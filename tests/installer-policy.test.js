import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("NSIS refuses running Recorder processes instead of terminating them", () => {
  const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url)));
  assert.equal(config.bundle.windows.nsis.installerHooks, "installer-hooks.nsh");
  assert.equal(config.bundle.windows.nsis.template, "installer.nsi");
  const hooks = readFileSync(new URL("../src-tauri/installer-hooks.nsh", import.meta.url), "utf8");
  assert.match(hooks, /!macroundef CheckIfAppIsRunning/);
  assert.match(hooks, /!macro CheckIfAppIsRunning executableName productName/);
  assert.match(hooks, /FindProcessCurrentUser/);
  assert.match(hooks, /SetErrorLevel 2/);
  assert.match(hooks, /Abort/);
  assert.doesNotMatch(hooks, /KillProcess|taskkill/i);
  const template = readFileSync(new URL("../src-tauri/installer.nsi", import.meta.url), "utf8");
  assert.doesNotMatch(template, /PageReinstall|ReadRegStr[^\n]+UninstallString/);
});
