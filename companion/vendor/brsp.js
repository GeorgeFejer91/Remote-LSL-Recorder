/**
 * Browser Remote Sync Protocol (BRSP/1)
 *
 * Transport-neutral protocol primitives plus a one-controller/one-target
 * reference state machine. The transport only needs to expose EventTarget
 * events named peeropen, peerclose, controlmessage, and statemessage, and
 * methods sendControl(), sendState(), and stop().
 */

export const BRSP_PROTOCOL = "brsp";
export const BRSP_VERSION = 1;
export const BRSP_CONTROL_MAX_BYTES = 16_384;
export const BRSP_STATE_MAX_BYTES = 8_192;
export const BRSP_STALE_MS = 2_000;
export const BRSP_RECOVERY_FRAMES = 3;

export const BRSP_CONTROL_TYPES = Object.freeze([
  "hello",
  "proof",
  "ready",
  "command",
  "applied",
  "snapshot-request",
  "snapshot",
  "error",
  "bye",
]);

export const BRSP_STATE_TYPES = Object.freeze(["state", "intent"]);

const CONTROL_TYPES = new Set(BRSP_CONTROL_TYPES);
const STATE_TYPES = new Set(BRSP_STATE_TYPES);
const ROLES = new Set(["controller", "target"]);
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

function detailEvent(type, detail) {
  const event = new Event(type);
  Object.defineProperty(event, "detail", { value: detail, enumerable: true });
  return event;
}

function fail(message) {
  throw new TypeError(message);
}

function plainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, label) {
  if (!plainObject(value)) fail(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} must contain exactly: ${wanted.join(", ")}.`);
  }
}

function assertToken(value, label, { min = 1, max = 96 } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max || !TOKEN_PATTERN.test(value)) {
    fail(`${label} must be a ${min}-${max} character protocol token.`);
  }
  return value;
}

function assertDisplayString(value, label, { max = 256 } = {}) {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    fail(`${label} must be display-safe text of at most ${max} characters.`);
  }
  return value;
}

function assertRole(value) {
  if (!ROLES.has(value)) fail("role must be controller or target.");
  return value;
}

function assertUint32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    fail(`${label} must be an unsigned 32-bit integer.`);
  }
  return value >>> 0;
}

function assertRevision(value, label = "revision") {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative safe integer.`);
  return value;
}

function assertTokenArray(value, label, { maxItems = 32 } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) fail(`${label} must be an array of at most ${maxItems} tokens.`);
  assertJsonValue(value, label);
  const normalized = value.map((item, index) => assertToken(item, `${label}[${index}]`, { max: 64 }));
  if (new Set(normalized).size !== normalized.length) fail(`${label} must not contain duplicates.`);
  return normalized;
}

function assertJsonValue(value, label = "value", depth = 0) {
  if (depth > 8) fail(`${label} exceeds the maximum nesting depth.`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} must contain only finite numbers.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(`${label} must be a plain array.`);
    if (value.length > 256) fail(`${label} contains too many array entries.`);
    const allowedKeys = new Set(["length"]);
    for (let index = 0; index < value.length; index += 1) {
      const key = String(index);
      allowedKeys.add(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor) fail(`${label} must be a dense array.`);
      if (!("value" in descriptor)) fail(`${label}[${index}] must be a data property.`);
      assertJsonValue(descriptor.value, `${label}[${index}]`, depth + 1);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !allowedKeys.has(key)) {
        fail(`${label} must not contain extra array properties.`);
      }
    }
    return value;
  }
  if (plainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > 128) fail(`${label} contains too many object fields.`);
    for (const key of keys) {
      if (key.length === 0 || key.length > 96 || key === "__proto__" || key === "prototype" || key === "constructor") {
        fail(`${label} contains an unsafe field name.`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) fail(`${label}.${key} must be a data property.`);
      assertJsonValue(descriptor.value, `${label}.${key}`, depth + 1);
    }
    return value;
  }
  fail(`${label} must be JSON-compatible.`);
}

function toBytes(value) {
  if (typeof value === "string") return textEncoder.encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  fail("A protocol message must be a UTF-8 string, ArrayBuffer, or typed array.");
}

function bytesToBase64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function constantTimeStringEqual(left, right) {
  const leftBytes = textEncoder.encode(String(left));
  const rightBytes = textEncoder.encode(String(right));
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export function canonicalStringify(value) {
  assertJsonValue(value);
  const visit = (item) => {
    if (item === null || typeof item !== "object") return JSON.stringify(item);
    if (Array.isArray(item)) {
      const entries = [];
      for (let index = 0; index < item.length; index += 1) {
        entries.push(visit(Object.getOwnPropertyDescriptor(item, String(index)).value));
      }
      return `[${entries.join(",")}]`;
    }
    return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${visit(item[key])}`).join(",")}}`;
  };
  return visit(value);
}

export function randomToken(byteLength = 18) {
  if (!Number.isInteger(byteLength) || byteLength < 8 || byteLength > 64) fail("Random token length must be 8-64 bytes.");
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64url(bytes);
}

export function randomEpoch() {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] >>> 0;
}

export function isNewerSequence(sequence, previousSequence) {
  assertUint32(sequence, "sequence");
  if (previousSequence === undefined || previousSequence === null) return true;
  assertUint32(previousSequence, "previousSequence");
  const distance = ((sequence >>> 0) - (previousSequence >>> 0)) >>> 0;
  return distance > 0 && distance < 0x8000_0000;
}

export function makeEnvelope({ type, sessionId, senderId, senderEpoch, sequence, body = {} }) {
  const envelope = {
    protocol: BRSP_PROTOCOL,
    version: BRSP_VERSION,
    type,
    sessionId,
    senderId,
    senderEpoch,
    sequence,
    body,
  };
  validateEnvelope(envelope, { lane: STATE_TYPES.has(type) ? "state" : undefined });
  return envelope;
}

export function validateEnvelope(envelope, { lane } = {}) {
  exactKeys(
    envelope,
    ["protocol", "version", "type", "sessionId", "senderId", "senderEpoch", "sequence", "body"],
    "envelope",
  );
  if (envelope.protocol !== BRSP_PROTOCOL || envelope.version !== BRSP_VERSION) fail("Unsupported protocol or version.");
  assertToken(envelope.sessionId, "sessionId", { min: 8, max: 96 });
  assertToken(envelope.senderId, "senderId", { min: 8, max: 96 });
  assertUint32(envelope.senderEpoch, "senderEpoch");
  assertUint32(envelope.sequence, "sequence");
  if (lane === "state") {
    if (!STATE_TYPES.has(envelope.type)) fail("Unknown replaceable-lane message type.");
  } else if (!CONTROL_TYPES.has(envelope.type)) {
    fail("Unknown control message type.");
  }
  assertJsonValue(envelope.body, "body");
  return envelope;
}

export function encodeEnvelope(envelope, { lane = "control" } = {}) {
  validateEnvelope(envelope, { lane });
  const encoded = canonicalStringify(envelope);
  const maximum = lane === "state" ? BRSP_STATE_MAX_BYTES : BRSP_CONTROL_MAX_BYTES;
  if (textEncoder.encode(encoded).byteLength > maximum) fail(`${lane} message exceeds ${maximum} UTF-8 bytes.`);
  return encoded;
}

export function decodeEnvelope(value, { lane = "control" } = {}) {
  try {
    const bytes = toBytes(value);
    const maximum = lane === "state" ? BRSP_STATE_MAX_BYTES : BRSP_CONTROL_MAX_BYTES;
    if (bytes.byteLength === 0 || bytes.byteLength > maximum) return undefined;
    const envelope = JSON.parse(textDecoder.decode(bytes));
    return validateEnvelope(envelope, { lane });
  } catch {
    return undefined;
  }
}

export function createHelloEnvelope({
  role,
  sessionId,
  senderId,
  senderEpoch,
  sequence = 0,
  nonce = randomToken(16),
  capabilities = [],
  requestedScopes = [],
  grantedScopes = [],
}) {
  assertRole(role);
  const normalizedCapabilities = assertTokenArray(capabilities, "capabilities");
  const normalizedRequestedScopes = assertTokenArray(requestedScopes, "requestedScopes");
  const normalizedGrantedScopes = assertTokenArray(grantedScopes, "grantedScopes");
  const body = {
    role,
    nonce,
    capabilities: normalizedCapabilities.sort(),
    requestedScopes: normalizedRequestedScopes.sort(),
    grantedScopes: normalizedGrantedScopes.sort(),
  };
  validateHelloBody(body);
  return makeEnvelope({ type: "hello", sessionId, senderId, senderEpoch, sequence, body });
}

export function validateHelloBody(body) {
  exactKeys(body, ["role", "nonce", "capabilities", "requestedScopes", "grantedScopes"], "hello body");
  assertRole(body.role);
  if (typeof body.nonce !== "string" || body.nonce.length < 20 || body.nonce.length > 96 || !BASE64URL_PATTERN.test(body.nonce)) {
    fail("hello nonce must be a base64url token with at least 120 bits of entropy.");
  }
  assertTokenArray(body.capabilities, "capabilities");
  assertTokenArray(body.requestedScopes, "requestedScopes");
  assertTokenArray(body.grantedScopes, "grantedScopes");
  return body;
}

function helloPair(first, second) {
  if (first?.type !== "hello" || second?.type !== "hello") fail("Proofs require two hello envelopes.");
  validateEnvelope(first);
  validateEnvelope(second);
  validateHelloBody(first.body);
  validateHelloBody(second.body);
  if (first.sessionId !== second.sessionId) fail("Hello envelopes must use the same sessionId.");
  const targetHello = first.body.role === "target" ? first : second.body.role === "target" ? second : undefined;
  const controllerHello = first.body.role === "controller" ? first : second.body.role === "controller" ? second : undefined;
  if (!targetHello || !controllerHello || targetHello === controllerHello) fail("Proofs require one target and one controller hello.");
  return { targetHello, controllerHello };
}

export function proofTranscript(firstHello, secondHello) {
  const { targetHello, controllerHello } = helloPair(firstHello, secondHello);
  return canonicalStringify({
    protocol: BRSP_PROTOCOL,
    version: BRSP_VERSION,
    sessionId: targetHello.sessionId,
    targetHello,
    controllerHello,
  });
}

async function hmacSha256(secret, message) {
  if (typeof secret !== "string" || textEncoder.encode(secret).byteLength < 16) {
    fail("The pairing secret must contain at least 16 UTF-8 bytes; use a generated 192-bit secret in production.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(message)));
}

export async function createProofEnvelope({ localHello, remoteHello, secret, sequence }) {
  const transcript = proofTranscript(localHello, remoteHello);
  const role = validateHelloBody(localHello.body).role;
  const value = bytesToBase64url(await hmacSha256(secret, `BRSP/1 proof\n${role}\n${transcript}`));
  return makeEnvelope({
    type: "proof",
    sessionId: localHello.sessionId,
    senderId: localHello.senderId,
    senderEpoch: localHello.senderEpoch,
    sequence,
    body: { algorithm: "HMAC-SHA-256", role, value },
  });
}

export async function verifyProofEnvelope({ proof, localHello, remoteHello, secret }) {
  validateEnvelope(proof);
  exactKeys(proof.body, ["algorithm", "role", "value"], "proof body");
  if (proof.type !== "proof" || proof.body.algorithm !== "HMAC-SHA-256") return false;
  const remoteRole = validateHelloBody(remoteHello.body).role;
  if (proof.body.role !== remoteRole || proof.senderId !== remoteHello.senderId || proof.senderEpoch !== remoteHello.senderEpoch) {
    return false;
  }
  if (typeof proof.body.value !== "string" || !BASE64URL_PATTERN.test(proof.body.value)) return false;
  const transcript = proofTranscript(localHello, remoteHello);
  const expected = bytesToBase64url(await hmacSha256(secret, `BRSP/1 proof\n${remoteRole}\n${transcript}`));
  return constantTimeStringEqual(proof.body.value, expected);
}

export function negotiateSession(localHello, remoteHello) {
  const { targetHello, controllerHello } = helloPair(localHello, remoteHello);
  const capabilities = targetHello.body.capabilities.filter((value) => controllerHello.body.capabilities.includes(value)).sort();
  const acceptedScopes = controllerHello.body.requestedScopes.filter((value) => targetHello.body.grantedScopes.includes(value)).sort();
  return { capabilities, acceptedScopes };
}

export function createReadyEnvelope({ localHello, remoteHello, sequence }) {
  const { capabilities, acceptedScopes } = negotiateSession(localHello, remoteHello);
  return makeEnvelope({
    type: "ready",
    sessionId: localHello.sessionId,
    senderId: localHello.senderId,
    senderEpoch: localHello.senderEpoch,
    sequence,
    body: { capabilities, acceptedScopes },
  });
}

function validateReadyEnvelope(envelope, expected) {
  exactKeys(envelope.body, ["capabilities", "acceptedScopes"], "ready body");
  const capabilities = assertTokenArray(envelope.body.capabilities, "capabilities");
  const acceptedScopes = assertTokenArray(envelope.body.acceptedScopes, "acceptedScopes");
  if (canonicalStringify({ capabilities, acceptedScopes }) !== canonicalStringify(expected)) {
    fail("Peer ready message does not match the negotiated capabilities and scopes.");
  }
}

function createCommandEnvelope({ hello, sequence, commandId, scope, action, args = {}, expectedRevision = null }) {
  assertToken(commandId, "commandId", { min: 8, max: 96 });
  assertToken(scope, "scope", { max: 64 });
  assertToken(action, "action", { max: 64 });
  if (expectedRevision !== null) assertRevision(expectedRevision, "expectedRevision");
  assertJsonValue(args, "args");
  return makeEnvelope({
    type: "command",
    sessionId: hello.sessionId,
    senderId: hello.senderId,
    senderEpoch: hello.senderEpoch,
    sequence,
    body: { commandId, scope, action, args, expectedRevision },
  });
}

function validateCommandBody(body) {
  exactKeys(body, ["commandId", "scope", "action", "args", "expectedRevision"], "command body");
  assertToken(body.commandId, "commandId", { min: 8, max: 96 });
  assertToken(body.scope, "scope", { max: 64 });
  assertToken(body.action, "action", { max: 64 });
  if (body.expectedRevision !== null) assertRevision(body.expectedRevision, "expectedRevision");
  assertJsonValue(body.args, "args");
  return body;
}

function createAppliedEnvelope({ hello, sequence, commandId, ok, revision, result = null, error = null }) {
  assertToken(commandId, "commandId", { min: 8, max: 96 });
  assertRevision(revision);
  if (typeof ok !== "boolean") fail("ok must be boolean.");
  if (error !== null) assertToken(error, "error", { max: 64 });
  assertJsonValue(result, "result");
  return makeEnvelope({
    type: "applied",
    sessionId: hello.sessionId,
    senderId: hello.senderId,
    senderEpoch: hello.senderEpoch,
    sequence,
    body: { commandId, ok, revision, result, error },
  });
}

function validateAppliedBody(body) {
  exactKeys(body, ["commandId", "ok", "revision", "result", "error"], "applied body");
  assertToken(body.commandId, "commandId", { min: 8, max: 96 });
  if (typeof body.ok !== "boolean") fail("applied ok must be boolean.");
  assertRevision(body.revision);
  assertJsonValue(body.result, "result");
  if (body.error !== null) assertToken(body.error, "error", { max: 64 });
  return body;
}

/**
 * One target and one controller over any BRSP transport.
 */
export class BRSPConnection extends EventTarget {
  constructor({
    transport,
    role,
    sessionId,
    sharedSecret,
    peerId = `peer_${randomToken(12)}`,
    epoch = randomEpoch(),
    capabilities = ["command-ack", "state-snapshot", "latest-state"],
    requestedScopes = [],
    grantedScopes = [],
    applyCommand,
    applyIntent,
    getState,
    now = () => performance.now(),
  }) {
    super();
    if (!transport?.addEventListener || typeof transport.sendControl !== "function" || typeof transport.sendState !== "function") {
      fail("transport must implement the BRSP transport interface.");
    }
    this.transport = transport;
    this.role = assertRole(role);
    this.sessionId = assertToken(sessionId, "sessionId", { min: 8, max: 96 });
    if (typeof sharedSecret !== "string" || textEncoder.encode(sharedSecret).byteLength < 16) {
      fail("sharedSecret must contain at least 16 UTF-8 bytes.");
    }
    this.sharedSecret = sharedSecret;
    this.peerId = assertToken(peerId, "peerId", { min: 8, max: 96 });
    this.epoch = assertUint32(epoch, "epoch");
    this.capabilities = [...new Set(assertTokenArray(capabilities, "capabilities"))].sort();
    this.requestedScopes = [...new Set(assertTokenArray(requestedScopes, "requestedScopes"))].sort();
    this.grantedScopes = [...new Set(assertTokenArray(grantedScopes, "grantedScopes"))].sort();
    this.applyCommand = applyCommand;
    this.applyIntent = applyIntent;
    this.getState = getState;
    this.now = now;

    this.phase = "waiting-for-peer";
    this.peerKey = undefined;
    this.localHello = undefined;
    this.remoteHello = undefined;
    this.localProofSent = false;
    this.remoteProofValid = false;
    this.localReadySent = false;
    this.remoteReady = false;
    this.controlSequence = 0;
    this.stateSequence = 0;
    this.remoteControlSequence = undefined;
    this.remoteStateSequence = undefined;
    this.acceptedScopes = [];
    this.negotiatedCapabilities = [];
    this.pendingCommands = new Map();
    this.commandResults = new Map();
    this.readyAt = undefined;
    this.lastStateAt = undefined;
    this.lastIntentAt = undefined;
    this.controlReceiveChain = Promise.resolve();
    this.commandApplyChain = Promise.resolve();

    this.handlers = {
      peeropen: (event) => {
        void this.attachPeer(event.detail).catch((error) => this.protocolError(error));
      },
      peerclose: (event) => this.handlePeerClose(event.detail),
      controlmessage: (event) => {
        this.controlReceiveChain = this.controlReceiveChain
          .then(() => this.receiveControl(event.detail))
          .catch((error) => this.protocolError(error));
      },
      statemessage: (event) => {
        try { this.receiveState(event.detail); } catch (error) { this.protocolError(error); }
      },
    };
    for (const [type, handler] of Object.entries(this.handlers)) transport.addEventListener(type, handler);
  }

  snapshot() {
    return {
      phase: this.phase,
      role: this.role,
      sessionId: this.sessionId,
      peerId: this.peerId,
      remotePeerId: this.remoteHello?.senderId,
      acceptedScopes: [...this.acceptedScopes],
      capabilities: [...this.negotiatedCapabilities],
      pendingCommands: this.pendingCommands.size,
      lastStateAt: this.lastStateAt,
      stateAgeMs: Number.isFinite(this.lastStateAt) ? Math.max(0, this.now() - this.lastStateAt) : undefined,
      lastIntentAt: this.lastIntentAt,
      intentAgeMs: Number.isFinite(this.lastIntentAt) ? Math.max(0, this.now() - this.lastIntentAt) : undefined,
    };
  }

  emitPhase(message) {
    this.dispatchEvent(detailEvent("phasechange", { ...this.snapshot(), message }));
  }

  nextControlSequence() {
    this.controlSequence = (this.controlSequence + 1) >>> 0;
    return this.controlSequence;
  }

  async attachPeer(detail = {}) {
    if (!detail.peerKey || (this.peerKey && detail.peerKey !== this.peerKey)) {
      if (detail.peerKey) this.transport.closePeer?.(detail.peerKey);
      return;
    }
    if (this.peerKey) return;
    this.peerKey = detail.peerKey;
    this.phase = "authenticating";
    this.localHello = createHelloEnvelope({
      role: this.role,
      sessionId: this.sessionId,
      senderId: this.peerId,
      senderEpoch: this.epoch,
      sequence: 0,
      capabilities: this.capabilities,
      requestedScopes: this.role === "controller" ? this.requestedScopes : [],
      grantedScopes: this.role === "target" ? this.grantedScopes : [],
    });
    this.sendControlEnvelope(this.localHello);
    this.emitPhase("Transport connected; authenticating the peer.");
  }

  sendControlEnvelope(envelope) {
    const encoded = encodeEnvelope(envelope);
    if (!this.peerKey || !this.transport.sendControl(this.peerKey, encoded)) {
      throw new Error("Reliable control lane is unavailable or backpressured.");
    }
    return true;
  }

  assertRemoteSender(envelope) {
    if (!this.remoteHello || envelope.senderId !== this.remoteHello.senderId || envelope.senderEpoch !== this.remoteHello.senderEpoch) {
      fail("Control message sender does not match the authenticated hello.");
    }
  }

  async receiveControl({ peerKey, data } = {}) {
    if (!this.peerKey || peerKey !== this.peerKey) return;
    const envelope = decodeEnvelope(data);
    if (!envelope) fail("Malformed or oversized control message.");
    if (envelope.sessionId !== this.sessionId || envelope.senderId === this.peerId) fail("Control message uses the wrong session or sender.");

    if (envelope.type === "hello") {
      await this.handleHello(envelope);
      return;
    }
    this.assertRemoteSender(envelope);
    if (!isNewerSequence(envelope.sequence, this.remoteControlSequence)) return;
    this.remoteControlSequence = envelope.sequence;

    if (envelope.type === "proof") await this.handleProof(envelope);
    else if (envelope.type === "ready") this.handleReady(envelope);
    else {
      if (this.phase !== "ready") fail("Application messages are forbidden before mutual authentication and ready.");
      if (envelope.type === "command") this.queueCommand(envelope);
      else if (envelope.type === "applied") this.handleApplied(envelope);
      else if (envelope.type === "snapshot-request") this.handleSnapshotRequest(envelope);
      else if (envelope.type === "snapshot") this.handleSnapshot(envelope);
      else if (envelope.type === "bye") {
        exactKeys(envelope.body, [], "bye body");
        this.handlePeerClose({ peerKey, reason: "Peer ended the session." });
      } else if (envelope.type === "error") {
        exactKeys(envelope.body, ["code", "message"], "error body");
        assertToken(envelope.body.code, "error code", { max: 64 });
        assertDisplayString(envelope.body.message, "error message");
        this.dispatchEvent(detailEvent("remoteerror", envelope.body));
      }
    }
  }

  async handleHello(envelope) {
    if (this.remoteHello) {
      if (canonicalStringify(this.remoteHello) !== canonicalStringify(envelope)) fail("Peer changed its hello during authentication.");
      return;
    }
    if (envelope.sequence !== 0) fail("The first hello sequence must be zero.");
    validateHelloBody(envelope.body);
    if (envelope.body.role === this.role) fail("A BRSP/1 connection requires one controller and one target.");
    this.remoteHello = envelope;
    this.remoteControlSequence = envelope.sequence;
    await this.sendProof();
  }

  async sendProof() {
    if (this.localProofSent || !this.localHello || !this.remoteHello) return;
    const proof = await createProofEnvelope({
      localHello: this.localHello,
      remoteHello: this.remoteHello,
      secret: this.sharedSecret,
      sequence: this.nextControlSequence(),
    });
    this.sendControlEnvelope(proof);
    this.localProofSent = true;
  }

  async handleProof(envelope) {
    if (!this.localHello || !this.remoteHello) fail("Proof arrived before both hello messages.");
    const valid = await verifyProofEnvelope({
      proof: envelope,
      localHello: this.localHello,
      remoteHello: this.remoteHello,
      secret: this.sharedSecret,
    });
    if (!valid) fail("Pairing-secret proof failed.");
    this.remoteProofValid = true;
    await this.sendProof();
    this.sendReady();
  }

  sendReady() {
    if (this.localReadySent || !this.remoteProofValid || !this.localProofSent) return;
    const ready = createReadyEnvelope({
      localHello: this.localHello,
      remoteHello: this.remoteHello,
      sequence: this.nextControlSequence(),
    });
    this.sendControlEnvelope(ready);
    this.localReadySent = true;
    this.finishReady();
  }

  handleReady(envelope) {
    if (!this.remoteProofValid) fail("Ready arrived before a valid peer proof.");
    const negotiated = negotiateSession(this.localHello, this.remoteHello);
    validateReadyEnvelope(envelope, negotiated);
    this.remoteReady = true;
    this.sendReady();
    this.finishReady();
  }

  finishReady() {
    if (this.phase === "ready" || !this.localReadySent || !this.remoteReady) return;
    const negotiated = negotiateSession(this.localHello, this.remoteHello);
    this.acceptedScopes = negotiated.acceptedScopes;
    this.negotiatedCapabilities = negotiated.capabilities;
    this.readyAt = this.now();
    this.phase = "ready";
    this.emitPhase("Mutual proof verified; application synchronization is ready.");
    this.dispatchEvent(detailEvent("ready", this.snapshot()));
    if (this.role === "controller") {
      this.sendControlEnvelope(makeEnvelope({
        type: "snapshot-request",
        sessionId: this.sessionId,
        senderId: this.peerId,
        senderEpoch: this.epoch,
        sequence: this.nextControlSequence(),
        body: {},
      }));
    } else {
      this.publishSnapshot();
      this.publishState();
    }
  }

  sendCommand(scope, action, args = {}, { expectedRevision = null } = {}) {
    if (this.role !== "controller" || this.phase !== "ready") fail("Only a ready controller can send commands.");
    if (!this.acceptedScopes.includes(scope)) fail(`Scope ${scope} was not granted by the target.`);
    const commandId = `cmd_${randomToken(12)}`;
    const envelope = createCommandEnvelope({
      hello: this.localHello,
      sequence: this.nextControlSequence(),
      commandId,
      scope,
      action,
      args,
      expectedRevision,
    });
    this.sendControlEnvelope(envelope);
    this.pendingCommands.set(commandId, { sentAt: this.now(), scope, action, expectedRevision });
    return commandId;
  }

  queueCommand(envelope) {
    if (this.role !== "target") fail("Only targets may receive command messages.");
    validateCommandBody(envelope.body);
    this.commandApplyChain = this.commandApplyChain
      .then(() => this.handleCommand(envelope))
      .catch((error) => this.protocolError(error));
  }

  async handleCommand(envelope) {
    const command = envelope.body;
    if (!this.acceptedScopes.includes(command.scope)) fail("Command uses a scope that was not negotiated.");
    const cached = this.commandResults.get(command.commandId);
    if (cached) {
      if (cached.request !== canonicalStringify(command)) fail("A commandId was reused with a different command body.");
      this.sendControlEnvelope(createAppliedEnvelope({
        hello: this.localHello,
        sequence: this.nextControlSequence(),
        commandId: command.commandId,
        ...cached.outcome,
      }));
      return;
    }

    let outcome;
    try {
      outcome = typeof this.applyCommand === "function"
        ? await this.applyCommand({ ...command })
        : { ok: false, revision: 0, result: null, error: "unsupported_command" };
    } catch {
      outcome = { ok: false, revision: 0, result: null, error: "command_failed" };
    }
    const normalized = {
      ok: outcome?.ok === true,
      revision: assertRevision(outcome?.revision ?? 0),
      result: outcome?.result ?? null,
      error: outcome?.ok === true ? null : (outcome?.error ?? "command_rejected"),
    };
    const applied = createAppliedEnvelope({
      hello: this.localHello,
      sequence: this.nextControlSequence(),
      commandId: command.commandId,
      ...normalized,
    });
    this.commandResults.set(command.commandId, {
      request: canonicalStringify(command),
      outcome: normalized,
    });
    if (this.commandResults.size > 128) this.commandResults.delete(this.commandResults.keys().next().value);
    this.sendControlEnvelope(applied);
    this.dispatchEvent(detailEvent("command", { command, outcome: normalized }));
    this.publishState(undefined, { revision: normalized.revision });
  }

  handleApplied(envelope) {
    if (this.role !== "controller") fail("Only controllers may receive applied messages.");
    const applied = validateAppliedBody(envelope.body);
    const pending = this.pendingCommands.get(applied.commandId);
    this.pendingCommands.delete(applied.commandId);
    this.dispatchEvent(detailEvent("commandapplied", { ...applied, pending }));
  }

  publishSnapshot(state, { revision } = {}) {
    if (this.role !== "target" || this.phase !== "ready") return false;
    const current = state === undefined && typeof this.getState === "function" ? this.getState() : state;
    if (current === undefined) return false;
    const normalizedRevision = assertRevision(revision ?? current?.revision ?? 0);
    assertJsonValue(current, "snapshot state");
    const envelope = makeEnvelope({
      type: "snapshot",
      sessionId: this.sessionId,
      senderId: this.peerId,
      senderEpoch: this.epoch,
      sequence: this.nextControlSequence(),
      body: { revision: normalizedRevision, state: current },
    });
    this.sendControlEnvelope(envelope);
    return true;
  }

  handleSnapshotRequest(envelope) {
    if (this.role !== "target") fail("Only targets may receive snapshot requests.");
    exactKeys(envelope.body, [], "snapshot-request body");
    this.publishSnapshot();
  }

  handleSnapshot(envelope) {
    if (this.role !== "controller") fail("Only controllers may receive snapshots.");
    exactKeys(envelope.body, ["revision", "state"], "snapshot body");
    assertRevision(envelope.body.revision);
    assertJsonValue(envelope.body.state, "snapshot state");
    this.dispatchEvent(detailEvent("snapshot", envelope.body));
  }

  publishState(state, { revision } = {}) {
    if (this.role !== "target" || this.phase !== "ready") return false;
    const current = state === undefined && typeof this.getState === "function" ? this.getState() : state;
    if (current === undefined) return false;
    const normalizedRevision = assertRevision(revision ?? current?.revision ?? 0);
    assertJsonValue(current, "state");
    this.stateSequence = (this.stateSequence + 1) >>> 0;
    const envelope = makeEnvelope({
      type: "state",
      sessionId: this.sessionId,
      senderId: this.peerId,
      senderEpoch: this.epoch,
      sequence: this.stateSequence,
      body: { revision: normalizedRevision, state: current },
    });
    const encoded = encodeEnvelope(envelope, { lane: "state" });
    const sent = Boolean(this.peerKey && this.transport.sendState(this.peerKey, encoded));
    if (!sent) this.dispatchEvent(detailEvent("backpressure", { lane: "state", retained: "latest-only" }));
    return sent;
  }

  publishIntent(scope, controls) {
    if (this.role !== "controller" || this.phase !== "ready") return false;
    if (!this.negotiatedCapabilities.includes("latest-intent")) fail("The peer did not negotiate latest-intent.");
    if (!this.acceptedScopes.includes(scope)) fail(`Scope ${scope} was not granted by the target.`);
    assertToken(scope, "intent scope", { max: 64 });
    assertJsonValue(controls, "intent controls");
    this.stateSequence = (this.stateSequence + 1) >>> 0;
    const envelope = makeEnvelope({
      type: "intent",
      sessionId: this.sessionId,
      senderId: this.peerId,
      senderEpoch: this.epoch,
      sequence: this.stateSequence,
      body: { scope, controls },
    });
    const encoded = encodeEnvelope(envelope, { lane: "state" });
    const sent = Boolean(this.peerKey && this.transport.sendState(this.peerKey, encoded));
    if (!sent) this.dispatchEvent(detailEvent("backpressure", { lane: "intent", retained: "latest-only" }));
    return sent;
  }

  receiveState({ peerKey, data } = {}) {
    if (!this.peerKey || peerKey !== this.peerKey || this.phase !== "ready") return false;
    const envelope = decodeEnvelope(data, { lane: "state" });
    if (!envelope || envelope.sessionId !== this.sessionId) fail("Malformed, oversized, or wrong-session state message.");
    this.assertRemoteSender(envelope);
    if (!isNewerSequence(envelope.sequence, this.remoteStateSequence)) return false;
    this.remoteStateSequence = envelope.sequence;
    if (envelope.type === "state") {
      if (this.role !== "controller") fail("Only controllers may receive authoritative state in BRSP/1.");
      exactKeys(envelope.body, ["revision", "state"], "state body");
      assertRevision(envelope.body.revision);
      assertJsonValue(envelope.body.state, "state");
      this.lastStateAt = this.now();
      this.dispatchEvent(detailEvent("state", { ...envelope.body, sequence: envelope.sequence, receivedAt: this.lastStateAt }));
      return true;
    }
    if (this.role !== "target") fail("Only targets may receive live intent in BRSP/1.");
    if (!this.negotiatedCapabilities.includes("latest-intent")) fail("Live intent arrived without the latest-intent capability.");
    exactKeys(envelope.body, ["scope", "controls"], "intent body");
    assertToken(envelope.body.scope, "intent scope", { max: 64 });
    if (!this.acceptedScopes.includes(envelope.body.scope)) fail("Live intent uses a scope that was not negotiated.");
    assertJsonValue(envelope.body.controls, "intent controls");
    this.lastIntentAt = this.now();
    const detail = {
      ...envelope.body,
      sequence: envelope.sequence,
      receivedAt: this.lastIntentAt,
    };
    this.dispatchEvent(detailEvent("intent", detail));
    try {
      const outcome = typeof this.applyIntent === "function" ? this.applyIntent(detail) : undefined;
      if (outcome && typeof outcome.then === "function") {
        const acceptedSequence = envelope.sequence;
        void outcome.then((resolved) => {
          if (this.phase === "ready" && this.remoteStateSequence === acceptedSequence) this.publishIntentOutcome(resolved);
        }).catch((error) => this.dispatchEvent(detailEvent("intenterror", {
          message: error instanceof Error ? error.message : String(error),
        })));
      } else {
        this.publishIntentOutcome(outcome);
      }
    } catch (error) {
      this.dispatchEvent(detailEvent("intenterror", {
        message: error instanceof Error ? error.message : String(error),
      }));
    }
    return true;
  }

  publishIntentOutcome(outcome) {
    if (this.role !== "target" || this.phase !== "ready") return;
    if (outcome && plainObject(outcome) && Object.prototype.hasOwnProperty.call(outcome, "state")) {
      this.publishState(outcome.state, { revision: outcome.revision ?? outcome.state?.revision ?? 0 });
    } else if (typeof this.getState === "function") {
      this.publishState();
    }
  }

  isStateStale(at = this.now(), thresholdMs = BRSP_STALE_MS) {
    const freshnessBaseline = Number.isFinite(this.lastStateAt) ? this.lastStateAt : this.readyAt;
    return this.role === "controller" && (this.phase === "ready" || this.phase === "disconnected")
      && Number.isFinite(freshnessBaseline) && at - freshnessBaseline >= thresholdMs;
  }

  isIntentStale(at = this.now(), thresholdMs = 500) {
    return this.role === "target" && this.phase === "ready" && Number.isFinite(this.lastIntentAt)
      && at - this.lastIntentAt >= thresholdMs;
  }

  handlePeerClose({ peerKey, reason = "Transport peer disconnected." } = {}) {
    if (!this.peerKey || peerKey !== this.peerKey) return;
    this.phase = "disconnected";
    this.emitPhase(reason);
    this.dispatchEvent(detailEvent("peerclose", { ...this.snapshot(), reason }));
  }

  protocolError(error) {
    this.phase = "error";
    const message = error instanceof Error ? error.message : String(error);
    this.emitPhase(message);
    this.dispatchEvent(detailEvent("protocolerror", { ...this.snapshot(), message }));
    if (this.peerKey) this.transport.closePeer?.(this.peerKey);
  }

  async close() {
    if (this.phase === "ready" && this.peerKey) {
      try {
        this.sendControlEnvelope(makeEnvelope({
          type: "bye",
          sessionId: this.sessionId,
          senderId: this.peerId,
          senderEpoch: this.epoch,
          sequence: this.nextControlSequence(),
          body: {},
        }));
      } catch {
        // Local teardown remains authoritative.
      }
    }
    this.phase = "closed";
    for (const [type, handler] of Object.entries(this.handlers)) this.transport.removeEventListener(type, handler);
    await this.transport.stop();
    this.emitPhase("Session closed.");
  }
}
