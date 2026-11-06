import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".for-ai-local/record-and-play");
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, `.${new URL(req.url, "http://localhost").pathname}`);
    if (!path.startsWith(root + "/") && !path.startsWith(root + "\\")) throw new Error("Outside root");
    const bytes = await readFile(path);
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" })[extname(path)] || "application/octet-stream");
    res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  page.on("pageerror", error => console.error(error.message));
  page.setDefaultTimeout(2500);
  const calls = [];
  let fail = false;
  let phase = "idle";
  await page.exposeFunction("fixtureInvoke", async (command, args) => {
    calls.push({ command, args });
    if (command === "start_recording_and_play") {
      if (fail) throw new Error("VLC+ is not listening on the selected port.");
      phase = "recording";
    }
    if (command === "stop_recording") phase = "idle";
    return { revision: 0, controlRevision: 0, participantId: "UITest", outputDirectory: "C:\\Recordings",
      selectAllStreams: true, keyboardMarkers: false, mouseMarkers: false, externalPages: [],
      externalPagesInitialized: true, externalPagesRevision: 0, viewer: {}, streams: [], markers: [],
      recording: { phase, bytesWritten: 0 }, remote: { phase: "idle", active: false, route: "unknown", approval: "waiting" } };
  });
  await page.addInitScript(() => { window.__TAURI__ = { core: { invoke: (command, args = {}) => window.fixtureInvoke(command, args) } }; });
  await page.goto(`http://127.0.0.1:${server.address().port}/web/index.html`);
  const start = page.getByRole("button", { name: "Record and play VLC+", exact: true });
  await start.waitFor();
  await page.getByRole("button", { name: "VLC+ setup", exact: true }).click();
  await page.getByLabel("VLC+ control port").fill("42124");
  await page.getByRole("button", { name: "Close VLC+ setup" }).click();
  await start.click();
  await page.waitForFunction(() => document.querySelector("#record-phase").textContent === "Recording").catch(async error => {
    console.error(JSON.stringify({ calls, status: await page.locator("#system-status").textContent(), port: await page.locator("#vlc-port").inputValue() }));
    throw error;
  });
  assert.equal(await start.isDisabled(), true);
  const startIndex = calls.findIndex(call => call.command === "start_recording_and_play");
  assert.equal(calls[startIndex].args.port, 42124);
  assert.equal(calls[startIndex - 1].command, "configure_session");
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await start.waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector("#record-play").disabled);
  fail = true;
  await start.click();
  await page.waitForFunction(() => document.querySelector("#system-status").textContent.includes("not listening"));
  assert.equal(await start.isEnabled(), true);
  for (const width of [320, 720, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await start.evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1), true);
    await page.screenshot({ path: resolve(output, `recorder-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addStyleTag({ content: "html {font-size:200% !important} #record-play {line-height:1.5 !important;letter-spacing:.12em !important;word-spacing:.16em !important}" });
  assert.equal(await start.evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1), true);
  await page.screenshot({ path: resolve(output, "recorder-large-text.png"), fullPage: true });
  console.log("PASS: record/play control, session ordering, port, active lock, failure recovery and readable label at 320/720/1280/1920 CSS px (mock native IPC).");
} finally { await browser.close(); await new Promise(done => server.close(done)); }
