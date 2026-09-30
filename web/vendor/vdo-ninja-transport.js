/**
 * VDO.Ninja SDK v1.5.5 adapter for BRSP/1.
 *
 * One target announces a data-only source. One controller views it. That one
 * publisher/viewer WebRTC connection is already duplex, so two separate peer
 * connections are unnecessary. Two custom RTCDataChannels provide different
 * delivery semantics for control and live state.
 */

import {
  BRSP_CONTROL_MAX_BYTES,
  BRSP_STATE_MAX_BYTES,
  randomToken,
} from "./brsp.js";

export const VDO_BRSP_CONTROL_CHANNEL = "brsp_control_v1";
export const VDO_BRSP_STATE_CHANNEL = "brsp_state_v1";
export const VDO_BRSP_STREAM_PREFIX = "brsp_target_";
export const VDO_BRSP_SALT = "browser-remote-sync-protocol-v1";
export const VDO_CONTROL_BACKLOG_LIMIT = 262_144;

const encoder = new TextEncoder();

function detailEvent(type, detail) {
  const event = new Event(type);
  Object.defineProperty(event, "detail", { value: detail, enumerable: true });
  return event;
}

function protocolBytes(value) {
  if (typeof value === "string") return encoder.encode(value).byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return Infinity;
}

function sourceItem(value) {
  if (typeof value === "string") return { streamId: value, peerKey: "", label: "" };
  return {
    streamId: value?.streamID ?? value?.streamId ?? "",
    peerKey: value?.UUID ?? value?.uuid ?? "",
    label: value?.label ?? value?.streamLabel ?? value?.name ?? "",
  };
}

function normalizeRoom(value) {
  const room = String(value ?? "").replace(/[^A-Za-z0-9_]/gu, "_").slice(0, 96);
  if (room.length < 8) throw new TypeError("VDO.Ninja room must contain at least eight safe characters.");
  return room;
}

function normalizeChannelLabel(label) {
  return String(label ?? "").startsWith("x-") ? String(label).slice(2) : String(label ?? "");
}

function defaultSdkFactory(options) {
  if (typeof globalThis.VDONinjaSDK !== "function") {
    throw new Error("The pinned VDO.Ninja SDK has not been loaded.");
  }
  return new globalThis.VDONinjaSDK(options);
}

export function generateVdoRoomId() {
  return normalizeRoom(`brsp_${randomToken(18)}`);
}

export class VdoNinjaTransport extends EventTarget {
  constructor({
    role,
    room,
    sharedSecret,
    streamId,
    label = "BRSP target",
    sdkFactory = defaultSdkFactory,
    forceTurn = false,
  }) {
    super();
    if (role !== "controller" && role !== "target") throw new TypeError("role must be controller or target.");
    if (typeof sharedSecret !== "string" || encoder.encode(sharedSecret).byteLength < 16) {
      throw new TypeError("sharedSecret must contain at least 16 UTF-8 bytes.");
    }
    this.role = role;
    this.room = normalizeRoom(room);
    this.sharedSecret = sharedSecret;
    this.streamId = streamId
      ? normalizeRoom(streamId)
      : `${VDO_BRSP_STREAM_PREFIX}${randomToken(12)}`.replace(/[^A-Za-z0-9_]/gu, "_");
    if (this.role === "target" && !this.streamId.startsWith(VDO_BRSP_STREAM_PREFIX)) {
      throw new TypeError(`Target streamId must start with ${VDO_BRSP_STREAM_PREFIX}.`);
    }
    this.label = String(label).replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 64) || "BRSP target";
    this.sdkFactory = sdkFactory;
    this.forceTurn = Boolean(forceTurn);
    this.phase = "idle";
    this.sdk = undefined;
    this.listeners = [];
    this.peers = new Map();
    this.sources = new Map();
    this.selectedStreamId = "";
    this.selectedPeerKey = "";
    this.discoveryReady = false;
    this.qualityTimer = undefined;
    this.tearingDown = false;
    this.lifecycleGeneration = 0;
    this.stopPromise = undefined;
  }

  snapshot() {
    return {
      phase: this.phase,
      role: this.role,
      room: this.room,
      streamId: this.role === "target" ? this.streamId : this.selectedStreamId,
      sources: Array.from(this.sources.values()),
      peers: Array.from(this.peers.keys()),
      forceTurnRequested: this.forceTurn,
    };
  }

  emitStatus(message, error = false) {
    this.dispatchEvent(detailEvent("status", { ...this.snapshot(), message, error }));
  }

  isCurrentSdk(sdk, generation) {
    return Boolean(sdk) && this.sdk === sdk && this.lifecycleGeneration === generation && !this.tearingDown;
  }

  listen(sdk, generation, type, handler) {
    const guardedHandler = (event) => {
      if (this.isCurrentSdk(sdk, generation)) handler(event);
    };
    sdk.addEventListener(type, guardedHandler);
    this.listeners.push([sdk, type, guardedHandler]);
  }

  removeSdkListeners(sdk) {
    const retained = [];
    for (const [listenerSdk, type, handler] of this.listeners) {
      if (listenerSdk !== sdk) {
        retained.push([listenerSdk, type, handler]);
        continue;
      }
      try { listenerSdk.removeEventListener(type, handler); } catch { /* best-effort listener cleanup */ }
    }
    this.listeners = retained;
  }

  resetSessionState() {
    if (this.qualityTimer !== undefined) clearInterval(this.qualityTimer);
    this.qualityTimer = undefined;
    for (const peerKey of [...this.peers.keys()]) this.closePeer(peerKey);
    this.sources.clear();
    this.selectedStreamId = "";
    this.selectedPeerKey = "";
    this.discoveryReady = false;
  }

  async cancelledStartSnapshot(sdk) {
    this.removeSdkListeners(sdk);
    if (this.stopPromise) {
      try { await this.stopPromise; } catch { /* Stop owns signaling cleanup errors. */ }
    }
    return this.snapshot();
  }

  async start() {
    if (this.phase !== "idle" && this.phase !== "error") return this.snapshot();
    const generation = ++this.lifecycleGeneration;
    this.tearingDown = false;
    this.resetSessionState();
    this.phase = "connecting";
    this.emitStatus("Connecting to VDO.Ninja signaling.");
    let stage = "constructing the SDK";
    let sdk;
    try {
      sdk = this.sdkFactory({
        password: this.sharedSecret,
        salt: VDO_BRSP_SALT,
        forceTURN: this.forceTurn,
      });
      this.sdk = sdk;
      this.installSdkListeners(sdk, generation);
      stage = "connecting to signaling";
      await sdk.connect();
      if (!this.isCurrentSdk(sdk, generation)) return this.cancelledStartSnapshot(sdk);
      stage = "joining the discovery room";
      await sdk.joinRoom({ room: this.room, password: this.sharedSecret });
      if (!this.isCurrentSdk(sdk, generation)) return this.cancelledStartSnapshot(sdk);
      if (this.role === "target") {
        stage = "announcing the data-only target";
        await sdk.announce({ streamID: this.streamId, label: this.label });
        if (!this.isCurrentSdk(sdk, generation)) return this.cancelledStartSnapshot(sdk);
        this.phase = "discoverable";
        this.emitStatus("Data-only target announced; waiting for a controller.");
      } else {
        this.phase = "discovering";
        this.discoveryReady = true;
        this.emitStatus("Looking for the target in the private room.");
        await this.selectOnlyTarget({ sdk, generation });
        if (!this.isCurrentSdk(sdk, generation)) return this.cancelledStartSnapshot(sdk);
      }
      this.qualityTimer = setInterval(() => { void this.refreshQuality(); }, 2_000);
      return this.snapshot();
    } catch (error) {
      if (sdk && !this.isCurrentSdk(sdk, generation)) return this.cancelledStartSnapshot(sdk);
      const cleanupGeneration = ++this.lifecycleGeneration;
      this.tearingDown = true;
      if (sdk) this.removeSdkListeners(sdk);
      this.resetSessionState();
      await this.stopSdk(sdk);
      if (this.lifecycleGeneration !== cleanupGeneration) return this.cancelledStartSnapshot(sdk);
      this.tearingDown = false;
      this.phase = "error";
      const message = `${stage}: ${error instanceof Error ? error.message : String(error)}`;
      this.emitStatus(message, true);
      throw new Error(`VDO.Ninja transport failed while ${message}`, { cause: error });
    }
  }

  installSdkListeners(sdk, generation) {
    this.listen(sdk, generation, "listing", (event) => this.addListing(event.detail));
    this.listen(sdk, generation, "videoaddedtoroom", (event) => this.addSource(event.detail));
    this.listen(sdk, generation, "userLeft", (event) => this.removePeerOrSource(event.detail));
    this.listen(sdk, generation, "dataChannelOpen", (event) => {
      if (this.role === "target") void this.openTargetChannels(event.detail?.uuid);
    });
    this.listen(sdk, generation, "channelOpen", (event) => {
      if (this.role === "controller") this.acceptControllerChannel(event.detail);
    });
    this.listen(sdk, generation, "dataChannelClose", (event) => this.markPeerClosed(event.detail?.uuid, "VDO.Ninja control channel closed."));
    this.listen(sdk, generation, "connectionFailed", (event) => this.markPeerClosed(
      event.detail?.uuid,
      `Peer connection failed: ${event.detail?.reason ?? "unknown reason"}`,
    ));
    this.listen(sdk, generation, "error", (event) => this.emitStatus(
      event.detail?.error?.message ?? event.detail?.error ?? event.detail?.message ?? "VDO.Ninja error",
      true,
    ));
  }

  addListing(detail) {
    if (Array.isArray(detail?.list)) detail.list.forEach((item) => this.addSource(item, { deferSelection: true }));
    else this.addSource(detail);
    if (this.discoveryReady) void this.selectOnlyTarget().catch(() => {});
  }

  addSource(value, { deferSelection = false } = {}) {
    if (this.role !== "controller") return;
    const item = sourceItem(value);
    if (!item.streamId.startsWith(VDO_BRSP_STREAM_PREFIX)) return;
    this.sources.set(item.streamId, item);
    this.emitStatus(`Discovered ${item.label || item.streamId}.`);
    if (this.discoveryReady && !deferSelection) void this.selectOnlyTarget().catch(() => {});
  }

  async selectOnlyTarget({ sdk = this.sdk, generation = this.lifecycleGeneration } = {}) {
    if (this.role !== "controller" || !this.isCurrentSdk(sdk, generation) || this.selectedStreamId || this.sources.size === 0) return;
    if (this.sources.size > 1) {
      this.phase = "selection-required";
      this.emitStatus("More than one target was found; explicitly select the intended target.", true);
      return;
    }
    const [source] = this.sources.values();
    await this.selectTarget(source.streamId, { sdk, generation });
  }

  async selectTarget(streamId, { sdk = this.sdk, generation = this.lifecycleGeneration } = {}) {
    if (this.role !== "controller" || !this.isCurrentSdk(sdk, generation)) {
      throw new Error("Only a started controller can select a target.");
    }
    if (this.selectedStreamId) {
      if (streamId === this.selectedStreamId) return this.snapshot();
      throw new Error("A controller is already bound to a target; stop before selecting another one.");
    }
    const source = this.sources.get(streamId);
    if (!source) throw new Error("The selected target is not present in the authenticated discovery room.");
    const retryPhase = this.sources.size > 1 ? "selection-required" : "discovering";
    this.selectedStreamId = source.streamId;
    this.selectedPeerKey = source.peerKey;
    this.phase = "connecting-peer";
    this.emitStatus(`Opening a data-only connection to ${source.label || source.streamId}.`);
    try {
      await sdk.view(source.streamId, {
        audio: false,
        video: false,
        downloads: false,
        allowresources: false,
        label: "BRSP controller",
      });
      if (!this.isCurrentSdk(sdk, generation)) return this.cancelledStartSnapshot(sdk);
      return this.snapshot();
    } catch (error) {
      if (!this.isCurrentSdk(sdk, generation)) return this.cancelledStartSnapshot(sdk);
      this.selectedStreamId = "";
      this.selectedPeerKey = "";
      this.phase = retryPhase;
      this.emitStatus(error instanceof Error ? error.message : String(error), true);
      throw error;
    }
  }

  removePeerOrSource(detail = {}) {
    const identifier = detail.UUID ?? detail.uuid ?? detail.streamID ?? detail.streamId;
    if (!identifier) return;
    const peerKeys = new Set([identifier]);
    for (const [streamId, source] of this.sources) {
      if (streamId === identifier || source.peerKey === identifier) {
        if (source.peerKey) peerKeys.add(source.peerKey);
        this.sources.delete(streamId);
      }
    }
    for (const peerKey of peerKeys) this.markPeerClosed(peerKey, "Peer left the VDO.Ninja room.");
  }

  peerRecord(peerKey) {
    let peer = this.peers.get(peerKey);
    if (!peer) {
      peer = {
        peerKey,
        control: undefined,
        state: undefined,
        opened: false,
        closed: false,
        pendingState: undefined,
      };
      this.peers.set(peerKey, peer);
    }
    return peer;
  }

  async openTargetChannels(peerKey) {
    if (!peerKey || this.tearingDown) return;
    const sdk = this.sdk;
    const generation = this.lifecycleGeneration;
    if (!this.isCurrentSdk(sdk, generation)) return;
    const peer = this.peerRecord(peerKey);
    if (peer.opening || peer.opened) return;
    peer.opening = true;
    try {
      const [control, state] = await Promise.all([
        sdk.openChannel(peerKey, VDO_BRSP_CONTROL_CHANNEL, { ordered: true }),
        sdk.openChannel(peerKey, VDO_BRSP_STATE_CHANNEL, { ordered: false, maxRetransmits: 0 }),
      ]);
      if (!this.isCurrentSdk(sdk, generation) || this.peers.get(peerKey) !== peer) {
        try { control.close(); } catch { /* stale channel */ }
        try { state.close(); } catch { /* stale channel */ }
        return;
      }
      this.attachChannel(peer, "control", control);
      this.attachChannel(peer, "state", state);
      this.finishPeerOpen(peer);
    } catch (error) {
      if (this.isCurrentSdk(sdk, generation)) {
        this.markPeerClosed(peerKey, error instanceof Error ? error.message : String(error));
      }
    } finally {
      peer.opening = false;
    }
  }

  acceptControllerChannel(detail = {}) {
    if (!detail.uuid || !detail.channel) return;
    if (detail.streamID && this.selectedStreamId && detail.streamID !== this.selectedStreamId) return;
    if (this.selectedPeerKey && detail.uuid !== this.selectedPeerKey) return;
    const lane = normalizeChannelLabel(detail.label);
    if (lane !== VDO_BRSP_CONTROL_CHANNEL && lane !== VDO_BRSP_STATE_CHANNEL) return;
    if (!this.selectedPeerKey) this.selectedPeerKey = detail.uuid;
    const peer = this.peerRecord(detail.uuid);
    this.attachChannel(peer, lane === VDO_BRSP_CONTROL_CHANNEL ? "control" : "state", detail.channel);
    this.finishPeerOpen(peer);
  }

  attachChannel(peer, lane, channel) {
    if (peer[lane] === channel) return;
    if (peer[lane] && peer[lane].readyState !== "closed") peer[lane].close();
    peer[lane] = channel;
    channel.binaryType = "arraybuffer";
    if (lane === "state") channel.bufferedAmountLowThreshold = 0;
    channel.addEventListener("message", (event) => {
      if (this.peers.get(peer.peerKey)?.[lane] !== channel) return;
      this.dispatchEvent(detailEvent(`${lane}message`, { peerKey: peer.peerKey, data: event.data }));
    });
    channel.addEventListener("close", () => {
      if (this.peers.get(peer.peerKey)?.[lane] === channel) {
        this.markPeerClosed(peer.peerKey, `${lane} data channel closed.`);
      }
    }, { once: true });
    if (lane === "state") {
      channel.addEventListener("bufferedamountlow", () => this.flushPendingState(peer.peerKey));
    }
  }

  finishPeerOpen(peer) {
    if (peer.opened || !peer.control || !peer.state) return;
    if (peer.control.readyState !== "open" || peer.state.readyState !== "open") return;
    peer.opened = true;
    peer.closed = false;
    this.phase = "peer-open";
    this.emitStatus("Reliable control and latest-state channels are open.");
    this.dispatchEvent(detailEvent("peeropen", { peerKey: peer.peerKey }));
  }

  sendControl(peerKey, data) {
    const peer = this.peers.get(peerKey);
    const channel = peer?.control;
    const bytes = protocolBytes(data);
    if (!channel || channel.readyState !== "open" || bytes > BRSP_CONTROL_MAX_BYTES) return false;
    if (Number(channel.bufferedAmount) + bytes > VDO_CONTROL_BACKLOG_LIMIT) return false;
    try {
      channel.send(data);
      return true;
    } catch {
      return false;
    }
  }

  sendState(peerKey, data) {
    const peer = this.peers.get(peerKey);
    const channel = peer?.state;
    if (!channel || channel.readyState !== "open" || protocolBytes(data) > BRSP_STATE_MAX_BYTES) return false;
    if (Number(channel.bufferedAmount) > 0) {
      peer.pendingState = data;
      return false;
    }
    try {
      channel.send(data);
      peer.pendingState = undefined;
      return true;
    } catch {
      peer.pendingState = data;
      return false;
    }
  }

  flushPendingState(peerKey) {
    const peer = this.peers.get(peerKey);
    if (!peer?.pendingState || peer.state?.readyState !== "open" || Number(peer.state.bufferedAmount) > 0) return false;
    const pending = peer.pendingState;
    peer.pendingState = undefined;
    return this.sendState(peerKey, pending);
  }

  closePeer(peerKey) {
    const peer = this.peers.get(peerKey);
    if (!peer) return;
    peer.closed = true;
    for (const channel of [peer.control, peer.state]) {
      try { channel?.close(); } catch { /* best-effort peer close */ }
    }
    this.peers.delete(peerKey);
  }

  markPeerClosed(identifier, reason) {
    if (!identifier) return;
    for (const [peerKey, peer] of this.peers) {
      if (peerKey !== identifier) continue;
      if (!peer.closed) {
        peer.closed = true;
        this.dispatchEvent(detailEvent("peerclose", { peerKey, reason }));
      }
      this.closePeer(peerKey);
    }
  }

  async refreshQuality() {
    if (!this.sdk?.getPeerQuality || this.tearingDown) return;
    const sdk = this.sdk;
    const generation = this.lifecycleGeneration;
    for (const peerKey of this.peers.keys()) {
      try {
        const quality = await sdk.getPeerQuality(peerKey);
        if (!this.isCurrentSdk(sdk, generation) || !this.peers.has(peerKey)) return;
        this.dispatchEvent(detailEvent("quality", {
          peerKey,
          route: quality?.relayed === true ? "relay" : quality?.relayed === false ? "direct" : "unknown",
          rttMs: Number.isFinite(quality?.rttMs) ? Math.round(quality.rttMs) : undefined,
        }));
      } catch {
        // Quality readback is diagnostic and never controls protocol liveness.
      }
    }
  }

  async stopSdk(sdk = this.sdk) {
    if (this.sdk === sdk) this.sdk = undefined;
    if (!sdk) return;
    try { await sdk.disconnect?.(); } catch { /* already disconnected */ }
  }

  stop() {
    if (this.stopPromise) return this.stopPromise;
    if (this.phase === "idle" || this.phase === "closed") return Promise.resolve(this.snapshot());
    this.stopPromise = this.performStop();
    return this.stopPromise;
  }

  async performStop() {
    const generation = ++this.lifecycleGeneration;
    this.tearingDown = true;
    this.phase = "stopping";
    const sdk = this.sdk;
    if (sdk) this.removeSdkListeners(sdk);
    this.resetSessionState();
    await this.stopSdk(sdk);
    if (this.lifecycleGeneration === generation) {
      this.phase = "closed";
      this.emitStatus("Transport closed.");
    }
    return this.snapshot();
  }
}
