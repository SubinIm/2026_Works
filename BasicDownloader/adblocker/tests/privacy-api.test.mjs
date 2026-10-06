import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState, buildNetworkRules, ALLOW_PRIORITY } from '../state.js';
import { protectionRegistrations, privacyApiRules, SANDBOX_POLICY } from '../protection.js';

test('privacy API controls default off, validate booleans and preserve independent protections', () => {
  const state = normalizeState({ globalPrivacyControlEnabled: 'true', privacySandboxBlocked: 1 });
  assert.equal(state.globalPrivacyControlEnabled, false);
  assert.equal(state.privacySandboxBlocked, false);
  assert.deepEqual(privacyApiRules(state), []);
  const enabled = normalizeState({ globalPrivacyControlEnabled: true, privacySandboxBlocked: true });
  const rules = buildNetworkRules(enabled);
  assert.equal(rules.length, 2);
  assert.equal(rules.find(r => r.id === 23000).action.requestHeaders[0].value, '1');
  assert.ok(rules.find(r => r.id === 23000).condition.resourceTypes.includes('main_frame'));
  assert.equal(rules.find(r => r.id === 23001).action.responseHeaders[0].operation, 'append');
  assert.match(SANDBOX_POLICY, /browsing-topics=\(\)/);
  assert.match(SANDBOX_POLICY, /private-state-token-redemption=\(\)/);
  assert.ok(rules.every(r => r.action.type === 'modifyHeaders' && r.priority < ALLOW_PRIORITY));
  assert.deepEqual(buildNetworkRules({ ...enabled, enabled: false }).map(r => r.action.type), ['allow']);
  assert.ok(buildNetworkRules({ ...enabled, disabledSites: ['paused.test'] }).some(r => r.action.type === 'allowAllRequests' && r.priority === ALLOW_PRIORITY));
});

test('privacy API scripts are independent, document-start, site-excluded and disabled with global pause', () => {
  const state = normalizeState({ fingerprintProtectionEnabled: true, globalPrivacyControlEnabled: true,
    privacySandboxBlocked: true, disabledSites: ['paused.test', '127.0.0.1'] });
  const scripts = protectionRegistrations(state);
  assert.equal(scripts.length, 3);
  assert.equal(new Set(scripts.map(s => s.id)).size, 3);
  for (const script of scripts) {
    assert.equal(script.world, 'MAIN'); assert.equal(script.runAt, 'document_start');
    assert.equal(script.allFrames, false);
    assert.ok(script.excludeMatches.includes('*://*.paused.test/*'));
    assert.ok(script.excludeMatches.includes('*://127.0.0.1/*'));
    assert.equal(script.excludeMatches.includes('*://*.127.0.0.1/*'), false);
  }
  assert.equal(protectionRegistrations({ ...state, globalPrivacyControlEnabled: false }).length, 2);
  assert.deepEqual(protectionRegistrations({ ...state, enabled: false }), []);
});
