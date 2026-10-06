import { Filter, FilterConverter, Rule, DNR_CONVERTER_VERSION } from '@adguard/dnr-converter';
import { RE2 } from '@adguard/re2-wasm';

// Pinned converter 2.0.0's library API defaults to a Chrome-only validator.
// Use its own Node CLI's RE2 memory budget, without loading browser code or eval.
const { re2Validator } = await import(new URL('./re2-regexp/re2-validator.js', import.meta.resolve('@adguard/dnr-converter')));
if (DNR_CONVERTER_VERSION !== '2.0.0') throw new Error('Review the RE2 adapter before updating the converter.');
re2Validator.setValidator(async pattern => { new RE2(pattern, 'u', 1979); return true; });

export const POLICY_VERSION = 1;
export const VIDEO_DOMAINS = Object.freeze([
  'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'googlevideo.com',
  'twitch.tv', 'ttvnw.net', 'vimeo.com', 'dailymotion.com', 'dai.ly',
  'netflix.com', 'disneyplus.com', 'primevideo.com', 'tving.com', 'wavve.com',
  'coupangplay.com', 'sooplive.co.kr', 'afreecatv.com', 'chzzk.naver.com', 'tv.naver.com',
]);
const NON_NETWORK = /#(?:@?[?$%]?#|@?\^)/;
const DISABLED_OPERATIONS = new Set(['redirect', 'redirect-rule', 'rewrite', 'csp', 'removeparam', 'removeheader', 'permissions', 'cookie', 'urltransform', 'replace', 'jsonprune', 'xmlprune', 'hls', 'referrerpolicy', 'stealth', 'jsinject', 'content', 'extension']);
const COSMETIC_ONLY = new Set(['elemhide', 'ehide', 'generichide', 'ghide', 'specifichide', 'shide']);
const VIDEO_PATTERN = /(?:vast|vpaid|pre[-_]?roll|mid[-_]?roll|post[-_]?roll|ima3|imasdk|\.m3u8|\.mpd|video[-_/]?ads)/i;
const SAFE_ACTIONS = new Set(['block', 'allow', 'allowAllRequests']);
const MAX_RULES = 100000;
const MAX_REGEX = 1000;

function modifiers(rule) { return rule.node.modifiers?.children.map(item => item.name.value) ?? []; }
function sourceRecord(source, line, sourceRule, reason, detail) {
  return { source: source.key, filterId: source.id, line, sourceRule, reason, ...(detail ? { detail } : {}) };
}
function classifyRule(text, parsed) {
  const names = [...new Set(parsed.flatMap(modifiers))];
  // These actions and their action-specific exceptions are disabled together.
  const disabled = names.find(name => DISABLED_OPERATIONS.has(name));
  if (disabled) return `operation-not-enabled:${disabled}`;
  if (names.includes('popup') || names.includes('popunder')) return 'popup-navigation-out-of-scope';
  if (names.some(name => COSMETIC_ONLY.has(name)) && names.every(name => COSMETIC_ONLY.has(name) || name === 'domain')) return 'cosmetic-exception-handled-separately';
  if (!text.startsWith('@@') && VIDEO_PATTERN.test(parsed.map(rule => rule.pattern).join(' '))) return 'video-specific-pattern-out-of-scope';
  return null;
}

export function validateNetworkRules(rules, { maxRules = MAX_RULES, maxRegex = MAX_REGEX } = {}) {
  if (!rules.length || rules.length > maxRules) throw new Error(`Network rule quota exceeded or empty: ${rules.length}/${maxRules}`);
  if (rules.filter(rule => rule.condition.regexFilter).length > maxRegex) throw new Error('Regex rule quota exceeded.');
  const ids = new Set();
  for (const rule of rules) {
    if (!Number.isInteger(rule.id) || rule.id < 1 || ids.has(rule.id)) throw new Error('Invalid or duplicate rule ID.');
    ids.add(rule.id);
    if (!SAFE_ACTIONS.has(rule.action.type) || Object.keys(rule.action).length !== 1) throw new Error('Unsupported network action.');
    if (!Number.isInteger(rule.priority) || rule.priority < 1 || rule.priority > 100000) throw new Error('Public rule priority must be 1..100000.');
    const c = rule.condition;
    if (rule.action.type === 'block') {
      for (const type of ['main_frame', 'media']) {
        if (c.resourceTypes?.includes(type) || (!c.resourceTypes && !c.excludedResourceTypes?.includes(type))) throw new Error(`Forbidden block type: ${type}`);
      }
    }
    for (const field of ['resourceTypes', 'requestDomains', 'initiatorDomains']) if (c[field]?.length === 0) throw new Error(`Empty condition ${field}.`);
    if (c.resourceTypes && c.excludedResourceTypes) throw new Error('Conflicting resource type conditions.');
    if (c.regexFilter) new RE2(c.regexFilter, 'u', 1979);
  }
}

export async function compileNetwork(sources, limits = {}) {
  const skipped = [];
  const inputs = [];
  const lookup = new Map();
  const badFilterRules = [];
  for (const source of sources) {
    const references = new Map();
    let offset = 0;
    const content = source.text.split('\n').map((raw, index) => {
      const text = raw.trim();
      const line = index + 1;
      const currentOffset = offset;
      offset += raw.length + 1;
      if (!text || text.startsWith('!') || text.startsWith('[')) return '';
      if (NON_NETWORK.test(text)) return '';
      let parsed;
      try { parsed = Rule.createFromText(source.id, currentOffset, text); }
      catch (error) {
        if (text.startsWith('@@')) throw new Error(`Unparsed exception ${source.key}:${line}: ${error.message}`);
        skipped.push(sourceRecord(source, line, text, 'network-parse-error', error.message));
        return '';
      }
      if (!parsed.length) {
        if (text.startsWith('@@')) throw new Error(`Unrecognized exception ${source.key}:${line}`);
        skipped.push(sourceRecord(source, line, text, 'unsupported-network-syntax'));
        return '';
      }
      const reason = classifyRule(text, parsed);
      if (reason) { skipped.push(sourceRecord(source, line, text, reason)); return ''; }
      for (const rule of parsed) if (modifiers(rule).includes('badfilter')) {
        // Upstream documents incomplete $badfilter/$domain intersections.
        // Do not ship a partially cancelled block when a future list uses it.
        if (rule.permittedDomains?.length || rule.restrictedDomains?.length) throw new Error(`Unsupported domain-scoped badfilter ${source.key}:${line}`);
        badFilterRules.push(rule);
      }
      if (!references.has(text)) references.set(text, []);
      references.get(text).push(line);
      return text;
    }).join('\n');
    lookup.set(source.id, { source, references, content });
    inputs.push(new Filter(source.id, content));
  }
  // A single combined pass plus explicit shared badfilter rules preserves
  // exceptions/cancellations across source lists. No list is enabled in isolation.
  const [converted] = await new FilterConverter().convert(inputs, {
    combine: true, withSourceMap: true, badFilterRules,
    maxNumberOfRules: limits.maxRules ?? MAX_RULES,
    maxNumberOfRegexpRules: limits.maxRegex ?? MAX_REGEX,
    maxNumberOfUnsafeRules: 0,
  });
  if (converted.limitations.length) throw new Error(`Converter attempted truncation: ${converted.limitations.map(error => error.message).join('; ')}`);
  for (const error of converted.errors) {
    const parsed = error.rule;
    if (!parsed || parsed.allowlist) throw new Error(`Unsafe to omit conversion error: ${error.message}`);
    const item = lookup.get(parsed.filterListId);
    const text = parsed.node.raws?.text ?? parsed.pattern;
    const line = item.references.get(text)?.[0] ?? item.content.slice(0, parsed.index).split('\n').length;
    skipped.push(sourceRecord(item.source, line, text, `converter:${error.name}`, error.reason ?? error.message));
  }
  const rules = [];
  const sourceMap = {};
  const policyAdjustments = { mainFrameAndMediaExcluded: 0, videoGuards: 2 };
  for (const original of await converted.ruleset.getDeclarativeRules()) {
    const refs = await converted.ruleset.getRulesById(original.id);
    if (!refs?.length) throw new Error(`Missing converter source mapping: ${original.id}`);
    const sourcesForRule = refs.map(ref => {
      const item = lookup.get(ref.filterId);
      return { source: item.source.key, filterId: ref.filterId,
        lines: item.references.get(ref.sourceRule) ?? [], sourceRule: ref.sourceRule };
    });
    if (sourcesForRule.some(ref => !ref.lines.length)) throw new Error(`Lost source line mapping for rule ${original.id}`);
    if (!SAFE_ACTIONS.has(original.action.type)) throw new Error(`Unexpected enabled operation: ${original.action.type}`);
    const rule = structuredClone(original);
    if (rule.action.type === 'block') {
      const c = rule.condition;
      if (c.resourceTypes) {
        c.resourceTypes = c.resourceTypes.filter(type => !['main_frame', 'media'].includes(type));
        if (!c.resourceTypes.length) {
          for (const ref of sourcesForRule) skipped.push({ ...ref, line: ref.lines[0], reason: 'only-main-frame-or-media-out-of-scope' });
          continue;
        }
      } else c.excludedResourceTypes = [...new Set([...(c.excludedResourceTypes ?? []), 'main_frame', 'media'])].sort();
      policyAdjustments.mainFrameAndMediaExcluded++;
    }
    rule.id = rules.length + 1;
    rules.push(rule);
    sourceMap[rule.id] = { originalConverterId: original.id, sources: sourcesForRule };
  }
  const priorities = [...new Set(rules.map(rule => rule.priority ?? 1))].sort((a, b) => a - b);
  for (const rule of rules) rule.priority = priorities.indexOf(rule.priority ?? 1) + 1;
  const guardPriority = priorities.length + 1;
  for (const field of ['initiatorDomains', 'requestDomains']) {
    const id = rules.length + 1;
    rules.push({ id, priority: guardPriority, action: { type: 'allow' }, condition: { [field]: [...VIDEO_DOMAINS] } });
    sourceMap[id] = { policy: 'video-service-out-of-scope', conditionField: field, policyVersion: POLICY_VERSION };
  }
  validateNetworkRules(rules, limits);
  const skippedByReason = {};
  for (const item of skipped) skippedByReason[item.reason] = (skippedByReason[item.reason] ?? 0) + 1;
  return { rules, sourceMap, report: { converter: { name: '@adguard/dnr-converter', version: DNR_CONVERTER_VERSION, regexValidator: '@adguard/re2-wasm 1.2.0; 1979-byte budget' },
    policyVersion: POLICY_VERSION, ruleCount: rules.length,
    blockCount: rules.filter(rule => rule.action.type === 'block').length,
    allowCount: rules.filter(rule => rule.action.type === 'allow').length,
    allowAllRequestsCount: rules.filter(rule => rule.action.type === 'allowAllRequests').length,
    regexCount: rules.filter(rule => rule.condition.regexFilter).length,
    maxPriority: guardPriority, sourcePriorityLevels: priorities, badFilterCount: badFilterRules.length,
    skippedCount: skipped.length, skippedByReason, policyAdjustments, skipped } };
}
