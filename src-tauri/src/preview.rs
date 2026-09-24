use crate::types::{
    Authority, ChannelView, MAX_MARKERS, MAX_PREVIEW_SAMPLES, MAX_STREAMS, MarkerEvent,
    PreviewSample, StreamRecord, StreamView,
};
use chrono::Utc;
use labstream::{Buffer, Chunk, Format, Inlet, Post, Query, StreamInfo};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

pub struct PreviewService {
    started: Mutex<HashMap<String, Arc<AtomicBool>>>,
    excluded_source_id: String,
}

impl PreviewService {
    pub fn new(excluded_source_id: String) -> Self {
        Self {
            started: Mutex::new(HashMap::new()),
            excluded_source_id,
        }
    }

    pub fn refresh(&self, authority: &Arc<Mutex<Authority>>) -> Result<usize, String> {
        let infos = labstream::resolve_all(&Query::all(), Duration::from_millis(900))
            .map_err(|error| format!("LSL discovery failed: {error}"))?;
        let mut unique = HashMap::<String, StreamInfo>::new();
        for info in infos
            .into_iter()
            .filter(|info| info.source_id() != self.excluded_source_id)
        {
            if unique.len() == MAX_STREAMS {
                break;
            }
            unique.entry(stream_id(&info)).or_insert(info);
        }

        let stale;
        {
            let mut state = authority
                .lock()
                .map_err(|_| "State lock failed.".to_string())?;
            stale = state
                .streams
                .keys()
                .filter(|id| !unique.contains_key(*id))
                .cloned()
                .collect::<Vec<_>>();
            for id in &stale {
                state.streams.remove(id);
                state.selected_ids.remove(id);
                state.revision += 1;
                state.control_revision += 1;
            }
            for (id, info) in &unique {
                if let std::collections::hash_map::Entry::Vacant(entry) =
                    state.streams.entry(id.clone())
                {
                    entry.insert(stream_record(id, info));
                    state.revision += 1;
                    state.control_revision += 1;
                }
                if state.recording.phase != "recording"
                    && state.select_all_streams
                    && state.selected_ids.insert(id.clone())
                {
                    state.revision += 1;
                    state.control_revision += 1;
                }
            }
        }

        let mut started = self
            .started
            .lock()
            .map_err(|_| "Preview registry lock failed.".to_string())?;
        for id in stale {
            if let Some(active) = started.remove(&id) {
                active.store(false, Ordering::Release);
            }
        }
        for (id, info) in unique {
            if started
                .get(&id)
                .is_some_and(|active| active.load(Ordering::Acquire))
            {
                continue;
            }
            let active = Arc::new(AtomicBool::new(true));
            started.insert(id.clone(), active.clone());
            start_preview_thread(authority.clone(), id, info, active);
        }

        let count = authority
            .lock()
            .map_err(|_| "State lock failed.".to_string())?
            .streams
            .len();
        Ok(count)
    }
}

fn stream_id(info: &StreamInfo) -> String {
    if info.source_id().trim().is_empty() {
        format!(
            "{}|{}|{}|{}|{}",
            info.name(),
            info.stream_type(),
            info.hostname(),
            info.channel_count(),
            info.rate()
        )
    } else {
        format!("source:{}", info.source_id())
    }
}

fn stream_record(id: &str, info: &StreamInfo) -> StreamRecord {
    let marker = is_marker(info);
    let query = if info.source_id().trim().is_empty() {
        Query::name(info.name())
            .and(Query::stream_type(info.stream_type()))
            .and(Query::property("hostname", info.hostname()))
    } else {
        Query::source_id(info.source_id())
    };
    StreamRecord {
        view: StreamView {
            id: id.to_string(),
            name: info.name().to_string(),
            stream_type: info.stream_type().to_string(),
            hostname: info.hostname().to_string(),
            source_id: info.source_id().to_string(),
            channel_count: info.channel_count(),
            channels: Vec::new(),
            nominal_rate: info.rate(),
            format: format!("{:?}", info.format()),
            is_marker: marker,
            selected: true,
            connected: false,
            dropped_samples: 0,
            error: None,
            preview: Vec::new(),
        },
        query: query.as_str().to_string(),
    }
}

fn is_marker(info: &StreamInfo) -> bool {
    let kind = info.stream_type().to_ascii_lowercase();
    info.format() == Format::String
        || kind.contains("marker")
        || kind.contains("event")
        || kind.contains("trigger")
}

fn start_preview_thread(
    authority: Arc<Mutex<Authority>>,
    id: String,
    info: StreamInfo,
    active: Arc<AtomicBool>,
) {
    thread::Builder::new()
        .name(format!("lsl-preview-{}", thread_safe_name(&id)))
        .spawn(move || {
            let marker = is_marker(&info);
            let inlet = Inlet::builder(&info)
                .buffer(if marker {
                    Buffer::Samples(512)
                } else {
                    Buffer::Seconds(3.0)
                })
                .postprocess(Post::ALL)
                .open(Duration::from_secs(3));
            let mut inlet = match inlet {
                Ok(inlet) => inlet,
                Err(error) => {
                    if active.load(Ordering::Acquire) {
                        update_error(
                            &authority,
                            &id,
                            format!("Preview connection failed: {error}"),
                            &active,
                        );
                    }
                    active.store(false, Ordering::Release);
                    return;
                }
            };
            if !active.load(Ordering::Acquire) {
                return;
            }
            if let Ok(mut state) = authority.lock()
                && active.load(Ordering::Acquire)
                && let Some(stream) = state.streams.get_mut(&id)
            {
                stream.view.connected = true;
                stream.view.error = None;
                stream.view.channels = inlet
                    .info()
                    .channels()
                    .into_iter()
                    .map(|channel| ChannelView {
                        label: channel.label.chars().take(64).collect(),
                        unit: channel.unit.chars().take(32).collect(),
                    })
                    .collect();
            }

            if marker {
                run_marker_preview(&authority, &id, &mut inlet, &active);
            } else {
                run_signal_preview(&authority, &id, &mut inlet, &active);
            }
            active.store(false, Ordering::Release);
        })
        .ok();
}

fn run_marker_preview(
    authority: &Arc<Mutex<Authority>>,
    id: &str,
    inlet: &mut Inlet,
    active: &AtomicBool,
) {
    while active.load(Ordering::Acquire) {
        match inlet.pull_text(Duration::from_millis(100)) {
            Ok(Some((timestamp, values))) => {
                let mut state = match authority.lock() {
                    Ok(state) => state,
                    Err(_) => return,
                };
                if !active.load(Ordering::Acquire) || !state.streams.contains_key(id) {
                    return;
                }
                let name = state
                    .streams
                    .get(id)
                    .map(|stream| stream.view.name.clone())
                    .unwrap_or_else(|| id.to_string());
                state.next_marker_sequence += 1;
                let sequence = state.next_marker_sequence;
                state.markers.push_back(MarkerEvent {
                    sequence,
                    stream_id: id.to_string(),
                    stream_name: name,
                    lsl_timestamp: timestamp,
                    received_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                    value: values.join(" · "),
                });
                while state.markers.len() > MAX_MARKERS {
                    state.markers.pop_front();
                }
                state.revision += 1;
                if let Some(stream) = state.streams.get_mut(id) {
                    stream.view.dropped_samples = inlet.dropped();
                }
            }
            Ok(None) => {}
            Err(error) => {
                update_error(
                    authority,
                    id,
                    format!("Marker preview stopped: {error}"),
                    active,
                );
                return;
            }
        }
    }
}

fn run_signal_preview(
    authority: &Arc<Mutex<Authority>>,
    id: &str,
    inlet: &mut Inlet,
    active: &AtomicBool,
) {
    let channels = inlet.info().channel_count();
    let stride = (inlet.info().rate() / 100.0).ceil().max(1.0) as usize;
    let mut chunk = Chunk::<f64>::new(channels, 256);
    while active.load(Ordering::Acquire) {
        chunk.clear();
        match inlet.pull_chunk(&mut chunk, Duration::from_millis(50)) {
            Ok(0) => {}
            Ok(_) => {
                if let Ok(mut state) = authority.lock()
                    && active.load(Ordering::Acquire)
                    && let Some(stream) = state.streams.get_mut(id)
                {
                    stream.view.preview.extend(
                        chunk
                            .iter()
                            .enumerate()
                            .filter(|(index, _)| index % stride == 0)
                            .map(|(_, (timestamp, values))| PreviewSample {
                                timestamp,
                                values: values.to_vec(),
                            }),
                    );
                    if stream.view.preview.len() > MAX_PREVIEW_SAMPLES {
                        let remove = stream.view.preview.len() - MAX_PREVIEW_SAMPLES;
                        stream.view.preview.drain(0..remove);
                    }
                    stream.view.connected = true;
                    stream.view.dropped_samples = inlet.dropped();
                }
            }
            Err(error) => {
                update_error(
                    authority,
                    id,
                    format!("Signal preview stopped: {error}"),
                    active,
                );
                return;
            }
        }
    }
}

fn update_error(authority: &Arc<Mutex<Authority>>, id: &str, message: String, active: &AtomicBool) {
    if let Ok(mut state) = authority.lock()
        && active.load(Ordering::Acquire)
        && let Some(stream) = state.streams.get_mut(id)
    {
        stream.view.connected = false;
        stream.view.error = Some(message);
    }
}

fn thread_safe_name(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(24)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn irregular_numeric_streams_are_signals_and_string_events_are_markers() {
        let numeric = StreamInfo::builder("Intervals", "Data", Format::Float32)
            .channel_count(1)
            .irregular()
            .build()
            .unwrap();
        let marker = StreamInfo::builder("Events", "Markers", Format::String)
            .channel_count(1)
            .irregular()
            .build()
            .unwrap();
        assert!(!is_marker(&numeric));
        assert!(is_marker(&marker));
    }
}
