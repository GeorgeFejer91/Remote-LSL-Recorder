# External experiment tabs

## Operator procedure

1. Select **+** in the desktop viewer or phone companion. Recorder stays first.
2. Enter a tab name and the experiment application's HTTPS **controller page**
   URL. An invitation URL may include its fresh room and secret in the fragment.
3. Select **Load page**, then use that page's own **Connect** button and pairing
   procedure. Approve experiment access in the experiment app.
4. Switch back to **Recorder** to select streams and start XDF recording. Start
   the experiment through its tab when the recorder is ready.
5. **Unload** destroys the embedded page and its browser connections.
   **Close tab** also removes the saved entry. Stop the experiment through its
   own controls before unloading if it should stop running on the target.

Add more tabs with **+**; there is no fixed tab count. Every loaded page costs
memory and may open another peer connection. Switching tabs keeps their pages
mounted. Browsers can throttle hidden pages, and phones can suspend the entire
viewer. Experiment timing and acquisition must remain in the target program.

Names and base URLs are saved as local presentation preferences on each device.
They are independent on PC and phone. Query strings and fragments are removed
before saving, including when restoring older storage. Reload opens Recorder
and restores unloaded tabs; it does not reconnect external apps. Keep secrets
out of names and URL paths too. Paste a fresh invitation when reconnecting.

HTTP loopback (`localhost`, `127.0.0.1`, `[::1]`) is allowed in the installed PC
app and local HTTP development. The hosted HTTPS phone viewer accepts HTTPS
only. On a phone, localhost refers to the phone itself. Use a hosted HTTPS
controller page to control an experiment on the PC through VDO.Ninja.

## Architecture decision

HTML hosting and VDO.Ninja transport are separate parts of the connector:

```text
Remote LSL Recorder desktop / phone
  Recorder tab ---- BRSP recorder session ---- Rust recorder ---- LabRecorder/XDF
  Experiment tab -- HTTPS iframe page
                       | own BRSP experiment session over VDO.Ninja/WebRTC
                       v
                    Experiment program ---- LSL signals and trial markers
                                                  |
                                          LabRecorder subscriptions
```

The tab shell owns only navigation, local tab preferences, and iframe lifetime.
It never fetches HTML in Rust, forwards Tauri calls, shares recorder invitations,
or dispatches commands from `postMessage`. VDO.Ninja does not serve a remote
program's HTML. Host the controller's static HTML/CSS/JS over HTTPS; its existing
VDO integration carries typed experiment commands, acknowledgements, and state.

The experiment program is authoritative for experiment phase, trial index,
stimulus timing, device acquisition, and LSL timestamps. The recorder Rust core
is authoritative for recording and filesystem effects. A controller renders
confirmed target state. Neither app inherits the other's grants or pairing
secret. Starting both programs remains two explicit operations; this feature
does not promise atomic start or synchronized clocks through tab switching.
Publish trial markers with the LSL clock and record those streams alongside
signals for alignment in XDF.

## Link another application's controller

### 1. Define the experiment contract

Reuse the application's existing controller when it already has one. Otherwise,
define a small versioned profile in that application, for example:

| Scope | Action / state | Owner |
| --- | --- | --- |
| `experiment.observe` | phase, trial index, current public stimulus label, revision | Experiment target |
| `experiment.control` | `start`, `pause`, `resume`, `stop` with exact validated arguments | Experiment target |

Both local experiment UI and remote actions call one reducer. Validate phase
preconditions, scope, arguments, and expected revision in the target. Use
reliable commands with matching `applied` acknowledgements. Publish bounded
snapshots/current state on the replaceable lane with a heartbeat and visible
staleness. Do not send raw sensor history, files, shell commands, selectors, or
JavaScript through the control protocol.

### 2. Use the existing BRSP/VDO adapter

The recorder's reviewed runtime is in `companion/vendor/`: `brsp.js`,
`vdo-ninja-transport.js`, and the pinned VDO.Ninja SDK 1.5.5 plus its notices.
Copy these public assets with their license/notice files into the external
controller project, plus `companion/external-page-connector.js`, or use that
project's compatible reviewed implementation.
No change to BRSP/1 or the recorder's wire profile is required.

The experiment target explicitly enables remote access, generates a fresh
room and high entropy secret, and announces a data-only source. Its controller
joins that session as `controller`. Use a distinct invitation from Recorder.
Do not connect on page load. For example, inside the external page's Connect
handler, after parsing and clearing its own invitation fragment:

```js
import { BRSPConnection, randomToken } from "./vendor/brsp.js";
import { VdoNinjaTransport } from "./vendor/vdo-ninja-transport.js";
import { createEmbeddedVdoSdk } from "./external-page-connector.js";

const transport = new VdoNinjaTransport({
  role: "controller", room: invite.room, sharedSecret: invite.secret,
  label: "Experiment controller",
  sdkFactory: createEmbeddedVdoSdk,
});
const session = new BRSPConnection({
  transport, role: "controller", sessionId: invite.room,
  sharedSecret: invite.secret, peerId: `controller_${randomToken(12)}`,
  capabilities: ["command-ack", "state-snapshot", "latest-state"],
  requestedScopes: ["experiment.observe", "experiment.control"],
  grantedScopes: [],
});
session.addEventListener("snapshot", ({ detail }) => renderConfirmed(detail.state));
session.addEventListener("state", ({ detail }) => renderConfirmed(detail.state));
session.addEventListener("commandapplied", showApplied);
await transport.start();
// Once ready, scoped, approved, and supplied with target state:
// session.sendCommand("experiment.control", "start", {}, { expectedRevision });
```

The connector helper disables only the SDK's optional TURN-list storage cache
when origin storage is unavailable. SDK 1.5.5 checks the `localStorage` getter
outside its exception handler; without this helper, an opaque iframe can find
the target but fail to open its peer connection. The helper preserves SDK
options, signaling, ICE/TURN retrieval, authentication, and scopes. Its two
cache hooks are pinned implementation details; requalify them on SDK updates.
Importing the helper does not start a session. Pass it to the transport factory
inside the external controller's own Connect operation.

This is an assembly recipe: the external app must implement its invitation
validator, target reducer, approval, rendering, error handling, and lifecycle.
Use the [BRSP integration recipes](https://github.com/GeorgeFejer91/browser-remote-sync-protocol/blob/main/docs/12-app-integration-recipes.md)
for the complete target/controller contract. Stop, failure, and `pagehide` must
cancel producers before closing the session. Target-owned revocation, timeouts,
and leases must handle abrupt iframe destruction and phone suspension; a final
browser close packet cannot be the authority for stopping an experiment.

### 3. Make the page embeddable

The iframe sandbox permits scripts and forms, with an **opaque origin**. It
does not grant `allow-same-origin`, top navigation, popups, downloads, clipboard,
camera, microphone, or recorder/native privileges. Web Crypto and data-only
WebRTC are available in the secure context, but origin storage/cookie-dependent
controllers and some cross-origin API policies need adaptation.

- Serve the controller and assets over trusted HTTPS.
- For module scripts, fonts, and fetched public assets, send
  `Access-Control-Allow-Origin: *` (without credentials). Sandboxed requests may
  carry `Origin: null`; do not grant privileged credentialed APIs to that origin.
  A bundled classic script can avoid module CORS requirements.
- Remove conflicting `X-Frame-Options: DENY` / `SAMEORIGIN` from the controller
  endpoint when embedding is intended. Configure an HTTP CSP `frame-ancestors`
  for the complete ancestor chain. For this Windows app and hosted phone viewer
  that normally includes `http://tauri.localhost`, `https://tauri.localhost`,
  and `https://georgefejer91.github.io`. Add exact development origins only when
  needed. Check the actual installed origin. `frame-ancestors` in a meta tag is
  ineffective. A more restrictive page policy may prevent embedding altogether.
- Keep the external page's own CSP narrow. For the pinned VDO adapter the
  CSP-visible service endpoints are `wss://wss.vdo.ninja` and
  `https://turnservers.vdo.ninja`; also permit its reviewed local scripts/assets.
- Use responsive controls at 320 CSS px, a visible Connect/Stop, connection
  phase, approval, confirmed revision, stale status, and observed route.

The shell permits HTTPS frame destinations because operators choose controller
hosts. Its script/native policy remains local, and all application commands
now have explicit Tauri permissions granted only to bundled `main` content.
The opaque sandbox also isolates same-host pages and redirects. This Windows
boundary is not a qualification of Linux/Android Tauri iframe isolation.

A blank frame does not prove connection failure. Browser iframe load events
also fire for blocked pages, so the shell says **Page requested** and leaves
connection confirmation to the external page. Inspect its console and server
headers when it stays blank; unload it and use its standalone controller if
the application cannot support this embedding profile.

## Observability and validation

Keep recorder and experiment connection status separate. Display the observed
VDO route as direct, relay, or unknown inside each controller. Internet
signaling and ICE services remain dependencies even on the same Wi-Fi. A
configured TURN flag alone does not prove the selected route.

For each real experiment integration, verify:

1. No peer connection before Connect; fresh independent invitations and approval.
2. Correct and wrong secret, denied scope, stale revision, and reconnect.
3. One command reaches the experiment reducer; matching acknowledgement and
   target revision return to the page inside the tab.
4. Recorder remains active and its state updates while an experiment tab is shown.
5. Switching tabs preserves the page; Unload/Close destroys it; experiment target
   handles peer loss according to its explicit policy.
6. Trial markers and numeric samples appear together in an independently read XDF.
7. Packaged WebView plus physical phone portrait/landscape, text enlargement,
   lock/unlock, backgrounding, and network transition.

Repository checks cover URL rejection, secret-free preference restoration,
capability configuration, copied assets, and browser tab behavior. A browser
fixture is separate evidence from a real experiment, public VDO route, physical
phone, or recording run.

## References inspected

- [VDO.Ninja SDK data-only API](https://github.com/steveseguin/ninjasdk)
- [Iframe sandbox and load-event behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)
- [Tauri capabilities and remote-origin boundaries](https://v2.tauri.app/security/capabilities/)
- [BRSP deployment/network inventory](https://github.com/GeorgeFejer91/browser-remote-sync-protocol/blob/main/docs/14-deployment-network-and-csp.md)
