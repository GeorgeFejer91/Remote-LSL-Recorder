# Session scope — 2026-11-06

Outcome: extend Record and play with a Start VLC+ and record action that launches the installed player, selects its exact affect/marker pair alongside the operator's streams, waits for XDF subscriptions, then begins video playback. Qualify changing ratings and markers through the real WebView and independent XDF parsing.

Allowed changes: a bounded loopback VLC RC client, local native command and permission, desktop control, regression/rendered tests and user documentation. Preserve recorder selection/lifecycle, XDF engine ownership, remote grants, companion and acquisition formats. Start recording before requesting playback; failures must remain visible and preserve any partial XDF.

Initial checkout: clean codex/record-and-play at 93c66af. Existing unit/rendered tests pass in the saved handoff; the native changing-rating test remains open. Preserve remote grants, companion command authority, recording selection and acquisition formats. Continuing handoff authorization covers task-required publication and installation. Test data is explicitly synthetic; no security consent automation.
