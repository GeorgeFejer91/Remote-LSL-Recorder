fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_snapshot",
            "refresh_streams",
            "configure_session",
            "configure_external_pages",
            "set_viewer_preferences",
            "select_stream",
            "select_all_streams",
            "set_input_markers",
            "emit_input_marker",
            "start_recording",
            "stop_recording",
            "start_remote",
            "stop_remote",
            "decide_remote",
            "report_remote_status",
            "remote_command",
        ]),
    ))
    .expect("failed to build recorder command permissions")
}
