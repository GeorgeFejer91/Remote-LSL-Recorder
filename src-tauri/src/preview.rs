use crate::types::{
    Authority, MAX_MARKERS, MAX_PREVIEW_SAMPLES, MAX_STREAMS, MarkerEvent, PreviewSample,
    StreamRecord, StreamView,
};
use chrono::Utc;
use labstream::{Buffer, Chunk, Inlet, Post, Query, StreamInfo};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

pub struct PreviewService {
    started: Mutex<HashSet<String>>,
}

impl PreviewService {
    pub fn new() -> Self {
        Self {
            started: Mutex::new(HashSet::new()),
        }
    }

    pub fn refresh(&self, authority: &Arc<Mutex<Authority>>) -> Result<usize, String> {
        let infos = labstream::resolve_all(&Query::all(), Duration::from_millis(900))
            .map_err(|error| format!("LSL discovery failed: {error}"))?;
        let mut unique = HashMap::<String, StreamInfo>::new();
        for info in infos.into_iter().take(MAX_STREAMS) {
            unique.entry(stream_id(&info)).or_insert(info);
        }

        for (id, info) in &unique {
            let record = stream_record(id, info);
            let mut state = authority
                .lock()
                .map_err(|_| "State lock failed.".to_string())?;
            let previously_selected = state.selected_ids.contains(id);
            state.streams.insert(id.clone(), record);
            if !previously_selected && state.recording.phase == "idle" {
                state.selected_ids.insert(id.clone());
            }
        }

        let mut started = self
            .started
            .lock()
            .map_err(|_| "Preview registry lock failed.".to_string())?;
        for (id, info) in unique {
            if started.insert(id.clone()) {
                start_preview_thread(authority.clone(), id, info);
            }
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
    !info.is_regular()
        || kind.contains("marker")
        || kind.contains("event")
        || kind.contains("trigger")
}

fn start_preview_thread(authority: Arc<Mutex<Authority>>, id: String, info: StreamInfo) {
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
                    update_error(
                        &authority,
                        &id,
                        format!("Preview connection failed: {error}"),
                    );
                    return;
                }
            };
            if let Ok(mut state) = authority.lock()
                && let Some(stream) = state.streams.get_mut(&id)
            {
                stream.view.connected = true;
                stream.view.error = None;
            }

            if marker {
                run_marker_preview(&authority, &id, &mut inlet);
            } else {
                run_signal_preview(&authority, &id, &mut inlet);
            }
        })
        .ok();
}

fn run_marker_preview(authority: &Arc<Mutex<Authority>>, id: &str, inlet: &mut Inlet) {
    loop {
        match inlet.pull_text(Duration::from_millis(100)) {
            Ok(Some((timestamp, values))) => {
                let mut state = match authority.lock() {
                    Ok(state) => state,
                    Err(_) => return,
                };
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
                update_error(authority, id, format!("Marker preview stopped: {error}"));
                return;
            }
        }
    }
}

fn run_signal_preview(authority: &Arc<Mutex<Authority>>, id: &str, inlet: &mut Inlet) {
    let channels = inlet.info().channel_count();
    let mut chunk = Chunk::<f64>::new(channels, 256);
    loop {
        chunk.clear();
        match inlet.pull_chunk(&mut chunk, Duration::from_millis(50)) {
            Ok(0) => {}
            Ok(_) => {
                if let Some((timestamp, values)) = chunk.iter().last()
                    && let Ok(mut state) = authority.lock()
                    && let Some(stream) = state.streams.get_mut(id)
                {
                    stream.view.preview.push(PreviewSample {
                        timestamp,
                        values: values.iter().take(16).copied().collect(),
                    });
                    if stream.view.preview.len() > MAX_PREVIEW_SAMPLES {
                        let remove = stream.view.preview.len() - MAX_PREVIEW_SAMPLES;
                        stream.view.preview.drain(0..remove);
                    }
                    stream.view.connected = true;
                    stream.view.dropped_samples = inlet.dropped();
                }
            }
            Err(error) => {
                update_error(authority, id, format!("Signal preview stopped: {error}"));
                return;
            }
        }
    }
}

fn update_error(authority: &Arc<Mutex<Authority>>, id: &str, message: String) {
    if let Ok(mut state) = authority.lock()
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
