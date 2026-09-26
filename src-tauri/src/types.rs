use crate::workspace::{ExternalPage, ViewerPreferences};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

pub const MAX_STREAMS: usize = 64;
pub const MAX_PREVIEW_SAMPLES: usize = 300;
pub const MAX_MARKERS: usize = 200;
pub const MAX_LOG_LINES: usize = 100;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewSample {
    pub timestamp: f64,
    pub values: Vec<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelView {
    pub label: String,
    pub unit: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamView {
    pub id: String,
    pub name: String,
    pub stream_type: String,
    pub hostname: String,
    pub source_id: String,
    pub channel_count: usize,
    pub channels: Vec<ChannelView>,
    pub nominal_rate: f64,
    pub format: String,
    pub is_marker: bool,
    pub selected: bool,
    pub connected: bool,
    pub dropped_samples: u64,
    pub error: Option<String>,
    pub preview: Vec<PreviewSample>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkerEvent {
    pub sequence: u64,
    pub stream_id: String,
    pub stream_name: String,
    pub lsl_timestamp: f64,
    pub received_at: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingView {
    pub phase: String,
    pub output_file: Option<String>,
    pub started_at: Option<String>,
    pub bytes_written: u64,
    pub error: Option<String>,
}

impl Default for RecordingView {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            output_file: None,
            started_at: None,
            bytes_written: 0,
            error: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteView {
    pub active: bool,
    pub phase: String,
    pub route: String,
    pub controller_connected: bool,
    pub approval: String,
    pub controller_name: Option<String>,
}

impl Default for RemoteView {
    fn default() -> Self {
        Self {
            active: false,
            phase: "idle".into(),
            route: "unknown".into(),
            controller_connected: false,
            approval: "idle".into(),
            controller_name: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    pub revision: u64,
    pub control_revision: u64,
    pub select_all_streams: bool,
    pub keyboard_markers: bool,
    pub mouse_markers: bool,
    pub participant_id: String,
    pub output_directory: String,
    pub external_pages: Vec<ExternalPage>,
    pub external_pages_revision: u64,
    pub external_pages_initialized: bool,
    pub viewer: ViewerPreferences,
    pub workspace_warning: Option<String>,
    pub streams: Vec<StreamView>,
    pub markers: Vec<MarkerEvent>,
    pub recording: RecordingView,
    pub remote: RemoteView,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInvite {
    pub room: String,
    pub secret: String,
    pub grant_token: String,
    pub url: String,
    pub qr_svg: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteCommandRequest {
    pub grant_token: String,
    pub scope: String,
    pub action: String,
    #[serde(default)]
    pub args: serde_json::Value,
    pub expected_revision: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteCommandOutcome {
    pub ok: bool,
    pub revision: u64,
    pub result: serde_json::Value,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StreamRecord {
    pub view: StreamView,
    pub query: String,
}

#[derive(Debug, Clone)]
pub struct RemoteSession {
    pub grant_token: String,
}

pub struct Authority {
    pub revision: u64,
    pub control_revision: u64,
    pub select_all_streams: bool,
    pub keyboard_markers: bool,
    pub mouse_markers: bool,
    pub participant_id: String,
    pub output_directory: String,
    pub external_pages: Vec<ExternalPage>,
    pub external_pages_revision: u64,
    pub external_pages_initialized: bool,
    pub viewer: ViewerPreferences,
    pub workspace_warning: Option<String>,
    pub streams: HashMap<String, StreamRecord>,
    pub selected_ids: HashSet<String>,
    pub remembered_selected_ids: HashSet<String>,
    pub markers: VecDeque<MarkerEvent>,
    pub next_marker_sequence: u64,
    pub recording: RecordingView,
    pub remote: RemoteView,
    pub remote_session: Option<RemoteSession>,
    pub diagnostics: VecDeque<String>,
}

impl Authority {
    pub fn snapshot(&self) -> AppSnapshot {
        let mut streams = self
            .streams
            .values()
            .map(|record| {
                let mut view = record.view.clone();
                view.selected = self.selected_ids.contains(&view.id);
                view
            })
            .collect::<Vec<_>>();
        streams.sort_by(|a, b| {
            b.is_marker
                .cmp(&a.is_marker)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.hostname.cmp(&b.hostname))
        });
        AppSnapshot {
            revision: self.revision,
            control_revision: self.control_revision,
            select_all_streams: self.select_all_streams,
            keyboard_markers: self.keyboard_markers,
            mouse_markers: self.mouse_markers,
            participant_id: self.participant_id.clone(),
            output_directory: self.output_directory.clone(),
            external_pages: self.external_pages.clone(),
            external_pages_revision: self.external_pages_revision,
            external_pages_initialized: self.external_pages_initialized,
            viewer: self.viewer.clone(),
            workspace_warning: self.workspace_warning.clone(),
            streams,
            markers: self.markers.iter().rev().cloned().collect(),
            recording: self.recording.clone(),
            remote: self.remote.clone(),
            diagnostics: self.diagnostics.iter().cloned().collect(),
        }
    }

    pub fn log(&mut self, line: impl Into<String>) {
        self.diagnostics.push_back(line.into());
        while self.diagnostics.len() > MAX_LOG_LINES {
            self.diagnostics.pop_front();
        }
    }
}
