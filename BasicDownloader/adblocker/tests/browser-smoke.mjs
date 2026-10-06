// Optional real-browser integration check. Pass Playwright's index.mjs and an
// extension-capable Chromium executable (Edge or Chrome for Testing).
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const playwrightPath = process.argv[2];
const executablePath = process.argv[3];
if (!playwrightPath || !executablePath) throw new Error("Usage: node tests/browser-smoke.mjs <playwright/index.mjs> <browser.exe>; start fixtures/server.mjs first");
const { chromium } = await import(pathToFileURL(resolve(playwrightPath)).href);
const extension = fileURLToPath(new URL("..", import.meta.url));
const resultsDir = join(extension, "test-results");
await mkdir(resultsDir, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "basic-banner-browser-"));
const context = await chromium.launchPersistentContext(profile, {
  executablePath, headless: true, viewport: { width: 1280, height: 960 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
    "--host-resolver-rules=MAP pagead2.googlesyndication.com 127.0.0.1", "--no-proxy-server"]
});
const errors = [];
context.on("weberror", error => errors.push(error.error().message));
const page = await context.newPage();
const fixture = process.env.FIXTURE_URL || "http://127.0.0.1:8766/";

async function waitFor(check, label) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error(`Timeout: ${label}`);
}

try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 15000 });
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => {
    globalThis.testFrameIds = {};
    chrome.runtime.onMessage.addListener((_message, sender) => {
      if (sender.tab && sender.url) globalThis.testFrameIds[`${sender.tab.id}:${sender.url}`] = sender.frameId;
    });
  });
  await page.goto(fixture);
  await waitFor(() => page.locator("ins.adsbygoogle").isHidden(), "automatic banner hidden");
  assert.equal(await page.locator("#normal-story").isVisible(), true);
  assert.equal(await page.locator("#normal-video").isVisible(), true);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, fixture);

  // A real trusted right-click records the target; send the same frame message
  // that the native contextMenus callback sends (the callback is unit-tested).
  async function pick(selector, target = page, frameId = 0) {
    await target.locator(selector).click({ button: "right", position: { x: 8, y: 8 } });
    const response = await worker.evaluate(async ({ tabId, frameId }) =>
      chrome.tabs.sendMessage(tabId, { type: "PICK_ELEMENT" }, { frameId }), { tabId, frameId });
    assert.equal(response.ok, true, response.error);
  }
  await pick("#partner-panel");
  await page.keyboard.press("Enter"); // Initially focused preview button.
  assert.equal(await page.locator("#partner-panel").isHidden(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#partner-panel").isVisible(), true);
  assert.equal((await worker.evaluate(async () => (await chrome.storage.local.get("adblockState")).adblockState.customRules)).length, 0);
  await pick("#partner-panel");
  await page.screenshot({ path: join(resultsDir, "picker.png") });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter"); // Save.
  await waitFor(() => page.locator("#partner-panel").isHidden(), "manual save hidden");
  assert.equal(await page.locator("#manual-sibling").isVisible(), true);
  await page.reload();
  await waitFor(() => page.locator("#partner-panel").isHidden(), "saved rule survives reload");

  // This extension tab supplies the active-page ID normally supplied by Chrome's
  // action popup; all messages/storage/network calls still use the installed extension.
  const popup = await context.newPage();
  await popup.addInitScript(({ tabId, fixture }) => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = info => info.active ? Promise.resolve([{ id: tabId, url: fixture }]) : query(info);
  }, { tabId, fixture });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await waitFor(async () => (await popup.locator("#rule-count").innerText()) === "1", "popup loads stored rule");
  const diagnostics = await popup.evaluate(tabId => chrome.runtime.sendMessage({ type: "GET_DIAGNOSTICS", tabId }), tabId);
  assert.equal(diagnostics.diagnostics.menuReady, true);
  assert.equal(diagnostics.diagnostics.networkEnabled, true);
  assert.equal(diagnostics.diagnostics.contentReady, true);
  assert.equal(diagnostics.diagnostics.autoHiddenCount, 2);
  await waitFor(async () => (await popup.locator("#auto-hidden-count").innerText()) === "2개", "popup shows actual automatic hide count");
  assert.equal(await popup.locator("#content-status").innerText(), "연결됨");
  assert.equal(await popup.locator("#start-picker").isEnabled(), true);
  await popup.setViewportSize({ width: 400, height: 700 });
  await popup.screenshot({ path: join(resultsDir, "popup.png"), fullPage: true, animations: "disabled" });
  await popup.getByRole("button", { name: /복원$/ }).filter({ hasText: /^복원$/ }).click();
  await waitFor(() => page.locator("#partner-panel").isVisible(), "popup restore updates existing page");

  const networkMatches = await worker.evaluate(async () => {
    const test = (url, type = "script") => chrome.declarativeNetRequest.testMatchOutcome({ url, type, initiator: "https://example.com" });
    return { ad: await test("https://pagead2.googlesyndication.com/banner.js"),
      normal: await test("https://example.com/article.js"),
      media: await test("https://pagead2.googlesyndication.com/video.mp4", "media") };
  });
  assert.ok(networkMatches.ad.matchedRules.some(rule => rule.rulesetId === "banner_ads"));
  assert.deepEqual(networkMatches.normal.matchedRules, []);
  assert.deepEqual(networkMatches.media.matchedRules, []);
  // Browser DNS maps this domain to the loopback fixture; no live ad server is used.
  async function probeAdImage() {
    return page.evaluate(port => new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve("loaded");
      img.onerror = () => resolve("blocked");
      img.src = `http://pagead2.googlesyndication.com:${port}/sample.svg?probe=${Date.now()}`;
    }), new URL(fixture).port);
  }
  assert.equal(await probeAdImage(), "blocked");
  await popup.locator("#site-toggle").click();
  await waitFor(() => page.locator("ins.adsbygoogle").isVisible(), "site pause restores cosmetic rules");
  await page.reload();
  assert.equal(await probeAdImage(), "loaded", "paused top site permits its frame tree's actual requests");
  const pauseRules = await worker.evaluate(() => chrome.declarativeNetRequest.getDynamicRules());
  assert.equal(pauseRules[0].action.type, "allowAllRequests");
  await popup.locator("#site-toggle").click();
  await waitFor(() => page.locator("ins.adsbygoogle").isHidden(), "site resumes cosmetics");
  await page.reload();
  assert.equal(await probeAdImage(), "blocked", "resumed site blocks new ad requests again");
  await popup.locator("#global-toggle").click();
  await waitFor(() => page.locator("ins.adsbygoogle").isVisible(), "global disable restores cosmetics");
  assert.equal(await probeAdImage(), "loaded", "global off permits actual ad requests");
  const off = await worker.evaluate(() => chrome.declarativeNetRequest.testMatchOutcome({
    url: "https://pagead2.googlesyndication.com/banner.js", type: "script", initiator: "https://example.com"
  }));
  assert.ok(off.matchedRules.some(rule => rule.rulesetId === "_dynamic" && rule.ruleId === 1));
  await popup.locator("#global-toggle").click();
  await waitFor(() => page.locator("ins.adsbygoogle").isHidden(), "global re-enable restores rules");

  await page.bringToFront();
  await waitFor(() => page.locator("#returning-partner-panel").isVisible(), "dynamic card exists");
  await pick("#returning-partner-panel");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitFor(() => page.locator("#returning-partner-panel").isHidden(), "dynamic card saved");
  await page.locator("#insert-partner").click();
  await waitFor(() => page.locator("#returning-partner-panel").isHidden(), "reinserted card hidden");
  assert.equal(await page.locator("#dynamic-sibling").isVisible(), true);

  const sameFrame = page.frames().find(frame => frame.url().includes("label=same-host"));
  const otherFrame = page.frames().find(frame => frame.url().includes("label=alternate-host"));
  assert.ok(sameFrame && otherFrame);
  const frameId = await worker.evaluate(key => globalThis.testFrameIds[key], `${tabId}:${sameFrame.url()}`);
  assert.ok(Number.isInteger(frameId) && frameId > 0);
  await pick("#frame-partner-panel", sameFrame, frameId);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitFor(() => sameFrame.locator("#frame-partner-panel").isHidden(), "selected iframe banner hides");
  assert.equal(await otherFrame.locator("#frame-partner-panel").isVisible(), true);
  assert.equal(await sameFrame.locator("#frame-normal-content").isVisible(), true);
  const otherSite = await context.newPage();
  await otherSite.goto(fixture.replace("127.0.0.1", "localhost"));
  const otherSameHostFrame = otherSite.frames().find(frame => frame.url().includes("label=alternate-host"));
  assert.equal(await otherSameHostFrame.locator("#frame-partner-panel").isVisible(), true,
    "same frame hostname under a different top site does not inherit a manual rule");

  await page.bringToFront();
  const blank = page.frames().find(frame => frame.url() === "about:blank" && frame !== page.mainFrame());
  const srcdoc = page.frames().find(frame => frame.url() === "about:srcdoc");
  assert.ok(blank && srcdoc, "both no-src and srcdoc frames exist");
  for (const [target, selector] of [[blank, "#blank-partner"], [srcdoc, "#srcdoc-partner"]]) {
    const targetFrameId = await worker.evaluate(key => globalThis.testFrameIds[key], `${tabId}:${target.url()}`);
    assert.ok(Number.isInteger(targetFrameId), `content script reached ${target.url()}`);
    await pick(selector, target, targetFrameId);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await waitFor(() => target.locator(selector).isHidden(), `saved rule applies in ${target.url()}`);
  }

  // This request calls back into GET_CONTEXT while the background waits for it.
  const start = await popup.evaluate(tabId => chrome.runtime.sendMessage({ type: "START_PICKER", tabId }), tabId);
  assert.equal(start.ok, true);
  await page.locator("#partner-panel").click({ position: { x: 8, y: 8 } });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await waitFor(() => page.locator("#partner-panel").isHidden(), "popup-driven click selection saves");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, browser: await context.browser()?.version(), extensionId: id,
    checks: ["real MV3 load", "automatic banners", "right-click target", "preview/cancel", "save/reload", "popup restore",
      "DNR ad/normal/media matching", "actual loopback request blocking/allowing", "site/global toggles", "dynamic reinsertion",
      "iframe right-click and host isolation", "top-site rule isolation", "page diagnostics",
      "about:blank/srcdoc selection", "popup selection without right-click"], screenshots: resultsDir, profile }, null, 2));
} finally {
  await context.close();
}
