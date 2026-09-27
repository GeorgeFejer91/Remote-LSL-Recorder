import { BRSPConnection } from './vendor/brsp.js';
import { VdoNinjaTransport } from './vendor/vdo-ninja-transport.js';
import { createEmbeddedVdoSdk } from './vendor/external-page-connector.js';
import { parseInvitation, OBSERVE_SCOPE, validateObserverState } from './remote-profile.js';
import { measureTextRegions } from './text-fit.js';

const byId = id => document.getElementById(id);
let invitation = parseInvitation(location.href);
if (location.hash) {
  try { history.replaceState(null, '', location.pathname + location.search); }
  catch { location.replace('#'); } // Opaque frames deny History API URL replacement.
}
let active;
measureTextRegions().catch(() => { document.documentElement.dataset.pretextFit = 'unavailable'; });
if (invitation) byId('connection-status').textContent = 'Private invitation received. Select Connect to observe Respyra.';
byId('pairing').addEventListener('submit', event => { event.preventDefault(); void connect(); });
byId('disconnect').addEventListener('click', () => { void stop(); });
window.addEventListener('pagehide', () => { void stop(); });

async function stop(message = 'Disconnected. Create a fresh viewer invitation in Respyra to reconnect.') {
  const context = active;
  active = undefined;
  invitation = null;
  byId('invitation').value = '';
  byId('invitation').required = true;
  byId('invitation').disabled = false;
  byId('connect').disabled = false;
  byId('connect').hidden = false;
  byId('invitation-field').hidden = false;
  byId('disconnect').disabled = true;
  byId('observation').hidden = true;
  byId('connection-status').textContent = message;
  clearInterval(context?.timer);
  await context?.connection?.close();
}

async function connect() {
  if (active) return;
  invitation = parseInvitation(byId('invitation').value) ?? invitation;
  if (!invitation) { byId('connection-status').textContent = 'Paste a fresh private viewer link from Respyra.'; return; }
  byId('invitation').value = '';
  byId('invitation-field').hidden = true;
  const context = { route: 'unknown', lastState: 0, started: performance.now() };
  active = context;
  byId('connect').disabled = true;
  byId('invitation').disabled = true;
  byId('disconnect').disabled = false;
  byId('connection-status').textContent = 'Connecting to Respyra…';
  try {
    context.transport = new VdoNinjaTransport({ role: 'controller', room: invitation.room, sharedSecret: invitation.secret,
      label: 'Respyra observer', sdkFactory: createEmbeddedVdoSdk });
    context.connection = new BRSPConnection({ transport: context.transport, role: 'controller',
      sessionId: invitation.room, sharedSecret: invitation.secret,
      requestedScopes: [OBSERVE_SCOPE], capabilities: ['command-ack', 'state-snapshot', 'latest-state'] });
    const state = value => {
      if (active !== context || !context.connection.acceptedScopes.includes(OBSERVE_SCOPE)) return;
      if (!validateObserverState(value)) { void stop('Invalid observer state. Create a fresh invitation.'); return; }
      if (context.revision !== undefined && value.revision < context.revision) return;
      context.revision = value.revision;
      context.lastState = performance.now();
      byId('observation').hidden = false;
      byId('connect').hidden = true;
      byId('phase').textContent = { starting: 'Starting', waiting_recorder: 'Waiting for recorder', setup: 'Setup', experiment: 'Running', finished: 'Finished', error: 'Needs attention' }[value.phase];
      byId('input-state').textContent = value.phase === 'setup' ? value.inputReady ? 'Ready' : 'Not ready' : 'See the local runner';
      byId('trial-summary').textContent = [value.trial, value.condition].filter(value => value !== null).join(' · ') || '—';
      byId('phase-summary').textContent = [value.experimentPhase, value.screen].filter(Boolean).join(' · ') || '—';
      for (const [id, key] of [['event', 'event'], ['sequence', 'seq'], ['lsl-time', 'lslTime'], ['revision', 'revision']]) byId(id).textContent = value[key] === null ? '—' : String(value[key]);
      byId('route').textContent = `Route: ${context.route}`;
      byId('connection-status').textContent = 'Connected. Live experiment progress.';
    };
    context.connection.addEventListener('snapshot', event => state(event.detail.state));
    context.connection.addEventListener('state', event => state(event.detail.state));
    context.transport.addEventListener('quality', event => { context.route = event.detail.route; });
    context.connection.addEventListener('phasechange', event => {
      if (active === context && ['disconnected', 'closed', 'error'].includes(event.detail.phase)) void stop();
    });
    context.timer = setInterval(() => {
      if (active !== context) return;
      if (performance.now() - (context.lastState || context.started) > 2000) byId('connection-status').textContent = 'No recent updates. Displayed progress may be stale; use the local runner.';
      if (!context.lastState && performance.now() - context.started > 30000) void stop('Respyra did not respond. Start a fresh viewer session and try again.');
    }, 250);
    await context.transport.start();
  } catch { if (active === context) await stop('Connection failed. Start a fresh viewer session and try again.'); }
}

// A fragment invitation makes Connect valid without exposing the secret in a field.
byId('invitation').required = !invitation;
byId('invitation-field').hidden = Boolean(invitation);
