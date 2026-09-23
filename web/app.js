import {
  startRemoteTarget,
  stopRemoteTarget,
  updateRemoteSnapshot,
} from "./remote-target.js";
import { timeToX } from "./chart-time.js";
import { channelRanges } from "./chart-scale.js";
import { mountTextFitting } from "./text-fit.js";

const invoke = (command, args = {}) => window.__TAURI__.core.invoke(command, args);
const byId = (id) => document.getElementById(id);
const elements = {
  status: byId("system-status"),
  refresh: byId("refresh-streams"),
  sessionForm: byId("session-form"),
  participant: byId("participant-id"),
  output: byId("output-directory"),
  streamCount: byId("stream-count"),
  streamList: byId("stream-list"),
  charts: byId("charts"),
  viewerStreams: byId("viewer-streams"),
  markerCount: byId("marker-count"),
  markerList: byId("marker-list"),
  keyboardMarkers: byId("keyboard-markers"),
  mouseMarkers: byId("mouse-markers"),
  recordIndicator: byId("record-indicator"),
  recordPhase: byId("record-phase"),
  recordDetail: byId("record-detail"),
  recordStart: byId("record-start"),
  recordStop: byId("record-stop"),
  remoteOpen: byId("remote-open"),
  remoteDialog: byId("remote-dialog"),
  remoteIdle: byId("remote-idle"),
  remoteActive: byId("remote-active"),
  remoteStart: byId("remote-start"),
  remoteStop: byId("remote-stop"),
  remoteQr: byId("remote-qr"),
  remoteLink: byId("remote-link"),
  remotePhase: byId("remote-phase"),
  remoteRoute: byId("remote-route"),
  remoteRequest: byId("remote-request"),
  remoteRequestName: byId("remote-request-name"),
  remoteApprove: byId("remote-approve"),
  remoteDeny: byId("remote-deny"),
};

let latest;
let sessionInitialized = false;
let streamSignature = "";
let chartSignature = "";
let viewerSignature = "";
const hiddenStreamIds = new Set();
let markerSequence = -1;
let busy = false;
let remoteRunning = false;
let remoteClosing = false;
let inputMarkersPending = false;
let inputMarkerQueue = Promise.resolve();

async function run(label, operation) {
  if (busy) return;
  busy = true;
  elements.status.textContent = label;
  try {
    const value = await operation();
    if (value?.streams) render(value);
    elements.status.textContent = "Ready";
    return value;
  } catch (error) {
    elements.status.textContent = readableError(error);
    throw error;
  } finally {
    busy = false;
  }
}

function render(snapshot) {
  latest = snapshot;
  updateRemoteSnapshot(snapshot);
  if (!sessionInitialized) {
    elements.participant.value = snapshot.participantId;
    elements.output.value = snapshot.outputDirectory;
    sessionInitialized = true;
  }
  renderStreams(snapshot);
  renderViewerStreams(snapshot);
  renderCharts(snapshot);
  renderMarkers(snapshot.markers);
  if (!inputMarkersPending) {
    elements.keyboardMarkers.checked = snapshot.keyboardMarkers;
    elements.mouseMarkers.checked = snapshot.mouseMarkers;
  }
  renderRecording(snapshot.recording);
  elements.remotePhase.textContent = snapshot.remote.approval === "pending"
    ? "Approval required"
    : snapshot.remote.approval === "approved" ? "Connected"
      : snapshot.remote.approval === "denied" ? "Denied" : titleCase(snapshot.remote.phase);
  elements.remoteRoute.textContent = titleCase(snapshot.remote.route);
  elements.remoteRequest.hidden = snapshot.remote.approval !== "pending";
  elements.remoteRequestName.textContent = snapshot.remote.controllerName ?? "A phone";
  if (snapshot.remote.approval === "pending" && !elements.remoteDialog.open) {
    elements.remoteDialog.showModal();
  }
}

function renderStreams(snapshot) {
  elements.streamCount.textContent = `${snapshot.streams.length} found`;
  const nextSignature = JSON.stringify(snapshot.streams.map((stream) => [
    stream.id, stream.selected, stream.connected, stream.error,
  ]));
  if (nextSignature === streamSignature) return;
  streamSignature = nextSignature;
  elements.streamList.replaceChildren();
  if (snapshot.streams.length === 0) {
    elements.streamList.append(textElement("p", "No LSL streams found.", "empty-state"));
    return;
  }
  for (const stream of snapshot.streams) {
    const row = document.createElement("label");
    row.className = "stream-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = stream.selected;
    checkbox.disabled = snapshot.recording.phase === "recording";
    checkbox.addEventListener("change", () => {
      void run("Updating stream selection…", () => invoke("select_stream", {
        streamId: stream.id,
        selected: checkbox.checked,
      })).catch(() => { checkbox.checked = !checkbox.checked; });
    });
    const copy = document.createElement("span");
    copy.className = "stream-copy";
    const name = textElement("strong", stream.name);
    const detail = textElement(
      "span",
      `${stream.streamType || "untyped"} · ${stream.channelCount} ch · ${formatRate(stream.nominalRate)} · ${stream.hostname}`,
    );
    copy.append(name, detail);
    const kind = textElement(
      "span",
      stream.isMarker ? "marker" : (stream.connected ? "live" : "waiting"),
      `stream-kind${stream.isMarker ? " marker" : ""}`,
    );
    row.title = stream.error || stream.sourceId || stream.id;
    row.append(checkbox, copy, kind);
    elements.streamList.append(row);
  }
}

function renderViewerStreams(snapshot) {
  const numeric = snapshot.streams.filter((stream) => !stream.isMarker);
  const signature = numeric.map((stream) => `${stream.id}:${stream.name}`).join("|");
  if (signature === viewerSignature) return;
  viewerSignature = signature;
  elements.viewerStreams.replaceChildren();
  for (const stream of numeric) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !hiddenStreamIds.has(stream.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) hiddenStreamIds.delete(stream.id);
      else hiddenStreamIds.add(stream.id);
      renderCharts(latest);
    });
    label.append(checkbox, textElement("span", stream.name));
    elements.viewerStreams.append(label);
  }
}

function renderCharts(snapshot) {
  const visible = snapshot.streams.filter((stream) => !stream.isMarker && !hiddenStreamIds.has(stream.id));
  const nextSignature = visible.map((stream) => stream.id).join("|");
  if (nextSignature !== chartSignature) {
    chartSignature = nextSignature;
    elements.charts.replaceChildren();
    if (visible.length === 0) {
      elements.charts.append(textElement("p", "No numeric streams are visible.", "empty-state"));
    } else {
      for (const stream of visible) elements.charts.append(createChart(stream));
    }
  }
  for (const stream of visible) {
    const canvas = document.querySelector(`canvas[data-stream-id="${CSS.escape(stream.id)}"]`);
    if (canvas) drawChart(canvas, stream, snapshot.markers);
  }
}

function createChart(stream) {
  const panel = document.createElement("article");
  panel.className = "chart-panel";
  const title = document.createElement("div");
  title.className = "chart-title";
  title.append(
    textElement("strong", stream.name),
    textElement("span", `${stream.channelCount} channels · ${formatRate(stream.nominalRate)} · per-channel autoscale`),
  );
  const canvas = document.createElement("canvas");
  canvas.dataset.streamId = stream.id;
  canvas.style.height = `${Math.min(16, stream.channelCount) * 90}px`;
  canvas.setAttribute("aria-label", `Live signal plot for ${stream.name}`);
  panel.append(title, canvas);
  return panel;
}

function drawChart(canvas, stream, markers) {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * scale));
  const height = Math.max(1, Math.floor(rect.height * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(scale, 0, 0, scale, 0, 0);
  const w = rect.width;
  const h = rect.height;
  context.clearRect(0, 0, w, h);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, w, h);
  const channels = Math.min(16, stream.channelCount);
  const laneHeight = h / Math.max(1, channels);
  const left = Math.min(115, w * 0.3);
  const plotWidth = Math.max(1, w - left - 8);
  if (stream.preview.length < 2) {
    context.fillStyle = "#777c73";
    context.font = "12px Noto Sans";
    context.fillText(stream.connected ? "Waiting for samples…" : "Connecting…", 12, 22);
    return;
  }
  const ranges = channelRanges(stream.preview, channels);
  canvas.setAttribute("aria-label", `Live signal plot for ${stream.name}. ${ranges.map((range, index) => {
    const metadata = stream.channels?.[index];
    const label = metadata?.label || `Channel ${index + 1}`;
    return range ? `${label}: ${formatValue(range.min)} to ${formatValue(range.max)} ${metadata?.unit || "units unspecified"}` : `${label}: no finite samples`;
  }).join("; ")}`);
  const colors = ["#276749", "#a85d13", "#6b4d8a", "#2f6f89", "#8e493b", "#52633b"];
  const first = stream.preview[0].timestamp;
  const last = stream.preview.at(-1).timestamp;
  for (let channel = 0; channel < channels; channel += 1) {
    const top = channel * laneHeight;
    const range = ranges[channel];
    const metadata = stream.channels?.[channel];
    context.fillStyle = "#454a43";
    context.font = "11px Noto Sans";
    context.fillText(metadata?.label || `Ch ${channel + 1}`, 8, top + 22, left - 14);
    context.fillStyle = "#62675f";
    context.font = "10px Noto Sans";
    context.fillText(metadata?.unit || "unit unknown", 8, top + 38, left - 14);
    if (range) context.fillText(`${formatValue(range.min)} to ${formatValue(range.max)}`, 8, top + 54, left - 14);
    context.strokeStyle = "#e7e4dc";
    context.lineWidth = 1;
    context.beginPath(); context.moveTo(left, top + laneHeight / 2); context.lineTo(w, top + laneHeight / 2); context.stroke();
    if (channel > 0) {
      context.beginPath(); context.moveTo(0, top); context.lineTo(w, top); context.stroke();
    }
    if (!range) continue;
    context.strokeStyle = colors[channel % colors.length];
    context.lineWidth = 1.25;
    context.beginPath();
    let started = false;
    for (const sample of stream.preview) {
      const value = sample.values[channel];
      if (!Number.isFinite(value)) { started = false; continue; }
      const x = left + timeToX(sample.timestamp, first, last, plotWidth);
      const y = top + laneHeight - 8 - ((value - range.low) / (range.high - range.low)) * (laneHeight - 16);
      if (started) context.lineTo(x, y); else context.moveTo(x, y);
      started = true;
    }
    context.stroke();
  }
  const inWindow = markers.filter((marker) => marker.lslTimestamp >= first && marker.lslTimestamp <= last).reverse();
  for (const marker of inWindow.slice(-16)) {
    const x = left + timeToX(marker.lslTimestamp, first, last, plotWidth);
    context.strokeStyle = markerColor(marker.streamName);
    context.lineWidth = 1.5;
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, h); context.stroke();
    context.save();
    context.translate(Math.min(w - 4, x + 3), 7);
    context.rotate(Math.PI / 2);
    context.fillStyle = markerColor(marker.streamName);
    context.font = "10px Cascadia Mono";
    context.fillText(marker.value.slice(0, 28), 0, 0);
    context.restore();
  }
}

function renderMarkers(markers) {
  const newest = markers[0]?.sequence ?? -1;
  elements.markerCount.textContent = markers.length === 0
    ? "No markers received"
    : `${markers.length} recent marker${markers.length === 1 ? "" : "s"}`;
  if (newest === markerSequence) return;
  markerSequence = newest;
  elements.markerList.replaceChildren();
  if (markers.length === 0) {
    const row = document.createElement("tr");
    const cell = textElement("td", "Irregular marker and event streams are monitored automatically.", "empty-state");
    cell.colSpan = 4;
    row.append(cell);
    elements.markerList.append(row);
    return;
  }
  for (const marker of markers) {
    const row = document.createElement("tr");
    const received = new Date(marker.receivedAt).toLocaleTimeString();
    row.append(
      textElement("td", received),
      textElement("td", marker.streamName),
      textElement("td", marker.lslTimestamp.toFixed(5)),
      textElement("td", marker.value, "marker-value"),
    );
    elements.markerList.append(row);
  }
}

function renderRecording(recording) {
  const active = recording.phase === "recording";
  elements.recordIndicator.classList.toggle("active", active);
  elements.recordPhase.textContent = titleCase(recording.phase);
  elements.recordStart.disabled = active || busy;
  elements.recordStop.disabled = !active || busy;
  const parts = [];
  if (recording.outputFile) parts.push(recording.outputFile);
  if (recording.bytesWritten > 0) parts.push(formatBytes(recording.bytesWritten));
  if (recording.error) parts.push(recording.error);
  elements.recordDetail.textContent = parts.join(" · ") || "Configure a participant and select at least one stream.";
}

elements.sessionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void run("Applying session…", () => invoke("configure_session", {
    participantId: elements.participant.value,
    outputDirectory: elements.output.value,
  })).catch(() => {});
});

elements.refresh.addEventListener("click", () => {
  void run("Discovering LSL streams…", () => invoke("refresh_streams")).catch(() => {});
});

elements.recordStart.addEventListener("click", () => {
  void run("Starting XDF recording…", async () => {
    await invoke("configure_session", {
      participantId: elements.participant.value,
      outputDirectory: elements.output.value,
    });
    return invoke("start_recording");
  }).catch(() => {});
});

elements.recordStop.addEventListener("click", () => {
  void run("Finishing the XDF footer…", () => invoke("stop_recording")).catch(() => {});
});

async function setInputMarkers() {
  if (inputMarkersPending) return;
  inputMarkersPending = true;
  elements.keyboardMarkers.disabled = true;
  elements.mouseMarkers.disabled = true;
  try {
    await inputMarkerQueue;
    render(await invoke("set_input_markers", {
      keyboard: elements.keyboardMarkers.checked,
      mouse: elements.mouseMarkers.checked,
    }));
    elements.status.textContent = "Ready";
  } catch (error) {
    elements.status.textContent = readableError(error);
    elements.keyboardMarkers.checked = latest.keyboardMarkers;
    elements.mouseMarkers.checked = latest.mouseMarkers;
  } finally {
    inputMarkersPending = false;
    elements.keyboardMarkers.disabled = false;
    elements.mouseMarkers.disabled = false;
  }
}

elements.keyboardMarkers.addEventListener("change", () => void setInputMarkers());
elements.mouseMarkers.addEventListener("change", () => void setInputMarkers());

function queueInputMarker(kind, detail) {
  inputMarkerQueue = inputMarkerQueue
    .then(() => invoke("emit_input_marker", { kind, detail: JSON.stringify(detail) }))
    .catch((error) => { elements.status.textContent = readableError(error); });
}

document.addEventListener("keydown", (event) => {
  if (latest?.keyboardMarkers && elements.keyboardMarkers.checked) queueInputMarker("key-down", {
    key: event.key, code: event.code, repeat: event.repeat,
    alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey,
  });
}, true);
document.addEventListener("keyup", (event) => {
  if (latest?.keyboardMarkers && elements.keyboardMarkers.checked) queueInputMarker("key-up", {
    key: event.key, code: event.code,
    alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey,
  });
}, true);
document.addEventListener("mousedown", (event) => {
  if (latest?.mouseMarkers && elements.mouseMarkers.checked) queueInputMarker("mouse-click", {
    button: event.button, x: event.clientX, y: event.clientY,
    screenX: event.screenX, screenY: event.screenY,
  });
}, true);

elements.remoteOpen.addEventListener("click", () => elements.remoteDialog.showModal());
elements.remoteStart.addEventListener("click", () => {
  void run("Starting phone access…", async () => {
    const invite = await invoke("start_remote");
    elements.remoteQr.innerHTML = invite.qrSvg;
    elements.remoteLink.href = invite.url;
    elements.remoteIdle.hidden = true;
    elements.remoteActive.hidden = false;
    await startRemoteTarget(invite, ({ phase, route, connected }) => {
      remoteRunning = true;
      elements.remotePhase.textContent = connected ? "Waiting for approval" : titleCase(phase);
      elements.remoteRoute.textContent = titleCase(route);
      if (["disconnected", "error"].includes(phase) && !remoteClosing) {
        void endRemoteSession().catch((error) => { elements.status.textContent = readableError(error); });
      }
    });
    remoteRunning = true;
    return invoke("get_snapshot");
  }).catch(async () => {
    await stopRemoteTarget();
    await invoke("stop_remote").catch(() => {});
    remoteRunning = false;
  });
});

elements.remoteApprove.addEventListener("click", () => {
  void run("Approving phone…", () => invoke("decide_remote", { approved: true })).catch(() => {});
});
elements.remoteDeny.addEventListener("click", () => {
  void run("Denying phone…", () => invoke("decide_remote", { approved: false })).catch(() => {});
});

elements.remoteStop.addEventListener("click", () => {
  void run("Stopping phone access…", endRemoteSession).catch(() => {});
});

async function endRemoteSession() {
  if (remoteClosing) return;
  remoteClosing = true;
  try {
    await stopRemoteTarget();
    remoteRunning = false;
    elements.remoteQr.replaceChildren();
    elements.remoteLink.href = "#";
    elements.remoteIdle.hidden = false;
    elements.remoteActive.hidden = true;
    return await invoke("stop_remote");
  } finally {
    remoteClosing = false;
  }
}

window.addEventListener("pagehide", () => {
  if (remoteRunning) void stopRemoteTarget();
}, { once: true });

async function poll() {
  try {
    const snapshot = await invoke("get_snapshot");
    render(snapshot);
  } catch (error) {
    elements.status.textContent = readableError(error);
  } finally {
    window.setTimeout(poll, 250);
  }
}

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function markerColor(value) {
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.codePointAt(0)) | 0;
  return ["#b53b35", "#a85d13", "#6b4d8a", "#2f6f89"][Math.abs(hash) % 4];
}

function formatRate(rate) { return rate > 0 ? `${rate.toLocaleString()} Hz` : "irregular"; }
function formatValue(value) {
  if (value !== 0 && (Math.abs(value) >= 1e5 || Math.abs(value) < 1e-3)) return value.toExponential(2);
  return Number(value.toPrecision(3)).toString();
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
function titleCase(value) { return String(value || "unknown").replaceAll("-", " ").replace(/^./u, (letter) => letter.toUpperCase()); }
function readableError(error) { return String(error?.message || error || "Unknown error"); }

await poll();
void mountTextFitting();
void run("Discovering LSL streams…", () => invoke("refresh_streams")).catch(() => {});
