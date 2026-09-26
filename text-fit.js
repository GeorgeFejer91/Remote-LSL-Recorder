import { clearCache, measureLineStats, measureNaturalWidth, prepareWithSegments } from "./vendor/pretext/layout.js";

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

export function sizeInPixels(token, rootSize, parentSize) {
  const match = /^(\d*\.?\d+)(px|rem|em)$/u.exec(token.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return value * (match[2] === "rem" ? rootSize : match[2] === "em" ? parentSize : 1);
}

export async function mountTextFitting(root = document) {
  const view = root.defaultView;
  if (!view?.Intl?.Segmenter || !view.ResizeObserver || !view.MutationObserver
    || !view.document.createElement("canvas").getContext("2d")) return;
  try {
    await root.fonts.load('600 16px "Noto Sans"');
    await root.fonts.ready;
  } catch { /* A fallback font can still be measured. */ }

  const labels = new Set(root.querySelectorAll("[data-fit-text]"));
  const dirty = new Set(labels);
  let frame = 0;
  function measure(element) {
    if (!element.isConnected || !element.clientWidth) return null;
    const style = view.getComputedStyle(element);
    const width = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    if (width <= 0) return null;
    const rootSize = parseFloat(view.getComputedStyle(root.documentElement).fontSize);
    const parentSize = parseFloat(view.getComputedStyle(element.parentElement).fontSize);
    const preferred = sizeInPixels(style.getPropertyValue("--fit-preferred-size"), rootSize, parentSize)
      ?? parseFloat(style.fontSize);
    const min = Math.min(preferred, sizeInPixels(style.getPropertyValue("--fit-min-size"), rootSize, parentSize)
      ?? preferred * 0.88);
    const text = element.textContent || "";
    const fits = (size) => {
      const prepared = prepareWithSegments(text, `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`, {
        whiteSpace: "normal", wordBreak: "normal",
        letterSpacing: style.letterSpacing === "normal" ? 0 : parseFloat(style.letterSpacing),
      });
      return measureNaturalWidth(prepared) <= width - 1
        && measureLineStats(prepared, width).lineCount <= 1;
    };
    try { return { element, preferred, ...chooseLargestFittingSize(min, preferred, fits) }; }
    catch { return { element, preferred, size: min, fits: false }; }
  }
  function flush() {
    frame = 0;
    const updates = [...dirty].map(measure).filter(Boolean);
    dirty.clear();
    for (const { element, preferred, size, fits } of updates) {
      const nextSize = fits && size === preferred ? "" : `${size.toFixed(1)}px`;
      if (element.style.getPropertyValue("--fit-text-size") !== nextSize) {
        if (nextSize) element.style.setProperty("--fit-text-size", nextSize);
        else element.style.removeProperty("--fit-text-size");
      }
      const state = fits ? "fit" : "no-fit";
      if (element.dataset.fitState !== state) element.dataset.fitState = state;
    }
  }
  function schedule(element) {
    dirty.add(element);
    if (!frame) frame = view.requestAnimationFrame(flush);
  }
  const observer = new view.ResizeObserver((entries) => {
    for (const entry of entries) schedule(entry.target);
  });
  const mutations = new view.MutationObserver((records) => {
    for (const record of records) {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const label = target?.closest("[data-fit-text]");
      if (label) schedule(label);
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        for (const added of [node, ...node.querySelectorAll("[data-fit-text]")]) {
          if (!added.matches("[data-fit-text]") || labels.has(added)) continue;
          labels.add(added);
          observer.observe(added);
          schedule(added);
        }
      }
    }
    for (const label of labels) {
      if (label.isConnected) continue;
      observer.unobserve(label);
      labels.delete(label);
      dirty.delete(label);
    }
  });
  for (const label of labels) {
    observer.observe(label);
  }
  mutations.observe(root.body, { subtree: true, childList: true, characterData: true });
  const refit = () => { for (const label of labels) schedule(label); };
  const fontChanged = () => { clearCache(); refit(); };
  root.fonts.addEventListener?.("loadingdone", fontChanged);
  view.addEventListener("resize", refit);
  refit();
  return () => {
    observer.disconnect();
    mutations.disconnect();
    root.fonts.removeEventListener?.("loadingdone", fontChanged);
    view.removeEventListener("resize", refit);
    if (frame) view.cancelAnimationFrame(frame);
  };
}
