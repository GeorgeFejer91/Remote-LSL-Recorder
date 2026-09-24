# Remote LSL Recorder

A Windows-first Tauri application for discovering, viewing, and recording LSL
streams with an opt-in BRSP smartphone companion.

The desktop app records selected streams to XDF through the official
LabRecorder engine, while its Rust core owns session configuration, process
lifecycle, state, and remote authorization. The local interface includes live
signal previews and a marker timeline. Remote access is off until the operator
explicitly starts a fresh pairing session.

The viewer stacks every channel from recording-selected numeric streams in one
scrollable preview. Each channel rescales independently to its current 300
display samples. Drag the preview's lower border to change its height or the
divider beside the setup panel to change its width. **Fit all channels to
window** compresses the rows into the preview without an inner scrollbar;
uncheck it to return to taller, scrollable rows. The **Display channels**
checkboxes affect the preview only. Stream checkboxes in the left panel decide
which streams the recorder saves to XDF.

Keyboard and mouse marker checkboxes capture input delivered to the recorder
window. Keyboard markers contain key down/up, key, code, repeat, and modifiers;
mouse markers contain the button and window/screen coordinates at button press.
They are off by default. When enabled, the app publishes a one-channel LSL
marker stream named `Recorder input` and shows the events in the marker table.
The recorder includes that stream in XDF, including when a toggle is enabled
after recording starts. Input in other applications is outside this capture.

## Phone pairing

1. On the computer, open **Phone remote** and select **Start phone access**.
2. Scan the QR code, enter a name on the phone, and tap **Connect**.
3. Check the name on the computer and select **Allow**. **Deny** refuses the request.

The phone can then set the participant ID, refresh and select streams, toggle
computer input markers, and start or stop recording. The computer owns the XDF
file and returns a compact live view: recording bytes, stream activity, a small
first-channel trace for each signal, and recent markers with LSL timestamps.
The trace is built on the phone from one current value per update; full signal
buffers stay on the computer. Choose the recording folder on the computer. Closing the
connection or selecting **Stop phone access** revokes approval; start a new
session to reconnect. The link uses VDO.Ninja data-only WebRTC and requires
Internet signaling.

## Development

Requirements: Rust 1.88 or newer, Node.js 22 or newer, pnpm, and the Windows
WebView2 runtime.

```powershell
pnpm install
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fetch-labrecorder.ps1
pnpm tauri dev
```

Run `pnpm check` for the source and test gates. Downloaded vendor binaries,
recordings, invitations, and participant data are never committed.

## Windows installer

On Windows x86_64, prepare the pinned LabRecorder engine and build the NSIS
installer:

```powershell
pnpm install --frozen-lockfile
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fetch-labrecorder.ps1
pnpm tauri build --bundles nsis
```

The installer is written to `src-tauri/target/release/bundle/nsis/`. It bundles
the LabRecorder CLI and an offline WebView2 installer. The phone controller
needs Internet access for VDO.Ninja signaling even when the devices share Wi-Fi.

AI-agent project context starts at [`for-ai/README.md`](./for-ai/README.md).

Repository: https://github.com/GeorgeFejer91/Remote-LSL-Recorder
The static `companion/` source is published from the repository's `gh-pages`
branch at <https://georgefejer91.github.io/Remote-LSL-Recorder/>.
