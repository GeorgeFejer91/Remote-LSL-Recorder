mod preview;
mod state;
mod types;

use state::AppState;
use tauri::{AppHandle, Manager, State};
use types::{AppSnapshot, RemoteCommandOutcome, RemoteCommandRequest, RemoteInvite};

#[tauri::command]
fn get_snapshot(state: State<'_, AppState>) -> Result<AppSnapshot, String> {
    state.snapshot()
}

#[tauri::command]
async fn refresh_streams(app: AppHandle) -> Result<AppSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().refresh_streams())
        .await
        .map_err(|error| format!("Stream refresh task failed: {error}"))?
}

#[tauri::command]
fn configure_session(
    state: State<'_, AppState>,
    participant_id: String,
    output_directory: String,
) -> Result<AppSnapshot, String> {
    state.configure_session(participant_id, output_directory)
}

#[tauri::command]
fn select_stream(
    state: State<'_, AppState>,
    stream_id: String,
    selected: bool,
) -> Result<AppSnapshot, String> {
    state.select_stream(stream_id, selected)
}

#[tauri::command]
async fn set_input_markers(
    app: AppHandle,
    keyboard: bool,
    mouse: bool,
) -> Result<AppSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>().set_input_markers(keyboard, mouse)
    })
    .await
    .map_err(|error| format!("Input marker setup failed: {error}"))?
}

#[tauri::command]
fn emit_input_marker(
    state: State<'_, AppState>,
    kind: String,
    detail: String,
) -> Result<(), String> {
    state.emit_input_marker(kind, detail)
}

#[tauri::command]
async fn start_recording(app: AppHandle) -> Result<AppSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().start_recording())
        .await
        .map_err(|error| format!("Recorder start task failed: {error}"))?
}

#[tauri::command]
async fn stop_recording(app: AppHandle) -> Result<AppSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().stop_recording())
        .await
        .map_err(|error| format!("Recorder stop task failed: {error}"))?
}

#[tauri::command]
fn start_remote(state: State<'_, AppState>) -> Result<RemoteInvite, String> {
    state.start_remote()
}

#[tauri::command]
fn stop_remote(state: State<'_, AppState>) -> Result<AppSnapshot, String> {
    state.stop_remote()
}

#[tauri::command]
fn decide_remote(state: State<'_, AppState>, approved: bool) -> Result<AppSnapshot, String> {
    state.decide_remote(approved)
}

#[tauri::command]
fn report_remote_status(
    state: State<'_, AppState>,
    grant_token: String,
    phase: String,
    route: String,
    connected: bool,
) -> Result<(), String> {
    state.report_remote_status(grant_token, phase, route, connected)
}

#[tauri::command]
async fn remote_command(
    app: AppHandle,
    request: RemoteCommandRequest,
) -> Result<RemoteCommandOutcome, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AppState>().remote_command(request))
        .await
        .map_err(|error| format!("Remote command task failed: {error}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let documents = app.path().document_dir()?;
            let output = documents.join("Remote LSL Recordings");
            std::fs::create_dir_all(&output)?;
            let development_engine = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../vendor/labrecorder-win");
            let packaged_engine = app.path().resource_dir()?.join("labrecorder");
            let engine = if development_engine.join("LabRecorderCLI.exe").is_file() {
                development_engine
            } else {
                packaged_engine
            };
            app.manage(AppState::new(output, engine));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            refresh_streams,
            configure_session,
            select_stream,
            set_input_markers,
            emit_input_marker,
            start_recording,
            stop_recording,
            start_remote,
            stop_remote,
            decide_remote,
            report_remote_status,
            remote_command,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Remote LSL Recorder");

    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, code, .. } = event
            && app.state::<AppState>().begin_shutdown()
        {
            api.prevent_exit();
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                app.state::<AppState>().shutdown();
                app.exit(code.unwrap_or(0));
            });
        }
    });
}
