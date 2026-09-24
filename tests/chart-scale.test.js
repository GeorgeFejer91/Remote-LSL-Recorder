import assert from "node:assert/strict";
import test from "node:test";
import { channelRanges, displayChannels } from "../web/chart-scale.js";

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

test("the shared viewer includes every channel from recording-selected streams", () => {
  const streams = [
    { id: "eeg", selected: true, isMarker: false, channelCount: 24 },
    { id: "force", selected: true, isMarker: false, channelCount: 2 },
    { id: "unused", selected: false, isMarker: false, channelCount: 3 },
    { id: "event", selected: true, isMarker: true, channelCount: 1 },
  ];
  const all = displayChannels(streams, new Set());
  assert.equal(all.length, 26);
  assert.equal(all[23].channel, 23);
  const channels = displayChannels(streams, new Set([`eeg\0${23}`]));
  assert.equal(channels.length, 25);
  assert.deepEqual(channels.at(0), { stream: streams[0], channel: 0, key: `eeg\0${0}` });
  assert.deepEqual(channels.at(-1), { stream: streams[1], channel: 1, key: `force\0${1}` });
  assert.equal(channels.some(({ channel }) => channel === 23), false);
});
