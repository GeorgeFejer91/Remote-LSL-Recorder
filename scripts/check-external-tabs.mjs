// Optional rendered gate. Install Playwright locally, or point PLAYWRIGHT_MODULE
// at an existing installation. No browser automation dependency is shipped.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";

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
    if (surface === "web") await page.addInitScript(() => {
      window.calls = [];
      window.__TAURI__ = { core: { invoke: async (command) => {
        window.calls.push(command);
        return { revision: window.calls.length, controlRevision: 0, participantId: "Fixture",
          outputDirectory: "Fixture", selectAllStreams: true, keyboardMarkers: true, mouseMarkers: false,
          streams: [], markers: [], recording: { phase: "idle", bytesWritten: 0 },
          remote: { phase: "disabled", approval: "waiting", route: "unknown" } };
      } } };
    });
    await page.goto(`${origin}/${surface}/index.html`);
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
    await page.reload();
    assert.equal(await page.locator("iframe").count(), 0);
    assert.equal(await page.getByRole("tab", { name: "Recorder", exact: true }).getAttribute("aria-selected"), "true");
    assert.equal(await page.getByRole("tab", { name: "Fixture experiment", exact: true }).count(), 1);
    assert.deepEqual(errors, []);
    console.log(`${surface}: tab lifecycle, independent BRSP browser fixture, opaque isolation, preferences, keyboard, and layout passed`);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
