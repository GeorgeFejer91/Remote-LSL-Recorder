import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const pretext = resolve(root, "node_modules/@chenglou/pretext");
const font = resolve(root, "node_modules/@fontsource/noto-sans");
const runtime = [
  "analysis.js", "bidi.js", "generated/bidi-data.js", "layout.js",
  "line-break.js", "line-text.js", "measurement.js",
];
const files = [
  ...runtime.map((name) => [resolve(pretext, "dist", name), `vendor/pretext/${name}`]),
  [resolve(pretext, "LICENSE"), "vendor/pretext/LICENSE"],
  ...[400, 600].map((weight) => [
    resolve(font, `files/noto-sans-latin-${weight}-normal.woff2`),
    `vendor/fonts/noto-sans-latin-${weight}-normal.woff2`,
  ]),
  [resolve(font, "LICENSE"), "vendor/fonts/LICENSE"],
  [resolve(root, "web/text-fit.js"), "text-fit.js"],
];

for (const [source, relative] of files) {
  for (const surface of relative === "text-fit.js" ? ["companion"] : ["web", "companion"]) {
    const destination = resolve(root, surface, relative);
    if (check) {
      const [expected, actual] = await Promise.all([readFile(source), readFile(destination)]);
      if (!expected.equals(actual)) throw new Error(`${surface}/${relative} differs from its locked source`);
    } else {
      await mkdir(resolve(destination, ".."), { recursive: true });
      await copyFile(source, destination);
    }
  }
}
