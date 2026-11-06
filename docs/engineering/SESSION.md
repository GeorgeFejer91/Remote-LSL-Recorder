# Session scope — 2026-11-06

Outcome: add a local Record and play VLC+ control and verify that ratings reach an independently readable XDF during video playback.

Allowed changes: a bounded loopback VLC RC client, local native command and permission, desktop control, regression/rendered tests and user documentation. Preserve recorder selection/lifecycle, XDF engine ownership, remote grants, companion and acquisition formats. Start recording before requesting playback; failures must remain visible and preserve any partial XDF.

Initial checkout: clean main 461d622, now codex/record-and-play. JavaScript baseline: 21 passed. Native baseline initially stopped at missing vendor/LabRecorder engine; fetch is in progress. No publication is authorized by this session.
