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

## D-0005 — Shared bounded text and independent remote control revision

- Date: 2026-09-23
- Status: Accepted
- Context: The installed viewer and phone controller need flexible action text,
  while frequent marker events can otherwise invalidate every remote action.
- Decision: Copy one locked Pretext fitter and Noto Sans face into both static
  interfaces for bounded headings and action labels. CSS defines the box and
  readable font bounds; the fitter reacts to text, font, and width changes.
  Keep arbitrary data text DOM-managed with wrapping or scrolling. Expose a
  Rust control revision for remote action preconditions while the full state
  revision still tracks marker events.
- Consequences: Vendor assets and both UI surfaces need a sync check; remote
  actions remain guarded against competing control mutations during marker
  traffic. Real WebView and phone rendering remain separate evidence gates.
- Supersedes: None

## D-0006 — Phone mini viewer from bounded state summaries

- Date: 2026-09-23
- Status: Accepted
- Context: The phone needs a small live view without transferring full LSL
  buffers or capturing the desktop screen.
- Decision: Reuse the BRSP latest-state lane over VDO.Ninja data-only WebRTC.
  Send one first-channel value and sample identifier per stream; build the
  short trace and freshness indicator in the phone browser. Continue sending
  bounded recent marker text and LSL timestamps.
- Consequences: No second media track or screen-capture grant is needed. The
  trace is an activity preview; XDF remains the full-fidelity record.
- Supersedes: None

## D-0007 — Independent external experiment tabs

- Date: 2026-09-26
- Status: Accepted; catalog persistence/phone ownership amended by D-0008

Use HTTPS controller pages in an opaque-origin iframe sandbox with scripts and
forms only. VDO.Ninja transports each external application's own typed remote
session; it does not host HTML or share recorder grants. Keep the tab shell as
browser presentation, persist names/base URLs only, restore unloaded, and
retain loaded frames across tab selection. Target programs own timing, LSL
markers, approval, and disconnect policy. External controller assets must
support opaque-origin CORS; origin-storage-dependent pages need adaptation.
Explicit Tauri application command permissions protect the Windows native
boundary. Connector input never enters the recorder input marker stream.
For pinned VDO SDK 1.5.5, external controllers use the copyable SDK factory to
disable its optional TURN-list cache when the opaque origin denies storage.
The SDK otherwise throws before its storage exception handler. Keep proof and
transport options intact; requalify cache hooks on upgrades.

## D-0008 — Desktop workspace memory and approved panel mirroring

- Date: 2026-09-26
- Status: Accepted
- Amends: D-0007's independent catalog ownership and unloaded desktop restoration

Rust persists applied session settings, selection policy/remembered stream IDs,
marker toggles, viewer preferences and base panel URLs in one versioned local
workspace file. Writes use a sibling temporary file and replacement; unreadable
or unsupported files are preserved and reported. Startup restores configuration
and preloads controller base pages, with recording stopped, empty data history,
and fresh remote pairing required. Migrate previous desktop browser tabs once.

The desktop catalog is authoritative for mirrored phone panels. After local
approval, `workspace.observe/read-page` returns one bounded descriptor at a
requested catalog revision. Regular state announces revision/count only; the
phone applies complete results and keeps frames across unrelated revisions.
Current launch queries/fragments may be shared with the approved operator in
memory but are absent from disk and phone preferences. Revocation closes the
mirror. Personal phone tabs remain independent. Remote Panel/1 descriptors
are importable data; each app still owns its pairing, typed commands, reducer,
timing, multi-controller policy, and LSL markers.
