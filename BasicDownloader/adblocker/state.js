import { privacyRules } from './privacy-rules.js';
import { videoRules, privacyApiRules } from './protection.js';
export const STATE_KEY = "adblockState";
export const MAX_CUSTOM_RULES = 1000;
export const MAX_NETWORK_RULES = 1000;
export const MAX_DISABLED_SITES = 500;
export const PUBLIC_FILTER_MAX_PRIORITY = 100000;
export const USER_BLOCK_PRIORITY = 200000;
export const ALLOW_PRIORITY = 1000000;

export function hostFromUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.hostname.toLowerCase().replace(/\.$/, "");
  } catch { return null; }
}

export function validHost(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 253 &&
    /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value) && !value.includes("..") &&
    hostFromUrl(`https://${value}`) === value;
}

export function hostWithin(host, parent) {
  return host === parent || host.endsWith(`.${parent}`);
}

// User network rules accept domain names, never URLs, wildcards or IP literals.
export function validNetworkDomain(value) {
  if (!validHost(value) || !value.includes(".") || value.endsWith(".localhost")) return false;
  const labels = value.split(".");
  return labels.every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) &&
    !/^\d+$/.test(labels.at(-1));
}

export function validSelector(selector) {
  return typeof selector === "string" && selector.length > 0 && selector.length <= 2048 &&
    !/[{};\u0000-\u001f\u007f]/.test(selector) &&
    !/^(?:html|body|:root|\*)$/i.test(selector.trim());
}

export function validRuleAction(action) {
  return action === "hide" || action === "move";
}

export function normalizeState(raw) {
  const state = { version: 1, enabled: true, publicFiltersEnabled: true, trackingProtectionEnabled: false, errorMonitoringBlocked: false, videoAdBlockingEnabled: false, youtubeAdBlockingEnabled: false, fingerprintProtectionEnabled: false, globalPrivacyControlEnabled: false, privacySandboxBlocked: false, disabledSites: [], customRules: [], networkRules: [] };
  if (!raw || typeof raw !== "object") return state;
  if (typeof raw.enabled === "boolean") state.enabled = raw.enabled;
  if (typeof raw.publicFiltersEnabled === "boolean") state.publicFiltersEnabled = raw.publicFiltersEnabled;
  if (typeof raw.trackingProtectionEnabled === "boolean") state.trackingProtectionEnabled = raw.trackingProtectionEnabled;
  if (typeof raw.errorMonitoringBlocked === "boolean") state.errorMonitoringBlocked = raw.errorMonitoringBlocked;
  if (typeof raw.videoAdBlockingEnabled === "boolean") state.videoAdBlockingEnabled = raw.videoAdBlockingEnabled;
  if (typeof raw.youtubeAdBlockingEnabled === "boolean") state.youtubeAdBlockingEnabled = raw.youtubeAdBlockingEnabled;
  if (typeof raw.fingerprintProtectionEnabled === "boolean") state.fingerprintProtectionEnabled = raw.fingerprintProtectionEnabled;
  if (typeof raw.globalPrivacyControlEnabled === "boolean") state.globalPrivacyControlEnabled = raw.globalPrivacyControlEnabled;
  if (typeof raw.privacySandboxBlocked === "boolean") state.privacySandboxBlocked = raw.privacySandboxBlocked;
  if (Array.isArray(raw.disabledSites)) {
    state.disabledSites = [...new Set(raw.disabledSites.filter(validHost))].slice(0, MAX_DISABLED_SITES);
  }
  const ids = new Set();
  if (Array.isArray(raw.customRules)) {
    state.customRules = raw.customRules.filter(rule => {
      if (!rule || typeof rule.id !== "string" || !rule.id || ids.has(rule.id) ||
          !validHost(rule.site) || !validHost(rule.frameHost) || !validSelector(rule.selector) ||
          !(rule.action === undefined || validRuleAction(rule.action))) return false;
      ids.add(rule.id);
      return true;
    }).slice(0, MAX_CUSTOM_RULES).map(rule => ({
      id: rule.id, site: rule.site, frameHost: rule.frameHost, selector: rule.selector, action: rule.action ?? "hide",
      label: typeof rule.label === "string" ? rule.label.slice(0, 100) : rule.action === "move" ? "이동한 요소" : "숨긴 요소",
      enabled: rule.enabled !== false,
      createdAt: Number.isFinite(rule.createdAt) ? rule.createdAt : 0
    }));
  }
  if (Array.isArray(raw.networkRules)) {
    state.networkRules = raw.networkRules.filter(rule => {
      if (!rule || typeof rule.id !== "string" || !rule.id || ids.has(rule.id) ||
          !validNetworkDomain(rule.domain) || !(rule.site === null || validHost(rule.site))) return false;
      ids.add(rule.id);
      return true;
    }).slice(0, MAX_NETWORK_RULES).map(rule => ({
      id: rule.id, domain: rule.domain, site: rule.site, enabled: rule.enabled !== false,
      createdAt: Number.isFinite(rule.createdAt) ? rule.createdAt : 0
    }));
  }
  return state;
}

export function enabledForSite(state, site) {
  return !!site && state.enabled && !state.disabledSites.some(parent => hostWithin(site, parent));
}

export function contextFor(state, site, frameHost) {
  return {
    ok: true, site, frameHost,
    enabled: validHost(site) && validHost(frameHost) && enabledForSite(state, site),
    publicFiltersEnabled: state.publicFiltersEnabled !== false,
    rules: state.customRules.filter(rule => rule.enabled !== false && rule.site === site && rule.frameHost === frameHost)
  };
}

export function setSiteEnabled(state, site, enabled) {
  if (!validHost(site)) throw new Error("지원되는 웹사이트 주소가 아닙니다.");
  // Resuming a child also removes a parent pause so the toggle actually takes effect.
  const disabledSites = state.disabledSites.filter(parent =>
    !hostWithin(parent, site) && !(enabled && hostWithin(site, parent)));
  if (!enabled && !disabledSites.some(parent => hostWithin(site, parent))) disabledSites.push(site);
  if (disabledSites.length > MAX_DISABLED_SITES) throw new Error("사이트 예외는 최대 500개까지 저장할 수 있습니다.");
  return { ...state, disabledSites };
}

export function buildAllowRules(state) {
  if (!state.enabled) {
    return [{ id: 1, priority: ALLOW_PRIORITY, action: { type: "allow" }, condition: { urlFilter: "*" } }];
  }
  if (!state.disabledSites.length) return [];
  return [
    // Applies to the whole frame tree on the next navigation, including third-party iframes.
    { id: 2, priority: ALLOW_PRIORITY, action: { type: "allowAllRequests" },
      condition: { requestDomains: state.disabledSites, resourceTypes: ["main_frame"] } }
  ];
}

export function buildNetworkRules(state) {
  const rules = buildAllowRules(state);
  if (!state.enabled) return rules;
  rules.push(...privacyRules(state));
  rules.push(...videoRules(state));
  rules.push(...privacyApiRules(state));
  for (const [index, rule] of (state.networkRules || []).entries()) {
    if (rule.enabled === false) continue;
    rules.push({
      id: 10000 + index,
      priority: USER_BLOCK_PRIORITY,
      action: { type: "block" },
      condition: {
        requestDomains: [rule.domain],
        domainType: "thirdParty",
        resourceTypes: ["script", "image", "sub_frame", "xmlhttprequest", "ping", "other"],
        // Chrome tests the initiating frame's host, not the outermost page host.
        ...(rule.site === null ? {} : { initiatorDomains: [rule.site] })
      }
    });
  }
  return rules;
}
