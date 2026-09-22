import {
  startRemoteTarget,
  stopRemoteTarget,
  updateRemoteSnapshot,
} from "./remote-target.js";

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
  markerCount: byId("marker-count"),
  markerList: byId("marker-list"),
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
};

let latest;
let sessionInitialized = false;
let streamSignature = "";
let chartSignature = "";
let markerSequence = -1;
let busy = false;
let remoteRunning = false;

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
  renderCharts(snapshot);
  renderMarkers(snapshot.markers);
  renderRecording(snapshot.recording);
  elements.remotePhase.textContent = titleCase(snapshot.remote.phase);
  elements.remoteRoute.textContent = titleCase(snapshot.remote.route);
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

function renderCharts(snapshot) {
  const visible = snapshot.streams.filter((stream) => !stream.isMarker && stream.selected);
  const nextSignature = visible.map((stream) => stream.id).join("|");
  if (nextSignature !== chartSignature) {
    chartSignature = nextSignature;
    elements.charts.replaceChildren();
    if (visible.length === 0) {
      elements.charts.append(textElement("p", "Select a numeric LSL stream to view it.", "empty-state"));
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
    textElement("span", `${stream.channelCount} channels · ${formatRate(stream.nominalRate)}`),
  );
  const canvas = document.createElement("canvas");
  canvas.dataset.streamId = stream.id;
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
  context.strokeStyle = "#e7e4dc";
  context.lineWidth = 1;
  for (let line = 1; line < 4; line += 1) {
    const y = (h * line) / 4;
    context.beginPath(); context.moveTo(0, y); context.lineTo(w, y); context.stroke();
  }
  if (stream.preview.length < 2) {
    context.fillStyle = "#777c73";
    context.font = "12px Aptos";
    context.fillText(stream.connected ? "Waiting for samples…" : "Connecting…", 12, 22);
    return;
  }
  const channels = Math.min(16, stream.preview[0].values.length);
  const values = stream.preview.flatMap((sample) => sample.values.slice(0, channels)).filter(Number.isFinite);
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (low === high) { low -= 1; high += 1; }
  const pad = (high - low) * 0.08;
  low -= pad; high += pad;
  const colors = ["#276749", "#a85d13", "#6b4d8a", "#2f6f89", "#8e493b", "#52633b"];
  for (let channel = 0; channel < channels; channel += 1) {
    context.strokeStyle = colors[channel % colors.length];
    context.lineWidth = 1.25;
    context.beginPath();
    stream.preview.forEach((sample, index) => {
      const x = (index / (stream.preview.length - 1)) * w;
      const y = h - ((sample.values[channel] - low) / (high - low)) * h;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
  }
  const first = stream.preview[0].timestamp;
  const last = stream.preview.at(-1).timestamp;
  const inWindow = markers.filter((marker) => marker.lslTimestamp >= first && marker.lslTimestamp <= last).reverse();
  for (const marker of inWindow.slice(-16)) {
    const x = ((marker.lslTimestamp - first) / Math.max(0.000001, last - first)) * w;
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
      elements.remotePhase.textContent = connected ? "Connected" : titleCase(phase);
      elements.remoteRoute.textContent = titleCase(route);
    });
    remoteRunning = true;
    return invoke("get_snapshot");
  }).catch(async () => {
    await stopRemoteTarget();
    await invoke("stop_remote").catch(() => {});
    remoteRunning = false;
  });
});

elements.remoteStop.addEventListener("click", () => {
  void run("Stopping phone access…", async () => {
    await stopRemoteTarget();
    remoteRunning = false;
    elements.remoteQr.replaceChildren();
    elements.remoteLink.href = "#";
    elements.remoteIdle.hidden = false;
    elements.remoteActive.hidden = true;
    return invoke("stop_remote");
  }).catch(() => {});
});

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
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
function titleCase(value) { return String(value || "unknown").replaceAll("-", " ").replace(/^./u, (letter) => letter.toUpperCase()); }
function readableError(error) { return String(error?.message || error || "Unknown error"); }

await poll();
void run("Discovering LSL streams…", () => invoke("refresh_streams")).catch(() => {});
