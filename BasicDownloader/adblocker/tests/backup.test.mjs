import test from "node:test";
import assert from "node:assert/strict";
import { normalizeState, MAX_CUSTOM_RULES, MAX_NETWORK_RULES, MAX_DISABLED_SITES } from "../state.js";
import { createBackup, previewImport, mergeBackup, MAX_BACKUP_BYTES } from "../backup.js";

const custom = (id = "element", selector = "#banner") => ({ id, site: "one.test", frameHost: "frame.test", selector, label: "광고", enabled: true, createdAt: 10 });
const network = (id = "request", domain = "ads.example") => ({ id, domain, site: null, enabled: true, createdAt: 20 });
const envelope = (values = {}) => ({ format: "basic-banner-blocker-rules", version: 1, customRules: [], networkRules: [], disabledSites: [], ...values });

test("v2 preserves movement while legacy backups mean hide and duplicates preserve the existing action", () => {
  const state = normalizeState({ customRules: [{ ...custom(), action: "move" }] });
  const backup = createBackup(state);
  assert.equal(backup.version, 2);
  assert.equal(mergeBackup(normalizeState(), backup).customRules[0].action, "move");
  assert.equal(mergeBackup(normalizeState(), envelope({ customRules: [custom()] })).customRules[0].action, "hide");
  const duplicate = envelope({ customRules: [custom()] });
  assert.equal(previewImport(state, duplicate).duplicates.customRules, 1);
  assert.equal(mergeBackup(state, duplicate).customRules[0].action, "move");
  assert.throws(() => mergeBackup(normalizeState(), { ...backup, version: 1 }));
});

test("backup round trip preserves rules, paused entries and exceptions but excludes global enabled", () => {
  const original = normalizeState({ enabled: false, customRules: [{ ...custom(), enabled: false }], networkRules: [network()], disabledSites: ["paused.test"] });
  const backup = createBackup(original);
  assert.equal(backup.version, 2);
  assert.equal(Object.hasOwn(backup, "enabled"), false);
  assert.equal(backup.customRules[0].enabled, false);
  backup.customRules[0].label = "백업 사본";
  assert.equal(original.customRules[0].label, "광고");
  const restored = mergeBackup(normalizeState(), JSON.parse(JSON.stringify(backup)));
  assert.equal(restored.enabled, true);
  assert.deepEqual(restored.customRules, backup.customRules);
  assert.deepEqual(restored.networkRules, backup.networkRules);
  assert.deepEqual(restored.disabledSites, backup.disabledSites);
  assert.equal(mergeBackup({ ...normalizeState(), enabled: false }, backup).enabled, false);
});

test("preview is pure and merging deduplicates semantic keys while preserving existing settings", () => {
  const state = normalizeState({ customRules: [{ ...custom(), enabled: false }], networkRules: [network()], disabledSites: ["paused.test"] });
  const payload = envelope({ customRules: [custom("different-id"), custom("new", "#new"), custom("new-copy", "#new")],
    networkRules: [network("different-network-id"), { ...network("scoped"), site: "news.test" }],
    disabledSites: ["paused.test", "new.test", "new.test"] });
  const before = structuredClone(state);
  const preview = previewImport(state, payload);
  assert.deepEqual(preview, { added: { customRules: 1, networkRules: 1, disabledSites: 1 },
    duplicates: { customRules: 2, networkRules: 1, disabledSites: 2 },
    totals: { customRules: 2, networkRules: 2, disabledSites: 2 } });
  assert.deepEqual(state, before);
  const merged = mergeBackup(state, payload);
  assert.equal(merged.customRules[0].id, "element");
  assert.equal(merged.customRules[0].enabled, false);
  assert.deepEqual(state, before);
});

test("conflicting imported IDs are regenerated across both kinds of rule", () => {
  const state = normalizeState({ customRules: [custom("same")] });
  const payload = envelope({ customRules: [custom("same", "#new"), custom("same", "#other")], networkRules: [network("same")] });
  const merged = mergeBackup(state, payload);
  const ids = [...merged.customRules, ...merged.networkRules].map(rule => rule.id);
  assert.equal(new Set(ids).size, 4);
  assert.equal(ids[0], "same");
  assert.ok(ids.slice(1).every(id => id !== "same"));
});

test("invalid backup rejects the entire payload without dropping malformed rows silently", () => {
  const state = normalizeState({ customRules: [custom()] });
  const invalidPayloads = [null, [], {}, envelope({ version: 3 }), envelope({ networkRules: {} }),
    envelope({ customRules: [{ ...custom(), action: "move" }] }),
    envelope({ version: 2, customRules: [{ ...custom(), action: "remove" }] }),
    envelope({ customRules: [custom("valid", "#safe"), { ...custom("invalid"), selector: "body" }] }),
    envelope({ customRules: [{ ...custom(), enabled: "false" }] }),
    envelope({ customRules: [{ ...custom(), createdAt: -1 }] }),
    envelope({ networkRules: [{ ...network(), domain: "*.ads.test" }] }),
    envelope({ networkRules: [{ ...network(), site: undefined }] }),
    envelope({ disabledSites: ["https://bad.test"] })];
  for (const payload of invalidPayloads) {
    const before = structuredClone(state);
    assert.throws(() => previewImport(state, payload));
    assert.throws(() => mergeBackup(state, payload));
    assert.deepEqual(state, before);
  }
  assert.throws(() => previewImport(state, envelope({ note: "x".repeat(MAX_BACKUP_BYTES) })), /8MB/);
});

test("both incoming and merged rule limits reject atomically after legitimate deduplication", () => {
  const fullState = normalizeState({ customRules: Array.from({ length: MAX_CUSTOM_RULES }, (_, i) => custom(`c${i}`, `#ad${i}`)),
    networkRules: Array.from({ length: MAX_NETWORK_RULES }, (_, i) => network(`n${i}`, `ads${i}.test`)),
    disabledSites: Array.from({ length: MAX_DISABLED_SITES }, (_, i) => `paused${i}.test`) });
  const duplicateOnly = createBackup(fullState);
  assert.equal(previewImport(fullState, duplicateOnly).added.customRules, 0);
  for (const payload of [envelope({ customRules: [custom("extra", "#extra")] }),
    envelope({ networkRules: [network("extra", "extra.test")] }), envelope({ disabledSites: ["extra.test"] }),
    envelope({ customRules: Array(MAX_CUSTOM_RULES + 1).fill(custom()) }),
    envelope({ networkRules: Array(MAX_NETWORK_RULES + 1).fill(network()) }),
    envelope({ disabledSites: Array(MAX_DISABLED_SITES + 1).fill("paused.test") })]) {
    assert.throws(() => previewImport(fullState, payload), /한도/);
    assert.throws(() => mergeBackup(fullState, payload), /한도/);
  }
  assert.equal(fullState.customRules.length, MAX_CUSTOM_RULES);
});
