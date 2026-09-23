import assert from "node:assert/strict";
import test from "node:test";
import { channelRanges } from "../web/chart-scale.js";

test("each channel uses only its current preview window and its own units", () => {
  const ranges = channelRanges([
    { values: [0.001, 10] },
    { values: [0.003, 20] },
  ], 2);
  assert.deepEqual(ranges.map(({ min, max }) => [min, max]), [[0.001, 0.003], [10, 20]]);
  assert.deepEqual(channelRanges([{ values: [0.003, 20] }, { values: [0.004, 30] }], 2)
    .map(({ min, max }) => [min, max]), [[0.003, 0.004], [20, 30]]);
  assert.equal(channelRanges([{ values: [Number.NaN] }], 1)[0], null);
});
