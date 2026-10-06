import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState, buildNetworkRules } from '../state.js';
import { protectionRegistrations, videoRules } from '../protection.js';

test('YouTube is opt-in, independently normalized and leaves network/media rules unchanged', () => {
  assert.equal(normalizeState().youtubeAdBlockingEnabled, false);
  assert.equal(normalizeState({ youtubeAdBlockingEnabled: 'true' }).youtubeAdBlockingEnabled, false);
  const state = normalizeState({ youtubeAdBlockingEnabled: true });
  assert.equal(state.youtubeAdBlockingEnabled, true);
  assert.equal(state.videoAdBlockingEnabled, false);
  assert.deepEqual(buildNetworkRules(state), buildNetworkRules(normalizeState()));
});
test('YouTube document-start script is host scoped, top-level and respects pause settings', () => {
  const state = normalizeState({ youtubeAdBlockingEnabled: true, disabledSites: ['youtube.com'] });
  const [script] = protectionRegistrations(state);
  assert.equal(script.id, 'basic-youtube-ads');
  assert.deepEqual(script.js, ['youtube-ads.js']);
  assert.equal(script.world, 'MAIN'); assert.equal(script.runAt, 'document_start');
  assert.equal(script.allFrames, false);
  assert.ok(script.matches.every(match => /^https:\/\/(www\.|m\.)?youtube\.com\/\*$/.test(match)));
  assert.ok(script.excludeMatches.includes('*://*.youtube.com/*'));
  assert.deepEqual(protectionRegistrations({ ...state, enabled: false }), []);
  assert.deepEqual(protectionRegistrations({ ...state, youtubeAdBlockingEnabled: false }), []);
});

test('generic video request blocks exclude YouTube player initiators independently of its option', () => {
  for (const youtubeAdBlockingEnabled of [true, false]) {
    const rules=videoRules(normalizeState({videoAdBlockingEnabled:true,youtubeAdBlockingEnabled}));
    assert.equal(rules.length,2);
    for(const rule of rules) assert.deepEqual(rule.condition.excludedInitiatorDomains,['youtube.com','youtube-nocookie.com','youtu.be']);
  }
});
