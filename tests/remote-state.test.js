import assert from "node:assert/strict";
import test from "node:test";
import { BRSPConnection } from "../web/vendor/brsp.js";
import { compactState, REMOTE_SCOPES } from "../web/remote-target.js";

function event(type, detail) {
  const value = new Event(type);
  Object.defineProperty(value, "detail", { value: detail });
  return value;
}

class LinkedTransport extends EventTarget {
  sendControl(peerKey, data) {
    queueMicrotask(() => this.other.dispatchEvent(event("controlmessage", { peerKey, data })));
    return true;
  }

  sendState(peerKey, data) {
    queueMicrotask(() => this.other.dispatchEvent(event("statemessage", { peerKey, data })));
    return true;
  }

  async stop() {}
}

test("phone receives no recorder data before local approval", () => {
  const snapshot = {
    revision: 7,
    controlRevision: 3,
    remote: { approval: "pending" },
    participantId: "PRIVATE",
    outputDirectory: "C:\\PRIVATE",
    streams: [{ name: "PRIVATE STREAM" }],
    markers: [{ value: "PRIVATE MARKER" }],
    recording: { phase: "recording" },
    externalPages: [{ id: "private", name: "Private panel", url: "https://example.com/#private-secret" }],
    externalPagesRevision: 4,
  };
  for (const approval of ["waiting", "pending", "denied", "revoked"]) {
    snapshot.remote.approval = approval;
    assert.deepEqual(compactState(snapshot), { revision: 7, approval });
  }
  snapshot.remote.approval = "approved";
  snapshot.streams = [];
  snapshot.markers = [];
  snapshot.keyboardMarkers = false;
  snapshot.mouseMarkers = false;
  assert.equal(compactState(snapshot).participantId, "PRIVATE");
  assert.equal(compactState(snapshot).outputDirectory, undefined);
  assert.deepEqual(compactState(snapshot).externalPages, { revision: 4, count: 1 });
  assert.ok(!JSON.stringify(compactState(snapshot)).includes("private-secret"));
});

test("phone receives one bounded numeric preview and marker activity, never signal history", () => {
  const snapshot = {
    revision: 8, controlRevision: 3, remote: { approval: "approved" },
    keyboardMarkers: false, mouseMarkers: false, participantId: "P-001",
    streams: [
      {
        id: "signal", name: "Signal", streamType: "EEG", selected: true, connected: true,
        isMarker: false, channelCount: 2, channels: [{ label: "Fp1", unit: "uV" }],
        preview: [{ timestamp: 1, values: [9, 8] }, { timestamp: 2, values: [12.345678, 7] }],
      },
      {
        id: "marker", name: "Markers", streamType: "Markers", selected: true, connected: true,
        isMarker: true, channelCount: 1, channels: [], preview: [],
      },
    ],
    markers: [{ sequence: 2, streamId: "marker", streamName: "Markers", lslTimestamp: 2,
      receivedAt: "2026-09-23T10:00:00Z", value: "Start" }],
    recording: { phase: "recording", startedAt: "2026-09-23T10:00:00Z", bytesWritten: 1024, error: null },
  };
  const state = compactState(snapshot);
  assert.equal(state.streams[0].lastSample, 2);
  assert.equal(state.streams[0].sampleValue, 12.346);
  assert.equal(state.streams[0].channelLabel, "Fp1");
  assert.equal(state.streams[1].lastSample, 2);
  assert.equal(state.streams[1].sampleValue, null);
  assert.equal(state.streams[0].preview, undefined);
  assert.equal(state.streams[0].latestValues, undefined);
  assert.ok(new TextEncoder().encode(JSON.stringify(state)).byteLength < 6_500);
});

test("BRSP pairing request is acknowledged before recorder state is released", { timeout: 5_000 }, async () => {
  const targetTransport = new LinkedTransport();
  const controllerTransport = new LinkedTransport();
  targetTransport.other = controllerTransport;
  controllerTransport.other = targetTransport;
  let state = { revision: 1, approval: "waiting" };
  const target = new BRSPConnection({
    transport: targetTransport, role: "target", sessionId: "pairing-test",
    sharedSecret: "generated-secret-for-pairing-test", peerId: "target_test",
    grantedScopes: REMOTE_SCOPES,
    getState: () => state,
    applyCommand: ({ scope, action, args }) => {
      assert.equal(scope, "pairing.request");
      assert.equal(action, "request-access");
      assert.deepEqual(args, { name: "Alice" });
      state = { revision: 2, approval: "pending" };
      return { ok: true, revision: 2, result: { requested: true } };
    },
  });
  const controller = new BRSPConnection({
    transport: controllerTransport, role: "controller", sessionId: "pairing-test",
    sharedSecret: "generated-secret-for-pairing-test", peerId: "controller_test",
    requestedScopes: REMOTE_SCOPES,
  });
  const ready = Promise.all([target, controller].map((connection) =>
    new Promise((resolve) => connection.addEventListener("ready", resolve, { once: true }))));
  targetTransport.dispatchEvent(event("peeropen", { peerKey: "peer" }));
  controllerTransport.dispatchEvent(event("peeropen", { peerKey: "peer" }));
  await ready;
  const applied = new Promise((resolve) => controller.addEventListener("commandapplied", resolve, { once: true }));
  controller.sendCommand("pairing.request", "request-access", { name: "Alice" });
  assert.equal((await applied).detail.ok, true);
  assert.deepEqual(state, { revision: 2, approval: "pending" });
  await target.close();
  await controller.close();
});
