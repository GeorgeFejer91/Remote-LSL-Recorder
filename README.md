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
checkboxes affect the preview only. Stream checkboxes under **Signals** decide
which available streams the recorder saves to XDF. Discovery updates them
automatically. **Record all available streams** selects new arrivals when on;
turning it off clears the selection. Stream selection is locked during a
recording, so a stream arriving mid-recording is available for the next XDF.

Keyboard and mouse marker checkboxes capture input delivered to the recorder
window. Keyboard markers contain key down/up, key, code, repeat, and modifiers;
mouse markers contain the button and window/screen coordinates at button press.
They are off by default. When enabled, the app publishes a one-channel LSL
marker stream named `Recorder input` and shows the events in the marker table.
The recorder includes that stream in XDF, including when a toggle is enabled
after recording starts. Input in other applications is outside this capture.

## Record and play VLC+

With VLC+ installed, open a local video paused with its loopback control enabled:

The helper selects English RC responses, which this local integration expects.

```powershell
./scripts/start-vlc-session.ps1 -VideoPath 'C:\path\to\dictator-3-study.mp4'
```

In Recorder, apply the participant and recording folder, then select that
player's `VLC_Flubber_Affect` and `VLC_Flubber_Markers` streams. Hover a stream
to check its process-specific source ID. **VLC+ setup** holds the matching
control port (42123 by default). **Record and play VLC+** checks that a video
is loaded and paused, starts XDF recording, waits for the selected stream
headers, and asks VLC+ to play. It confirms VLC's playing state. These are
ordered operations, not a claim of simultaneous hardware/display onset.

Errors remain visible. If playback fails after recording starts, Recorder
finishes the partial XDF and retains its path. **Stop recording** finishes XDF
without changing VLC playback. The button controls only the explicitly chosen
loopback RC endpoint and does not enable phone access. Keep the port local and
choose the same player's streams; RC itself does not authenticate other local
programs. Runtime qualification uses `scripts/check-native-vlc-recording.mjs`;
`scripts/check-record-and-play.mjs` tests rendered controls with mocked native
IPC and does not establish real recording.

## Phone pairing

1. On the computer, open **Phone remote** and select **Start phone access**.
2. Scan the QR code, enter a name on the phone, and tap **Connect**.
3. Check the name on the computer and select **Allow**. **Deny** refuses the request.

The phone can then set the participant ID, select streams, toggle
computer input markers, and start or stop recording. The computer owns the XDF
file and returns a compact live view: recording bytes, stream activity, a small
first-channel trace for each signal, and recent markers with LSL timestamps.
The trace is built on the phone from one current value per update; full signal
buffers stay on the computer. Choose the recording folder on the computer. Closing the
connection or selecting **Stop phone access** revokes approval; start a new
session to reconnect. The link uses VDO.Ninja data-only WebRTC and requires
Internet signaling.

## External experiment pages

Select **+** on the desktop to add an experiment controller tab. Give it a
name and HTTPS page/invitation URL, or import the app's `panel.json` descriptor.
After scanning the recorder QR code and receiving desktop approval, the phone
automatically receives those panels. Desktop additions, edits, and removals
follow over the existing BRSP connection. Personal phone tabs remain available.
Use each experiment page's own Connect/approval controls. Switching tabs keeps
pages mounted; **Unload** disconnects the page and **Close tab** removes it.

The PC automatically saves the applied participant ID, output directory,
stream-selection policy and remembered stream IDs, input-marker toggles,
viewer layout/channel preferences, and panel catalog in its app-config
`workspace.json`. On startup it restores settings and preloads panel base URLs,
with recording stopped and phone access inactive. URL queries/fragments and
session grants are never written to that file. Current panel invitation URLs
are shared only with an approved phone; its mirrored panels are discarded when
that recorder session ends.

The page must support sandboxed embedding. Its VDO.Ninja connection goes to
its own experiment program, which publishes LSL signals and trial markers for
the recorder. Follow the [external-page integration procedure](docs/external-pages.md)
for hosting, BRSP wiring, isolation, and acceptance checks.
Other applications can follow the [Remote Panel/1 profile](docs/remote-panel-profile.md)
and its [JSON schema](docs/remote-panel.schema.json).

**Share panel** creates a local QR code and a link that opens this panel in the
phone viewer. **Download panel JSON** exports its stable base URL. Invitation
queries/fragments are excluded; app pairing remains separate.
[Respyra 2.0](docs/respyra-panel.md) is the first integrated experiment viewer.

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

For the optional rendered tab gate, use an available Playwright installation
(`PLAYWRIGHT_MODULE` may point to its package directory) and run
`node scripts/check-external-tabs.mjs`. It uses Edge by default; set
`PLAYWRIGHT_CHANNEL` for another installed Chromium channel. Screenshots go to
ignored `.for-ai-local/external-tabs/`. This gate uses a deterministic browser
BRSP fixture and a desktop IPC fake; it does not claim a live VDO or native run.

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

Experimental Windows downloads are published in [GitHub Releases](https://github.com/GeorgeFejer91/Remote-LSL-Recorder/releases).
The application version remains 0.1.7; an `experimental` release tag identifies
the qualification channel. Each release includes SHA256 checksums, source and
dependency provenance, and licensing notices. Experimental installers are unsigned.

NSIS installs for the current user, normally into
`%LOCALAPPDATA%\Remote LSL Recorder`. Use `/S` for silent installation, `/P`
for passive installation, and `/NS` to suppress shortcuts. An optional
`/D=<absolute directory>` must be the last argument. Without `/R`, silent
installation does not launch the application. The current location is the
`InstallLocation` value under
`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Remote LSL Recorder`;
remove its surrounding quotes and append the `MainBinaryName` value. The
uninstaller is `uninstall.exe` in that directory and accepts `/S`.
Installation and uninstallation refuse to continue while Recorder is running;
stop any recording and close the program first. Neither path terminates it.
Reinstallation updates the managed files in place and never runs an existing
uninstaller. Use Windows Apps or the installed uninstaller to remove Recorder.

The manually dispatched **Windows installer smoke** workflow checks an exact
release installer hash on a disposable Windows host: installed resources and
registration, native window creation, idle recording, clean exit, and silent
uninstall. It also verifies that installation and uninstallation refuse a
running Recorder without terminating it or changing its executable. This does
not qualify physical phone control or hardware recording.

AI-agent project context starts at [`for-ai/README.md`](./for-ai/README.md).

Repository: https://github.com/GeorgeFejer91/Remote-LSL-Recorder
The static `companion/` source is published from the repository's `gh-pages`
branch at <https://georgefejer91.github.io/Remote-LSL-Recorder/>.
