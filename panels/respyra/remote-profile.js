export const VIEWER_URL = 'https://georgefejer91.github.io/Remote-LSL-Recorder/panels/respyra/';
export const OBSERVE_SCOPE = 'experiment.observe';
export const PANEL = Object.freeze({ id: 'respyra-2', name: 'Respyra 2.0', url: VIEWER_URL });

export function invitationUrl({ room, secret }) {
  if (!/^brsp_[a-f0-9]{64}$/u.test(room) || !/^[a-f0-9]{64}$/u.test(secret)) throw new Error('Invalid Respyra invitation.');
  return `${VIEWER_URL}#room=${room}&secret=${secret}`;
}

export function parseInvitation(value) {
  try {
    const url = new URL(value);
    if (url.origin !== new URL(VIEWER_URL).origin || url.pathname !== new URL(VIEWER_URL).pathname || url.search) return null;
    const fields = new URLSearchParams(url.hash.slice(1));
    if ([...fields.keys()].length !== 2 || !fields.has('room') || !fields.has('secret')) return null;
    const invitation = { room: fields.get('room'), secret: fields.get('secret') };
    invitationUrl(invitation);
    return invitation;
  } catch { return null; }
}

export function observerConnectionOptions(invitation, getState) {
  return { role: 'target', sessionId: invitation.room, sharedSecret: invitation.secret,
    capabilities: ['command-ack', 'state-snapshot', 'latest-state'], grantedScopes: [OBSERVE_SCOPE],
    getState, applyCommand: () => ({ ok: false, revision: 0, error: 'scope_denied' }) };
}

export function validateObserverState(value) {
  const keys = ['profile', 'revision', 'phase', 'inputReady', 'event', 'seq', 'lslTime', 'trial', 'condition', 'experimentPhase', 'screen'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) return false;
  if (value.profile !== 'respyra.observer/1' || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.inputReady !== 'boolean') return false;
  if (!['starting', 'waiting_recorder', 'setup', 'experiment', 'finished', 'error'].includes(value.phase)) return false;
  for (const key of ['event', 'condition', 'experimentPhase', 'screen']) if (value[key] !== null && (typeof value[key] !== 'string' || value[key].length > 80 || /[\u0000-\u001f\u007f]/u.test(value[key]))) return false;
  for (const key of ['seq', 'trial']) if (value[key] !== null && (!Number.isSafeInteger(value[key]) || value[key] < 0)) return false;
  return value.lslTime === null || (Number.isFinite(value.lslTime) && value.lslTime >= 0);
}
