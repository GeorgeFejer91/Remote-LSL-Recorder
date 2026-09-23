import assert from "node:assert/strict";
import test from "node:test";
import { timeToX } from "../web/chart-time.js";

test("signal samples and markers share LSL time coordinates", () => {
  assert.equal(timeToX(10.25, 10, 11, 200), 50);
  assert.equal(timeToX(10.5, 10, 11, 200), 100);
  assert.equal(timeToX(11, 10, 11, 200), 200);
});
