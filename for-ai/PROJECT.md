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
