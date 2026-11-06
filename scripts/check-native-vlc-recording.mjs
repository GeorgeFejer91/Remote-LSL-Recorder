import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createServer, createConnection } from "node:net";
import { readFile, writeFile, mkdir, stat, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, ".for-ai-local/native-vlc");
await mkdir(output, { recursive: true });
const inputDone = join(output, "input-done");
await unlink(inputDone).catch(error => { if (error.code !== "ENOENT") throw error; });
const vlcExe = join(process.env.LOCALAPPDATA, "Programs/VLCPlus/vlc.exe");
const video = resolve(process.env.VLC_TEST_MEDIA || "../vlc-plus/examples/media/dictator-3-study.mp4");
const recorderExe = process.env.RECORDER_TEST_EXE || resolve(root, "src-tauri/target/release/remote-lsl-recorder.exe");
for (const file of [vlcExe, video, recorderExe]) assert.equal((await stat(file)).isFile(), true);
const config = join(process.env.APPDATA, "dev.georgefejer.remotelslrecorder/workspace.json");
const previous = await readFile(config).catch(error => { if (error.code !== "ENOENT") throw error; return null; });
await writeFile(join(output, "workspace-backup.json"), JSON.stringify({ path: config,
  existed: previous !== null, content: previous?.toString("base64") ?? null }, null, 2));
async function freePort() {
  const server = createServer();
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const port = server.address().port;
  await new Promise(done => server.close(done));
  return port;
}
const rcPort = await freePort();
const debugPort = await freePort();
let vlcPid;
const recorder = spawn(recorderExe, [], { windowsHide: false, stdio: "ignore",
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --remote-debugging-address=127.0.0.1` } });
await writeFile(join(output, "processes.json"), JSON.stringify({ recorderPid: recorder.pid, rcPort, debugPort, vlcExe, video }, null, 2));
async function rc(command, acknowledgement = command) {
  return new Promise((done, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: rcPort });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`RC timeout: ${command}`)); }, 5000);
    let response = "";
    socket.on("error", error => { clearTimeout(timer); reject(error); });
    socket.on("connect", () => socket.write(command + "\n"));
    socket.on("data", chunk => {
      response += chunk.toString();
      if (response.includes(`${acknowledgement}: returned 0 `)) { clearTimeout(timer); socket.destroy(); done(response); }
    });
  });
}
let browser;
let stopped = false;
try {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${debugPort}/json/version`)).ok) break; } catch {}
    await delay(200);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  let page;
  const pageDeadline = Date.now() + 20000;
  while (Date.now() < pageDeadline && !page) {
    page = browser.contexts().flatMap(context => context.pages()).find(page => /tauri|localhost/.test(page.url()));
    if (!page) await delay(100);
  }
  if (!page) console.error(browser.contexts().flatMap(context => context.pages()).map(page => page.url()));
  assert.ok(page, "Recorder's packaged WebView was not found");
  page.setDefaultTimeout(20000);
  await page.getByLabel("Participant ID", { exact: true }).fill("VLC_UI_TEST");
  await page.getByLabel("Recording folder", { exact: true }).fill(output);
  await page.getByRole("button", { name: "Apply session", exact: true }).click();
  await page.getByRole("checkbox", { name: "Record all available streams", exact: true }).uncheck();
  await page.getByRole("button", { name: "VLC+ setup", exact: true }).click();
  await page.getByLabel("VLC+ control port").fill(String(rcPort));
  await page.getByLabel("Video path for Start VLC+ and record", { exact: true }).fill(video);
  await page.getByRole("button", { name: "Close VLC+ setup" }).click();
  await page.getByRole("button", { name: "Start VLC+ and record", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#record-phase").textContent === "Recording"
    && document.querySelector("#system-status").textContent === "Ready").catch(async error => {
      console.error(JSON.stringify({ status: await page.locator("#system-status").textContent(),
        snapshot: await page.evaluate(() => window.__TAURI__.core.invoke("get_snapshot")) }));
      throw error;
    });
  const before = await page.evaluate(() => window.__TAURI__.core.invoke("get_snapshot"));
  const launched = before.streams.find(stream => stream.selected && /^vlc-flubber-\d+-affect$/.test(stream.sourceId));
  assert.ok(launched, "The launched player's affect stream must be automatically selected");
  vlcPid = Number(launched.sourceId.match(/^vlc-flubber-(\d+)-/)[1]);
  assert.ok(before.streams.some(stream => stream.selected && stream.sourceId === `vlc-flubber-${vlcPid}-markers`));
  await rc("pause");
  const transportBefore = await rc("get_time\nvolume\nstatus", "status");
  await writeFile(join(output, "processes.json"), JSON.stringify({ vlcPid, recorderPid: recorder.pid, rcPort, debugPort, vlcExe, video }, null, 2));
  console.log(`READY_FOR_KEYS VLC_PID=${vlcPid} RECORDER_PID=${recorder.pid}`);
  const inputDeadline = Date.now() + 120000;
  while (Date.now() < inputDeadline) {
    if (await stat(inputDone).then(() => true, () => false)) break;
    await delay(200);
  }
  assert.equal(await stat(inputDone).then(() => true, () => false), true, "Native keyboard phase was not completed");
  await delay(1500);
  const after = await page.evaluate(() => window.__TAURI__.core.invoke("get_snapshot"));
  const affect = after.streams.find(stream => stream.sourceId === `vlc-flubber-${vlcPid}-affect`);
  assert.ok(affect?.preview.some(sample => sample.values[0] !== 0 && sample.values[1] !== 0), "Both rating axes must change in the real LSL preview");
  assert.ok(after.markers.some(marker => /Start|Resume/.test(marker.value)), "Playback marker missing");
  const transportAfter = await rc("get_time\nvolume\nstatus", "status");
  const transportValues = text => ({
    time: text.split(/\r?\n/).map(line => line.replace(/^> /, "").trim()).find(line => /^\d+$/.test(line)),
    volume: text.match(/audio volume: (\d+)/)?.[1],
  });
  assert.deepEqual(transportValues(transportAfter), transportValues(transportBefore), "Affect arrows must not change paused VLC time or volume");
  assert.ok(transportValues(transportBefore).time !== undefined && transportValues(transportBefore).volume !== undefined, "Transport assertions require actual time and volume values");
  await rc("pause");
  await delay(1200);
  await rc("stop");
  await page.waitForFunction(async pid => {
    const state = await window.__TAURI__.core.invoke("get_snapshot");
    return state.markers.some(marker => /_Stop$/.test(marker.value)
      && state.streams.some(stream => stream.id === marker.streamId && stream.sourceId === `vlc-flubber-${pid}-markers`));
  }, vlcPid);
  await page.screenshot({ path: join(output, "native-recording.png") });
  await page.getByRole("button", { name: "Stop recording", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#record-phase").textContent === "Complete");
  const snapshot = await page.evaluate(() => window.__TAURI__.core.invoke("get_snapshot"));
  stopped = true;
  await writeFile(join(output, "receipt.json"), JSON.stringify({ before, after, stopped: snapshot, transportBefore, transportAfter, vlcPid, physicalInput: false }, null, 2));
  console.log(`XDF_READY ${snapshot.recording.outputFile}`);
  console.log("CLOSE_RECORDER: close the owned Recorder window to finish the native test.");
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(new Error("Recorder did not close gracefully")), 120000);
    recorder.once("exit", () => { clearTimeout(timer); done(); });
  });
  console.log("PASS: native WebView button -> Rust Recorder -> VLC playback -> changing LSL ratings -> clean XDF stop.");
} finally {
  if (browser && !stopped) {
    for (const page of browser.contexts().flatMap(context => context.pages())) {
      await page.evaluate(async () => {
        const snapshot = await window.__TAURI__.core.invoke("get_snapshot");
        if (snapshot.recording.phase === "recording") await window.__TAURI__.core.invoke("stop_recording");
      }).catch(error => console.error(`Recording cleanup needs attention: ${error.message}`));
    }
  }
  await new Promise(done => {
    const socket = createConnection({ host: "127.0.0.1", port: rcPort });
    const timer = setTimeout(() => { socket.destroy(); done(); }, 5000);
    let response = "";
    const finish = () => { clearTimeout(timer); socket.destroy(); done(); };
    socket.on("error", finish);
    socket.on("end", finish);
    socket.on("connect", () => socket.write("quit\n"));
    socket.on("data", chunk => {
      response += chunk.toString();
      if (/quit: returned 0 /.test(response)) finish();
    });
  });
  await browser?.close();
  const exitDeadline = Date.now() + 5000;
  while (recorder.exitCode === null && Date.now() < exitDeadline) await delay(100);
  if (recorder.exitCode !== null) {
    if (previous) await writeFile(config, previous);
    else await unlink(config).catch(error => { if (error.code !== "ENOENT") throw error; });
  } else console.error("Owned Recorder remains open; close it before restoring the saved workspace.");
}
