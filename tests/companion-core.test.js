import assert from "node:assert/strict";
import test from "node:test";
import { commandForParticipant, formatBytes, observeActivity, parseInvite, sparklinePath } from "../companion/core.js";

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

test("the miniature view tracks new samples locally and identifies a paused signal", () => {
  const history = new Map();
  const signal = { id: "signal", connected: true, isMarker: false, lastSample: 1, sampleValue: 10 };
  assert.equal(observeActivity(history, signal, 1_000).status, "Receiving");
  assert.equal(observeActivity(history, signal, 4_000).status, "No recent samples");
  signal.lastSample = 2;
  signal.sampleValue = 12;
  const fresh = observeActivity(history, signal, 4_100);
  assert.deepEqual(fresh.values, [10, 12]);
  assert.equal(fresh.status, "Receiving");
  assert.match(sparklinePath(fresh.values), /^M0\.0 \d+\.\d L88\.0 \d+\.\d$/u);
  const marker = { id: "marker", connected: true, isMarker: true, lastSample: null, sampleValue: null };
  assert.equal(observeActivity(history, marker, 4_100).status, "Watching events");
  marker.lastSample = 3;
  assert.equal(observeActivity(history, marker, 4_200).status, "Event received");
});
