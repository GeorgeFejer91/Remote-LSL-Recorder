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
