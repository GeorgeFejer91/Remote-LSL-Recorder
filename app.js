import { BRSPConnection, randomToken } from "./vendor/brsp.js";
import { VdoNinjaTransport } from "./vendor/vdo-ninja-transport.js";
import { commandForParticipant, formatBytes, parseInvite } from "./core.js";

const byId = (id) => document.getElementById(id);
const elements = {
  connect: byId("connect"),
  status: byId("connection-status"),
  pill: byId("connection-pill"),
  pairing: byId("pairing-panel"),
  pairingCopy: byId("pairing-copy"),
  workspace: byId("remote-workspace"),
  participant: byId("participant-id"),
  applyParticipant: byId("apply-participant"),
  refresh: byId("refresh-streams"),
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

if (!invite) {
  elements.connect.disabled = true;
  elements.pairingCopy.textContent = "This link is incomplete or has expired. Scan a fresh QR code in the desktop app.";
  elements.status.textContent = "No valid invitation found.";
}

elements.connect.addEventListener("click", () => { void connect(); });
elements.applyParticipant.addEventListener("click", () => {
  send(commandForParticipant(elements.participant.value));
});
elements.refresh.addEventListener("click", () => send({
  scope: "recording.control", action: "refresh-streams", args: {},
}));
elements.start.addEventListener("click", () => send({
  scope: "recording.control", action: "start-recording", args: {},
}));
elements.stop.addEventListener("click", () => send({
  scope: "recording.control", action: "stop-recording", args: {},
}));

async function connect() {
  if (!invite || connection) return;
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
      requestedScopes: ["recording.observe", "recording.control"],
      grantedScopes: [],
    });
    transport.addEventListener("status", (event) => setStatus(event.detail.message));
    connection.addEventListener("phasechange", (event) => setStatus(event.detail.message));
    connection.addEventListener("ready", () => {
      elements.pill.textContent = "Connected";
      elements.pill.classList.add("live");
      elements.workspace.hidden = false;
      setStatus("Connected. Waiting for recorder state…");
    });
    connection.addEventListener("snapshot", (event) => acceptState(event.detail.state));
    connection.addEventListener("state", (event) => acceptState(event.detail.state));
    connection.addEventListener("commandapplied", (event) => {
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
      if (event.detail.phase === "disconnected") disconnect("The desktop disconnected.");
    });
    await transport.start();
  } catch (error) {
    await closeConnection();
    elements.connect.disabled = false;
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function send({ scope, action, args }) {
  if (!connection || connection.phase !== "ready" || !latest) return;
  try {
    connection.sendCommand(scope, action, args, { expectedRevision: latest.revision });
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
  latest = state;
  elements.participant.value = state.participantId ?? "";
  elements.revision.textContent = `Revision ${state.revision}`;
  renderRecording(state.recording);
  renderStreams(state.streams ?? []);
  renderMarkers(state.markers ?? []);
}

function renderRecording(recording = {}) {
  const active = recording.phase === "recording";
  elements.recordingPhase.textContent = titleCase(recording.phase ?? "idle");
  elements.recordingDetail.textContent = recording.error || formatBytes(recording.bytesWritten ?? 0);
  elements.start.disabled = active || pending > 0;
  elements.stop.disabled = !active || pending > 0;
}

function renderStreams(streams) {
  elements.streams.replaceChildren();
  if (streams.length === 0) {
    const message = (latest?.streamTotal ?? 0) > 0
      ? "Streams are available on the desktop but did not fit this bounded phone update."
      : "No streams found.";
    elements.streams.append(textElement("p", message, "empty"));
    return;
  }
  const recording = latest?.recording?.phase === "recording";
  for (const stream of streams) {
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
      textElement("span", `${stream.streamType || "untyped"} · ${stream.connected ? "live" : "waiting"}`),
    );
    row.append(
      checkbox,
      copy,
      textElement("span", stream.isMarker ? "marker" : "signal", `stream-kind${stream.isMarker ? " marker" : ""}`),
    );
    elements.streams.append(row);
  }
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
  elements.refresh.disabled = isBusy;
  for (const checkbox of elements.streams.querySelectorAll("input[type=checkbox]")) {
    checkbox.disabled = isBusy || active;
  }
}

function setStatus(message) {
  elements.status.textContent = message || "Working…";
}

function disconnect(message) {
  elements.pill.textContent = "Disconnected";
  elements.pill.classList.remove("live");
  elements.workspace.hidden = true;
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
