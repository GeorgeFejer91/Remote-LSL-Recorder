use crate::{
    preview::PreviewService,
    types::{
        AppSnapshot, Authority, MAX_MARKERS, MarkerEvent, RecordingView, RemoteCommandOutcome,
        RemoteCommandRequest, RemoteInvite, RemoteSession, RemoteView,
    },
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::Utc;
use labstream::{Format, Outlet, Query, StreamInfo};
use qrcode::{QrCode, render::svg};
use rand::RngCore;
use serde::Deserialize;
use serde_json::json;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

const COMPANION_URL: &str = "https://georgefejer91.github.io/Remote-LSL-Recorder/";

struct RecordingProcess {
    child: Child,
    stdin: Option<ChildStdin>,
    output_file: PathBuf,
}

pub struct AppState {
    authority: Arc<Mutex<Authority>>,
    preview: PreviewService,
    input_source_id: String,
    input_outlet: Mutex<Option<Outlet>>,
    recorder: Mutex<Option<RecordingProcess>>,
    engine_directory: PathBuf,
    shutting_down: AtomicBool,
}

impl AppState {
    pub fn new(output_directory: PathBuf, engine_directory: PathBuf) -> Self {
        let input_source_id = format!("remote-lsl-recorder-input-{}", random_token(12));
        let authority = Authority {
            revision: 0,
            control_revision: 0,
            keyboard_markers: false,
            mouse_markers: false,
            participant_id: String::new(),
            output_directory: output_directory.display().to_string(),
            streams: HashMap::new(),
            selected_ids: HashSet::new(),
            markers: VecDeque::new(),
            next_marker_sequence: 0,
            recording: RecordingView::default(),
            remote: RemoteView::default(),
            remote_session: None,
            diagnostics: VecDeque::new(),
        };
        Self {
            authority: Arc::new(Mutex::new(authority)),
            preview: PreviewService::new(input_source_id.clone()),
            input_source_id,
            input_outlet: Mutex::new(None),
            recorder: Mutex::new(None),
            engine_directory,
            shutting_down: AtomicBool::new(false),
        }
    }

    pub fn snapshot(&self) -> Result<AppSnapshot, String> {
        self.reconcile_process()?;
        let mut state = self
            .authority
            .lock()
            .map_err(|_| "State lock failed.".to_string())?;
        if let Some(path) = state.recording.output_file.as_deref() {
            state.recording.bytes_written = fs::metadata(path).map(|item| item.len()).unwrap_or(0);
        }
        Ok(state.snapshot())
    }

    pub fn refresh_streams(&self) -> Result<AppSnapshot, String> {
        let count = self.preview.refresh(&self.authority)?;
        let mut state = self
            .authority
            .lock()
            .map_err(|_| "State lock failed.".to_string())?;
        state.log(format!("Discovered {count} LSL stream(s)."));
        Ok(state.snapshot())
    }

    pub fn configure_session(
        &self,
        participant_id: String,
        output_directory: String,
    ) -> Result<AppSnapshot, String> {
        if self.is_recording()? {
            return Err("Stop the recording before changing session details.".into());
        }
        let participant_id = validate_participant(&participant_id)?;
        let output_directory = validate_output_directory(&output_directory)?;
        let mut state = self
            .authority
            .lock()
            .map_err(|_| "State lock failed.".to_string())?;
        let changed = state.participant_id != participant_id
            || state.output_directory != output_directory.display().to_string();
        state.participant_id = participant_id;
        state.output_directory = output_directory.display().to_string();
        if changed {
            state.revision += 1;
            state.control_revision += 1;
        }
        Ok(state.snapshot())
    }

    pub fn select_stream(&self, stream_id: String, selected: bool) -> Result<AppSnapshot, String> {
        if self.is_recording()? {
            return Err("Stream selection is locked while recording.".into());
        }
        let mut state = self
            .authority
            .lock()
            .map_err(|_| "State lock failed.".to_string())?;
        if !state.streams.contains_key(&stream_id) {
            return Err("The selected stream is no longer available.".into());
        }
        let changed = if selected {
            state.selected_ids.insert(stream_id)
        } else {
            state.selected_ids.remove(&stream_id)
        };
        if changed {
            state.revision += 1;
            state.control_revision += 1;
        }
        Ok(state.snapshot())
    }

    pub fn set_input_markers(&self, keyboard: bool, mouse: bool) -> Result<AppSnapshot, String> {
        if keyboard || mouse {
            self.ensure_input_outlet()?;
        }
        let mut state = self
            .authority
            .lock()
            .map_err(|_| "State lock failed.".to_string())?;
        if state.keyboard_markers != keyboard || state.mouse_markers != mouse {
            state.keyboard_markers = keyboard;
            state.mouse_markers = mouse;
            state.revision += 1;
            state.control_revision += 1;
        }
        Ok(state.snapshot())
    }

    pub fn emit_input_marker(&self, kind: String, detail: String) -> Result<(), String> {
        validate_input_marker(&kind, &detail)?;
        let enabled = {
            let state = self
                .authority
                .lock()
                .map_err(|_| "State lock failed.".to_string())?;
            match kind.as_str() {
                "key-down" | "key-up" => state.keyboard_markers,
                "mouse-click" => state.mouse_markers,
                _ => false,
            }
        };
        if !enabled {
            return Err("This input marker source is disabled.".into());
        }
        let value = format!("{kind} {detail}");
        let timestamp = labstream::clock();
        self.input_outlet
            .lock()
            .map_err(|_| "Input outlet lock failed.".to_string())?
            .as_ref()
            .ok_or_else(|| "Input marker stream is unavailable.".to_string())?
            .push_text_at(&value, timestamp)
            .map_err(|error| format!("Could not publish input marker: {error}"))?;
        let mut state = self
            .authority
            .lock()
            .map_err(|_| "State lock failed.".to_string())?;
        state.next_marker_sequence += 1;
        let sequence = state.next_marker_sequence;
        state.markers.push_back(MarkerEvent {
            sequence,
            stream_id: format!("source:{}", self.input_source_id),
            stream_name: "Recorder input".into(),
            lsl_timestamp: timestamp,
            received_at: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            value,
        });
        while state.markers.len() > MAX_MARKERS {
            state.markers.pop_front();
        }
        state.revision += 1;
        Ok(())
    }

    fn ensure_input_outlet(&self) -> Result<(), String> {
        let mut outlet = self
            .input_outlet
            .lock()
            .map_err(|_| "Input outlet lock failed.".to_string())?;
        if outlet.is_none() {
            let info = StreamInfo::builder("Recorder input", "Markers", Format::String)
                .irregular()
                .channel_count(1)
                .source_id(&self.input_source_id)
                .build()
                .map_err(|error| format!("Could not describe input marker stream: {error}"))?;
            *outlet = Some(
                Outlet::new(info)
                    .map_err(|error| format!("Could not publish input marker stream: {error}"))?,
            );
        }
        Ok(())
    }

    pub fn start_recording(&self) -> Result<AppSnapshot, String> {
        let mut recorder = self
            .recorder
            .lock()
            .map_err(|_| "Recorder lock failed.".to_string())?;
        if recorder.is_some() {
            return Err("A recording is already active.".into());
        }

        let (participant_id, output_directory, mut queries) = {
            let state = self
                .authority
                .lock()
                .map_err(|_| "State lock failed.".to_string())?;
            let participant = validate_participant(&state.participant_id)?;
            let output = validate_output_directory(&state.output_directory)?;
            let queries = state
                .selected_ids
                .iter()
                .filter_map(|id| state.streams.get(id).map(|record| record.query.clone()))
                .collect::<Vec<_>>();
            if queries.is_empty() && !state.keyboard_markers && !state.mouse_markers {
                return Err("Select at least one available LSL stream.".into());
            }
            (participant, output, queries)
        };

        self.ensure_input_outlet()?;
        queries.push(Query::source_id(&self.input_source_id).as_str().to_string());

        let executable = self.engine_directory.join("LabRecorderCLI.exe");
        let lsl_library = self.engine_directory.join("lsl.dll");
        if !executable.is_file() || !lsl_library.is_file() {
            return Err(
                "The recording engine is missing. Run scripts/fetch-labrecorder.ps1 and restart the app."
                    .into(),
            );
        }

        let output_file = next_output_file(&output_directory, &participant_id);
        let combined_query = queries
            .iter()
            .map(|query| format!("({query})"))
            .collect::<Vec<_>>()
            .join(" or ");
        let mut command = Command::new(&executable);
        command
            .current_dir(&self.engine_directory)
            .arg(&output_file)
            .arg(combined_query)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start LabRecorder: {error}"))?;
        let stdin = child.stdin.take();
        pipe_log(child.stdout.take(), self.authority.clone(), "LabRecorder");
        pipe_log(
            child.stderr.take(),
            self.authority.clone(),
            "LabRecorder error",
        );

        *recorder = Some(RecordingProcess {
            child,
            stdin,
            output_file: output_file.clone(),
        });
        let mut state = self
            .authority
            .lock()
            .map_err(|_| "State lock failed.".to_string())?;
        state.recording = RecordingView {
            phase: "recording".into(),
            output_file: Some(output_file.display().to_string()),
            started_at: Some(Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)),
            bytes_written: 0,
            error: None,
        };
        state.revision += 1;
        state.control_revision += 1;
        state.log("Recording started.");
        Ok(state.snapshot())
    }

    pub fn stop_recording(&self) -> Result<AppSnapshot, String> {
        let mut recorder = self
            .recorder
            .lock()
            .map_err(|_| "Recorder lock failed.".to_string())?;
        let mut process = recorder
            .take()
            .ok_or_else(|| "No recording is active.".to_string())?;

        thread::sleep(Duration::from_millis(600));
        if let Some(mut stdin) = process.stdin.take()
            && let Err(error) = stdin.write_all(b"\n").and_then(|_| stdin.flush())
        {
            let _ = process.child.kill();
            let _ = process.child.wait();
            let message = format!("Could not request a clean recorder stop: {error}");
            return Err(self.recording_failure(&process.output_file, message));
        }
        let deadline = Instant::now() + Duration::from_secs(10);
        let status = loop {
            match process.child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(50)),
                Ok(None) => {
                    let message = match process.child.kill() {
                        Ok(()) => "Recorder did not finish its XDF footer within 10 seconds; the owned process was terminated.".to_string(),
                        Err(error) => format!("Recorder did not stop and could not be terminated: {error}"),
                    };
                    let _ = process.child.wait();
                    return Err(self.recording_failure(&process.output_file, message));
                }
                Err(error) => {
                    let _ = process.child.kill();
                    let _ = process.child.wait();
                    let message = format!("Could not observe recorder shutdown: {error}");
                    return Err(self.recording_failure(&process.output_file, message));
                }
            }
        };
        let bytes = fs::metadata(&process.output_file)
            .map(|item| item.len())
            .unwrap_or(0);
        let mut state = self
            .authority
            .lock()
            .map_err(|_| "State lock failed.".to_string())?;
        state.recording.phase = if status.success() {
            "complete".into()
        } else {
            "error".into()
        };
        state.recording.bytes_written = bytes;
        state.recording.error =
            (!status.success()).then(|| format!("LabRecorder exited with {status}."));
        state.revision += 1;
        state.control_revision += 1;
        state.log(if status.success() {
            "Recording stopped cleanly.".to_string()
        } else {
            format!("Recording stopped with {status}.")
        });
        Ok(state.snapshot())
    }

    pub fn start_remote(&self) -> Result<RemoteInvite, String> {
        let room = format!("rlslr_{}", random_token(12));
        let secret = random_token(24);
        let grant_token = random_token(32);
        let url = format!("{COMPANION_URL}#room={room}&secret={secret}");
        let code =
            QrCode::new(url.as_bytes()).map_err(|error| format!("QR creation failed: {error}"))?;
        let qr_svg = code.render::<svg::Color>().min_dimensions(256, 256).build();
        let mut state = self
            .authority
            .lock()
            .map_err(|_| "State lock failed.".to_string())?;
        state.remote_session = Some(RemoteSession {
            grant_token: grant_token.clone(),
        });
        state.remote = RemoteView {
            active: true,
            phase: "waiting".into(),
            route: "unknown".into(),
            controller_connected: false,
            approval: "waiting".into(),
            controller_name: None,
        };
        state.revision += 1;
        state.control_revision += 1;
        Ok(RemoteInvite {
            room,
            secret,
            grant_token,
            url,
            qr_svg,
        })
    }

    pub fn stop_remote(&self) -> Result<AppSnapshot, String> {
        let mut state = self
            .authority
            .lock()
            .map_err(|_| "State lock failed.".to_string())?;
        state.remote_session = None;
        state.remote = RemoteView::default();
        state.revision += 1;
        state.control_revision += 1;
        Ok(state.snapshot())
    }

    pub fn report_remote_status(
        &self,
        grant_token: String,
        phase: String,
        route: String,
        connected: bool,
    ) -> Result<(), String> {
        validate_status_token(&phase, "phase")?;
        validate_status_token(&route, "route")?;
        let mut state = self
            .authority
            .lock()
            .map_err(|_| "State lock failed.".to_string())?;
        let session = state
            .remote_session
            .as_ref()
            .ok_or_else(|| "Remote access is not active.".to_string())?;
        if session.grant_token != grant_token {
            return Err("Remote grant was rejected.".into());
        }
        state.remote.phase = phase;
        state.remote.route = route;
        state.remote.controller_connected = connected;
        if matches!(
            state.remote.phase.as_str(),
            "disconnected" | "closed" | "error"
        ) {
            state.remote_session = None;
            state.remote.active = false;
            state.remote.approval = "revoked".into();
            state.remote.controller_name = None;
            state.revision += 1;
            state.control_revision += 1;
        }
        Ok(())
    }

    pub fn decide_remote(&self, approved: bool) -> Result<AppSnapshot, String> {
        let mut state = self
            .authority
            .lock()
            .map_err(|_| "State lock failed.".to_string())?;
        if state.remote_session.is_none() || state.remote.approval != "pending" {
            return Err("No phone is waiting for approval.".into());
        }
        state.remote.approval = if approved { "approved" } else { "denied" }.into();
        state.revision += 1;
        state.control_revision += 1;
        Ok(state.snapshot())
    }

    pub fn remote_command(
        &self,
        request: RemoteCommandRequest,
    ) -> Result<RemoteCommandOutcome, String> {
        let revision = {
            let mut state = self
                .authority
                .lock()
                .map_err(|_| "State lock failed.".to_string())?;
            let session = state
                .remote_session
                .as_ref()
                .ok_or_else(|| "Remote access is not active.".to_string())?;
            if session.grant_token != request.grant_token {
                return Err("Remote grant was rejected.".into());
            }
            if request.action == "request-access" {
                if request.scope != "pairing.request" || state.remote.approval != "waiting" {
                    return Ok(rejected_command(state.revision, "request_denied"));
                }
                let args: PairingArgs = serde_json::from_value(request.args)
                    .map_err(|_| "Invalid pairing request.".to_string())?;
                let name = args.name.trim();
                if name.is_empty()
                    || name.chars().count() > 48
                    || name.chars().any(char::is_control)
                {
                    return Err("Phone name must contain 1 to 48 printable characters.".into());
                }
                state.remote.controller_name = Some(name.to_string());
                state.remote.approval = "pending".into();
                state.revision += 1;
                state.control_revision += 1;
                return Ok(RemoteCommandOutcome {
                    ok: true,
                    revision: state.revision,
                    result: json!({ "requested": true }),
                    error: None,
                });
            }
            if request.scope != "recording.control" {
                return Ok(rejected_command(state.revision, "scope_denied"));
            }
            if state.remote.approval != "approved" {
                return Ok(rejected_command(state.revision, "approval_required"));
            }
            if let Some(expected) = request.expected_revision
                && expected != state.control_revision
            {
                return Ok(rejected_command(state.revision, "revision_conflict"));
            }
            state.revision
        };

        let result = match request.action.as_str() {
            "set-participant" => {
                let args: ParticipantArgs = serde_json::from_value(request.args)
                    .map_err(|_| "Invalid participant command.".to_string())?;
                let output = self.snapshot()?.output_directory;
                self.configure_session(args.participant_id, output)?;
                json!({ "configured": true })
            }
            "set-stream-selected" => {
                let args: StreamSelectionArgs = serde_json::from_value(request.args)
                    .map_err(|_| "Invalid stream selection command.".to_string())?;
                self.select_stream(args.stream_id, args.selected)?;
                json!({ "selected": args.selected })
            }
            "start-recording" => {
                ensure_empty_object(&request.args)?;
                let snapshot = self.start_recording()?;
                json!({ "phase": snapshot.recording.phase })
            }
            "stop-recording" => {
                ensure_empty_object(&request.args)?;
                let snapshot = self.stop_recording()?;
                json!({ "phase": snapshot.recording.phase })
            }
            "refresh-streams" => {
                ensure_empty_object(&request.args)?;
                let snapshot = self.refresh_streams()?;
                json!({ "streamCount": snapshot.streams.len() })
            }
            "set-input-markers" => {
                let args: InputMarkerArgs = serde_json::from_value(request.args)
                    .map_err(|_| "Invalid input marker command.".to_string())?;
                let snapshot = self.set_input_markers(args.keyboard, args.mouse)?;
                json!({ "keyboard": snapshot.keyboard_markers, "mouse": snapshot.mouse_markers })
            }
            _ => {
                return Ok(rejected_command(revision, "unsupported_command"));
            }
        };
        let current = self.snapshot()?.revision;
        Ok(RemoteCommandOutcome {
            ok: true,
            revision: current,
            result,
            error: None,
        })
    }

    pub fn shutdown(&self) {
        if self.is_recording().unwrap_or(false) {
            let _ = self.stop_recording();
        }
        let _ = self.stop_remote();
        if let Ok(mut outlet) = self.input_outlet.lock() {
            outlet.take();
        }
    }

    pub fn begin_shutdown(&self) -> bool {
        !self.shutting_down.swap(true, Ordering::AcqRel)
    }

    fn is_recording(&self) -> Result<bool, String> {
        Ok(self
            .recorder
            .lock()
            .map_err(|_| "Recorder lock failed.".to_string())?
            .is_some())
    }

    fn reconcile_process(&self) -> Result<(), String> {
        let mut recorder = self
            .recorder
            .lock()
            .map_err(|_| "Recorder lock failed.".to_string())?;
        let status = match recorder.as_mut() {
            Some(process) => process
                .child
                .try_wait()
                .map_err(|error| format!("Could not inspect LabRecorder: {error}"))?,
            None => None,
        };
        if let Some(status) = status {
            let finished = recorder.take().expect("recording process exists");
            let bytes = fs::metadata(&finished.output_file)
                .map(|item| item.len())
                .unwrap_or(0);
            let mut state = self
                .authority
                .lock()
                .map_err(|_| "State lock failed.".to_string())?;
            state.recording.phase = "error".into();
            state.recording.bytes_written = bytes;
            state.recording.error = Some(format!("LabRecorder exited unexpectedly with {status}."));
            state.revision += 1;
            state.control_revision += 1;
        }
        Ok(())
    }

    fn recording_failure(&self, output_file: &Path, message: String) -> String {
        let bytes = fs::metadata(output_file)
            .map(|item| item.len())
            .unwrap_or(0);
        if let Ok(mut state) = self.authority.lock() {
            state.recording.phase = "error".into();
            state.recording.bytes_written = bytes;
            state.recording.error = Some(message.clone());
            state.revision += 1;
            state.control_revision += 1;
            state.log(message.clone());
        }
        message
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ParticipantArgs {
    participant_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StreamSelectionArgs {
    stream_id: String,
    selected: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PairingArgs {
    name: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InputMarkerArgs {
    keyboard: bool,
    mouse: bool,
}

fn rejected_command(revision: u64, error: &str) -> RemoteCommandOutcome {
    RemoteCommandOutcome {
        ok: false,
        revision,
        result: serde_json::Value::Null,
        error: Some(error.into()),
    }
}

fn validate_participant(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 64 {
        return Err("Participant ID must contain 1 to 64 characters.".into());
    }
    if value.chars().any(|character| {
        character.is_control()
            || matches!(
                character,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            )
    }) {
        return Err("Participant ID contains a character that is unsafe in a file name.".into());
    }
    Ok(value.to_string())
}

fn validate_output_directory(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value.trim());
    if !path.is_absolute() {
        return Err("Recording folder must be an absolute path.".into());
    }
    fs::create_dir_all(&path)
        .map_err(|error| format!("Could not create the recording folder: {error}"))?;
    path.canonicalize()
        .map_err(|error| format!("Could not resolve the recording folder: {error}"))
}

fn next_output_file(directory: &Path, participant: &str) -> PathBuf {
    let safe = participant
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let base = format!("{safe}_{timestamp}");
    let first = directory.join(format!("{base}.xdf"));
    if !first.exists() {
        return first;
    }
    for index in 2..10_000 {
        let candidate = directory.join(format!("{base}_{index}.xdf"));
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{base}_{}.xdf", random_token(6)))
}

fn random_token(bytes: usize) -> String {
    let mut value = vec![0_u8; bytes];
    rand::rng().fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

fn validate_status_token(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 32
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(format!("Remote {label} is invalid."));
    }
    Ok(())
}

fn validate_input_marker(kind: &str, detail: &str) -> Result<(), String> {
    if !matches!(kind, "key-down" | "key-up" | "mouse-click") {
        return Err("Input marker kind is invalid.".into());
    }
    if detail.is_empty() || detail.chars().count() > 256 || detail.chars().any(char::is_control) {
        return Err("Input marker detail is invalid.".into());
    }
    Ok(())
}

fn ensure_empty_object(value: &serde_json::Value) -> Result<(), String> {
    match value {
        serde_json::Value::Object(map) if map.is_empty() => Ok(()),
        _ => Err("Command arguments must be an empty object.".into()),
    }
}

fn pipe_log<R>(reader: Option<R>, authority: Arc<Mutex<Authority>>, label: &'static str)
where
    R: std::io::Read + Send + 'static,
{
    let Some(reader) = reader else { return };
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            let line = line.trim();
            if !line.is_empty()
                && let Ok(mut state) = authority.lock()
            {
                state.log(format!("{label}: {}", truncate(line, 500)));
            }
        }
    });
}

fn truncate(value: &str, maximum: usize) -> String {
    value.chars().take(maximum).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn participant_ids_reject_path_characters() {
        assert!(validate_participant("P001").is_ok());
        assert!(validate_participant("../P001").is_err());
        assert!(validate_participant("P001/visit").is_err());
    }

    #[test]
    fn output_name_is_xdf_and_keeps_a_safe_participant_id() {
        let path = next_output_file(Path::new("C:\\recordings"), "P 001");
        let name = path.file_name().unwrap().to_string_lossy();
        assert!(name.starts_with("P_001_"));
        assert!(name.ends_with(".xdf"));
    }

    #[test]
    fn marker_updates_do_not_invalidate_remote_control_revision() {
        let app = AppState::new(PathBuf::from("C:\\recordings"), PathBuf::new());
        let invite = app.start_remote().unwrap();
        app.remote_command(RemoteCommandRequest {
            grant_token: invite.grant_token.clone(),
            scope: "pairing.request".into(),
            action: "request-access".into(),
            args: json!({ "name": "Phone" }),
            expected_revision: None,
        })
        .unwrap();
        app.decide_remote(true).unwrap();
        let control_revision = app.snapshot().unwrap().control_revision;
        {
            let mut state = app.authority.lock().unwrap();
            state.revision += 1;
            state.next_marker_sequence += 1;
        }
        let outcome = app
            .remote_command(RemoteCommandRequest {
                grant_token: invite.grant_token,
                scope: "recording.control".into(),
                action: "unknown-action".into(),
                args: json!({}),
                expected_revision: Some(control_revision),
            })
            .unwrap();
        assert_eq!(outcome.error.as_deref(), Some("unsupported_command"));
    }

    #[test]
    fn phone_commands_require_named_local_approval_and_disconnect_revokes_it() {
        let app = AppState::new(PathBuf::from("C:\\recordings"), PathBuf::new());
        let invite = app.start_remote().unwrap();
        let command = || RemoteCommandRequest {
            grant_token: invite.grant_token.clone(),
            scope: "recording.control".into(),
            action: "unknown-action".into(),
            args: json!({}),
            expected_revision: None,
        };
        assert_eq!(
            app.remote_command(command()).unwrap().error.as_deref(),
            Some("approval_required")
        );
        let requested = app
            .remote_command(RemoteCommandRequest {
                grant_token: invite.grant_token.clone(),
                scope: "pairing.request".into(),
                action: "request-access".into(),
                args: json!({ "name": "Alice's phone" }),
                expected_revision: None,
            })
            .unwrap();
        assert!(requested.ok);
        let pending = app.snapshot().unwrap();
        assert_eq!(pending.remote.approval, "pending");
        assert_eq!(
            pending.remote.controller_name.as_deref(),
            Some("Alice's phone")
        );
        assert_eq!(
            app.remote_command(command()).unwrap().error.as_deref(),
            Some("approval_required")
        );
        app.decide_remote(true).unwrap();
        assert_eq!(
            app.remote_command(command()).unwrap().error.as_deref(),
            Some("unsupported_command")
        );
        app.report_remote_status(
            invite.grant_token.clone(),
            "disconnected".into(),
            "unknown".into(),
            false,
        )
        .unwrap();
        assert!(app.remote_command(command()).is_err());

        let next = app.start_remote().unwrap();
        app.remote_command(RemoteCommandRequest {
            grant_token: next.grant_token.clone(),
            scope: "pairing.request".into(),
            action: "request-access".into(),
            args: json!({ "name": "Bob" }),
            expected_revision: None,
        })
        .unwrap();
        app.decide_remote(false).unwrap();
        assert_eq!(app.snapshot().unwrap().remote.approval, "denied");
        assert_eq!(
            app.remote_command(RemoteCommandRequest {
                grant_token: next.grant_token,
                scope: "recording.control".into(),
                action: "unknown-action".into(),
                args: json!({}),
                expected_revision: None,
            })
            .unwrap()
            .error
            .as_deref(),
            Some("approval_required")
        );
    }

    #[test]
    fn input_markers_reject_unbounded_or_unknown_events() {
        assert!(validate_input_marker("key-down", r#"{"key":"a"}"#).is_ok());
        assert!(validate_input_marker("pointer-move", "x=1").is_err());
        assert!(validate_input_marker("mouse-click", &"x".repeat(257)).is_err());
    }

    #[test]
    fn enabled_input_markers_reach_the_authoritative_timeline() {
        let app = AppState::new(PathBuf::from("C:\\recordings"), PathBuf::new());
        assert!(
            app.emit_input_marker("key-down".into(), "a".into())
                .is_err()
        );
        app.set_input_markers(true, false).unwrap();
        let control_revision = app.snapshot().unwrap().control_revision;
        app.emit_input_marker("key-down".into(), "a".into())
            .unwrap();
        let snapshot = app.snapshot().unwrap();
        assert_eq!(snapshot.control_revision, control_revision);
        assert_eq!(snapshot.markers[0].value, "key-down a");
        assert!(snapshot.markers[0].lsl_timestamp.is_finite());
        assert!(
            app.emit_input_marker("mouse-click".into(), "x=1".into())
                .is_err()
        );
    }

    #[test]
    #[ignore = "requires the pinned Windows LabRecorder engine; run explicitly for an XDF smoke test"]
    fn labrecorder_captures_input_markers() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.for-ai-local");
        let output = root.join(format!("input-marker-smoke-{}", random_token(6)));
        let engine = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../vendor/labrecorder-win");
        let app = AppState::new(output.clone(), engine);
        app.configure_session("INPUT_TEST".into(), output.display().to_string())
            .unwrap();
        app.set_input_markers(true, true).unwrap();
        let started = app.start_recording().unwrap();
        thread::sleep(Duration::from_secs(2));
        app.set_input_markers(false, false).unwrap();
        assert!(
            app.emit_input_marker("key-down".into(), "ignored".into())
                .is_err()
        );
        app.set_input_markers(true, true).unwrap();
        app.emit_input_marker("key-down".into(), r#"{"key":"a"}"#.into())
            .unwrap();
        app.emit_input_marker("key-up".into(), r#"{"key":"a"}"#.into())
            .unwrap();
        app.emit_input_marker("mouse-click".into(), r#"{"button":0,"x":12,"y":34}"#.into())
            .unwrap();
        thread::sleep(Duration::from_secs(1));
        let stopped = app.stop_recording().unwrap();
        assert_eq!(stopped.recording.phase, "complete");
        assert!(stopped.recording.bytes_written > 0);
        println!("XDF: {}", started.recording.output_file.unwrap());
    }
}
