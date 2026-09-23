import assert from "node:assert/strict";
import test from "node:test";
import { chooseLargestFittingSize, sizeInPixels } from "../web/text-fit.js";

test("bounded text fitting shrinks, regrows, and reports a readable-floor failure", () => {
  assert.deepEqual(chooseLargestFittingSize(12, 16, (size) => size <= 16), { size: 16, fits: true });
  const narrow = chooseLargestFittingSize(12, 16, (size) => size <= 13.5);
  assert.equal(narrow.fits, true);
  assert.ok(narrow.size <= 13.5 && narrow.size > 13);
  assert.deepEqual(chooseLargestFittingSize(12, 16, (size) => size <= 11), { size: 12, fits: false });
});

test("typography bounds follow the root and parent text scales", () => {
  assert.equal(sizeInPixels("1.25rem", 20, 16), 25);
  assert.equal(sizeInPixels("0.9em", 20, 16), 14.4);
  assert.equal(sizeInPixels("14px", 20, 16), 14);
  assert.equal(sizeInPixels("", 20, 16), null);
});
