// Optional rendered gate. Install Playwright locally, or point PLAYWRIGHT_MODULE
// at an existing installation. No browser automation dependency is shipped.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { BRSPConnection } from "../web/vendor/brsp.js";
import { compactState, REMOTE_SCOPES } from "../web/remote-target.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".for-ai-local/external-tabs");
await mkdir(output, { recursive: true });
const fixture = `<!doctype html><html lang="en"><meta charset="utf-8">
<h1>Fixture experiment</h1><button id="connect">Connect</button>
<button id="start" disabled>Start experiment</button><p id="state">Disconnected</p>
<script type="module" src="/fixture.js"></script></html>`;
const fixtureScript = `import { BRSPConnection } from '/web/vendor/brsp.js';
class Lane extends EventTarget {
  sendControl(peerKey,data){queueMicrotask(()=>this.other.dispatchEvent(new CustomEvent('controlmessage',{detail:{peerKey,data}})));return true;}
  sendState(peerKey,data){queueMicrotask(()=>this.other.dispatchEvent(new CustomEvent('statemessage',{detail:{peerKey,data}})));return true;}
  async stop(){}
}
let target,controller,state={revision:0,phase:'idle'};
document.querySelector('#connect').onclick=async()=>{
  const a=new Lane(),b=new Lane();a.other=b;b.other=a;
  const options={sessionId:'fixture_session',sharedSecret:'fixture-only-high-entropy-secret',capabilities:['command-ack','state-snapshot','latest-state']};
  target=new BRSPConnection({...options,role:'target',transport:a,peerId:'target_fixture',grantedScopes:['experiment.control'],getState:()=>state,
    applyCommand:()=>{state={revision:state.revision+1,phase:'running'};return {ok:true,revision:state.revision,state};}});
  controller=new BRSPConnection({...options,role:'controller',transport:b,peerId:'controller_fixture',requestedScopes:['experiment.control']});
  controller.addEventListener('ready',()=>{document.querySelector('#start').disabled=false;document.querySelector('#state').textContent='Ready';});
  controller.addEventListener('commandapplied',e=>{document.querySelector('#state').textContent=e.detail.ok?'Confirmed running revision '+e.detail.revision:'Rejected';});
  a.dispatchEvent(new CustomEvent('peeropen',{detail:{peerKey:'fixture'}}));b.dispatchEvent(new CustomEvent('peeropen',{detail:{peerKey:'fixture'}}));
};
document.querySelector('#start').onclick=()=>controller.sendCommand('experiment.control','start',{}, {expectedRevision:0});
window.addEventListener('pagehide',()=>{void target?.close();void controller?.close();});`;

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    let body;
    if (path === "/fixture.html") body = fixture;
    else if (path === "/fixture.js") body = fixtureScript;
    else if (path === "/text-spacing.css") body = "html { font-size: 200% !important } .external-page * { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important }";
    else {
      const file = resolve(root, `.${decodeURIComponent(path)}`);
      if (!file.startsWith(`${root}\\`) && !file.startsWith(`${root}/`)) throw new Error("Outside root");
      body = await readFile(file);
    }
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" }[extname(path)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Access-Control-Allow-Origin": "*" });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes("--serve")) {
  console.log(`Native fixture: ${origin}/fixture.html`);
  await new Promise(() => {});
}
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
try {
  for (const surface of ["web", "companion"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const active = page.locator(".external-page:not([hidden])");
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let desktopPages = [];
    let durablePages = [];
    let catalogRevision = 0;
    let viewer = {};
    let pagesInitialized = false;
    if (surface === "web") {
      await page.exposeFunction("fixtureInvoke", async (command, args = {}) => {
        if (command === "configure_external_pages") {
          pagesInitialized = true;
          desktopPages = args.pages;
          durablePages = desktopPages.map((entry) => { const url = new URL(entry.url); url.search = ""; url.hash = ""; return { ...entry, url: url.href }; });
          catalogRevision += 1;
        }
        if (command === "set_viewer_preferences") viewer = args.preferences;
        return { revision: catalogRevision, controlRevision: 0, participantId: "Fixture",
          outputDirectory: "Fixture", selectAllStreams: true, keyboardMarkers: true, mouseMarkers: false,
          externalPages: desktopPages, externalPagesRevision: catalogRevision, externalPagesInitialized: pagesInitialized, viewer,
          streams: [], markers: [], recording: { phase: "idle", bytesWritten: 0 },
          remote: { phase: "disabled", approval: "waiting", route: "unknown" } };
      });
      await page.addInitScript(() => {
      if (window !== top) return;
      window.calls = [];
      window.__TAURI__ = { core: { invoke: async (command, args) => {
        window.calls.push(command);
        const snapshot = await window.fixtureInvoke(command, args);
        if (command === "set_viewer_preferences") window.viewerSaved = snapshot.viewer.fitPreview;
        return snapshot;
      } } };
      });
      await page.addInitScript((legacyUrl) => {
        if (window !== top) return;
        if (!sessionStorage.getItem("legacy-fixture-installed")) {
          localStorage.setItem("remote-lsl-recorder.external-tabs.v1", JSON.stringify([{ name: "Legacy saved panel", url: legacyUrl }]));
          sessionStorage.setItem("legacy-fixture-installed", "yes");
        }
      }, `${origin}/fixture.html?token=legacy-private#old-invitation`);
    }
    await page.goto(`${origin}/${surface}/index.html`);
    if (surface === "web") {
      await page.getByRole("tab", { name: "Legacy saved panel", exact: true }).click();
      assert.equal(durablePages[0].url, `${origin}/fixture.html`);
      assert.equal(await page.evaluate(() => localStorage.getItem("remote-lsl-recorder.external-tabs.v1")), null);
      await page.getByRole("button", { name: "Close tab", exact: true }).click();
    }
    await page.getByRole("button", { name: "Add external page tab" }).click();
    await active.getByLabel("Tab name", { exact: true }).fill("Fixture experiment");
    await active.getByLabel("Remote page URL").fill(`${origin}/fixture.html?token=private#secret=private`);
    await page.getByRole("button", { name: "Load page", exact: true }).click();
    const frame = page.frameLocator("iframe");
    await frame.getByRole("button", { name: "Connect", exact: true }).click();
    await frame.getByRole("button", { name: "Start experiment" }).click();
    await frame.getByText("Confirmed running revision 1").waitFor();
    assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts allow-forms");
    const child = page.frames()[1];
    const isolation = await child.evaluate(() => {
      let parentBlocked = false, storageBlocked = false;
      try { void parent.document.body; } catch { parentBlocked = true; }
      try { void localStorage.length; } catch { storageBlocked = true; }
      return { parentBlocked, storageBlocked, secure: isSecureContext, crypto: Boolean(crypto.subtle), rtc: typeof RTCPeerConnection };
    });
    assert.deepEqual(isolation, { parentBlocked: true, storageBlocked: true, secure: true, crypto: true, rtc: "function" });
    const preferences = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    assert.ok(!preferences.includes("private"));
    const count = surface === "web" ? await page.evaluate(() => window.calls.length) : 0;
    if (surface === "web") {
      await active.locator("summary").click();
      await active.getByLabel("Remote page URL").fill(`${origin}/fixture.html#sensitive-input`);
      await active.getByLabel("Remote page URL").press("a");
      assert.ok(!await page.evaluate(() => window.calls.includes("emit_input_marker")));
      await active.locator("summary").click();
    }
    await page.getByRole("tab", { name: "Recorder", exact: true }).click();
    await page.getByRole("tab", { name: "Fixture experiment", exact: true }).click();
    await frame.getByText("Confirmed running revision 1").waitFor();
    if (surface === "web") await page.waitForFunction((previous) => window.calls.length > previous, count);
    await page.getByRole("button", { name: "Add external page tab" }).click();
    await active.getByLabel("Tab name", { exact: true }).fill("Donaudampfschifffahrtsgesellschaft Experiment 遠隔操作");
    await active.getByLabel("Remote page URL").fill(`${origin}/fixture.html`);
    await page.getByRole("button", { name: "Load page", exact: true }).click();
    await page.getByRole("tab", { name: "Donaudampfschifffahrtsgesellschaft Experiment 遠隔操作" }).press("Home");
    assert.equal(await page.getByRole("tab", { name: "Recorder", exact: true }).getAttribute("aria-selected"), "true");
    await page.getByRole("tab", { name: "Recorder", exact: true }).press("End");
    await active.locator("summary").click();
    for (const [width, height] of [[320, 740], [390, 844], [844, 390], [1280, 820], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      await page.locator('[role="tab"][aria-selected="true"][data-fit-state]').waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${surface} overflows at ${width}`);
      const visibleLabels = await page.locator(".external-page:not([hidden]) button[data-fit-text]").evaluateAll((nodes) => nodes.map((node) => ({
        fit: node.dataset.fitState, clipped: node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1,
      })));
      assert.ok(visibleLabels.every((label) => label.fit && !label.clipped), JSON.stringify(visibleLabels));
      await page.screenshot({ path: resolve(output, `${surface}-${width}.png`) });
    }
    await page.setViewportSize({ width: 320, height: 740 });
    await page.addStyleTag({ url: `${origin}/text-spacing.css` });
    await page.screenshot({ path: resolve(output, `${surface}-enlarged.png`) });
    const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((node) => {
      const box = node.getBoundingClientRect();
      return box.width && (box.left < -1 || box.right > innerWidth + 1) && !node.closest(".page-tabs");
    }).map((node) => ({ tag: node.tagName, class: node.className, width: node.getBoundingClientRect().width })));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), JSON.stringify(overflow));
    await page.getByRole("button", { name: "Unload", exact: true }).click();
    assert.equal(await page.locator(".external-page:not([hidden]) iframe").count(), 0);
    await page.getByRole("button", { name: "Close tab", exact: true }).click();
    if (surface === "web") {
      await page.waitForFunction(() => window.calls.includes("configure_external_pages"));
      await page.getByRole("tab", { name: "Recorder", exact: true }).click();
      await page.locator("#fit-preview").check();
      await page.waitForFunction(() => window.viewerSaved === true);
      desktopPages = durablePages;
      assert.ok(!JSON.stringify(durablePages).includes("private"));
    }
    await page.reload();
    if (surface === "web") await page.waitForFunction(() => document.querySelector("#fit-preview").checked);
    assert.equal(await page.locator("iframe").count(), surface === "web" ? 1 : 0);
    if (surface === "web") assert.equal(await page.locator("#fit-preview").isChecked(), true);
    assert.equal(await page.getByRole("tab", { name: "Recorder", exact: true }).getAttribute("aria-selected"), "true");
    assert.equal(await page.getByRole("tab", { name: "Fixture experiment", exact: true }).count(), 1);
    await page.getByRole("button", { name: "Add external page tab" }).click();
    await page.getByLabel("Import app panel (.json)").last().setInputFiles({ name: "panel.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ id: "imported-panel", name: "Imported experiment", url: `${origin}/fixture.html` })) });
    await page.getByRole("tab", { name: "Imported experiment", exact: true }).waitFor();
    assert.equal(await page.locator(".external-page:not([hidden]) iframe").count(), 1);
    assert.deepEqual(errors, []);
    console.log(`${surface}: tab lifecycle, independent BRSP browser fixture, opaque isolation, preferences, keyboard, and layout passed`);
    await context.close();
  }
  // Run the actual phone app and BRSP envelopes against a deterministic target.
  // The transport is an in-memory bridge, not public VDO or a native recorder.
  const context = await browser.newContext();
  const page = await context.newPage({ viewport: { width: 390, height: 844 } });
  const events = (type, detail) => {
    const event = new Event(type); Object.defineProperty(event, "detail", { value: detail }); return event;
  };
  let delivery = Promise.resolve(), started = false;
  const queued = [];
  class FixtureLane extends EventTarget {
    send(lane, data) {
      delivery = delivery.then(() => page.evaluate(({ lane, data }) => {
        window.fixtureTransport.dispatchEvent(new CustomEvent(lane === "state" ? "statemessage" : "controlmessage", { detail: { peerKey: "fixture", data } }));
      }, { lane, data }));
      return true;
    }
    sendControl(_peerKey, data) { return this.send("control", data); }
    sendState(_peerKey, data) { return this.send("state", data); }
    async stop() {}
  }
  const lane = new FixtureLane();
  const sessionRoom = `rlslr_${"f".repeat(16)}`, sessionSecret = "s".repeat(32);
  const snapshot = { revision: 1, controlRevision: 1, participantId: "Fixture", selectAllStreams: true,
    keyboardMarkers: false, mouseMarkers: false, streams: [], markers: [], recording: { phase: "idle", startedAt: null, bytesWritten: 0, error: null },
    externalPagesRevision: 1, externalPages: [{ id: "desktop-one", name: "Desktop experiment", url: `${origin}/fixture.html#private-desktop-invite` }],
    remote: { approval: "waiting" } };
  let reads = 0;
  const target = new BRSPConnection({ transport: lane, role: "target", sessionId: sessionRoom,
    sharedSecret: sessionSecret, peerId: "target_fixture", grantedScopes: REMOTE_SCOPES,
    getState: () => compactState(snapshot), applyCommand: ({ scope, action, args }) => {
      if (scope === "pairing.request" && action === "request-access") {
        snapshot.remote.approval = "pending"; snapshot.revision += 1;
        return { ok: true, revision: snapshot.revision, result: { requested: true } };
      }
      assert.equal(snapshot.remote.approval, "approved");
      assert.equal(scope, "workspace.observe"); assert.equal(action, "read-page");
      assert.equal(args.catalogRevision, snapshot.externalPagesRevision);
      reads += 1;
      return { ok: true, revision: snapshot.revision,
        result: { catalogRevision: args.catalogRevision, index: args.index, page: snapshot.externalPages[args.index] } };
    } });
  await page.exposeFunction("fixtureSend", (type, data) => {
    const event = events(type === "state" ? "statemessage" : "controlmessage", { peerKey: "fixture", data });
    if (started) lane.dispatchEvent(event); else queued.push(event);
  });
  await page.exposeFunction("fixtureStart", () => {
    lane.dispatchEvent(events("peeropen", { peerKey: "fixture" })); started = true;
    for (const event of queued.splice(0)) lane.dispatchEvent(event);
  });
  await page.route("**/vendor/vdo-ninja-transport.js", (route) => route.fulfill({ contentType: "text/javascript", body: `
    export class VdoNinjaTransport extends EventTarget {
      constructor(){super();window.fixtureTransport=this;}
      sendControl(_key,data){void window.fixtureSend('control',data);return true;}
      sendState(_key,data){void window.fixtureSend('state',data);return true;}
      async start(){this.dispatchEvent(new CustomEvent('peeropen',{detail:{peerKey:'fixture'}}));await window.fixtureStart();}
      async stop(){}
    }` }));
  await page.goto(`${origin}/companion/index.html#room=${sessionRoom}&secret=${sessionSecret}`);
  await page.getByLabel("Your name").fill("Browser fixture");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByText("Waiting for someone at the computer to approve.", { exact: true }).waitFor();
  assert.equal(reads, 0);
  assert.equal(await page.getByRole("tab", { name: "Desktop experiment", exact: true }).count(), 0);
  snapshot.remote.approval = "approved"; snapshot.revision += 1;
  target.publishState();
  await page.getByRole("tab", { name: "Desktop experiment", exact: true }).click();
  await page.frameLocator('section[data-origin="desktop"] iframe').getByRole("button", { name: "Connect", exact: true }).click();
  await page.frameLocator('section[data-origin="desktop"] iframe').getByRole("button", { name: "Start experiment" }).click();
  await page.frameLocator('section[data-origin="desktop"] iframe').getByText("Confirmed running revision 1").waitFor();
  assert.ok(!await page.evaluate(() => JSON.stringify({ ...localStorage }).includes("private-desktop-invite")));
  for (let i = 0; i < 3; i += 1) { snapshot.revision += 1; target.publishState(); }
  await delivery;
  assert.equal(reads, 1, "preview heartbeats must not re-fetch or reload panel pages");
  await page.frameLocator('section[data-origin="desktop"] iframe').getByText("Confirmed running revision 1").waitFor();
  snapshot.externalPages.push({ id: "desktop-two", name: "Second desktop panel", url: `${origin}/fixture.html` });
  snapshot.externalPagesRevision += 1; snapshot.revision += 1; target.publishState();
  await page.getByRole("tab", { name: "Second desktop panel", exact: true }).waitFor();
  assert.equal(await page.locator('section[data-origin="desktop"] iframe').count(), 2);
  snapshot.externalPages.shift(); snapshot.externalPagesRevision += 1; snapshot.revision += 1; target.publishState();
  await page.getByRole("tab", { name: "Desktop experiment", exact: true }).waitFor({ state: "detached" });
  assert.equal(await page.locator('section[data-origin="desktop"] iframe').count(), 1);
  snapshot.remote.approval = "revoked"; snapshot.revision += 1; target.publishState();
  await page.locator('section[data-origin="desktop"]').waitFor({ state: "detached" });
  await target.close(); await delivery; await context.close();
  console.log("companion: actual BRSP approval, automatic panel load, live catalog changes, heartbeat preservation, secret-free storage and revocation passed");
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
