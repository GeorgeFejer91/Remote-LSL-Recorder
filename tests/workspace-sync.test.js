import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceSync } from "../companion/workspace-sync.js";

test("desktop panels are read after approval and applied as one complete catalog", () => {
  const requests = [], applied = [], errors = [];
  const sync = createWorkspaceSync({
    getConnection: () => ({ sendCommand: (scope, action, args) => {
      const commandId = `command-${requests.length}`; requests.push({ commandId, scope, action, args }); return commandId;
    } }),
    applyPages: (pages) => applied.push(pages), clearPages: () => applied.push("cleared"), onError: (error) => errors.push(error),
  });
  const descriptor = { revision: 3, count: 2 };
  sync.observe({ approval: "pending", externalPages: descriptor });
  assert.equal(requests.length, 0);
  sync.observe({ approval: "approved", externalPages: descriptor });
  const reply = (index, page) => sync.applied({ commandId: requests.at(-1).commandId, ok: true,
    result: { catalogRevision: 3, index, page } });
  reply(0, { id: "one", name: "One", url: "https://example.com/one#fresh-invitation" });
  assert.equal(applied.length, 1, "partial catalogs never replace the displayed panels");
  reply(1, { id: "two", name: "Two", url: "https://example.com/two" });
  assert.equal(applied.at(-1)[0].url, "https://example.com/one#fresh-invitation");
  sync.observe({ approval: "approved", externalPages: descriptor });
  assert.equal(requests.length, 2, "heartbeats must not reload a connected experiment");
  sync.observe({ approval: "approved", externalPages: { revision: 4, count: 0 } });
  assert.deepEqual(applied.at(-1), []);
  sync.clear();
  assert.equal(applied.at(-1), "cleared");
  assert.deepEqual(errors, []);
});

test("changed catalogs discard old replies and malformed pages never reach the viewer", () => {
  const requests = [], applied = [], errors = [];
  const sync = createWorkspaceSync({
    getConnection: () => ({ sendCommand: (...args) => { requests.push(args); return `id-${requests.length}`; } }),
    applyPages: (pages) => applied.push(pages), clearPages: () => {}, onError: (error) => errors.push(error),
  });
  sync.observe({ approval: "approved", externalPages: { revision: 1, count: 1 } });
  sync.observe({ approval: "approved", externalPages: { revision: 2, count: 1 } });
  sync.applied({ commandId: "id-1", ok: true, result: { catalogRevision: 1, index: 0, page: { id: "old", name: "Old", url: "https://example.com/" } } });
  assert.equal(applied.length, 0);
  sync.applied({ commandId: "id-2", ok: true, result: { catalogRevision: 2, index: 0, page: { id: "unsafe", name: "Unsafe", url: "file:///C:/secret" } } });
  assert.equal(applied.length, 0);
  assert.equal(errors.length, 1);
  sync.clear();
});
