const ROOM_PATTERN = /^rlslr_[A-Za-z0-9_-]{16}$/u;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{32}$/u;

export function parseInvite(fragment) {
  const params = new URLSearchParams(String(fragment).replace(/^#/u, ""));
  const room = params.get("room") ?? "";
  const secret = params.get("secret") ?? "";
  if (!ROOM_PATTERN.test(room) || !SECRET_PATTERN.test(secret)) return undefined;
  return { room, secret };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "No data written yet";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function commandForParticipant(participantId) {
  return {
    scope: "recording.control",
    action: "set-participant",
    args: { participantId: String(participantId) },
  };
}

export function observeActivity(history, stream, now) {
  const current = history.get(stream.id) ?? { lastSample: null, seenAt: 0, values: [] };
  if (stream.lastSample != null && stream.lastSample !== current.lastSample) {
    current.lastSample = stream.lastSample;
    current.seenAt = now;
    if (Number.isFinite(stream.sampleValue)) {
      current.values.push(stream.sampleValue);
      if (current.values.length > 24) current.values.shift();
    }
  }
  history.set(stream.id, current);
  const recent = current.seenAt > 0 && now - current.seenAt < 2_500;
  const status = !stream.connected ? "Disconnected"
    : stream.isMarker ? (recent ? "Event received" : "Watching events")
      : recent ? "Receiving" : "No recent samples";
  return { status, recent, values: current.values };
}

export function sparklinePath(values, width = 88, height = 28) {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  return values.map((value, index) => {
    const x = (index * width / (values.length - 1)).toFixed(1);
    const y = (height / 2 - (range ? (value - min) / range - 0.5 : 0) * (height - 4)).toFixed(1);
    return `${index ? "L" : "M"}${x} ${y}`;
  }).join(" ");
}
