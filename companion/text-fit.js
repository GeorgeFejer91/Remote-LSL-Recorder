import { clearCache, measureNaturalWidth, prepareWithSegments } from "./vendor/pretext/layout.js";

export function chooseLargestFittingSize(min, preferred, fits) {
  if (fits(preferred)) return { size: preferred, fits: true };
  if (!fits(min)) return { size: min, fits: false };
  let low = min;
  let high = preferred;
  for (let i = 0; i < 12 && high - low > 0.1; i += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return { size: Math.floor(low * 10) / 10, fits: true };
}

export async function mountTextFitting(root = document) {
  const view = root.defaultView;
  if (!view?.Intl?.Segmenter || !view.ResizeObserver || !view.document.createElement("canvas").getContext("2d")) return;
  try {
    await root.fonts.load('600 16px "Noto Sans"');
    await root.fonts.ready;
  } catch { return; }

  const labels = [...root.querySelectorAll('[data-fit-text="action"]')];
  const dirty = new Set(labels);
  let frame = 0;
  function fit(element) {
    if (!element.isConnected || !element.clientWidth || !element.clientHeight) return;
    const style = view.getComputedStyle(element);
    const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const height = element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (width <= 0 || height <= 0) return;
    const preferred = parseFloat(view.getComputedStyle(root.documentElement).fontSize);
    const min = preferred * 0.88;
    const text = element.textContent || "";
    const fits = (size) => {
      const prepared = prepareWithSegments(text, `600 ${size}px "Noto Sans"`, {
        whiteSpace: "normal", wordBreak: "normal", letterSpacing: 0,
      });
      return measureNaturalWidth(prepared) <= width + 0.5 && size * 1.3 <= height + 0.5;
    };
    const result = chooseLargestFittingSize(min, preferred, fits);
    const size = `${result.size.toFixed(1)}px`;
    if (element.style.getPropertyValue("--fit-text-size") !== size) element.style.setProperty("--fit-text-size", size);
    element.dataset.fitState = result.fits ? "fit" : "no-fit";
  }
  function flush() {
    frame = 0;
    for (const element of dirty) fit(element);
    dirty.clear();
  }
  function schedule(element) {
    dirty.add(element);
    if (!frame) frame = view.requestAnimationFrame(flush);
  }
  const observer = new view.ResizeObserver((entries) => {
    for (const entry of entries) schedule(entry.target);
  });
  for (const label of labels) observer.observe(label);
  const refit = () => {
    clearCache();
    for (const label of labels) schedule(label);
  };
  root.fonts.addEventListener?.("loadingdone", refit);
  refit();
  return () => {
    observer.disconnect();
    root.fonts.removeEventListener?.("loadingdone", refit);
    if (frame) view.cancelAnimationFrame(frame);
  };
}
