import { BRSPConnection, randomToken } from "./vendor/brsp.js";
import { VdoNinjaTransport } from "./vendor/vdo-ninja-transport.js";
import { commandForParticipant, formatBytes, observeActivity, parseInvite, sparklinePath } from "./core.js";
import { mountTextFitting } from "./text-fit.js";
import { mountExternalTabs } from "./external-tabs.js";

const byId = (id) => document.getElementById(id);
const elements = {
  connect: byId("connect"),
  name: byId("controller-name"),
  status: byId("connection-status"),
  pill: byId("connection-pill"),
  pairing: byId("pairing-panel"),
  pairingCopy: byId("pairing-copy"),
  workspace: byId("remote-workspace"),
  participant: byId("participant-id"),
  applyParticipant: byId("apply-participant"),
  selectAllStreams: byId("select-all-streams"),
  keyboardMarkers: byId("keyboard-markers"),
  mouseMarkers: byId("mouse-markers"),
  streams: byId("stream-list"),
  markers: byId("marker-list"),
  markerCount: byId("marker-count"),
  recordingPhase: byId("recording-phase"),
  recordingDetail: byId("recording-detail"),
  start: byId("start-recording"),
  stop: byId("stop-recording"),
  revision: byId("revision"),
};

const invite = parseInvite(window.location.hash);
if (window.location.hash) {
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

let transport;
let connection;
let latest;
let pending = 0;
const streamHistory = new Map();

if (!invite) {
  elements.connect.disabled = true;
  elements.pairingCopy.textContent = "This link is incomplete or has expired. Scan a fresh QR code in the desktop app.";
  elements.status.textContent = "No valid invitation found.";
}

elements.connect.addEventListener("click", () => { void connect(); });
elements.applyParticipant.addEventListener("click", () => {
  send(commandForParticipant(elements.participant.value));
});
elements.selectAllStreams.addEventListener("change", () => send({
  scope: "recording.control", action: "set-all-streams-selected",
  args: { selected: elements.selectAllStreams.checked },
}));
elements.start.addEventListener("click", () => send({
  scope: "recording.control", action: "start-recording", args: {},
}));
elements.stop.addEventListener("click", () => send({
  scope: "recording.control", action: "stop-recording", args: {},
}));
for (const checkbox of [elements.keyboardMarkers, elements.mouseMarkers]) {
  checkbox.addEventListener("change", () => send({
    scope: "recording.control", action: "set-input-markers",
    args: { keyboard: elements.keyboardMarkers.checked, mouse: elements.mouseMarkers.checked },
  }));
}

async function connect() {
  if (!invite || connection) return;
  elements.name.value = elements.name.value.trim();
  if (!elements.name.reportValidity()) return;
  elements.connect.disabled = true;
  setStatus("Connecting to the desktop app…");
  try {
    transport = new VdoNinjaTransport({
      role: "controller",
      room: invite.room,
      sharedSecret: invite.secret,
      label: "Remote LSL Recorder phone",
    });
    connection = new BRSPConnection({
      transport,
      role: "controller",
      sessionId: invite.room,
      sharedSecret: invite.secret,
      peerId: `controller_${randomToken(12)}`,
      capabilities: ["command-ack", "state-snapshot", "latest-state"],
      requestedScopes: ["pairing.request", "recording.observe", "recording.control"],
      grantedScopes: [],
    });
    transport.addEventListener("status", (event) => {
      if (connection && event.detail.phase === "closed") disconnect("Session ended. Start a new phone session on the desktop and scan its QR code.");
      else setStatus(event.detail.message);
    });
    connection.addEventListener("phasechange", (event) => setStatus(event.detail.message));
    connection.addEventListener("ready", () => {
      elements.pill.textContent = "Approval needed";
      setStatus("Secure link ready. Asking the computer for approval…");
      connection.sendCommand("pairing.request", "request-access", { name: elements.name.value });
    });
    connection.addEventListener("snapshot", (event) => acceptState(event.detail.state));
    connection.addEventListener("state", (event) => acceptState(event.detail.state));
    connection.addEventListener("commandapplied", (event) => {
      if (event.detail.pending?.scope === "pairing.request") {
        setStatus(event.detail.ok
          ? "Waiting for someone at the computer to approve."
          : "Access request rejected. Start a new pairing session on the computer.");
        return;
      }
      pending = Math.max(0, pending - 1);
      setControlsBusy(false);
      if (!event.detail.ok) {
        setStatus(event.detail.error === "revision_conflict"
          ? "The desktop changed first. State is refreshing; try again."
          : `Command rejected: ${event.detail.error ?? "unknown error"}`);
      } else {
        setStatus("Desktop confirmed the change.");
      }
    });
    connection.addEventListener("protocolerror", () => disconnect("The secure remote session ended."));
    connection.addEventListener("phasechange", (event) => {
      if (["disconnected", "closed", "error"].includes(event.detail.phase)) {
        disconnect("Session ended. Start a new phone session on the desktop and scan its QR code.");
      }
    });
    await transport.start();
  } catch (error) {
    await closeConnection();
    elements.pairing.classList.remove("connected");
    elements.connect.disabled = false;
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function send({ scope, action, args }) {
  if (!connection || connection.phase !== "ready" || latest?.approval !== "approved") return;
  try {
    connection.sendCommand(scope, action, args, { expectedRevision: latest.controlRevision });
    pending += 1;
    setControlsBusy(true);
    setStatus("Waiting for desktop confirmation…");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function acceptState(state) {
  if (!state || !Number.isSafeInteger(state.revision)) return;
  if (latest && state.revision < latest.revision) return;
  const previousApproval = latest?.approval;
  latest = state;
  if (state.approval === "denied") {
    disconnect("Access was denied on the computer. Scan a new QR code to try again.");
    return;
  }
  if (state.approval !== "approved") {
    elements.workspace.hidden = true;
    elements.pill.textContent = "Approval needed";
    return;
  }
  if (previousApproval !== "approved") {
    elements.pill.textContent = "Connected";
    elements.pill.classList.add("live");
    elements.pairing.classList.add("connected");
    elements.workspace.hidden = false;
    setStatus("Approved. Recorder state is synchronized.");
  }
  if (document.activeElement !== elements.participant) {
    elements.participant.value = state.participantId ?? "";
  }
  elements.revision.textContent = `Revision ${state.revision}`;
  renderRecording(state.recording);
  elements.keyboardMarkers.checked = Boolean(state.keyboardMarkers);
  elements.mouseMarkers.checked = Boolean(state.mouseMarkers);
  renderStreams(state.streams ?? []);
  renderMarkers(state.markers ?? []);
}

function renderRecording(recording = {}) {
  const active = recording.phase === "recording";
  elements.recordingPhase.textContent = titleCase(recording.phase ?? "idle");
  elements.recordingDetail.textContent = recording.error || (active
    ? `${formatBytes(recording.bytesWritten ?? 0)} written to XDF`
    : formatBytes(recording.bytesWritten ?? 0));
  elements.start.disabled = active || pending > 0;
  elements.stop.disabled = !active || pending > 0;
}

function renderStreams(streams) {
  elements.selectAllStreams.checked = Boolean(latest?.selectAllStreams);
  elements.selectAllStreams.indeterminate = streams.some((stream) => stream.selected)
    && streams.some((stream) => !stream.selected);
  elements.selectAllStreams.disabled = latest?.recording?.phase === "recording" || pending > 0;
  elements.streams.replaceChildren();
  if (streams.length === 0) {
    const message = (latest?.streamTotal ?? 0) > 0
      ? "Streams are available on the desktop but did not fit this bounded phone update."
      : "No streams found.";
    elements.streams.append(textElement("p", message, "empty"));
    return;
  }
  const recording = latest?.recording?.phase === "recording";
  const now = Date.now();
  const visibleIds = new Set(streams.map((stream) => stream.id));
  for (const id of streamHistory.keys()) {
    if (!visibleIds.has(id)) streamHistory.delete(id);
  }
  for (const stream of streams) {
    const activity = observeActivity(streamHistory, stream, now);
    const row = document.createElement("label");
    row.className = "stream-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(stream.selected);
    checkbox.disabled = recording || pending > 0;
    checkbox.addEventListener("change", () => send({
      scope: "recording.control",
      action: "set-stream-selected",
      args: { streamId: stream.id, selected: checkbox.checked },
    }));
    const copy = document.createElement("span");
    copy.className = "stream-copy";
    copy.append(
      textElement("strong", stream.name || "Unnamed stream"),
      textElement("span", `${stream.streamType || "untyped"} · ${stream.channelCount || 1} ch · ${activity.status}`,
        activity.recent ? "activity-live" : ""),
    );
    if (recording && stream.selected) {
      copy.append(textElement("span", "Selected for XDF", "stream-selected"));
    }
    row.append(checkbox, copy);
    if (!stream.isMarker) row.append(miniPreview(stream, activity));
    elements.streams.append(row);
  }
}

function miniPreview(stream, activity) {
  const preview = document.createElement("span");
  preview.className = "mini-preview";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 88 28");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", sparklinePath(activity.values));
  svg.append(path);
  preview.append(svg);
  const value = stream.sampleValue == null ? "—" : `${stream.sampleValue}${stream.channelUnit ? ` ${stream.channelUnit}` : ""}`;
  preview.append(textElement("span", `${stream.channelLabel || "Ch 1"}: ${value}`));
  return preview;
}

function renderMarkers(markers) {
  const total = latest?.markerTotal ?? markers.length;
  elements.markerCount.textContent = markers.length < total
    ? `${markers.length} of ${total} recent`
    : `${markers.length} recent`;
  elements.markers.replaceChildren();
  if (markers.length === 0) {
    elements.markers.append(textElement("li", "No markers received yet.", "empty"));
    return;
  }
  for (const marker of markers) {
    const item = document.createElement("li");
    const received = new Date(marker.receivedAt).toLocaleTimeString();
    item.append(
      textElement("span", marker.value, "marker-value"),
      textElement("span", `${marker.streamName} · ${received} · LSL ${Number(marker.lslTimestamp).toFixed(5)}`, "marker-meta"),
    );
    elements.markers.append(item);
  }
}

function setControlsBusy(isBusy) {
  if (!latest) return;
  const active = latest.recording?.phase === "recording";
  elements.start.disabled = isBusy || active;
  elements.stop.disabled = isBusy || !active;
  elements.applyParticipant.disabled = isBusy || active;
  elements.selectAllStreams.disabled = isBusy || active;
  elements.keyboardMarkers.disabled = isBusy;
  elements.mouseMarkers.disabled = isBusy;
  for (const checkbox of elements.streams.querySelectorAll("input[type=checkbox]")) {
    checkbox.disabled = isBusy || active;
  }
}

function setStatus(message) {
  elements.status.textContent = message || "Working…";
}

function disconnect(message) {
  latest = undefined;
  streamHistory.clear();
  elements.pill.textContent = "Disconnected";
  elements.pill.classList.remove("live");
  elements.pairing.classList.remove("connected");
  elements.pairingCopy.textContent = "Start a new phone session on the desktop and scan its QR code.";
  elements.connect.disabled = true;
  elements.workspace.hidden = true;
  pending = 0;
  setStatus(message);
  void closeConnection();
}

async function closeConnection() {
  const current = connection;
  connection = undefined;
  transport = undefined;
  try { await current?.close(); } catch { /* best effort */ }
}

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = String(text ?? "");
  if (className) element.className = className;
  return element;
}

function titleCase(value) {
  return String(value).replaceAll("-", " ").replace(/^./u, (letter) => letter.toUpperCase());
}

window.addEventListener("pagehide", () => { void closeConnection(); }, { once: true });
mountExternalTabs();
void mountTextFitting();
