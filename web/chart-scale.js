export function channelRanges(samples, channelCount) {
  return Array.from({ length: channelCount }, (_, channel) => {
    let min = Infinity;
    let max = -Infinity;
    for (const sample of samples) {
      const value = sample.values[channel];
      if (Number.isFinite(value)) {
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
    }
    if (min === Infinity) return null;
    const span = max - min || Math.max(Math.abs(min) * 0.1, 1);
    const pad = span * 0.08;
    return { min, max, low: min - pad, high: max + pad };
  });
}

export function displayChannels(streams, hiddenChannels) {
  return streams.filter((stream) => stream.selected && !stream.isMarker).flatMap((stream) =>
    Array.from({ length: stream.channelCount }, (_, channel) => ({
      stream, channel, key: `${stream.id}\0${channel}`,
    })).filter(({ key }) => !hiddenChannels.has(key)));
}
