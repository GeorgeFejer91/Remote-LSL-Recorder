# Remote Panel/1 app integration profile

Remote LSL Recorder acts as a shared workspace for external controller pages.
Implementing this small profile lets an app register a panel once on PC and
have its HTML interface appear automatically on the approved phone viewer.
The app retains authority over its experiments and acquisition.

## Registration hook

Generate a UTF-8 `panel.json` file of at most 16 KB with exactly these fields:

```json
{
  "id": "my-experiment",
  "name": "My experiment",
  "url": "https://example.org/my-experiment/controller/"
}
```

- `id`: stable, unique within the recorder workspace; 1–64 ASCII letters,
  digits, hyphens, or underscores. Use distinct IDs for distinct app instances.
- `name`: a printable operator-facing name of up to 80 characters.
- `url`: an absolute HTTPS controller URL, bounded to 4096 bytes after URL
  normalization. HTTP loopback is available for local desktop development.
  A phone needs a reachable HTTPS page, not a PC localhost address.

The schema is [remote-panel.schema.json](remote-panel.schema.json). The importer
also enforces supported schemes, URL credentials, bounds, and unique IDs.
Select **+**, then **Import app panel (.json)**. The importer fills the name and
URL, loads the page, and saves the desktop definition. Normal manual entry
remains supported. To replace an imported ID, close its existing tab first.

The same `{id,name,url}` objects are the recorder's typed local
`configure_external_pages` boundary and approved BRSP catalog responses.
Other apps produce the descriptor and controller assets; they do not receive
native IPC access. This profile does not add a discovery daemon, registration
server, arbitrary postMessage handler, or executable plugin loader.

Keep the distributed descriptor's URL stable and free of credentials. A fresh
invitation URL may be loaded on PC for one active session: its query/fragment
is shared with approved phones in memory, but persistence keeps only the base
URL. The recorder QR grants access to its workspace and recorder controls;
experiment control still requires the experiment's own authentication and
approval. Keep secrets out of URL paths and panel names.

## Controller page contract

1. Host the static page and assets over HTTPS. Support the existing opaque
   iframe sandbox and CORS/frame headers described in
   [external-pages.md](external-pages.md#3-make-the-page-embeddable).
2. Keep the page useful when opened without an invitation: show a disconnected
   state and explain how to create a fresh app invitation. Preloading a page
   must not start an experiment or open a peer connection.
3. Use explicit **Connect**, confirmed state/revision, stale/disconnected status,
   and **Stop** controls. Fit PC and 320 CSS px phone layouts.
4. Use that app's own BRSP scopes, reducer, fresh secret, pairing, and approval.
   The existing pinned VDO transport and `createEmbeddedVdoSdk` helper are the
   shared browser connector. HTML hosting remains separate from VDO signaling.
5. Handle multiple controllers deliberately. If both PC and phone connect,
   support separate authenticated peers/grants; an app limited to one controller
   should leave its desktop controller disconnected while using the phone.
   Mirroring a tab does not clone an authenticated WebRTC session or bypass a
   target's single-controller restriction.
6. Own experiment timing and LSL sample/trial-marker timestamps in the target.
   Tab switching, hidden-page throttling, or phone suspension must not determine
   stimulus timing. Target-owned disconnect/lease policy handles abrupt unload.

The recorder hosts pages and distributes a catalog. Each app owns the commands
and observations displayed inside its page. For future cross-app orchestration,
define explicit app scopes and state/preconditions before adding any broker;
do not infer Start/Stop actions from DOM elements or forward generic JavaScript.

## Acceptance for a new app

- Import the descriptor once; approve a fresh recorder phone session; observe
  the same panel title and controller URL on phone without manual tab entry.
- Change/remove the panel on PC and verify the phone follows. Heartbeats must
  not reload a connected page. Recorder revocation clears mirrored frames.
- Restart the PC app: base pages and settings restore, with recording stopped,
  remote access inactive, and fresh experiment pairing required.
- Observe an app command reach its authoritative reducer and its applied
  acknowledgement return on PC and physical phone. Exercise denial, stale
  revision, disconnect, and backgrounding. Record the actual VDO route.
- Publish trial markers and signals through LSL; independently inspect their
  alignment in the recorder's XDF. Layout/browser tests alone do not establish
  experimental or recording correctness.
