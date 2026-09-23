# Verification and readiness gates

Evidence must match the claim. Missing dependencies, credentials, hardware, or
runtime access produce `BLOCKED` or `NOT RUN`, never `VERIFIED`.

## Result vocabulary

- `VERIFIED`: the named check directly observed the claimed surface and passed.
- `PARTIAL`: some required evidence passed and the missing scope is named.
- `BLOCKED`: a concrete external or authority blocker prevented the check.
- `NOT RUN`: the check was intentionally not applicable or not attempted, with
  the reason stated.

## Gate 0: bootstrap readiness

From the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File for-ai/scripts/check-context.ps1 -ProjectRoot . -RequireRemote
git status --short
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Pass when the context checker succeeds, the intended tree is clean, and local
`HEAD` equals `origin/main`.

## Gate 1: task contract

Before implementation, name:

- the observable user outcome;
- affected product surface and owner;
- acceptance criteria;
- focused check that can fail for the requested behavior;
- broader checks required by affected boundaries;
- explicitly deferred work.

## Gate 2: focused change

From the repository root:

```powershell
pnpm check
```

For recorder packaging, first run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fetch-labrecorder.ps1
pnpm tauri build --bundles nsis
```

`cargo test` proves only the Rust contracts and state transitions. JavaScript
tests prove only browser-safe logic. A real LSL/XDF run and phone pairing are
separate evidence gates.

## Gate 3: integrated readiness

Run proportionate build, test, lint, type, runtime, visual, device, security,
and compatibility checks for every affected boundary. Do not run an expensive
or irrelevant full matrix for a documentation-only edit.

For a complete recorder claim, exercise at least one numeric stream and one
marker stream, stop cleanly, and open the resulting XDF in an independent
reader. For a remote claim, observe a physical phone command reach Rust and the
authoritative revision return over BRSP/1. Record the VDO route honestly.

For pairing, verify the named request appears on the PC, commands and recorder
state remain unavailable before Allow, Deny refuses access, Allow enables one
session, and disconnect or Stop revokes it. Reconnect requires a fresh QR code.

For the combined viewer claim, inject at least two distinguishable markers and
verify that each appears with intact text and LSL time in the chronological
table and as a time-aligned vertical annotation on a numeric plot. Confirm that
pausing or slowing the HTML render loop does not stop preview ingestion or the
LabRecorder process. The companion must receive marker updates from the same
authoritative revisioned state rather than maintain a second marker clock.

For input markers, enable each toggle separately in the desktop window and
check key down/up plus left/right mouse button coordinates in the marker table.
Confirm that disabled sources produce no new markers, and independently open an
XDF made while toggling during recording to confirm the `Recorder input` stream
and its LSL timestamps. For scaling, use two numeric streams with different
units and at least one multi-channel stream; confirm separate stacked lanes,
independent moving ranges, unit labels where declared, and visibility controls
that do not change recording selection.

For bounded UI text, run the Pretext vendor sync check and inspect the desktop
WebView and phone browser at narrow and normal widths. Verify action labels
fit or wrap at the readable floor, stream names and errors remain accessible,
and the layout recovers when widened. Browser inspection does not establish
packaged WebView or physical-phone parity.

For remote control under live marker traffic, confirm marker updates advance
the state revision without advancing the control revision, then observe a phone
command applied against the current control revision.

For the miniature phone viewer, confirm a live signal produces a changing local
trace and receiving state, a paused signal changes to no recent samples, an
irregular marker stream stays in watching state between events, and a new
marker appears with intact text and LSL time. Inspect the BRSP projection to
confirm it sends one current numeric value and sample identifier per stream,
not the desktop preview buffer. Confirm the layout at narrow phone width.

## Gate 4: publication

1. Review status and diff; preserve unrelated changes.
2. Confirm only intended paths are staged.
3. Confirm all required gates passed or are honestly reported.
4. Create one coherent commit under normal repository policy.
5. Push without force and without bypassing protection or secret scanning.
6. Verify the remote commit and required CI/deployment for that exact SHA.

## Handoff evidence

Report exact commands or observed surfaces, results, untested scope, commit SHA,
remote synchronization, CI/deployment state, and whether `for-ai/` changed.
