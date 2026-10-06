import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  normalizeState, hostFromUrl, validHost, validSelector, enabledForSite,
  contextFor, setSiteEnabled, buildAllowRules, buildNetworkRules, validNetworkDomain,
  PUBLIC_FILTER_MAX_PRIORITY, USER_BLOCK_PRIORITY, ALLOW_PRIORITY
} from "../state.js";

test("only HTTP(S) sites are supported and domain boundaries are respected", () => {
  assert.equal(hostFromUrl("https://NEWS.Example.com:8443/page"), "news.example.com");
  for (const url of ["chrome://extensions", "file:///x", "about:blank", "invalid"]) assert.equal(hostFromUrl(url), null);
  for (const host of ["example.com/path", "example.com:123", "Example.com", "a..com", "", "0x7f000001"]) assert.equal(validHost(host), false);
  const state = setSiteEnabled(normalizeState(), "example.com", false);
  assert.equal(enabledForSite(state, "news.example.com"), false);
  assert.equal(enabledForSite(state, "notexample.com"), true);
});

test("stored legacy cosmetic rules migrate to enabled and disabled rules leave the content context", () => {
  const state = normalizeState({ customRules: [
    { id: "legacy", site: "one.test", frameHost: "one.test", selector: "#old" },
    { id: "paused", site: "one.test", frameHost: "one.test", selector: "#paused", enabled: false }
  ] });
  assert.equal(state.customRules[0].enabled, true);
  assert.equal(state.customRules[0].action, "hide");
  assert.equal(state.customRules[1].enabled, false);
  assert.deepEqual(state.networkRules, []);
  assert.deepEqual(contextFor(state, "one.test", "one.test").rules.map(rule => rule.id), ["legacy"]);
});

test("stored move actions survive normalization and invalid actions are dropped", () => {
  const rule = { site: "one.test", frameHost: "frame.test", selector: "#ad" };
  const state = normalizeState({ customRules: [
    { ...rule, id: "move", action: "move" }, { ...rule, id: "hide", action: "hide" },
    { ...rule, id: "bad", action: "delete" }, { ...rule, id: "null", action: null }
  ] });
  assert.deepEqual(state.customRules.map(rule => rule.action), ["move", "hide"]);
  assert.deepEqual(contextFor(state, "one.test", "frame.test").rules.map(rule => rule.action), ["move", "hide"]);
});

test("legacy settings enable the public pack by default and retain an explicit opt-out", () => {
  assert.equal(normalizeState().publicFiltersEnabled, true);
  assert.equal(normalizeState({ enabled: false }).publicFiltersEnabled, true);
  assert.equal(normalizeState({ publicFiltersEnabled: "false" }).publicFiltersEnabled, true);
  const state = normalizeState({ publicFiltersEnabled: false });
  assert.equal(state.publicFiltersEnabled, false);
  assert.equal(contextFor(state, "one.test", "one.test").publicFiltersEnabled, false);
});

test("explicit user blocks outrank public exceptions and global/site pauses outrank both", () => {
  const state = normalizeState({ networkRules: [{ id: "manual", domain: "ads.test", site: null }] });
  assert.ok(PUBLIC_FILTER_MAX_PRIORITY < USER_BLOCK_PRIORITY);
  assert.ok(USER_BLOCK_PRIORITY < ALLOW_PRIORITY);
  assert.equal(buildNetworkRules(state)[0].priority, USER_BLOCK_PRIORITY);
  assert.ok(buildNetworkRules({ ...state, enabled: false }).every(rule => rule.priority > PUBLIC_FILTER_MAX_PRIORITY));
  assert.ok(buildAllowRules({ ...state, disabledSites: ["one.test"] })[0].priority > USER_BLOCK_PRIORITY);
});

test("user network domains reject URLs, wildcards, IP addresses and malformed DNS labels", () => {
  for (const value of ["ads.example.com", "ads-1.example.test", "xn--bcher-kva.example"]) assert.equal(validNetworkDomain(value), true, value);
  for (const value of ["localhost", "ads.localhost", "127.0.0.1", "1.2.3.4", "0x7f000001", "[::1]", "https://ads.test", "ads.test/path", "*.ads.test", "ads.test:443", "Ads.test", "-ads.test", "ads-.test", "ads..test", `${"a".repeat(64)}.test`]) {
    assert.equal(validNetworkDomain(value), false, value);
  }
});

test("user request rules preserve frame initiator scope, exclude documents/media and obey exceptions", () => {
  const state = normalizeState({ disabledSites: ["paused.test"], networkRules: [
    { id: "all", domain: "ads.example", site: null },
    { id: "paused", domain: "paused.example", site: null, enabled: false },
    { id: "scoped", domain: "scoped.example", site: "news.test" }
  ] });
  const rules = buildNetworkRules(state);
  assert.equal(rules[0].action.type, "allowAllRequests");
  assert.deepEqual(rules[0].condition.requestDomains, ["paused.test"]);
  const blocks = rules.filter(rule => rule.action.type === "block");
  assert.deepEqual(blocks.map(rule => rule.id), [10000, 10002]);
  assert.equal(blocks[0].condition.initiatorDomains, undefined);
  assert.deepEqual(blocks[1].condition.initiatorDomains, ["news.test"]);
  for (const rule of blocks) {
    assert.equal(rule.condition.domainType, "thirdParty");
    assert.deepEqual(rule.condition.resourceTypes, ["script", "image", "sub_frame", "xmlhttprequest", "ping", "other"]);
    assert.ok(rule.priority < rules[0].priority);
  }
  assert.deepEqual(buildNetworkRules({ ...state, enabled: false }), buildAllowRules({ ...state, enabled: false }));
});

test("resume removes inherited parent pause and pause coalesces children", () => {
  let state = setSiteEnabled(normalizeState(), "news.example.com", false);
  state = setSiteEnabled(state, "example.com", false);
  assert.deepEqual(state.disabledSites, ["example.com"]);
  state = setSiteEnabled(state, "news.example.com", true);
  assert.deepEqual(state.disabledSites, []);
});

test("custom rules require both the same top site and same frame host", () => {
  const state = normalizeState({ customRules: [
    { id: "a", site: "one.test", frameHost: "frame.test", selector: "#banner", label: "ad", createdAt: 1 },
    { id: "b", site: "two.test", frameHost: "frame.test", selector: "#banner" },
    { id: "c", site: "one.test", frameHost: "other.test", selector: "#banner" }
  ] });
  assert.deepEqual(contextFor(state, "one.test", "frame.test").rules.map(r => r.id), ["a"]);
  assert.equal(contextFor({ ...state, enabled: false }, "one.test", "frame.test").enabled, false);
});

test("corrupt stored rules and CSS injection are rejected", () => {
  for (const selector of ["", "body", ":root", "*", "#ad{color:red}", "#ad;body", "#ad\nbody"]) {
    assert.equal(validSelector(selector), false, selector);
  }
  assert.equal(validSelector("body > div:nth-of-type(2) > #banner"), true);
  const state = normalizeState({ enabled: "false", disabledSites: [null, "example.com", "example.com"], customRules: [
    null, { id: "bad", site: "https://x.com", frameHost: "x.com", selector: "#ad" }
  ] });
  assert.equal(state.enabled, true);
  assert.deepEqual(state.disabledSites, ["example.com"]);
  assert.deepEqual(state.customRules, []);
});

test("off and site exception policies outrank block rules and cover iframe trees", () => {
  assert.deepEqual(buildAllowRules(normalizeState()), []);
  assert.equal(buildAllowRules({ ...normalizeState(), enabled: false })[0].action.type, "allow");
  const rules = buildAllowRules(setSiteEnabled(normalizeState(), "example.com", false));
  assert.equal(rules[0].action.type, "allowAllRequests");
  assert.deepEqual(rules[0].condition.resourceTypes, ["main_frame"]);
  assert.equal(rules.length, 1, "a paused host embedded in another site must not bypass that site's blocking");
  assert.ok(rules.every(rule => rule.priority > 1));
});

test("packaged ad rules do not block main documents or media streams", async () => {
  const rules = JSON.parse(await readFile(new URL("../rules/banner-ads.json", import.meta.url)));
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url)));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(new Set(rules.map(rule => rule.id)).size, rules.length);
  assert.ok(rules.length >= 20);
  const naverDisplayPaths = new Map([
    ["||nam.veta.naver.com/gfp/", ["xmlhttprequest"]],
    ["||siape.veta.naver.com/fxshow?", ["sub_frame"]],
    ["||ssl.pstatic.net/tveta/libs/glad/", ["script"]],
    ["||ssl.pstatic.net/tveta/libs/ndpsdk/", ["script"]],
    ["||ssl.pstatic.net/melona/libs/glad/", ["script"]],
    ["||sstatic.naver.net/tveta/libs/glad/", ["script"]],
    ["||sstatic.naver.net/tveta/libs/ndpsdk/", ["script"]],
    ["||recoshopping.naver.com^", ["sub_frame"]],
  ]);
  for (const rule of rules) {
    assert.equal(rule.action.type, "block");
    assert.equal(rule.condition.resourceTypes.includes("main_frame"), false);
    assert.equal(rule.condition.resourceTypes.includes("media"), false);
    if (rule.condition.domainType === "thirdParty") {
      assert.ok(rule.condition.urlFilter.startsWith("||") && rule.condition.urlFilter.endsWith("^"));
    } else {
      assert.deepEqual(rule.condition.initiatorDomains, ["www.naver.com"], "same-site display rules must stay on the observed homepage");
      assert.ok(naverDisplayPaths.has(rule.condition.urlFilter), "same-site rules must use a reviewed display-ad path");
      assert.deepEqual(rule.condition.resourceTypes, naverDisplayPaths.get(rule.condition.urlFilter));
    }
  }
});

test("generated public package respects local/user priority and excludes document/media blocking", async t => {
  let metadata;
  try { metadata = JSON.parse(await readFile(new URL("../filters/manifest.json", import.meta.url))); }
  catch (error) {
    if (error.code === "ENOENT") return t.skip("Public filter artifacts have not been built yet.");
    throw error;
  }
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url)));
  const resource = manifest.declarative_net_request.rule_resources.find(rule => rule.id === "public_ads");
  assert.ok(resource, "public pack must have a registered static ruleset");
  const rules = JSON.parse(await readFile(new URL(`../${resource.path}`, import.meta.url)));
  assert.equal(rules.length, metadata.network.ruleCount);
  assert.equal(rules.reduce((maximum, rule) => Math.max(maximum, rule.priority), 0), metadata.network.maxPriority);
  assert.ok(rules.every(rule => Number.isInteger(rule.priority) && rule.priority > 0 && rule.priority <= PUBLIC_FILTER_MAX_PRIORITY));
  assert.ok(USER_BLOCK_PRIORITY > metadata.network.maxPriority);
  assert.ok(ALLOW_PRIORITY > USER_BLOCK_PRIORITY);
  for (const rule of rules.filter(rule => rule.action.type === "block")) {
    if (rule.condition.resourceTypes) {
      assert.ok(rule.condition.resourceTypes.length > 0);
      assert.equal(rule.condition.resourceTypes.includes("main_frame"), false);
      assert.equal(rule.condition.resourceTypes.includes("media"), false);
    } else {
      assert.ok(rule.condition.excludedResourceTypes?.includes("main_frame"));
      assert.ok(rule.condition.excludedResourceTypes?.includes("media"));
    }
  }
});

test('privacy protection is opt-in, independent, and respects global/site pause priority', () => {
  const base = normalizeState();
  assert.equal(base.trackingProtectionEnabled, false);
  assert.equal(base.errorMonitoringBlocked, false);
  assert.equal(normalizeState({ trackingProtectionEnabled: 'true' }).trackingProtectionEnabled, false);
  const tracking = buildNetworkRules({ ...base, trackingProtectionEnabled: true });
  assert.ok(tracking.length > 6);
  assert.ok(tracking.every(rule => rule.action.type === 'block' && rule.priority < ALLOW_PRIORITY));
  assert.ok(tracking.every(rule => !rule.condition.resourceTypes.includes('main_frame') && !rule.condition.resourceTypes.includes('media')));
  const both = buildNetworkRules({ ...base, trackingProtectionEnabled: true, errorMonitoringBlocked: true });
  assert.equal(both.length, tracking.length + 4);
  assert.equal(new Set(both.map(rule => rule.id)).size, both.length);
  assert.deepEqual(both.filter(rule => rule.id >= 21000), buildNetworkRules({ ...base, errorMonitoringBlocked: true }));
  assert.equal(buildNetworkRules({ ...base, errorMonitoringBlocked: true }).length, 4);
  assert.ok(buildNetworkRules({ ...base, enabled: false, trackingProtectionEnabled: true }).every(rule => rule.action.type === 'allow'));
  assert.ok(buildAllowRules({ ...base, disabledSites: ['sportsseoul.com'] }).every(rule => rule.priority > tracking[0].priority));
});

test('extension and action icons are packaged PNGs at their declared dimensions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
  for (const [size, file] of Object.entries({ ...manifest.icons, ...manifest.action.default_icon })) {
    const png = await readFile(new URL(`../${file}`, import.meta.url));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), Number(size));
    assert.equal(png.readUInt32BE(20), Number(size));
  }
});
