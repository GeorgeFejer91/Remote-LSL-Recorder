# Remote LSL Recorder

A Windows-first Tauri application for discovering, viewing, and recording LSL
streams with an opt-in BRSP smartphone companion.

The desktop app records selected streams to XDF through the official
LabRecorder engine, while its Rust core owns session configuration, process
lifecycle, state, and remote authorization. The local interface includes live
signal previews and a marker timeline. Remote access is off until the operator
explicitly starts a fresh pairing session.

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

AI-agent project context starts at [`for-ai/README.md`](./for-ai/README.md).

Repository: https://github.com/GeorgeFejer91/Remote-LSL-Recorder
The static `companion/` source is mirrored to the repository's `gh-pages`
branch. The intended URL is
<https://georgefejer91.github.io/Remote-LSL-Recorder/>; enabling the live site
requires a repository visibility or account plan that supports GitHub Pages.
