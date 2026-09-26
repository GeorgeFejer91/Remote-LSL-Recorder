import {
  startRemoteTarget,
  stopRemoteTarget,
  updateRemoteSnapshot,
} from "./remote-target.js";
import { timeToX } from "./chart-time.js";
import { channelRanges, displayChannels } from "./chart-scale.js";
import { mountTextFitting } from "./text-fit.js";
import { mountExternalTabs } from "./external-tabs.js";

const invoke = (command, args = {}) => window.__TAURI__.core.invoke(command, args);
const byId = (id) => document.getElementById(id);
const elements = {
  status: byId("system-status"),
  sessionForm: byId("session-form"),
  participant: byId("participant-id"),
  output: byId("output-directory"),
  streamCount: byId("stream-count"),
  selectAllStreams: byId("select-all-streams"),
  streamList: byId("stream-list"),
  setup: document.querySelector(".setup-panel"),
  workspaceResize: byId("workspace-resize"),
  charts: byId("charts"),
  previewResize: byId("preview-resize"),
  channelMapSummary: byId("channel-map-summary"),
  viewerChannels: byId("viewer-channels"),
  fitPreview: byId("fit-preview"),
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
let channelMapSignature = "";
const hiddenChannels = new Set();
let markerSequence = -1;
let busy = false;
let discoveryFailed = false;
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
  renderChannelMap(snapshot);
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
  elements.streamCount.textContent = `${snapshot.streams.length} stream${snapshot.streams.length === 1 ? "" : "s"} found`;
  elements.selectAllStreams.checked = snapshot.selectAllStreams;
  elements.selectAllStreams.indeterminate = snapshot.streams.some((stream) => stream.selected)
    && snapshot.streams.some((stream) => !stream.selected);
  elements.selectAllStreams.disabled = snapshot.recording.phase === "recording";
  const nextSignature = JSON.stringify(snapshot.streams.map((stream) => [
    stream.id, stream.name, stream.streamType, stream.channelCount, stream.nominalRate,
    stream.hostname, stream.selected, stream.connected, stream.error,
  ]).concat(snapshot.recording.phase));
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
      if (busy) { checkbox.checked = !checkbox.checked; return; }
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
      `${stream.streamType || "untyped"} · ${stream.channelCount} ch · ${stream.isMarker ? "marker" : (stream.connected ? "live" : "waiting")}`,
    );
    copy.append(name, detail);
    row.title = stream.error || `${stream.hostname} · ${formatRate(stream.nominalRate)} · ${stream.sourceId || stream.id}`;
    row.append(checkbox, copy);
    elements.streamList.append(row);
  }
}

function renderChannelMap(snapshot) {
  const streams = snapshot.streams.filter((stream) => stream.selected && !stream.isMarker);
  const signature = JSON.stringify(streams.map((stream) => [stream.id, stream.name, stream.channelCount, stream.channels]));
  if (signature !== channelMapSignature) {
    channelMapSignature = signature;
    elements.viewerChannels.replaceChildren();
    for (const stream of streams) {
      for (let channel = 0; channel < stream.channelCount; channel += 1) {
        const key = `${stream.id}\0${channel}`;
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = !hiddenChannels.has(key);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) hiddenChannels.delete(key);
          else hiddenChannels.add(key);
          renderChannelMap(latest);
          renderCharts(latest);
        });
        const name = stream.channels?.[channel]?.label || `Ch ${channel + 1}`;
        label.append(checkbox, textElement("span", `${stream.name} · ${name}`));
        elements.viewerChannels.append(label);
      }
    }
  }
  const total = streams.reduce((sum, stream) => sum + stream.channelCount, 0);
  elements.channelMapSummary.textContent = `Display channels · ${displayChannels(streams, hiddenChannels).length} of ${total} shown`;
}

function renderCharts(snapshot) {
  const visible = displayChannels(snapshot.streams, hiddenChannels);
  const nextSignature = JSON.stringify(visible.map(({ stream, channel, key }) => [
    key, stream.name, stream.channels?.[channel],
  ]));
  if (nextSignature !== chartSignature) {
    chartSignature = nextSignature;
    elements.charts.replaceChildren();
    if (visible.length === 0) {
      elements.charts.append(textElement("p", "Select a numeric LSL stream or show a channel to preview it.", "empty-state"));
    } else {
      for (const entry of visible) elements.charts.append(createChart(entry));
    }
  }
  const fit = elements.fitPreview.checked;
  elements.charts.classList.toggle("fit", fit);
  if (fit) elements.charts.scrollTop = 0;
  const rowHeight = fit && visible.length
    ? Math.floor(elements.charts.clientHeight * 100 / visible.length) / 100 : 100;
  const seen = new Set();
  const ranges = new Map();
  let first = Infinity;
  let last = -Infinity;
  for (const { stream } of visible) {
    if (seen.has(stream.id)) continue;
    seen.add(stream.id);
    ranges.set(stream.id, channelRanges(stream.preview, stream.channelCount));
    if (stream.preview.length >= 2) {
      first = Math.min(first, stream.preview[0].timestamp);
      last = Math.max(last, stream.preview.at(-1).timestamp);
    }
  }
  const canvases = elements.charts.querySelectorAll("canvas");
  for (let index = 0; index < visible.length; index += 1) {
    const { stream, channel } = visible[index];
    canvases[index].style.height = `${rowHeight}px`;
    drawChart(canvases[index], stream, channel, ranges.get(stream.id)[channel], snapshot.markers, first, last);
  }
}

function createChart({ stream, channel }) {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `Live signal plot for ${stream.name}, channel ${channel + 1}`);
  canvas.title = `${stream.name}, ${stream.channels?.[channel]?.label || `channel ${channel + 1}`}`;
  return canvas;
}

function drawChart(canvas, stream, channel, range, markers, first, last) {
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
  const left = Math.min(170, w * 0.36);
  const plotWidth = Math.max(1, w - left - 8);
  const metadata = stream.channels?.[channel];
  const label = metadata?.label || `Channel ${channel + 1}`;
  const description = `Live signal plot for ${stream.name}, ${label}. ${range
    ? `${formatValue(range.min)} to ${formatValue(range.max)} ${metadata?.unit || "units unspecified"}`
    : "No finite samples"}`;
  canvas.setAttribute("aria-label", description);
  canvas.title = description;
  context.fillStyle = "#454a43";
  if (h < 60) {
    context.font = "10px Noto Sans";
    if (h >= 11) context.fillText(w < 400 ? label : `${stream.name} · ${label}`, 8, h / 2 + 3, left - 14);
  } else if (w < 400) {
    context.font = "11px Noto Sans";
    context.fillText(label, 8, 24, left - 14);
    context.fillStyle = "#62675f";
    context.font = "10px Noto Sans";
    context.fillText(range ? `${formatValue(range.min)} to ${formatValue(range.max)} ${metadata?.unit || ""}`
      : (metadata?.unit || "Unit unspecified"), 8, 43, left - 14);
  } else {
    context.font = "11px Noto Sans";
    context.fillText(stream.name, 8, 19, left - 14);
    context.fillText(label, 8, 36, left - 14);
    context.fillStyle = "#62675f";
    context.font = "10px Noto Sans";
    context.fillText(range ? `${formatValue(range.min)} to ${formatValue(range.max)} ${metadata?.unit || ""}`
      : (metadata?.unit || "Unit unspecified"), 8, 53, left - 14);
  }
  context.strokeStyle = "#e7e4dc";
  context.lineWidth = 1;
  context.beginPath(); context.moveTo(left, h / 2); context.lineTo(w, h / 2); context.stroke();
  if (stream.preview.length < 2) {
    context.fillStyle = "#777c73";
    context.font = "12px Noto Sans";
    context.fillText(stream.connected ? "Waiting for samples…" : "Connecting…", left + 8, 22);
    return;
  }
  if (range) {
    context.strokeStyle = ["#276749", "#a85d13", "#6b4d8a", "#2f6f89", "#8e493b", "#52633b"][channel % 6];
    context.lineWidth = 1.25;
    context.beginPath();
    let started = false;
    const pad = Math.min(8, h * 0.15);
    for (const sample of stream.preview) {
      const value = sample.values[channel];
      if (!Number.isFinite(value)) { started = false; continue; }
      const x = left + timeToX(sample.timestamp, first, last, plotWidth);
      const y = h - pad - ((value - range.low) / (range.high - range.low)) * Math.max(1, h - 2 * pad);
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
    if (h >= 60) {
      context.save();
      context.translate(Math.min(w - 4, x + 3), 7);
      context.rotate(Math.PI / 2);
      context.fillStyle = markerColor(marker.streamName);
      context.font = "10px Cascadia Mono";
      context.fillText(marker.value.slice(0, 28), 0, 0);
      context.restore();
    }
  }
}

function bindResize(handle, measure, apply) {
  let drag;
  const showValue = (value, bounds) => {
    handle.setAttribute("aria-valuemin", String(bounds.min));
    handle.setAttribute("aria-valuemax", String(bounds.max));
    handle.setAttribute("aria-valuenow", String(Math.round(value)));
  };
  const setSize = (size, bounds) => {
    const value = Math.round(Math.max(bounds.min, Math.min(bounds.max, size)));
    apply(value);
    showValue(value, bounds);
  };
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const bounds = measure();
    drag = { ...bounds, pointer: event.pointerId, start: bounds.axis === "x" ? event.clientX : event.clientY };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const point = drag.axis === "x" ? event.clientX : event.clientY;
    setSize(drag.size + point - drag.start, drag);
  });
  const stop = () => { drag = null; };
  handle.addEventListener("pointerup", stop);
  handle.addEventListener("pointercancel", stop);
  handle.addEventListener("lostpointercapture", stop);
  handle.addEventListener("keydown", (event) => {
    const bounds = measure();
    const direction = bounds.axis === "x"
      ? { ArrowLeft: -1, ArrowRight: 1 }
      : { ArrowUp: -1, ArrowDown: 1 };
    if (!direction[event.key]) return;
    event.preventDefault();
    setSize(bounds.size + direction[event.key] * (event.shiftKey ? 40 : 10), bounds);
  });
  const refresh = () => {
    const bounds = measure();
    if (bounds.size < bounds.min || bounds.size > bounds.max) setSize(bounds.size, bounds);
    else showValue(bounds.size, bounds);
  };
  window.addEventListener("resize", refresh);
  window.requestAnimationFrame(refresh);
}

bindResize(elements.workspaceResize, () => {
  const narrow = window.matchMedia("(max-width: 800px)").matches;
  const axis = narrow ? "y" : "x";
  const size = narrow ? elements.setup.getBoundingClientRect().height : elements.setup.getBoundingClientRect().width;
  const available = narrow ? elements.workspaceResize.parentElement.clientHeight : elements.workspaceResize.parentElement.clientWidth;
  elements.workspaceResize.setAttribute("aria-orientation", narrow ? "horizontal" : "vertical");
  return { axis, size, min: narrow ? 160 : 220, max: Math.max(narrow ? 160 : 220, available - (narrow ? 180 : 300) - 8) };
}, (size) => {
  const narrow = window.matchMedia("(max-width: 800px)").matches;
  elements.workspaceResize.parentElement.style.setProperty(narrow ? "--setup-height" : "--setup-width", `${size}px`);
  if (latest) renderCharts(latest);
});

bindResize(elements.previewResize, () => ({
  axis: "y", size: elements.charts.getBoundingClientRect().height, min: 160, max: 1000,
}), (size) => {
  elements.charts.style.height = `${size}px`;
  if (latest) renderCharts(latest);
});

elements.fitPreview.addEventListener("change", () => { if (latest) renderCharts(latest); });

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

elements.selectAllStreams.addEventListener("change", () => {
  if (busy) { if (latest) renderStreams(latest); return; }
  void run("Updating stream selection…", () => invoke("select_all_streams", {
    selected: elements.selectAllStreams.checked,
  })).catch(() => { if (latest) renderStreams(latest); });
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
  if (event.target.closest?.(".external-page")) return;
  if (latest?.keyboardMarkers && elements.keyboardMarkers.checked) queueInputMarker("key-down", {
    key: event.key, code: event.code, repeat: event.repeat,
    alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey,
  });
}, true);
document.addEventListener("keyup", (event) => {
  if (event.target.closest?.(".external-page")) return;
  if (latest?.keyboardMarkers && elements.keyboardMarkers.checked) queueInputMarker("key-up", {
    key: event.key, code: event.code,
    alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey,
  });
}, true);
document.addEventListener("mousedown", (event) => {
  if (event.target.closest?.(".external-page")) return;
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

async function discoverStreams() {
  if (!busy) {
    try {
      render(await invoke("refresh_streams"));
      if (discoveryFailed || elements.status.textContent === "Starting…") elements.status.textContent = "Ready";
      discoveryFailed = false;
    } catch (error) {
      discoveryFailed = true;
      elements.status.textContent = readableError(error);
    }
  }
  window.setTimeout(discoverStreams, 3000);
}

await poll();
mountExternalTabs();
void mountTextFitting();
void discoverStreams();
