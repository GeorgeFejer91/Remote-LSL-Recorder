// Rendered navigation check. Optional app build roots exercise real operator pages.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { PANEL_HOST } from "../web/panel-link.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(import.meta.dirname, "..");
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const apps = [
  ["spatial-study-6-webxr", process.env.STUDY6_BUILD],
  ["minimal-social-threat-webxr", process.env.SOCIAL_THREAT_BUILD],
].filter(([, directory]) => directory);
const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2" };
await context.route("https://georgefejer91.github.io/**", async (route) => {
  const url = new URL(route.request().url());
  const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
  const repo = parts.shift();
  const directory = repo === "Remote-LSL-Recorder" ? resolve(root, "companion") : apps.find(([name]) => name === repo)?.[1];
  if (!directory) return route.abort();
  const file = resolve(directory, parts.join("/") || "index.html");
  if (!file.startsWith(`${resolve(directory)}\\`) && !file.startsWith(`${resolve(directory)}/`)) return route.abort();
  try { await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] || "application/octet-stream", headers: { "Access-Control-Allow-Origin": "*" } }); }
  catch { await route.fulfill({ status: 404, body: "Missing fixture file" }); }
});
await context.route("https://experiment.example/**", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><h1>Fixture experiment</h1><button>Connect</button>' }));
try {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(PANEL_HOST);
  await page.getByRole("button", { name: "Add external page tab" }).click();
  let active = page.locator(".external-page:not([hidden])");
  await active.getByLabel("Tab name", { exact: true }).fill("Fixture experiment");
  await active.getByLabel("Remote page URL").fill("https://experiment.example/operator.html?token=private#private-invitation");
  await active.getByRole("button", { name: "Load page", exact: true }).click();
  await page.frameLocator("iframe").getByRole("heading", { name: "Fixture experiment" }).waitFor();
  await active.getByRole("button", { name: "Share panel", exact: true }).click();
  const link = await active.getByLabel("Panel link", { exact: true }).inputValue();
  assert.ok(link.startsWith(`${PANEL_HOST}#panel=`));
  const qr = active.getByRole("img", { name: "QR code for Fixture experiment panel link" });
  await qr.waitFor();
  assert.ok(await qr.evaluate((image) => image.complete && image.naturalWidth > 0));
  const downloadPromise = page.waitForEvent("download");
  await active.getByRole("button", { name: "Download panel JSON", exact: true }).click();
  const download = await downloadPromise;
  const descriptor = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(descriptor.url, "https://experiment.example/operator.html");
  assert.ok(!JSON.stringify(descriptor).includes("private"));
  await active.getByRole("button", { name: "Close tab", exact: true }).click();
  await page.getByRole("button", { name: "Add external page tab" }).click();
  await active.getByLabel("Remote page URL").fill(link);
  await active.getByRole("button", { name: "Load page", exact: true }).click();
  await page.getByRole("tab", { name: "Fixture experiment", exact: true }).waitFor();
  assert.equal(await active.locator("iframe").getAttribute("src"), descriptor.url);

  // Keep phone storage empty while using the same isolated fixture routes.
  const phone = await context.newPage();
  await phone.addInitScript(() => localStorage.clear());
  await phone.goto(link);
  assert.equal(await phone.evaluate(() => location.hash), "");
  await phone.getByRole("tab", { name: "Fixture experiment", exact: true }).waitFor();
  assert.equal(await phone.locator("iframe").count(), 0);
  await phone.getByRole("button", { name: "Load page", exact: true }).click();
  await phone.frameLocator("iframe").getByRole("heading", { name: "Fixture experiment" }).waitFor();
  await phone.close();
  console.log("Panel share: local QR, base URL JSON download, pasted link, scrubbed phone link and review-before-load passed");

  for (const [name] of apps) {
    const sockets = [];
    const observeSocket = (socket) => sockets.push(socket.url());
    page.on("websocket", observeSocket);
    await page.goto(PANEL_HOST);
    await page.getByRole("button", { name: "Add external page tab" }).click();
    await page.getByLabel("Import app panel (.json)").last().setInputFiles({ name: "panel.json", mimeType: "application/json", buffer: await readFile(resolve(apps.find(([repo]) => repo === name)[1], "panel.json")) });
    await active.locator("iframe").waitFor();
    await active.frameLocator("iframe").getByRole("button", { name: "Connect", exact: true }).waitFor();
    const child = page.frames().find((frame) => frame !== page.mainFrame() && frame.url().includes(name));
    assert.ok(child, `${name} frame missing`);
    await child.getByRole("button", { name: "Connect", exact: true }).waitFor();
    // Two animation frames observe delayed boot effects, including React hydration.
    await child.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.deepEqual(sockets, [], `${name} connected before Connect`);
    const isolation = await child.evaluate(() => {
      let parentBlocked = false, storageBlocked = false;
      try { void parent.document.body; } catch { parentBlocked = true; }
      try { void localStorage.length; } catch { storageBlocked = true; }
      return { parentBlocked, storageBlocked };
    });
    assert.deepEqual(isolation, { parentBlocked: true, storageBlocked: true });
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await child.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      assert.ok(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} overflow at ${width}`);
    }
    await child.addStyleTag({ content: 'html { font-size: 200% !important } button { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important }' });
    await page.setViewportSize({ width: 320, height: 844 });
    await child.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.ok(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} enlarged text overflow`);
    const clipped = await child.locator("button").evaluateAll((buttons) => buttons.filter((button) => button.getBoundingClientRect().width && (button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1)).map((button) => button.textContent));
    assert.deepEqual(clipped, [], `${name} clipped labels`);
    // Attempt actual SDK startup in denied-storage context; transport success is a separate gate.
    const socketStarted = page.waitForEvent("websocket", { timeout: 15000 });
    await child.getByRole("button", { name: "Connect", exact: true }).click();
    await socketStarted;
    console.log(`${name}: real built operator page, explicit Connect, opaque storage, responsive text, SDK signaling start passed`);
    await active.getByRole("button", { name: "Unload", exact: true }).click();
    page.off("websocket", observeSocket);
  }
  assert.deepEqual(errors, []);
} finally {
  await context.close();
  await browser.close();
}
