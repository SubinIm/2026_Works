import test from "node:test";
import assert from "node:assert/strict";

const listeners = {};
const data = {};
let dynamicRules = [];
let rejectNetwork = false;
let registeredScripts = [];
let rejectScripts = false;
let rejectStorage = false;
let enabledRulesets = ["banner_ads", "public_ads"];
let rejectStatic = false;
let rejectPublicEnable = false;
let rejectRulesetRead = false;
let rejectMetadata = false;
let cosmeticLoads = 0;
const publicMetadata = { schemaVersion: 1, filterVersion: "fixture-v1", generatedAt: "2026-10-05T00:00:00Z",
  sources: [{ id: "easylist", name: "EasyList", url: "https://example.test/easylist.txt", sourceVersion: "v1", license: "GPL-3.0" }],
  network: { ruleCount: 3, maxPriority: 3 }, cosmetic: { selectorCount: 2 } };
globalThis.fetch = async url => {
  if (url === "chrome-extension://fixture-extension/filters/manifest.json") {
    if (rejectMetadata) throw new Error("metadata missing");
    return { ok: true, async json() { return structuredClone(publicMetadata); } };
  }
  if (url === "chrome-extension://fixture-extension/filters/cosmetic.json") {
    cosmeticLoads++;
    return { ok: true, async json() { return { version: 1, generic: [{ selector: ".public-ad", exclude: [] }],
      hosts: { "frame.test": [{ selector: "#frame-ad", exclude: [] }], "spoof.test": [{ selector: "#spoof-ad", exclude: [] }] },
      exceptions: { generic: [], hosts: {} }, exemptions: { generic: [], hosts: {} } }; } };
  }
  throw new Error(`Unexpected fixture fetch: ${url}`);
};
const menuCalls = [];
const createdMenus = [];
let pageStatus = null;
let relayHandler = null;
let storageHook = null;
const event = name => ({ addListener(callback) { listeners[name] = callback; } });
globalThis.chrome = {
  scripting: {
    async getRegisteredContentScripts({ ids } = {}) { return structuredClone(registeredScripts.filter(s => !ids || ids.includes(s.id))); },
    async registerContentScripts(scripts) {
      if (rejectScripts) throw new Error('script registration failed');
      if (scripts.some(s => registeredScripts.some(old => old.id === s.id))) throw new Error('duplicate script ID');
      registeredScripts.push(...structuredClone(scripts));
    },
    async updateContentScripts(scripts) {
      if (rejectScripts) throw new Error('script registration failed');
      for (const script of scripts) {
        const index = registeredScripts.findIndex(old => old.id === script.id);
        if (index < 0) throw new Error('unknown script ID');
        registeredScripts[index] = structuredClone(script);
      }
    },
    async unregisterContentScripts({ ids } = {}) {
      if (rejectScripts) throw new Error('script registration failed');
      registeredScripts = registeredScripts.filter(s => ids && !ids.includes(s.id));
    },
  },
  runtime: { id: "fixture-extension", getURL: path => `chrome-extension://fixture-extension/${path}`,
    onMessage: event("message"), onInstalled: event("install"), onStartup: event("startup") },
  storage: { local: {
    async get(key) { return { [key]: structuredClone(data[key]) }; },
    async set(value) {
      if (rejectStorage) { rejectStorage = false; throw new Error("storage unavailable"); }
      if (storageHook) await storageHook(value);
      Object.assign(data, structuredClone(value));
    }
  } },
  declarativeNetRequest: {
    async getEnabledRulesets() { if (rejectRulesetRead) throw new Error("ruleset state unavailable"); return [...enabledRulesets]; },
    async updateEnabledRulesets({ enableRulesetIds = [], disableRulesetIds = [] }) {
      if (rejectStatic || (rejectPublicEnable && enableRulesetIds.includes("public_ads"))) throw new Error("static rule quota unavailable");
      enabledRulesets = [...new Set([...enabledRulesets.filter(id => !disableRulesetIds.includes(id)), ...enableRulesetIds])];
    },
    async getDynamicRules() { return structuredClone(dynamicRules); },
    async updateDynamicRules({ addRules }) {
      if (rejectNetwork) throw new Error("network rules unavailable");
      dynamicRules = structuredClone(addRules);
    }
  },
  tabs: { async get() { return { url: "https://one.test/page" }; },
    async sendMessage(...args) {
      menuCalls.push(args);
      if (["FRAME_PICKER_EVENT", "FRAME_PICKER_COMMAND"].includes(args[1].type) && relayHandler) return relayHandler(...args);
      if (args[1].type === "GET_PAGE_STATUS") {
        if (!pageStatus) throw new Error("No receiving end");
        return pageStatus;
      }
      if (args[1].type === "START_PICKER") {
        const context = await new Promise(resolve => listeners.message({ type: "GET_CONTEXT" }, frame(), resolve));
        return { ok: context.enabled };
      }
      return { ok: true };
    } },
  contextMenus: { onClicked: event("menu"), async removeAll() {}, create(options, callback) { createdMenus.push(options); callback(); } },
  action: { async setBadgeText() {}, async setBadgeBackgroundColor() {}, async setTitle() {} }
};
await import("../background.js");
const popup = { id: chrome.runtime.id, url: chrome.runtime.getURL("popup.html") };
const options = { id: chrome.runtime.id, url: chrome.runtime.getURL("options.html") };
const frame = (site = "one.test", frameHost = "frame.test") => ({
  id: chrome.runtime.id, tab: { id: 4, url: `https://${site}/page` }, url: `https://${frameHost}/content`, frameId: 9
});
const message = (payload, sender = popup) => new Promise(resolve => listeners.message(payload, sender, resolve));
const reset = () => {
  registeredScripts = []; rejectScripts = false;
  delete data.adblockState; dynamicRules = []; rejectNetwork = false; rejectStorage = false; pageStatus = null; relayHandler = null; storageHook = null;
  enabledRulesets = ["banner_ads", "public_ads"]; rejectStatic = false; rejectPublicEnable = false; rejectRulesetRead = false; rejectMetadata = false;
};

test("concurrent saves do not overwrite one another and duplicate save is idempotent", async () => {
  reset();
  const results = await Promise.all([
    message({ type: "ADD_RULE", selector: "#first", label: "첫 광고", site: "spoof.test" }, frame()),
    message({ type: "ADD_RULE", selector: "#second", label: "둘째 광고" }, frame())
  ]);
  assert.ok(results.every(result => result.ok));
  assert.equal(data.adblockState.customRules.length, 2);
  assert.ok(data.adblockState.customRules.every(rule => rule.site === "one.test"));
  const duplicate = await message({ type: "ADD_RULE", selector: "#first" }, frame());
  assert.equal(duplicate.rule.id, results[0].rule.id);
  assert.equal(data.adblockState.customRules.length, 2);
});

test("picker actions validate before saving or routing and switching action has a reversible transaction", async () => {
  reset();
  for (const action of [null, "remove", false]) {
    assert.equal((await message({ type: "ADD_RULE", selector: "#ad", action }, frame())).ok, false);
    assert.equal((await message({ type: "START_PICKER", tabId: 4, action })).ok, false);
  }
  assert.equal((await message({ type: "START_PICKER", tabId: 4, action: "move" })).ok, true);
  assert.deepEqual(menuCalls.at(-1), [4, { type: "START_PICKER", action: "move" }, { frameId: 0 }]);
  const hidden = await message({ type: "ADD_RULE", selector: "#ad" }, frame());
  assert.equal(hidden.rule.action, "hide");
  const moved = await message({ type: "ADD_RULE", selector: "#ad", action: "move" }, frame());
  assert.equal(moved.rule.action, "move");
  assert.equal(moved.rule.id, hidden.rule.id);
  assert.equal(data.adblockState.customRules.length, 1);
  const duplicate = await message({ type: "ADD_RULE", selector: "#ad", action: "move" }, frame());
  assert.equal(duplicate.undoToken, null);
  assert.equal((await message({ type: "UNDO_RULE", undoToken: hidden.undoToken }, frame())).ok, false, "earlier hide undo is stale after a mode change");
  assert.equal((await message({ type: "UNDO_RULE", undoToken: moved.undoToken }, frame())).ok, true);
  assert.deepEqual(data.adblockState.customRules, [hidden.rule]);
  assert.equal((await message({ type: "UNDO_RULE", undoToken: moved.undoToken }, frame())).ok, false);
});

test("new-rule undo is sender scoped and reactivation undo restores a paused rule", async () => {
  reset();
  const source = { ...frame(), documentId: "source-document" };
  const saved = await message({ type: "ADD_RULE", selector: "#ad", action: "move" }, source);
  assert.equal(typeof saved.undoToken, "string");
  for (const sender of [options, { ...source, frameId: 0 }, { ...source, documentId: "replacement" },
    { ...source, tab: { ...source.tab, id: 8 } }, { ...source, url: "https://other.test" }, frame("other.test")]) {
    assert.equal((await message({ type: "UNDO_RULE", undoToken: saved.undoToken }, sender)).ok, false);
  }
  assert.equal((await message({ type: "UNDO_RULE", undoToken: saved.undoToken }, source)).ok, true);
  assert.equal(data.adblockState.customRules.length, 0);
  const paused = await message({ type: "ADD_RULE", selector: "#paused", action: "move" }, source);
  await message({ type: "SET_RULE_ENABLED", id: paused.rule.id, enabled: false }, options);
  const before = structuredClone(data.adblockState.customRules[0]);
  const reactivated = await message({ type: "ADD_RULE", selector: "#paused", action: "hide" }, source);
  assert.equal(reactivated.rule.enabled, true);
  assert.equal((await message({ type: "UNDO_RULE", undoToken: reactivated.undoToken }, source)).ok, true);
  assert.deepEqual(data.adblockState.customRules, [before]);
});

test("undo rejects later edits even if toggled back, expires, and retries safely after failed storage", async () => {
  reset();
  const saved = await message({ type: "ADD_RULE", selector: "#ad", action: "move" }, frame());
  await message({ type: "SET_RULE_ENABLED", id: saved.rule.id, enabled: false }, options);
  await message({ type: "SET_RULE_ENABLED", id: saved.rule.id, enabled: true }, options);
  assert.equal((await message({ type: "UNDO_RULE", undoToken: saved.undoToken }, frame())).ok, false);
  const fresh = await message({ type: "ADD_RULE", selector: "#fresh", action: "move" }, frame());
  rejectStorage = true;
  assert.equal((await message({ type: "UNDO_RULE", undoToken: fresh.undoToken }, frame())).ok, false);
  assert.equal(data.adblockState.customRules.length, 2);
  assert.equal((await message({ type: "UNDO_RULE", undoToken: fresh.undoToken }, frame())).ok, true);
  const expiring = await message({ type: "ADD_RULE", selector: "#expires" }, frame());
  const originalNow = Date.now;
  Date.now = () => originalNow() + 60_001;
  try { assert.equal((await message({ type: "UNDO_RULE", undoToken: expiring.undoToken }, frame())).ok, false); }
  finally { Date.now = originalNow; }
  assert.ok(data.adblockState.customRules.some(rule => rule.id === expiring.rule.id));
});

test("content scripts cannot alter global settings or other sites' rules", async () => {
  reset();
  const saved = await message({ type: "ADD_RULE", selector: "#ad" }, frame());
  assert.equal((await message({ type: "SET_ENABLED", enabled: false }, frame())).ok, false);
  assert.equal((await message({ type: "DELETE_RULE", id: saved.rule.id }, frame("other.test"))).ok, false);
  assert.equal((await message({ type: "GET_STATE", tabId: 4 }, frame())).ok, false);
  assert.equal((await message({ type: "DELETE_RULE", id: saved.rule.id }, frame())).ok, true);
  assert.equal(data.adblockState.customRules.length, 0);
});

test("site/global toggles change network policy and context without deleting saved rules", async () => {
  reset();
  await message({ type: "ADD_RULE", selector: "#ad" }, frame());
  await message({ type: "SET_SITE_ENABLED", site: "one.test", enabled: false });
  assert.equal((await message({ type: "GET_CONTEXT" }, frame())).enabled, false);
  assert.equal(dynamicRules[0].action.type, "allowAllRequests");
  await message({ type: "SET_SITE_ENABLED", site: "one.test", enabled: true });
  assert.equal((await message({ type: "GET_CONTEXT" }, frame())).enabled, true);
  await message({ type: "SET_ENABLED", enabled: false });
  assert.equal(dynamicRules[0].id, 1);
  assert.equal(data.adblockState.customRules.length, 1);
  assert.equal((await message({ type: "ADD_RULE", selector: "#another" }, frame())).ok, false);
});

test("failed network update leaves stored setting intact and storage failure rolls back rules", async () => {
  reset();
  await message({ type: "SET_ENABLED", enabled: true });
  rejectNetwork = true;
  assert.equal((await message({ type: "SET_ENABLED", enabled: false })).ok, false);
  assert.equal(data.adblockState.enabled, true);
  rejectNetwork = false;
  rejectStorage = true;
  assert.equal((await message({ type: "SET_ENABLED", enabled: false })).ok, false);
  assert.equal(data.adblockState.enabled, true);
  assert.deepEqual(dynamicRules, []);
});

test("clear-site restores only that top site's saved elements", async () => {
  reset();
  await message({ type: "ADD_RULE", selector: "#ad" }, frame());
  await message({ type: "ADD_RULE", selector: "#ad" }, frame("two.test"));
  await message({ type: "CLEAR_SITE_RULES", site: "one.test" });
  assert.deepEqual(data.adblockState.customRules.map(rule => rule.site), ["two.test"]);
});

test("context menu targets the frame that was actually right-clicked", async () => {
  listeners.menu({ menuItemId: "basic-banner-blocker-hide", frameId: 9 }, { id: 4 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(menuCalls.at(-1), [4, { type: "PICK_ELEMENT", action: "hide" }, { frameId: 9 }]);
  listeners.menu({ menuItemId: "basic-banner-blocker-move", frameId: 3 }, { id: 4 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(menuCalls.at(-1), [4, { type: "PICK_ELEMENT", action: "move" }, { frameId: 3 }]);
});

test("menu registers independently even when network initialization fails and allows blank frames", async () => {
  reset();
  const before = createdMenus.length;
  rejectNetwork = true;
  await listeners.install();
  rejectNetwork = false;
  assert.ok(createdMenus.length > before);
  assert.deepEqual(createdMenus.slice(-2).map(menu => [menu.id, menu.title]), [
    ["basic-banner-blocker-hide", "이 요소 숨기기…"], ["basic-banner-blocker-move", "이 요소 이동시키기…"]
  ]);
  assert.equal(createdMenus.at(-1).documentUrlPatterns, undefined);
});

test("about:blank and srcdoc rules derive their host from the trusted inherited origin", async () => {
  reset();
  const sender = { ...frame(), url: "about:blank", origin: "https://frame.test" };
  const saved = await message({ type: "ADD_RULE", selector: "#blank-ad", frameHost: "spoof.test" }, sender);
  assert.equal(saved.ok, true);
  assert.equal(saved.rule.frameHost, "frame.test");
  const context = await message({ type: "GET_CONTEXT" }, { ...sender, url: "about:srcdoc" });
  assert.equal(context.rules[0].id, saved.rule.id);
  assert.equal((await message({ type: "GET_CONTEXT" }, { ...sender, origin: "null" })).ok, false);
});

test("diagnostics distinguish disconnected content from a genuine zero and keep manual rules separate", async () => {
  reset();
  let result = await message({ type: "GET_DIAGNOSTICS", tabId: 4 });
  assert.equal(result.diagnostics.networkEnabled, true);
  assert.equal(result.diagnostics.menuReady, true);
  assert.equal(result.diagnostics.contentReady, false);
  assert.equal(result.diagnostics.autoHiddenCount, null);
  pageStatus = { ok: true, autoHiddenCount: 3, manualHiddenCount: 0 };
  result = await message({ type: "GET_DIAGNOSTICS", tabId: 4 });
  assert.equal(result.diagnostics.contentReady, true);
  assert.equal(result.diagnostics.autoHiddenCount, 3);
  assert.equal((await message({ type: "GET_STATE", tabId: 4 })).state.customRules.length, 0);
});

test("popup picker can request page context without deadlocking the background write queue", { timeout: 1500 }, async () => {
  reset();
  const result = await message({ type: "START_PICKER", tabId: 4 });
  assert.equal(result.ok, true);
});

test("only the extension sidepanel document receives settings privileges", async () => {
  reset();
  const panel = { id: chrome.runtime.id, url: chrome.runtime.getURL("sidepanel.html") };
  assert.equal((await message({ type: "GET_STATE", tabId: 4 }, panel)).ok, true);
  assert.equal((await message({ type: "SET_ENABLED", enabled: false }, panel)).ok, true);
  assert.equal(data.adblockState.enabled, false);
  assert.equal((await message({ type: "SET_ENABLED", enabled: true }, { ...panel, url: 'https://news.test/sidepanel.html' })).ok, false);
  assert.equal(data.adblockState.enabled, false);
});

test("options can manage rules without a tab but content cannot toggle rules, edit requests or import", async () => {
  reset();
  const saved = await message({ type: "ADD_RULE", selector: "#ad" }, frame());
  assert.equal((await message({ type: "GET_STATE" }, options)).site, null);
  assert.equal((await message({ type: "SET_RULE_ENABLED", id: saved.rule.id, enabled: false }, options)).ok, true);
  assert.equal((await message({ type: "GET_CONTEXT" }, frame())).rules.length, 0);
  assert.equal(data.adblockState.customRules.length, 1);
  const payloads = [
    { type: "SET_RULE_ENABLED", id: saved.rule.id, enabled: true },
    { type: "ADD_NETWORK_RULE", domain: "ads.example", site: null },
    { type: "SET_NETWORK_RULE_ENABLED", id: "any", enabled: true },
    { type: "DELETE_NETWORK_RULE", id: "any" },
    { type: "PREVIEW_IMPORT_BACKUP", backup: {} }, { type: "IMPORT_BACKUP", backup: {} }
  ];
  for (const payload of payloads) assert.equal((await message(payload, frame())).ok, false, payload.type);
  assert.equal((await message({ type: "GET_STATE" }, { ...options, id: "other-extension" })).ok, false);
  assert.equal((await message({ type: "GET_STATE" }, { ...options, url: "https://evil.test/options.html" })).ok, false);
  assert.deepEqual(data.adblockState.networkRules, []);
});

test("explicitly saving a paused cosmetic or request rule reactivates it without creating a duplicate", async () => {
  reset();
  const cosmetic = await message({ type: "ADD_RULE", selector: "#ad" }, frame());
  await message({ type: "SET_RULE_ENABLED", id: cosmetic.rule.id, enabled: false }, options);
  const savedAgain = await message({ type: "ADD_RULE", selector: "#ad" }, frame());
  assert.equal(savedAgain.rule.id, cosmetic.rule.id);
  assert.equal(savedAgain.rule.enabled, true);
  assert.equal((await message({ type: "GET_CONTEXT" }, frame())).rules.length, 1);
  const network = await message({ type: "ADD_NETWORK_RULE", domain: " ADS.Example ", site: "one.test" }, options);
  assert.equal(network.ok, true);
  assert.equal(network.rule.domain, "ads.example");
  assert.deepEqual(dynamicRules[0].condition.initiatorDomains, ["one.test"]);
  await message({ type: "SET_NETWORK_RULE_ENABLED", id: network.rule.id, enabled: false }, options);
  assert.deepEqual(dynamicRules, []);
  const enabledAgain = await message({ type: "ADD_NETWORK_RULE", domain: "ads.example", site: "one.test" }, options);
  assert.equal(enabledAgain.rule.id, network.rule.id);
  assert.equal(enabledAgain.rule.enabled, true);
  assert.equal(dynamicRules.length, 1);
  assert.equal(data.adblockState.networkRules.length, 1);
});

test("request rule mutations roll back on DNR or storage failure and site exceptions outrank them", async () => {
  reset();
  await message({ type: "SET_ENABLED", enabled: true });
  rejectNetwork = true;
  assert.equal((await message({ type: "ADD_NETWORK_RULE", domain: "ads.example", site: null }, options)).ok, false);
  assert.deepEqual(data.adblockState.networkRules, []);
  rejectNetwork = false;
  rejectStorage = true;
  assert.equal((await message({ type: "ADD_NETWORK_RULE", domain: "ads.example", site: null }, options)).ok, false);
  assert.deepEqual(data.adblockState.networkRules, []);
  assert.deepEqual(dynamicRules, []);
  const saved = await message({ type: "ADD_NETWORK_RULE", domain: "ads.example", site: null }, options);
  assert.equal(saved.ok, true);
  await message({ type: "SET_SITE_ENABLED", site: "one.test", enabled: false }, options);
  assert.deepEqual(dynamicRules.map(rule => rule.action.type), ["allowAllRequests", "block"]);
  assert.ok(dynamicRules[0].priority > dynamicRules[1].priority);
  const before = structuredClone(dynamicRules);
  rejectStorage = true;
  assert.equal((await message({ type: "DELETE_NETWORK_RULE", id: saved.rule.id }, options)).ok, false);
  assert.deepEqual(dynamicRules, before);
  assert.equal(data.adblockState.networkRules.length, 1);
  await message({ type: "SET_ENABLED", enabled: false }, options);
  assert.equal(dynamicRules.length, 1);
  assert.equal(dynamicRules[0].action.type, "allow");
  assert.equal(data.adblockState.networkRules.length, 1);
});

test("backup preview never mutates and import is revalidated and rolled back as one operation", async () => {
  reset();
  await message({ type: "SET_ENABLED", enabled: false }, options);
  const backup = { format: "basic-banner-blocker-rules", version: 1,
    customRules: [{ id: "imported", site: "one.test", frameHost: "frame.test", selector: "#imported", enabled: false }],
    networkRules: [{ id: "request", domain: "ads.example", site: null, enabled: true }], disabledSites: ["paused.test"] };
  const before = structuredClone(data.adblockState);
  const preview = await message({ type: "PREVIEW_IMPORT_BACKUP", backup }, options);
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.preview.added, { customRules: 1, networkRules: 1, disabledSites: 1 });
  assert.deepEqual(data.adblockState, before);
  rejectStorage = true;
  assert.equal((await message({ type: "IMPORT_BACKUP", backup }, options)).ok, false);
  assert.deepEqual(data.adblockState, before);
  assert.equal(dynamicRules[0].action.type, "allow");
  assert.equal((await message({ type: "IMPORT_BACKUP", backup: { ...backup, customRules: [...backup.customRules, null] } }, options)).ok, false);
  assert.deepEqual(data.adblockState, before);
  const imported = await message({ type: "IMPORT_BACKUP", backup }, options);
  assert.equal(imported.ok, true);
  assert.equal(imported.state.enabled, false);
  assert.equal(imported.state.customRules[0].enabled, false);
  assert.equal(imported.state.networkRules.length, 1);
  assert.deepEqual(imported.state.disabledSites, ["paused.test"]);
});

const childPicker = () => ({ ...frame(), documentId: "child-document-1" });
const topPicker = () => ({ ...frame("one.test", "one.test"), frameId: 0, documentId: "top-document-1" });
const bridge = (values = {}) => ({ type: "PICKER_BRIDGE", event: "show", token: "session-token", payload: { label: "광고", canSave: true }, ...values });
const pickerCommand = (values = {}) => ({ type: "PICKER_COMMAND", frameId: 9, documentId: "child-document-1", token: "session-token", command: "preview", ...values });

test("child picker events go only to their browser-provided tab and carry trusted source identity", async () => {
  reset();
  const result = await message(bridge({ tabId: 99, sourceFrameId: 88, sourceDocumentId: "spoof-document",
    payload: { label: "광고", canSave: true, site: "spoof.test", frameHost: "spoof-frame.test" } }), childPicker());
  assert.equal(result.ok, true);
  assert.deepEqual(menuCalls.at(-1), [4, {
    type: "FRAME_PICKER_EVENT", event: "show", token: "session-token",
    payload: { label: "광고", canSave: true, site: "one.test", frameHost: "frame.test", action: "hide" },
    sourceFrameId: 9, sourceDocumentId: "child-document-1"
  }, { frameId: 0 }]);
  await message(bridge({ event: "update", payload: {} }), { ...childPicker(), url: "about:blank", origin: "https://inherited.test" });
  assert.equal(menuCalls.at(-1)[1].payload.frameHost, "inherited.test");
  await message(bridge({ event: "close", payload: undefined }), frame());
  assert.equal(menuCalls.at(-1)[1].sourceDocumentId, null);
  assert.deepEqual(menuCalls.at(-1)[1].payload, {});
});

test("top picker commands target the exact source document and never accept a payload tab or rule ID", async () => {
  reset();
  const reply = { ok: true, previewing: true };
  relayHandler = async () => reply;
  assert.deepEqual(await message(pickerCommand({ tabId: 99, ruleId: "other-rule" }), topPicker()), reply);
  assert.deepEqual(menuCalls.at(-1), [4, {
    type: "FRAME_PICKER_COMMAND", token: "session-token", command: "preview"
  }, { frameId: 9, documentId: "child-document-1" }]);
  await message(pickerCommand({ documentId: null, command: "undo" }), topPicker());
  assert.deepEqual(menuCalls.at(-1)[2], { frameId: 9 });
});

test("picker relay rejects wrong senders, directions, tokens, commands and non-view payloads", async () => {
  reset();
  const cases = [
    [bridge(), popup], [bridge(), topPicker()], [bridge(), { ...childPicker(), id: "other-extension" }],
    [bridge(), { ...childPicker(), frameId: undefined }], [bridge(), { ...childPicker(), tab: { id: 4, url: "chrome://settings" } }],
    [bridge({ event: "execute" }), childPicker()], [bridge({ token: "" }), childPicker()],
    [bridge({ token: "x".repeat(129) }), childPicker()], [bridge({ payload: { nested: {} } }), childPicker()],
    [bridge({ payload: [] }), childPicker()], [bridge({ payload: { label: "x".repeat(4097) } }), childPicker()],
    [bridge({ payload: { action: "remove" } }), childPicker()], [bridge({ payload: { action: null } }), childPicker()],
    [bridge({ payload: { undoToken: "" } }), childPicker()], [bridge({ payload: { undoToken: false } }), childPicker()],
    [pickerCommand(), childPicker()], [pickerCommand(), options], [pickerCommand({ frameId: 0 }), topPicker()],
    [pickerCommand({ frameId: -1 }), topPicker()], [pickerCommand({ documentId: 7 }), topPicker()],
    [pickerCommand({ command: "DELETE_RULE" }), topPicker()], [pickerCommand({ token: null }), topPicker()]
  ];
  const before = menuCalls.length;
  for (const [payload, sender] of cases) assert.equal((await message(payload, sender)).ok, false);
  assert.equal(menuCalls.length, before, "invalid relay requests must not reach any tab");
});

test("missing top, navigated source and missing replies return failures to the picker", async () => {
  reset();
  relayHandler = async () => { throw new Error("No receiving end"); };
  let result = await message(bridge(), childPicker());
  assert.equal(result.ok, false);
  assert.match(result.error, /새로고침/);
  result = await message(pickerCommand(), topPicker());
  assert.equal(result.ok, false);
  assert.equal(menuCalls.at(-1)[2].documentId, "child-document-1");
  relayHandler = async () => undefined;
  assert.equal((await message(bridge(), childPicker())).ok, false);
  relayHandler = async () => ({ ok: false, error: "이미 닫힌 선택 화면입니다." });
  assert.deepEqual(await message(pickerCommand(), topPicker()), { ok: false, error: "이미 닫힌 선택 화면입니다." });
});

test("relayed save can await a nested rule write, context read and bridge update without deadlock", { timeout: 1500 }, async () => {
  reset();
  relayHandler = async (_tabId, payload) => {
    if (payload.type === "FRAME_PICKER_EVENT") return { ok: true };
    assert.equal(payload.command, "save");
    const saved = await message({ type: "ADD_RULE", selector: "#from-frame", label: "프레임 광고" }, childPicker());
    assert.equal(saved.ok, true);
    const context = await message({ type: "GET_CONTEXT" }, childPicker());
    assert.equal(context.rules.length, 1);
    const update = await message(bridge({ event: "toast", payload: { message: "숨겼습니다", undoable: true } }), childPicker());
    assert.equal(update.ok, true);
    return { ok: true, saved: true };
  };
  assert.deepEqual(await message(pickerCommand({ command: "save" }), topPicker()), { ok: true, saved: true });
  assert.equal(data.adblockState.customRules[0].frameHost, "frame.test");
});

test("picker bridge bypasses an already pending mutation instead of waiting on its queue", { timeout: 1500 }, async () => {
  reset();
  let relayed = false;
  storageHook = async () => {
    const result = await message(bridge({ event: "update", payload: { saving: true } }), childPicker());
    relayed = result.ok;
  };
  const result = await message({ type: "ADD_RULE", selector: "#save-in-progress" }, childPicker());
  assert.equal(result.ok, true);
  assert.equal(relayed, true);
});

test("only trusted settings can switch the public pack while local and user rules persist", async () => {
  reset();
  const custom = await message({ type: "ADD_RULE", selector: "#ad" }, frame());
  assert.equal((await message({ type: "GET_STATE" }, options)).state.publicFiltersEnabled, true);
  assert.equal((await message({ type: "SET_PUBLIC_FILTERS_ENABLED", enabled: false }, frame())).ok, false);
  assert.equal((await message({ type: "GET_FILTER_STATUS" }, frame())).ok, false);
  assert.equal((await message({ type: "SET_PUBLIC_FILTERS_ENABLED", enabled: "false" }, options)).ok, false);
  const paused = await message({ type: "SET_PUBLIC_FILTERS_ENABLED", enabled: false }, options);
  assert.equal(paused.ok, true);
  assert.equal(paused.state.publicFiltersEnabled, false);
  assert.deepEqual(enabledRulesets, ["banner_ads"]);
  const context = await message({ type: "GET_CONTEXT" }, frame());
  assert.equal(context.enabled, true);
  assert.equal(context.publicFiltersEnabled, false);
  assert.equal(context.rules[0].id, custom.rule.id);
  await message({ type: "SET_ENABLED", enabled: false }, options);
  assert.equal((await message({ type: "SET_PUBLIC_FILTERS_ENABLED", enabled: true }, options)).ok, true);
  assert.equal(data.adblockState.enabled, false);
  assert.deepEqual(enabledRulesets, ["banner_ads", "public_ads"]);
  assert.equal(dynamicRules[0].action.type, "allow");
});

test("public toggle failures preserve storage and restore actual static and dynamic policies", async () => {
  reset();
  await message({ type: "ADD_NETWORK_RULE", domain: "ads.example", site: null }, options);
  const beforeState = structuredClone(data.adblockState);
  const beforeDynamic = structuredClone(dynamicRules);
  rejectStatic = true;
  assert.equal((await message({ type: "SET_PUBLIC_FILTERS_ENABLED", enabled: false }, options)).ok, false);
  assert.deepEqual(data.adblockState, beforeState);
  assert.deepEqual(enabledRulesets, ["banner_ads", "public_ads"]);
  rejectStatic = false;
  rejectStorage = true;
  assert.equal((await message({ type: "SET_PUBLIC_FILTERS_ENABLED", enabled: false }, options)).ok, false);
  assert.deepEqual(data.adblockState, beforeState);
  assert.deepEqual(enabledRulesets, ["banner_ads", "public_ads"]);
  assert.deepEqual(dynamicRules, beforeDynamic);
  // Retrying an unchanged requested setting is also a transaction, including
  // restoring the previously disabled actual pack after storage failure.
  enabledRulesets = ["banner_ads"];
  rejectStorage = true;
  assert.equal((await message({ type: "SET_PUBLIC_FILTERS_ENABLED", enabled: true }, options)).ok, false);
  assert.deepEqual(enabledRulesets, ["banner_ads"]);
  assert.deepEqual(data.adblockState, beforeState);
  assert.deepEqual(dynamicRules, beforeDynamic);
});

test("quota failure at startup still restores local filtering, state migration and picker/menu", async () => {
  reset();
  enabledRulesets = [];
  rejectPublicEnable = true;
  await listeners.startup();
  assert.deepEqual(enabledRulesets, ["banner_ads"]);
  assert.equal(data.adblockState.publicFiltersEnabled, true);
  assert.equal((await message({ type: "GET_CONTEXT" }, frame())).enabled, true);
  assert.equal((await message({ type: "GET_CONTEXT" }, frame())).publicFiltersEnabled, false);
  const status = (await message({ type: "GET_FILTER_STATUS" }, options)).filterStatus;
  assert.equal(status.enabled, false);
  assert.equal(status.requestedEnabled, true);
  assert.match(status.error, /quota/);
  assert.equal(status.metadata.filterVersion, "fixture-v1");
  const diagnostics = (await message({ type: "GET_DIAGNOSTICS", tabId: 4 })).diagnostics;
  assert.equal(diagnostics.networkEnabled, null);
  assert.equal(diagnostics.menuReady, true);
  assert.equal((await message({ type: "START_PICKER", tabId: 4 })).ok, true);
  rejectPublicEnable = false;
  assert.equal((await message({ type: "SET_PUBLIC_FILTERS_ENABLED", enabled: true }, options)).ok, true);
  assert.equal((await message({ type: "GET_FILTER_STATUS" }, options)).filterStatus.error, null);
});

test("public metadata and DNR status failures stay distinct from baseline content readiness", async () => {
  reset();
  rejectMetadata = true;
  const status = (await message({ type: "GET_FILTER_STATUS" }, options)).filterStatus;
  assert.equal(status.enabled, true);
  assert.equal(status.metadata, null);
  assert.match(status.error, /배포 정보/);
  assert.equal((await message({ type: "GET_CONTEXT" }, frame())).enabled, true);
  rejectRulesetRead = true;
  const context = await message({ type: "GET_CONTEXT" }, frame());
  assert.equal(context.enabled, true);
  assert.equal(context.publicFiltersEnabled, false);
  pageStatus = { ok: true, autoHiddenCount: 2, manualHiddenCount: 0, publicCosmeticsEnabled: false,
    publicSelectorCount: 18, publicCosmeticsError: "public CSS unavailable" };
  const diagnostics = (await message({ type: "GET_DIAGNOSTICS", tabId: 4 })).diagnostics;
  assert.equal(diagnostics.networkEnabled, null);
  assert.equal(diagnostics.contentReady, true);
  assert.equal(diagnostics.publicCosmeticsEnabled, false);
  assert.equal(diagnostics.publicSelectorCount, 18);
  assert.equal(diagnostics.publicCosmeticsError, "public CSS unavailable");
});

test("public cosmetics are selected once from packaged data using trusted frame context, even while disabled", async () => {
  reset();
  await message({ type: "SET_PUBLIC_FILTERS_ENABLED", enabled: false }, options);
  const before = cosmeticLoads;
  const result = await message({ type: "GET_PUBLIC_COSMETICS", frameHost: "spoof.test", url: "https://spoof.test" }, frame());
  assert.equal(result.ok, true);
  assert.deepEqual(result.selection.selectors, [".public-ad", "#frame-ad"]);
  const inherited = await message({ type: "GET_PUBLIC_COSMETICS" }, { ...frame(), url: "about:blank", origin: "https://frame.test" });
  assert.deepEqual(inherited.selection, result.selection);
  assert.equal(cosmeticLoads - before, 1);
  assert.equal((await message({ type: "GET_PUBLIC_COSMETICS" }, options)).ok, false);
});

test('privacy toggles require trusted settings and restore DNR rules on storage failure', async () => {
  reset();
  const toggle = { type: 'SET_PRIVACY_PROTECTION', setting: 'trackingProtectionEnabled', enabled: true };
  assert.equal((await message(toggle, frame())).ok, false);
  assert.equal((await message({ ...toggle, setting: '__proto__' }, options)).ok, false);
  assert.equal((await message({ ...toggle, enabled: 'true' }, options)).ok, false);
  assert.equal((await message(toggle, options)).ok, true);
  assert.ok(dynamicRules.some(rule => rule.condition.urlFilter === '||facebook.com/tr/'));
  assert.equal(dynamicRules.some(rule => rule.condition.urlFilter === '||sentry.io^'), false);
  const previous = structuredClone(dynamicRules);
  rejectStorage = true;
  assert.equal((await message({ ...toggle, setting: 'errorMonitoringBlocked' }, options)).ok, false);
  assert.deepEqual(dynamicRules, previous);
  assert.equal(data.adblockState.errorMonitoringBlocked, false);
  assert.equal((await message({ ...toggle, enabled: false }, options)).ok, true);
  assert.equal(dynamicRules.filter(rule => rule.action.type === 'block').length, 0);
});

test('settings section anchors retain trusted-page access without accepting other URLs', async () => {
  reset();
  const toggle = { type: 'SET_PRIVACY_PROTECTION', setting: 'trackingProtectionEnabled', enabled: true };
  assert.equal((await message(toggle, { ...options, url: `${options.url}#privacy-heading` })).ok, true);
  assert.equal((await message(toggle, { ...options, url: `${options.url}.evil#privacy-heading` })).ok, false);
  assert.equal((await message(toggle, { ...options, url: 'https://example.test/options.html#privacy-heading' })).ok, false);
});

test('video and fingerprint toggles are independent and failed script/storage writes roll back', async () => {
  reset();
  const toggle = setting => ({ type: 'SET_PRIVACY_PROTECTION', setting, enabled: true });
  assert.equal((await message(toggle('fingerprintProtectionEnabled'), frame())).ok, false);
  assert.equal((await message(toggle('videoAdBlockingEnabled'), options)).ok, true);
  assert.ok(dynamicRules.some(rule => rule.id === 22000));
  assert.equal(registeredScripts.length, 0);
  rejectScripts = true;
  assert.equal((await message(toggle('fingerprintProtectionEnabled'), options)).ok, false);
  assert.equal(data.adblockState.fingerprintProtectionEnabled, false);
  rejectScripts = false;
  rejectStorage = true;
  assert.equal((await message(toggle('fingerprintProtectionEnabled'), options)).ok, false);
  assert.equal(registeredScripts.length, 0);
  assert.equal((await message(toggle('fingerprintProtectionEnabled'), options)).ok, true);
  assert.equal(registeredScripts[0].world, 'MAIN');
  assert.equal(registeredScripts[0].runAt, 'document_start');
  await message({ type: 'SET_SITE_ENABLED', site: 'one.test', enabled: false }, options);
  assert.ok(registeredScripts[0].excludeMatches.includes('*://*.one.test/*'));
  await message({ type: 'SET_ENABLED', enabled: false }, options);
  assert.equal(registeredScripts.length, 0);
  assert.equal(dynamicRules.some(rule => rule.id === 22000), false);
});

test('privacy API toggles keep other registered scripts and roll back failed settings writes', async () => {
  reset();
  const toggle = (setting, enabled = true) => ({ type: 'SET_PRIVACY_PROTECTION', setting, enabled });
  assert.equal((await message(toggle('globalPrivacyControlEnabled'), frame())).ok, false);
  await message(toggle('fingerprintProtectionEnabled'), options);
  await message(toggle('globalPrivacyControlEnabled'), options);
  assert.equal(registeredScripts.length, 2);
  const snapshot = structuredClone(registeredScripts);
  rejectStorage = true;
  assert.equal((await message(toggle('privacySandboxBlocked'), options)).ok, false);
  assert.deepEqual(registeredScripts, snapshot);
  assert.equal(dynamicRules.some(r => r.id === 23001), false);
  await message(toggle('privacySandboxBlocked'), options);
  assert.equal(registeredScripts.length, 3);
  await message(toggle('globalPrivacyControlEnabled', false), options);
  assert.deepEqual(new Set(registeredScripts.map(s => s.id)), new Set(['basic-fingerprint-protection', 'basic-sandbox-protection']));
  assert.equal(dynamicRules.some(r => r.id === 23000), false);
  assert.equal(dynamicRules.some(r => r.id === 23001), true);
  await message({ type: 'SET_ENABLED', enabled: false }, options);
  assert.equal(registeredScripts.length, 0);
  assert.equal(dynamicRules.some(r => r.id === 23001), false);
});

test('YouTube toggle registers only its script and rolls back a failed save while preserving other settings', async () => {
  reset();
  const toggle = { type: 'SET_PRIVACY_PROTECTION', setting: 'youtubeAdBlockingEnabled', enabled: true };
  assert.equal((await message(toggle, frame())).ok, false);
  await message({ type: 'SET_PRIVACY_PROTECTION', setting: 'globalPrivacyControlEnabled', enabled: true }, options);
  const before = structuredClone(registeredScripts), networkBefore = structuredClone(dynamicRules);
  rejectStorage = true;
  assert.equal((await message(toggle, options)).ok, false);
  assert.deepEqual(registeredScripts, before);
  assert.equal(data.adblockState.youtubeAdBlockingEnabled, false);
  assert.equal((await message(toggle, options)).ok, true);
  assert.equal(registeredScripts.length, 2);
  assert.ok(registeredScripts.find(s => s.id === 'basic-youtube-ads').matches.includes('https://www.youtube.com/*'));
  assert.deepEqual(dynamicRules, networkBefore);
  await message({ type: 'SET_SITE_ENABLED', site: 'youtube.com', enabled: false }, options);
  assert.ok(registeredScripts.find(s => s.id === 'basic-youtube-ads').excludeMatches.includes('*://*.youtube.com/*'));
  await message({ ...toggle, enabled: false }, options);
  assert.deepEqual(registeredScripts.map(s => s.id), ['basic-gpc-signal']);
});
