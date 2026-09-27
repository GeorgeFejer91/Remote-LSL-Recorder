# Respyra 2.0: first experiment panel

The [Respyra viewer](https://georgefejer91.github.io/Remote-LSL-Recorder/panels/respyra/)
shows read-only setup/run status and latest trial/phase/marker progress.

1. In the updated Respyra desktop app, select **Start viewer** and **Copy viewer link**.
2. In Recorder, select **+**, name the tab **Respyra 2.0**, paste that private
   URL, then **Load page**. Its invitation is session-only.
3. Start Recorder phone pairing and approve the phone. It receives the same
   panel automatically. Leave the desktop Respyra panel disconnected and select
   **Connect** inside the phone panel; Respyra supports one observer at a time.
4. **Stop viewer** in Respyra or disconnect its observer to end the invitation.
   Experiment/recorder controls remain local to their respective owners.

The Respyra QR opens its viewer directly. Recorder's QR opens the combined
workspace. Recorder's **Share panel** QR shares only the remembered base page;
it carries no Respyra observation grant. After restarting either app, create
a fresh Respyra invitation.

Import the public [panel descriptor](../companion/panels/respyra/panel.json)
for a permanent disconnected tab. Its stable ID is `respyra-2`.

Python retains PsychoPy timing and LSL acquisition/markers. Rust issues an
expiring read-only native grant and a bounded privacy projection. The HTML
viewer negotiates only `experiment.observe` over BRSP/VDO.Ninja data-only
WebRTC. It exposes no experiment commands, participant values, raw force or
private paths. Latest-only presentation may skip markers; XDF/LSL remains the
complete timeline. Internet signaling is required. A physical phone/belt,
packaged WebView transport and independent XDF timing remain separate checks.

## Publication owner

Source lives in [respyra-2.0](https://github.com/GeorgeFejer91/respyra-2.0),
not the recorder. Build it with `pnpm prepare:web`, commit the validated source,
then run `node scripts/prepare-respyra-panel.mjs <Respyra checkout>` here.
The script copies only static companion assets and records the source SHA.
Recorder's Pages publication includes this one reviewed panel under
`panels/respyra/`; its opaque iframe gives it no parent/native privileges.
