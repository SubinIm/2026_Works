import test from 'node:test';
import assert from 'node:assert/strict';
import { compileNetwork, validateNetworkRules, VIDEO_DOMAINS } from '../network.mjs';
import { preprocessSource, evaluateCondition } from '../preprocess.mjs';

const source = (text, id = 1) => ({ id, key: `test-${id}`, name: 'test list', text });
const upstream = result => result.rules.filter(rule => !result.sourceMap[rule.id].policy);

test('preserves ordinary and mixed cosmetic/network exceptions and relative priorities', async () => {
  const result = await compileNetwork([source('||ads.example^\n@@||ads.example/keep^\n@@||ads.example^$script,elemhide')]);
  const rules = upstream(result);
  assert.equal(rules.length, 3);
  assert.equal(rules.filter(rule => rule.action.type === 'allow').length, 2);
  const mixed = rules.find(rule => rule.condition.resourceTypes?.includes('script'));
  assert.equal(mixed.action.type, 'allow');
  assert.ok(mixed.priority > rules.find(rule => rule.action.type === 'block').priority);
  assert.deepEqual(result.sourceMap[mixed.id].sources[0].lines, [3]);
});

test('cancels a block using badfilter from a different list', async () => {
  const result = await compileNetwork([source('||cancel.example^\n||keep.example^'), source('||cancel.example^$badfilter', 2)]);
  assert.deepEqual(upstream(result).map(rule => rule.condition.urlFilter), ['||keep.example^']);
  assert.equal(result.report.badFilterCount, 1);
});

test('retains exact regex exceptions using Node RE2 validation', async () => {
  const result = await compileNetwork([source('||ads.example^\n@@/^https:\\/\\/ads\\.example\\/keep[0-9]{2}\\.js$/')]);
  const allow = upstream(result).find(rule => rule.action.type === 'allow');
  assert.equal(allow.condition.regexFilter, '^https:\\/\\/ads\\.example\\/keep[0-9]{2}\\.js$');
  assert.equal(result.report.regexCount, 1);
});

test('fails instead of discarding an unsupported general network exception', async () => {
  await assert.rejects(compileNetwork([source('||ads.example^\n@@||ads.example^$genericblock')]), /Unsafe to omit/);
  await assert.rejects(compileNetwork([source('||ads.example^$domain=site.example,badfilter')]), /domain-scoped badfilter/);
});

test('excludes main-frame/media and video-only rules, and protects service initiators/destinations', async () => {
  const result = await compileNetwork([source('||ads.example^\n||images.example^$image,media\n||media.example^$media\n||popup.example^$document\n||preroll.example^\n@@||keep.example^$document')]);
  const rules = upstream(result);
  assert.ok(rules.some(rule => rule.action.type === 'allowAllRequests'));
  assert.ok(!rules.some(rule => /media.example|popup.example|preroll.example/.test(rule.condition.urlFilter)));
  const image = rules.find(rule => rule.condition.urlFilter === '||images.example^');
  assert.deepEqual(image.condition.resourceTypes, ['image']);
  const guards = result.rules.filter(rule => result.sourceMap[rule.id].policy);
  assert.equal(guards.length, 2);
  assert.deepEqual(guards[0].condition.initiatorDomains, VIDEO_DOMAINS);
  assert.deepEqual(guards[1].condition.requestDomains, VIDEO_DOMAINS);
  assert.ok(guards.every(guard => guard.priority > Math.max(...rules.map(rule => rule.priority))));
});

test('drops transformations together with their operation-specific exceptions', async () => {
  const result = await compileNetwork([source('||ads.example^\n||assets.example^$redirect=noopjs\n||headers.example^$csp=script-src none\n@@||headers.example^$csp')]);
  assert.equal(upstream(result).length, 1);
  assert.equal(result.report.skippedByReason['operation-not-enabled:csp'], 2);
  assert.equal(result.report.skippedByReason['operation-not-enabled:redirect'], 1);
});

test('fails on converter truncation and final quota instead of shipping a subset', async () => {
  await assert.rejects(compileNetwork([source('||one.example^\n||two.example^\n||three.example^')], { maxRules: 1 }), /truncation|quota/);
  assert.throws(() => validateNetworkRules([{ id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'ads' } }]), /Forbidden block type/);
});

test('preprocessor preserves lines, chooses Chromium MV3, and rejects unknown syntax', () => {
  const text = '!#if adguard_app_windows\n||native.example^\n!#else\n||browser.example^\n!#endif\n||last.example^';
  const result = preprocessSource(source(text));
  assert.equal(result.text.split('\n')[3], '||browser.example^');
  assert.equal(result.text.split('\n')[5], '||last.example^');
  assert.equal(result.platformSkipped[0].line, 2);
  assert.equal(evaluateCondition('adguard_ext_chromium && !adguard_app_windows'), true);
  assert.throws(() => evaluateCondition('new_future_platform'), /Unknown/);
  assert.throws(() => preprocessSource(source('!#include external.txt')), /Unsupported/);
});
