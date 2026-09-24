import { BRSPConnection, randomToken } from "./vendor/brsp.js";
import { VdoNinjaTransport } from "./vendor/vdo-ninja-transport.js";

const invoke = (command, args = {}) => window.__TAURI__.core.invoke(command, args);

let active;
export const REMOTE_SCOPES = Object.freeze(["pairing.request", "recording.observe", "recording.control"]);

export function compactState(snapshot) {
  if (snapshot.remote.approval !== "approved") {
    return { revision: snapshot.revision, approval: snapshot.remote.approval };
  }
  const latestMarkerByStream = new Map();
  for (const marker of snapshot.markers) {
    if (!latestMarkerByStream.has(marker.streamId)) {
      latestMarkerByStream.set(marker.streamId, marker.sequence);
    }
  }
  const streams = snapshot.streams.slice(0, 18).map((stream) => ({
    id: stream.id,
    name: stream.name.slice(0, 80),
    streamType: stream.streamType.slice(0, 40),
    selected: stream.selected,
    connected: stream.connected,
    isMarker: stream.isMarker,
    channelCount: stream.channelCount,
    channelLabel: stream.channels[0]?.label.slice(0, 40) || "Ch 1",
    channelUnit: stream.channels[0]?.unit.slice(0, 20) || "",
    lastSample: stream.isMarker
      ? latestMarkerByStream.get(stream.id) ?? null
      : stream.preview.at(-1)?.timestamp ?? null,
    sampleValue: stream.isMarker || !Number.isFinite(stream.preview.at(-1)?.values[0])
      ? null : Number(stream.preview.at(-1).values[0].toPrecision(5)),
  }));
  const markers = snapshot.markers.slice(0, 18).map((marker) => ({
    sequence: marker.sequence,
    streamName: marker.streamName.slice(0, 80),
    lslTimestamp: marker.lslTimestamp,
    receivedAt: marker.receivedAt,
    value: marker.value.slice(0, 180),
  }));
  const compact = {
    revision: snapshot.revision,
    controlRevision: snapshot.controlRevision,
    selectAllStreams: snapshot.selectAllStreams,
    approval: snapshot.remote.approval,
    keyboardMarkers: snapshot.keyboardMarkers,
    mouseMarkers: snapshot.mouseMarkers,
    participantId: snapshot.participantId,
    streamTotal: snapshot.streams.length,
    markerTotal: snapshot.markers.length,
    streams,
    markers,
    recording: {
      phase: snapshot.recording.phase,
      startedAt: snapshot.recording.startedAt,
      bytesWritten: snapshot.recording.bytesWritten,
      error: snapshot.recording.error,
    },
  };
  const encoder = new TextEncoder();
  while (encoder.encode(JSON.stringify(compact)).byteLength > 6_500) {
    if (compact.markers.length > 0) compact.markers.pop();
    else if (compact.streams.length > 0) compact.streams.pop();
    else break;
  }
  return compact;
}

export async function startRemoteTarget(invite, onStatus) {
  await stopRemoteTarget();
  const transport = new VdoNinjaTransport({
    role: "target",
    room: invite.room,
    sharedSecret: invite.secret,
    label: "Remote LSL Recorder",
  });
  const context = {
    invite,
    transport,
    connection: undefined,
    snapshot: compactState(await invoke("get_snapshot")),
    phase: "connecting",
    route: "unknown",
    connected: false,
    heartbeat: undefined,
    onStatus,
  };
  const connection = new BRSPConnection({
    transport,
    role: "target",
    sessionId: invite.room,
    sharedSecret: invite.secret,
    peerId: `target_${randomToken(12)}`,
    capabilities: ["command-ack", "state-snapshot", "latest-state"],
    requestedScopes: [],
    grantedScopes: REMOTE_SCOPES,
    getState: () => context.snapshot,
    applyCommand: async ({ scope, action, args, expectedRevision }) => {
      if (!((scope === "pairing.request" && action === "request-access")
        || scope === "recording.control")) {
        return { ok: false, revision: context.snapshot.revision, error: "scope_denied" };
      }
      const outcome = await invoke("remote_command", {
        request: {
          grantToken: invite.grantToken,
          scope,
          action,
          args,
          expectedRevision,
        },
      });
      context.snapshot = compactState(await invoke("get_snapshot"));
      return outcome;
    },
  });
  context.connection = connection;
  active = context;

  const report = async () => {
    if (active !== context) return;
    onStatus?.({ phase: context.phase, route: context.route, connected: context.connected });
    try {
      await invoke("report_remote_status", {
        grantToken: invite.grantToken,
        phase: context.phase,
        route: context.route,
        connected: context.connected,
      });
    } catch {
      // Teardown may revoke the Rust grant before the browser adapter stops.
    }
  };

  transport.addEventListener("status", (event) => {
    context.phase = safeToken(event.detail.phase, "transport");
    void report();
  });
  transport.addEventListener("quality", (event) => {
    context.route = safeToken(event.detail.route, "unknown");
    void report();
  });
  connection.addEventListener("phasechange", (event) => {
    context.phase = safeToken(event.detail.phase, "protocol");
    context.connected = event.detail.phase === "ready";
    if (!context.connected) {
      window.clearInterval(context.heartbeat);
      context.heartbeat = undefined;
    }
    void report();
  });
  connection.addEventListener("ready", () => {
    context.phase = "ready";
    context.connected = true;
    window.clearInterval(context.heartbeat);
    context.heartbeat = window.setInterval(() => {
      if (connection.phase === "ready") {
        connection.publishState(context.snapshot, { revision: context.snapshot.revision });
      }
    }, 750);
    void report();
  });
  connection.addEventListener("protocolerror", () => {
    context.phase = "error";
    context.connected = false;
    void report();
  });

  await transport.start();
  return context;
}

export function updateRemoteSnapshot(snapshot) {
  if (!active) return;
  active.snapshot = compactState(snapshot);
}

export async function stopRemoteTarget() {
  const context = active;
  active = undefined;
  if (!context) return;
  window.clearInterval(context.heartbeat);
  await context.connection?.close();
}

function safeToken(value, fallback) {
  const token = String(value ?? "").replace(/[^A-Za-z0-9_-]/gu, "-").slice(0, 32);
  return token || fallback;
}
