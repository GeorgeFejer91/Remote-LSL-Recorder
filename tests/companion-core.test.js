import assert from "node:assert/strict";
import test from "node:test";
import { commandForParticipant, formatBytes, parseInvite } from "../companion/core.js";

test("invite parsing accepts only the generated room and secret shapes", () => {
  const invite = parseInvite("#room=rlslr_abcdefghijklmnop&secret=abcdefghijklmnopqrstuvwxyzABCDEF");
  assert.deepEqual(invite, {
    room: "rlslr_abcdefghijklmnop",
    secret: "abcdefghijklmnopqrstuvwxyzABCDEF",
  });
  assert.equal(parseInvite("#room=public&secret=short"), undefined);
});

test("participant command stays typed and bounded to its intended action", () => {
  assert.deepEqual(commandForParticipant("P-001"), {
    scope: "recording.control",
    action: "set-participant",
    args: { participantId: "P-001" },
  });
});

test("byte formatting is compact for phone display", () => {
  assert.equal(formatBytes(0), "No data written yet");
  assert.equal(formatBytes(1536), "1.5 KB");
});
