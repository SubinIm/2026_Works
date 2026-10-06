import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const vendor = join(root, "player", "vendor");
await mkdir(vendor, { recursive: true });
await copyFile(join(root, "node_modules", "hls.js", "dist", "hls.min.js"), join(vendor, "hls.min.js"));
await copyFile(join(root, "node_modules", "dashjs", "dist", "modern", "umd", "dash.all.min.js"), join(vendor, "dash.all.min.js"));
console.log(`Fixture player vendor assets: ${vendor}`);
