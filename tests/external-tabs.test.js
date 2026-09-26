import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { restoreTabs, savedPageUrl, validatePageUrl } from "../web/external-tabs.js";
import { createEmbeddedVdoSdk } from "../web/external-page-connector.js";

const desktop = "http://tauri.localhost/";
const phone = "https://georgefejer91.github.io/Remote-LSL-Recorder/";

test("the pinned SDK connector tolerates denied origin storage without changing session options", () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousSdk = globalThis.VDONinjaSDK;
  const options = { password: "test-session", salt: "test-salt" };
  class FakeSdk {
    constructor(value) { this.options = value; }
    _getStorage() { throw new Error("Cache must not be reached"); }
    _setStorage() { throw new Error("Cache must not be reached"); }
  }
  try {
    globalThis.VDONinjaSDK = FakeSdk;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Storage denied"); } });
    const sdk = createEmbeddedVdoSdk(options);
    assert.equal(sdk.options, options);
    assert.equal(sdk._getStorage("turnlist"), null);
    assert.doesNotThrow(() => sdk._setStorage("turnlist", []));
    globalThis.VDONinjaSDK = class {};
    assert.throws(() => createEmbeddedVdoSdk(options), /cache API/u);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
    if (previousSdk) globalThis.VDONinjaSDK = previousSdk;
    else delete globalThis.VDONinjaSDK;
  }
});

test("external pages accept HTTPS and local desktop development but reject privileged or mixed URLs", () => {
  assert.equal(validatePageUrl(" https://example.com/remote#room=private ", phone).hostname, "example.com");
  for (const url of ["http://localhost:8080/", "http://127.0.0.1:8080/", "http://[::1]:8080/"]) {
    assert.equal(validatePageUrl(url, desktop).protocol, "http:");
    assert.throws(() => validatePageUrl(url, phone));
  }
  for (const url of ["javascript:alert(1)", "data:text/html,x", "file:///C:/secret", "tauri://localhost/",
    "http://192.168.1.2/", "/relative", "https://user:pass@example.com/", "https://localhost.evil.example".replace("https:", "http:")]) {
    assert.throws(() => validatePageUrl(url, desktop));
  }
  assert.throws(() => validatePageUrl(`https://example.com/${"x".repeat(4096)}`, desktop));
});

test("only labels and base URLs restore; invitation material and corrupt entries are discarded", () => {
  const privateUrl = "https://example.com/controller?token=private#room=private&secret=private";
  assert.equal(savedPageUrl(privateUrl), "https://example.com/controller");
  const tabs = restoreTabs(JSON.stringify([
    { name: " Experiment ", url: privateUrl, secret: "private" },
    { name: "Bad", url: "javascript:alert(1)" },
    null, { name: "", url: privateUrl }, { name: "x".repeat(81), url: privateUrl },
  ]), phone);
  assert.deepEqual(tabs, [{ name: "Experiment", url: "https://example.com/controller" }]);
  assert.deepEqual(restoreTabs("broken", phone), []);
  assert.deepEqual(restoreTabs("{}", phone), []);
  assert.deepEqual(restoreTabs("x".repeat(1_000_001), phone), []);
});

test("both surfaces allow embedded pages without granting remote Tauri capabilities", async () => {
  const config = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url)));
  const html = await readFile(new URL("../companion/index.html", import.meta.url), "utf8");
  assert.match(config.app.security.csp, /frame-src https:/u);
  assert.match(html, /frame-src https:/u);
  const capability = JSON.parse(await readFile(new URL("../src-tauri/capabilities/default.json", import.meta.url)));
  assert.equal(capability.remote, undefined);
  assert.ok(capability.permissions.includes("allow-get-snapshot"));
  assert.ok(capability.permissions.every((permission) => permission === "core:default" || permission.startsWith("allow-")));
});
