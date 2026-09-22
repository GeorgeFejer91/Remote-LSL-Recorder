# Decision log

Record only durable choices whose rationale future agents would otherwise have
to rediscover. Source and tests remain the authority for implementation facts.

## D-0001 — Minimal control plane before product scaffolding

- Date: 2026-09-22
- Status: Accepted
- Context: The project needs a predictable AI entrypoint without choosing an
  application stack or inventing product structure prematurely.
- Decision: Use a short root `AGENTS.md` that routes to a lowercase `for-ai/`
  control plane. Keep product output outside that folder and add project files,
  skills, and protocols only for current requirements.
- Consequences: New agents get a reliable map and readiness gates. The first
  product task must still choose the smallest suitable output structure.
- Supersedes: None

## Record format

For later decisions, add one compact entry with:

- identifier and title;
- date and status (`Proposed`, `Accepted`, `Superseded`, or `Rejected`);
- context;
- decision;
- consequences;
- supersession link when applicable.

Do not rewrite accepted history to hide a changed direction. Add a superseding
decision and link both entries.

## D-0002 — Independent recorder with supervised official XDF engine

- Date: 2026-09-22
- Status: Accepted
- Context: The recorder must remain separate from the Polar and Vernier source
  applets while safely recording arbitrary LSL channel formats to XDF.
- Decision: Use one Rust/Tauri authority for product state and supervise the
  pinned official LabRecorder CLI for XDF acquisition/serialization. Use a
  separate bounded inlet path for live previews.
- Consequences: The product avoids a bespoke XDF writer and device switchboard.
  Packaging must fetch, verify, license, and bundle the pinned Windows engine.
- Supersedes: None

## D-0003 — Opt-in BRSP companion over VDO.Ninja

- Date: 2026-09-22
- Status: Accepted
- Context: A phone must start/stop sessions and observe markers without
  exposing a generic remote-control surface.
- Decision: Use BRSP/1 typed actions over an explicitly activated VDO.Ninja
  data-only session. Rust remains authoritative and revalidates every action.
- Consequences: The static companion contains no secrets or participant data;
  invitations are per-session. This route depends on Internet signaling and is
  not offline-LAN discovery.
- Supersedes: None

## D-0004 — Marker-first, projection-only visualization

- Date: 2026-09-22
- Status: Accepted
- Context: mBrainTrain-style recording makes event timing legible by showing
  marker streams both chronologically and as colored vertical annotations over
  signal plots. Related HTML/Tauri projects keep acquisition, application
  state, and game/render presentation in separate layers.
- Decision: Rust owns LSL discovery, timestamps, preview buffers, and recorder
  lifecycle. The HTML viewer renders bounded immutable snapshots: numeric
  traces plus time-aligned marker lines and a full-text marker timeline. A slow
  renderer may skip a visual frame but must never control or throttle recording.
- Consequences: Marker fidelity is testable independently of chart cadence.
  Device-specific data and renderer state cannot become recording authority.
- Supersedes: None
