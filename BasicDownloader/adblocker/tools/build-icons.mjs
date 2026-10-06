// Development-only: render the editable SVG to Chrome's required PNG sizes.
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const runtime = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(runtime ? pathToFileURL(runtime).href : 'playwright');
const directory = new URL('../icons/', import.meta.url);
await mkdir(directory, { recursive: true });
const svg = await readFile(new URL('mark.svg', directory), 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: fileURLToPath(new URL(`icon-${size}.png`, directory)), omitBackground: true });
    await page.close();
  }
} finally { await browser.close(); }
