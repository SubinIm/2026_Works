import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { normalizePreferences } from "../src/shared/preferences.ts";

test("options place default filename first and load/save filename and automatic Probe", async () => {
  const html = readFileSync(new URL("../src/options/options.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('id="default-filename"') < html.indexOf('id="root"'));
  const fields = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], { value: "", checked: false, textContent: "", onclick: undefined as undefined | (() => Promise<void>) }]));
  let preferences = normalizePreferences({ defaultFilename: "Original", autoProbe: false });
  const requests: any[] = [];
  const settings = { downloadRoot: "C:\\Downloads", ffmpegPath: "C:\\ffmpeg.exe" };
  const code = buildSync({ entryPoints: [fileURLToPath(new URL("../src/options/options.ts", import.meta.url))], bundle: true, write: false, format: "iife" }).outputFiles[0].text;
  runInNewContext(code, {
    document: { getElementById: (id: string) => fields.get(id) },
    chrome: {
      storage: { local: { get: async () => ({ settings }), set: async () => {} } },
      runtime: { sendMessage: async (request: any) => {
        requests.push(request);
        if (request.type === "save_preferences") preferences = normalizePreferences({ ...preferences, ...request.preferences });
        return { ok: true, preferences };
      } },
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fields.get("default-filename")!.value, "Original");
  assert.equal(fields.get("auto-probe")!.checked, false);
  fields.get("default-filename")!.value = "My clip";
  fields.get("auto-probe")!.checked = true;
  fields.get("batch-probe")!.checked = true;
  fields.get("download-after-probe")!.checked = true;
  await fields.get("save")!.onclick!();
  assert.equal(preferences.defaultFilename, "My clip");
  assert.equal(preferences.autoProbe, true);
  assert.equal(preferences.batchProbe, true);
  assert.equal(preferences.downloadAfterProbe, true);
  assert.equal(requests.at(-1).type, "save_preferences");
  assert.match(fields.get("status")!.textContent, /저장했습니다/);
});
