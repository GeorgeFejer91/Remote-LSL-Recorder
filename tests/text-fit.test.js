import assert from "node:assert/strict";
import test from "node:test";
import { chooseLargestFittingSize } from "../web/text-fit.js";

test("bounded text fitting shrinks, regrows, and reports a readable-floor failure", () => {
  assert.deepEqual(chooseLargestFittingSize(12, 16, (size) => size <= 16), { size: 16, fits: true });
  const narrow = chooseLargestFittingSize(12, 16, (size) => size <= 13.5);
  assert.equal(narrow.fits, true);
  assert.ok(narrow.size <= 13.5 && narrow.size > 13);
  assert.deepEqual(chooseLargestFittingSize(12, 16, (size) => size <= 11), { size: 12, fits: false });
});
