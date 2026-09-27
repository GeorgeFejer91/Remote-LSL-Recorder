import { prepareWithSegments, measureLineStats, measureNaturalWidth, setLocale } from './vendor/pretext/layout.js';

// Grow/reflow boxes; never shrink the reader's chosen text size.
export async function measureTextRegions(root = document) {
  await document.fonts.load('400 16px "Noto Sans"');
  await document.fonts.load('600 16px "Noto Sans"');
  await document.fonts.ready;
  setLocale(document.documentElement.lang);
  let scheduled = false;
  const cache = new Map();
  const measure = () => {
    scheduled = false;
    const results = [...root.querySelectorAll('[data-measure]')].map(element => {
      if (!element.getClientRects().length) return null;
      const css = getComputedStyle(element);
      const width = element.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      const height = element.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
      if (width <= 0) return null;
      const text = element.textContent;
      const font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
      const spacing = parseFloat(css.letterSpacing) || 0;
      const key = JSON.stringify([text, font, spacing, css.whiteSpace, css.wordBreak]);
      let prepared = cache.get(key);
      if (!prepared) {
        prepared = prepareWithSegments(text, font, { letterSpacing: spacing, whiteSpace: css.whiteSpace === 'pre-wrap' ? 'pre-wrap' : 'normal' });
        if (cache.size >= 128) cache.clear();
        cache.set(key, prepared);
      }
      const stats = measureLineStats(prepared, Math.max(1, width - 1));
      const natural = measureNaturalWidth(prepared);
      const lineHeight = parseFloat(css.lineHeight);
      const unsupported = parseFloat(css.wordSpacing) !== 0 && css.wordSpacing !== 'normal';
      const fits = stats.maxLineWidth <= width + 1 && stats.lineCount * lineHeight <= height + 1;
      return { element, fit: unsupported ? 'browser-check' : fits ? 'fit' : 'reflow', lines: stats.lineCount, natural };
    });
    for (const result of results) {
      if (!result) continue;
      result.element.dataset.pretextFit = result.fit;
      result.element.dataset.pretextLines = String(result.lines);
      result.element.dataset.pretextNaturalWidth = String(Math.ceil(result.natural));
    }
  };
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(measure); } };
  new ResizeObserver(schedule).observe(document.documentElement);
  new MutationObserver(schedule).observe(root, { childList: true, characterData: true, subtree: true });
  window.addEventListener('resize', schedule);
  schedule();
}
