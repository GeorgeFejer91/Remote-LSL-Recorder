# Project contract

## Purpose

A Windows-first Tauri application for discovering, viewing, and recording LSL streams with an opt-in BRSP smartphone companion.

## Primary goal

Deliver a small, independent recorder that can discover all visible LSL
streams, preview numeric signals and markers, record selected streams to one
XDF file, and expose the same safe session controls to an opt-in phone
companion.

## Non-goals

- No speculative framework, service, abstraction, compatibility layer, or
  deployment system.
- No second implementation tree or duplicate source of truth.
- No capability claim without matching evidence.
- No device-specific Polar or Vernier acquisition logic; those remain separate
  source applications.
- No remote desktop, arbitrary input forwarding, shell surface, public daemon,
  account service, or custom relay.
- No custom XDF writer while the maintained official LabRecorder engine covers
  the recording contract.

## Product/control-plane boundary

- Product source: `src-tauri/`, `web/`, and `companion/`.
- Setup and verification tooling: `scripts/`.
- Downloaded third-party runtime: `vendor/labrecorder-win/` (ignored and
  recreated from a pinned, hash-checked release).
- Agent orchestration and durable project memory: `for-ai/`.
- Local generated diagnostics and scratch evidence: `.for-ai-local/` (ignored).

## Architecture and ownership

- `src-tauri/src/`: sole authority for participant/session configuration,
  recording lifecycle, filesystem effects, revisions, and remote grants.
- Official LabRecorder CLI `v1.18.0`: supervised recording engine that owns LSL
  subscription and XDF serialization, never application policy.
- Rust `labstream` inlet: discovery and bounded live preview only; recording
  correctness does not depend on the preview path.
- Rust publishes an opt-in, local-window keyboard/mouse LSL marker stream;
  LabRecorder includes it in XDF independently of HTML preview cadence.
- `web/`: installed Tauri adapter and visualization surface.
- `companion/`: static BRSP/1 controller; contains no user data or secrets.
- Both viewers host external experiment pages through an opaque iframe sandbox.
  Shared tab code/CSS lives in `web/` and is copied to `companion/`. Rust owns
  the desktop catalog and versioned app-config `workspace.json`: session
  settings, selection policy/remembered IDs, marker toggles, viewer preferences,
  and base panel URLs. Startup preloads base pages, with recording stopped and
  remote grants inactive. URL queries/fragments and runtime state are not saved.
- Approved phones fetch the desktop catalog using revision-checked
  `workspace.observe/read-page` commands; frequent state carries revision/count
  only. Mirrored tabs/invitations remain in memory, preserve mounted frames on
  heartbeats, and clear on recorder revocation. Personal phone tabs have separate
  browser-local base-URL preferences. External pages keep their own pairing,
  BRSP/VDO sessions, approval and status. See `docs/external-pages.md`.
- Other apps can supply an importable Remote Panel/1 `{id,name,url}` descriptor
  and follow `docs/remote-panel-profile.md`. This is a controller-page contract,
  not a generic command broker, registration service or native plugin system.
- The + flow generates local panel QR/share links and base-URL JSON downloads.
  Shared `#panel=` descriptors are validated and scrubbed on opening, with
  review/load required. Respyra 2.0 is the first adopted observer panel: source
  remains in its repo and its reviewed static assets are published at
  `companion/panels/respyra/`, pinned by `source.json`. See `docs/respyra-panel.md`.
- `web/external-page-connector.js` (copied to `companion/`) is a copyable
  experiment-controller SDK factory. It disables SDK 1.5.5's optional origin
  storage cache in opaque iframes; upgrades must requalify those pinned hooks.
- All registered Tauri application commands have a generated command manifest
  and explicit permissions for bundled `main` content; no remote capabilities
  are granted. The product remains Windows-first.
- The phone's miniature viewer receives one first-channel value and a sample
  identifier per stream per bounded state update, and renders a local short
  trace. Recent markers retain their source text and LSL time. XDF acquisition
  and full preview buffers stay on the PC.
- Both interfaces use one copied Pretext fitter and a bundled Noto Sans face for
  bounded headings and action labels. CSS owns available space; the fitter
  scales text between preferred and readable sizes and responds to text, font,
  and viewport changes. Stream names, marker text, paths, and errors reflow or
  scroll as semantic HTML.
- VDO.Ninja data-only WebRTC: opt-in BRSP transport. It needs Internet
  signaling/STUN/TURN and is not described as offline-LAN control.
- Phone pairing carries a bounded name over BRSP; the desktop must approve it
  locally before Rust accepts recorder commands or publishes recorder state.
  Approval ends with the peer session. The output directory stays local to PC.
- Product identity: `Remote LSL Recorder`, bundle identifier
  `dev.georgefejer.remotelslrecorder`.

## Current verified state

- Public GitHub repository initialized on 2026-09-22 with `main` as the default
  branch.
- Companion source is published from `gh-pages` at
  `https://georgefejer91.github.io/Remote-LSL-Recorder/` with HTTPS enforced.
- Tauri v2, Rust 2024, and plain HTML/CSS/JavaScript are the selected stack.
- Windows x86_64 is the first packaging and runtime target.
- BRSP state revisions include marker updates; a separate control revision
  guards remote mutations so live markers do not invalidate phone commands.

Git and runnable checks are the authority for branch, revision, and behavior.
Do not turn this section into a second status ledger.

## Active delivery checklist

2026-11-06 local VLC+ integration (`codex/record-and-play`):

- [x] Install the hash-verified safe 0.1.7 release on this PC.
- [x] Add a local-only Record and play control with explicit VLC port, selected
  affect/marker streams, record-before-play ordering and partial-XDF retention.
- [x] Pass mocked-IPC rendered interaction/reflow/large-text checks and native
  control regression tests. Real quiet-RC testing caught and corrected absent
  greetings and VLC 3's input-exists `is_playing` semantics; use playlist status.
- [x] Run the real input-marker Recorder test and independently parse its XDF.
- [ ] Qualify the actual native WebView button with the installed VLC+ clip,
  changing both affect axes, playback markers and independent XDF inspection.
- [x] Build/install the updated candidate and retain source/artifact evidence;
  publication and physical input/device claims remain separate.

Local evidence: `pnpm check` passed 21 JavaScript and 14 Rust tests (three
explicit ignored native tests), formatting and clippy; rendered mocked-IPC
record/play checks passed including large text and narrow widths. The real
input-marker test passed and its XDF was parsed independently. Candidate NSIS
built and installed; `.for-ai-local/installed-candidate-integrity.json` verifies
that its binary differs from the release build only by Tauri's exact single
UNK-to-NSS bundle marker. Candidate retains application version 0.1.7; it has
not been published. Its installer is under `src-tauri/target/release/bundle/nsis/`.

Native WebView recording reached Recording/Ready and resumed the real paused
Great Dictator clip. `.for-ai-local/native-vlc/xdf-inspection.json` documents
3,706 affect samples and a Start marker in the saved XDF. Both axes remained
zero because Windows Security blocked the planned keyboard phase. Therefore
the changing-rating qualification above remains unchecked. Ask the user to
dismiss the firewall prompt manually, then rerun
`scripts/check-native-vlc-recording.mjs` with installed executable overrides.
Do not write `input-done` until actual keyboard tests have run. The script
backs up workspace settings, stops recordings on failure, and retains XDF.

Independent Windows experimental release (application 0.1.7):

- [x] Build from a clean committed source with frozen pnpm and Cargo locks;
  retain source, toolchain, pinned LabRecorder and bundled WebView2 provenance.
- [x] Pass source gates and synthetic numeric/marker XDF inspection; test the
  exact installer on a disposable Windows host before public promotion.
- [x] Publish the standalone prerelease with installer, checksums, provenance
  and licensing notices. Keep remote phone/hardware qualification open until
  those physical checks have direct evidence.

The published [v0.1.7-experimental.1 release](https://github.com/GeorgeFejer91/Remote-LSL-Recorder/releases/tag/v0.1.7-experimental.1)
is built from clean source `312a59f69614d3fb0a7849c0e559c19740f0df63`,
which is also the remote tag target. Its installer is 220,347,176 bytes with
SHA256 `8435bae7b06257e21ee1aeb5456615d7fda1a63bf47f2ddebec85108b24458ae`.
Release receipts retain component hashes, frozen dependencies and evidence.
Anonymous download returned HTTP 200 with the matching content length.

Source gates passed 21 JavaScript and 11 Rust tests, formatting and clippy.
Independent pyxdf inspection retained 451 synthetic numeric samples over
4.5003 seconds and two markers; the app-authority XDF retained all three input
markers. The [exact-installer Windows smoke](https://github.com/GeorgeFejer91/Remote-LSL-Recorder/actions/runs/42086293188)
passed install/resources/registration, native window creation, idle recording,
silent/passive refusal without terminating Recorder, direct uninstaller-worker
refusal, clean shutdown, closed-app reinstall without executing a sentinel
historical uninstaller, and final removal. Its workflow source is
`8c299b5406e00202eda3083419617cda166b5310`; later workflow-only fixes did not
rebuild or replace the qualified installer.

Standalone packaging is complete and published; the consuming suite owns live
joint installation. The overall product qualification remains open. Next:
observe a physical phone command reach Rust and its revision return; hardware,
rendered-control/accessibility, MSRV, historical upgrade/downgrade and
runtime-free offline-deployment claims still need their own evidence.

Release installation remains current-user and independent of any joint
installer. `scripts/smoke-windows-installer.ps1` deliberately refuses ordinary
desktop hosts; live-PC installation is coordinated separately. No recorder or
remote defaults change for the combined installer.
The NSIS hook overrides Tauri's shared running-process macro for installation
and uninstallation: the maintenance worker aborts with a nonzero result while Recorder is
running, preserving the process and any active recording. Never restore the
upstream silent force-termination path for this recording application.
The maintained template is pinned to Tauri CLI 2.11.4 and removes the earlier
maintenance-page route that could run an unsafe historical uninstaller. It
updates managed files in place; preserve this policy when upgrading Tauri.
The smoke dismisses only its owned passive NSIS error page, with bounded waits.
For synchronous uninstaller evidence it runs a temporary copy with the final,
unquoted `_?=<install directory>` argument to avoid the NSIS launcher handoff.
