// Remote Panel/1 links carry navigation metadata, never authority or app commands.
export const PANEL_HOST = "https://georgefejer91.github.io/Remote-LSL-Recorder/";

export function createPanelLink(page) {
  const bytes = new TextEncoder().encode(JSON.stringify(page));
  if (bytes.length > 16_384) throw new Error("Panel descriptors must be at most 16 KB.");
  const encoded = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  return `${PANEL_HOST}#panel=${encoded}`;
}

export function readPanelLink(value) {
  const url = new URL(value);
  if (url.origin !== new URL(PANEL_HOST).origin || url.pathname !== new URL(PANEL_HOST).pathname) return null;
  const encoded = new URLSearchParams(url.hash.slice(1)).get("panel");
  if (encoded === null) return null;
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length > 21_846) throw new Error("Invalid panel link.");
  try {
    const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch { throw new Error("Invalid panel link encoding."); }
}
