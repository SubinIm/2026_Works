import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { downloaderIcon } from "./icon.mjs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
const out = join(root, "dist");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await build({
  entryPoints: {
    "background/service-worker": join(root, "src/background/service-worker.ts"),
    "content/media-observer": join(root, "src/content/media-observer.ts"),
    "popup/popup": join(root, "src/popup/popup.ts"),
    "options/options": join(root, "src/options/options.ts")
  }, bundle: true, outdir: out, format: "iife", target: "chrome120", sourcemap: true
});
await cp(join(root, "public"), out, { recursive: true });
await mkdir(join(out, "icons"), { recursive: true });
await writeFile(join(out, "icons/downloader.png"), downloaderIcon());
await cp(join(root, "src/popup/popup.html"), join(out, "popup/popup.html"));
await cp(join(root, "src/popup/popup.css"), join(out, "popup/popup.css"));
await cp(join(root, "src/options/options.html"), join(out, "options/options.html"));
await cp(join(root, "src/options/options.css"), join(out, "options/options.css"));
console.log(`Extension built: ${out}`);
