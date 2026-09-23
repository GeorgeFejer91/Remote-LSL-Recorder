export function timeToX(timestamp, first, last, width) {
  if (!Number.isFinite(timestamp) || !Number.isFinite(first) || !Number.isFinite(last) || last <= first) return 0;
  return ((timestamp - first) / (last - first)) * width;
}
