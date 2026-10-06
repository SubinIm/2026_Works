import {
  MAX_CUSTOM_RULES, MAX_NETWORK_RULES, MAX_DISABLED_SITES,
  normalizeState, validHost, validSelector, validNetworkDomain, validRuleAction
} from "./state.js";

export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
const FORMAT = "basic-banner-blocker-rules";
const fields = ["customRules", "networkRules", "disabledSites"];
const limits = { customRules: MAX_CUSTOM_RULES, networkRules: MAX_NETWORK_RULES, disabledSites: MAX_DISABLED_SITES };
const customKey = rule => JSON.stringify([rule.site, rule.frameHost, rule.selector]);
const networkKey = rule => JSON.stringify([rule.site, rule.domain]);

export function createBackup(state) {
  const normalized = normalizeState(state);
  return {
    format: FORMAT, version: 2,
    customRules: normalized.customRules.map(rule => ({ ...rule })),
    networkRules: normalized.networkRules.map(rule => ({ ...rule })),
    disabledSites: [...normalized.disabledSites]
  };
}

function validRecord(rule) {
  return rule && typeof rule === "object" && !Array.isArray(rule) &&
    typeof rule.id === "string" && rule.id.length > 0 && rule.id.length <= 128 &&
    (rule.enabled === undefined || typeof rule.enabled === "boolean") &&
    (rule.createdAt === undefined || (Number.isFinite(rule.createdAt) && rule.createdAt >= 0));
}

function validateBackup(payload) {
  let encoded;
  try { encoded = JSON.stringify(payload); } catch { throw new Error("백업은 올바른 JSON 데이터여야 합니다."); }
  if (typeof encoded !== "string" || new TextEncoder().encode(encoded).byteLength > MAX_BACKUP_BYTES) {
    throw new Error("백업 파일은 8MB 이하여야 합니다.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.format !== FORMAT || ![1, 2].includes(payload.version)) {
    throw new Error("지원하지 않는 백업 형식 또는 버전입니다.");
  }
  for (const field of fields) {
    if (!Array.isArray(payload[field])) throw new Error("백업의 규칙 목록이 올바르지 않습니다.");
    if (payload[field].length > limits[field]) throw new Error("백업의 항목 수가 저장 한도를 초과합니다.");
  }
  for (const rule of payload.customRules) {
    if (!validRecord(rule) || !validHost(rule.site) || !validHost(rule.frameHost) || !validSelector(rule.selector) ||
        !(rule.action === undefined || validRuleAction(rule.action)) || (payload.version === 1 && rule.action === "move") ||
        (rule.label !== undefined && (typeof rule.label !== "string" || rule.label.length > 100))) {
      throw new Error("백업에 올바르지 않은 숨김·이동 규칙이 있습니다. 아무 항목도 가져오지 않았습니다.");
    }
  }
  for (const rule of payload.networkRules) {
    if (!validRecord(rule) || !validNetworkDomain(rule.domain) || !(rule.site === null || validHost(rule.site))) {
      throw new Error("백업에 올바르지 않은 요청 차단 규칙이 있습니다. 아무 항목도 가져오지 않았습니다.");
    }
  }
  if (!payload.disabledSites.every(validHost)) throw new Error("백업에 올바르지 않은 사이트 예외가 있습니다.");
  return payload;
}

function prepareImport(state, payload, assignIds) {
  const backup = validateBackup(payload);
  const merged = normalizeState(state);
  const preview = { added: {}, duplicates: {}, totals: {} };
  const ids = new Set([...merged.customRules, ...merged.networkRules].map(rule => rule.id));
  for (const field of ["customRules", "networkRules"]) {
    const keyFor = field === "customRules" ? customKey : networkKey;
    const keys = new Set(merged[field].map(keyFor));
    let added = 0;
    let duplicates = 0;
    for (const rule of backup[field]) {
      const key = keyFor(rule);
      if (keys.has(key)) { duplicates++; continue; }
      keys.add(key);
      let id = rule.id;
      if (assignIds && ids.has(id)) {
        do { id = crypto.randomUUID(); } while (ids.has(id));
      }
      ids.add(id);
      merged[field].push(field === "customRules" ? {
        id, site: rule.site, frameHost: rule.frameHost, selector: rule.selector, action: rule.action ?? "hide",
        label: rule.label ?? (rule.action === "move" ? "이동한 요소" : "숨긴 요소"), enabled: rule.enabled !== false, createdAt: rule.createdAt ?? 0
      } : { id, domain: rule.domain, site: rule.site, enabled: rule.enabled !== false, createdAt: rule.createdAt ?? 0 });
      added++;
    }
    preview.added[field] = added;
    preview.duplicates[field] = duplicates;
    preview.totals[field] = merged[field].length;
  }
  const sites = new Set(merged.disabledSites);
  for (const site of backup.disabledSites) sites.add(site);
  preview.added.disabledSites = sites.size - merged.disabledSites.length;
  preview.duplicates.disabledSites = backup.disabledSites.length - preview.added.disabledSites;
  merged.disabledSites = [...sites];
  preview.totals.disabledSites = sites.size;
  for (const field of fields) {
    if (preview.totals[field] > limits[field]) throw new Error("가져오면 저장 한도를 초과합니다. 기존 항목을 정리한 후 다시 시도해 주세요.");
  }
  return { state: merged, preview };
}

export function previewImport(state, payload) {
  return prepareImport(state, payload, false).preview;
}

export function mergeBackup(state, payload) {
  return prepareImport(state, payload, true).state;
}
