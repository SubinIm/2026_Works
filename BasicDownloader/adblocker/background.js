import {
  STATE_KEY, MAX_CUSTOM_RULES, MAX_NETWORK_RULES, normalizeState, hostFromUrl, validHost, validSelector, validNetworkDomain, validRuleAction,
  contextFor, enabledForSite, setSiteEnabled, buildNetworkRules
} from "./state.js";
import { previewImport, mergeBackup } from "./backup.js";
import { protectionRegistrations, PROTECTION_SCRIPT_IDS } from "./protection.js";
import "./cosmetic-filters.js";

const MENU_ID = "basic-banner-blocker-hide";
const MOVE_MENU_ID = "basic-banner-blocker-move";
const ruleUndos = new Map();
const UNDO_TTL_MS = 60_000;
const PUBLIC_RULESET_ID = "public_ads";
let pending = Promise.resolve();
let menuTask = null;
let menuStatus = { ready: false, error: null };
let publicFilterError = null;
let publicCosmeticData = null;
const readOnlyMessages = new Set(["GET_CONTEXT", "GET_STATE", "GET_DIAGNOSTICS", "START_PICKER", "PREVIEW_IMPORT_BACKUP", "GET_FILTER_STATUS", "GET_PUBLIC_COSMETICS"]);
const pickerRelayMessages = new Set(["PICKER_BRIDGE", "PICKER_COMMAND"]);
const pickerEvents = new Set(["show", "update", "close", "toast"]);
const pickerCommands = new Set(["parent", "child", "preview", "save", "cancel", "status", "undo"]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}

// Serialize writes from popups and frames, including simultaneous save/undo actions.
function serialize(operation) {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
}

async function readState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return normalizeState(stored[STATE_KEY]);
}

async function syncNetwork(state) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(rule => rule.id), addRules: buildNetworkRules(state)
  });
}

async function applyProtectionScripts(desired) {
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: PROTECTION_SCRIPT_IDS });
  const before = new Set(existing.map(script => script.id));
  const after = new Set(desired.map(script => script.id));
  const removed = existing.filter(script => !after.has(script.id)).map(script => script.id);
  const updated = desired.filter(script => before.has(script.id));
  const added = desired.filter(script => !before.has(script.id));
  try {
    if (removed.length) await chrome.scripting.unregisterContentScripts({ ids: removed });
    if (updated.length) await chrome.scripting.updateContentScripts(updated);
    if (added.length) await chrome.scripting.registerContentScripts(added);
  } catch (error) {
    // A mixed update can succeed partially. Restore the exact managed snapshot.
    const current = await chrome.scripting.getRegisteredContentScripts({ ids: PROTECTION_SCRIPT_IDS });
    if (JSON.stringify(current) !== JSON.stringify(existing)) {
      try {
        if (current.length) await chrome.scripting.unregisterContentScripts({ ids: current.map(script => script.id) });
        if (existing.length) await chrome.scripting.registerContentScripts(existing);
      } catch (rollback) { throw new Error(`${error.message} 보호 스크립트를 복구하지 못했습니다. ${rollback.message}`); }
    }
    throw error;
  }
}

async function restoreRulesets(previous) {
  const current = await chrome.declarativeNetRequest.getEnabledRulesets();
  const enableRulesetIds = previous.filter(id => !current.includes(id));
  const disableRulesetIds = current.filter(id => !previous.includes(id));
  if (enableRulesetIds.length || disableRulesetIds.length) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
  }
}

async function syncPublicFilters(state) {
  try {
    const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
    // Keep local, reviewed rules available even if the larger pack exceeds the
    // browser's available static-rule quota. Each update is independently atomic.
    if (!enabled.includes("banner_ads")) await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ["banner_ads"] });
    const desired = state.publicFiltersEnabled !== false;
    if (enabled.includes(PUBLIC_RULESET_ID) !== desired) {
      await chrome.declarativeNetRequest.updateEnabledRulesets(desired
        ? { enableRulesetIds: [PUBLIC_RULESET_ID] } : { disableRulesetIds: [PUBLIC_RULESET_ID] });
    }
    publicFilterError = null;
  } catch (error) {
    publicFilterError = `공개 필터 적용을 확인하지 못했습니다. ${error.message}`;
    throw error;
  }
}

async function filterStatus(state) {
  const status = { enabled: null, requestedEnabled: state.publicFiltersEnabled !== false, metadata: null, error: null };
  const errors = [];
  try {
    const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
    status.enabled = enabled.includes(PUBLIC_RULESET_ID);
    if (status.enabled !== status.requestedEnabled) errors.push(publicFilterError || "저장한 공개 필터 설정과 실제 적용 상태가 다릅니다. 다시 적용하거나 확장을 새로고침해 주세요.");
  } catch (error) { errors.push(`공개 필터 적용 상태를 읽지 못했습니다. ${error.message}`); }
  try {
    const response = await fetch(chrome.runtime.getURL("filters/manifest.json"));
    if (!response.ok) throw new Error("배포 파일이 없습니다.");
    const metadata = await response.json();
    if (!metadata || metadata.schemaVersion !== 1 || !Array.isArray(metadata.sources) ||
        !metadata.sources.every(source => source && typeof source === "object" && typeof source.name === "string" && typeof source.url === "string") ||
        !Number.isInteger(metadata.network?.ruleCount) || metadata.network.ruleCount < 0) throw new Error("배포 정보 형식이 올바르지 않습니다.");
    status.metadata = metadata;
  } catch (error) { errors.push(`공개 필터 배포 정보를 읽지 못했습니다. ${error.message}`); }
  status.error = errors.length ? errors.join(" ") : null;
  return status;
}

async function selectedPublicCosmetics(host) {
  if (!publicCosmeticData) {
    publicCosmeticData = (async () => {
      const response = await fetch(chrome.runtime.getURL("filters/cosmetic.json"));
      if (!response.ok) throw new Error("공개 요소 숨김 배포 파일을 읽지 못했습니다.");
      const data = await response.json();
      if (data?.version !== 1) throw new Error("공개 요소 숨김 배포 형식이 올바르지 않습니다.");
      return data;
    })().catch(error => { publicCosmeticData = null; throw error; });
  }
  return globalThis.BasicPublicCosmetics.select(await publicCosmeticData, host);
}

async function writeState(previous, next, forcePublic = false) {
  const changedNetwork = previous.enabled !== next.enabled ||
    previous.trackingProtectionEnabled !== next.trackingProtectionEnabled ||
    previous.errorMonitoringBlocked !== next.errorMonitoringBlocked ||
    previous.videoAdBlockingEnabled !== next.videoAdBlockingEnabled ||
    previous.globalPrivacyControlEnabled !== next.globalPrivacyControlEnabled ||
    previous.privacySandboxBlocked !== next.privacySandboxBlocked ||
    JSON.stringify(previous.disabledSites) !== JSON.stringify(next.disabledSites) ||
    JSON.stringify(previous.networkRules) !== JSON.stringify(next.networkRules);
  const changedPublic = forcePublic || previous.publicFiltersEnabled !== next.publicFiltersEnabled;
  const changedScripts = previous.enabled !== next.enabled || previous.fingerprintProtectionEnabled !== next.fingerprintProtectionEnabled ||
    previous.youtubeAdBlockingEnabled !== next.youtubeAdBlockingEnabled ||
    previous.globalPrivacyControlEnabled !== next.globalPrivacyControlEnabled || previous.privacySandboxBlocked !== next.privacySandboxBlocked ||
    JSON.stringify(previous.disabledSites) !== JSON.stringify(next.disabledSites);
  const previousScripts = changedScripts ? await chrome.scripting.getRegisteredContentScripts({ ids: PROTECTION_SCRIPT_IDS }) : null;
  const previousDynamic = changedNetwork ? await chrome.declarativeNetRequest.getDynamicRules() : null;
  const previousStatic = changedPublic ? await chrome.declarativeNetRequest.getEnabledRulesets() : null;
  let dynamicApplied = false;
  let staticApplied = false;
  let scriptsApplied = false;
  try {
    if (changedPublic) { await syncPublicFilters(next); staticApplied = true; }
    if (changedNetwork) { await syncNetwork(next); dynamicApplied = true; }
    if (changedScripts) { await applyProtectionScripts(protectionRegistrations(next)); scriptsApplied = true; }
    await chrome.storage.local.set({ [STATE_KEY]: next });
    // Once another edit changes a rule, a former picker must not undo that edit.
    for (const [token, undo] of ruleUndos) {
      const current = next.customRules.find(rule => rule.id === undo.after.id);
      if (undo.expiresAt <= Date.now() || JSON.stringify(current) !== JSON.stringify(undo.after)) ruleUndos.delete(token);
    }
  } catch (error) {
    const rollbackErrors = [];
    if (scriptsApplied) {
      try { await applyProtectionScripts(previousScripts); } catch (rollback) { rollbackErrors.push(rollback.message); }
    }
    if (dynamicApplied) {
      try {
        const current = await chrome.declarativeNetRequest.getDynamicRules();
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: current.map(rule => rule.id), addRules: previousDynamic });
      } catch (rollback) { rollbackErrors.push(rollback.message); }
    }
    if (changedPublic) {
      // A failed public-pack enable can still have repaired the local ruleset.
      // Restore the exact prior static state before reporting the failed write.
      try { await restoreRulesets(previousStatic); } catch (rollback) { rollbackErrors.push(rollback.message); }
    }
    if (staticApplied && !rollbackErrors.length) publicFilterError = null;
    if (rollbackErrors.length) throw new Error(`${error.message} 이전 필터 상태도 복구하지 못했습니다. 확장을 새로고침해 주세요. ${rollbackErrors.join(" ")}`);
    throw error;
  }
}

function isSettings(sender) {
  return sender.id === chrome.runtime.id &&
    ["popup.html", "sidepanel.html", "options.html"].some(path => sender.url?.split("#")[0] === chrome.runtime.getURL(path));
}

function senderContext(sender) {
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.tab.id === undefined) {
    throw new Error("웹페이지에서만 요소를 숨길 수 있습니다.");
  }
  const site = hostFromUrl(sender.tab.url);
  // The browser supplies the inherited origin for about:blank/srcdoc frames.
  // Never accept a frame host sent as part of a page message.
  const frameHost = hostFromUrl(sender.url) || hostFromUrl(sender.origin);
  if (!validHost(site) || !validHost(frameHost)) throw new Error("이 페이지에서는 요소 숨기기를 지원하지 않습니다.");
  return { site, frameHost };
}

function requireSettings(sender) {
  if (!isSettings(sender)) throw new Error("확장 프로그램 팝업 또는 규칙 관리 화면에서 설정을 변경해 주세요.");
}

function validPickerToken(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function requestedAction(value) {
  if (value === undefined) return "hide";
  if (!validRuleAction(value)) throw new Error("지원하지 않는 요소 처리 방식입니다.");
  return value;
}

function undoOwner(sender) {
  const { site, frameHost } = senderContext(sender);
  return JSON.stringify([site, frameHost, sender.tab.id, sender.frameId ?? 0, sender.documentId ?? null]);
}

function pickerViewPayload(payload) {
  if (payload == null) return {};
  if (typeof payload !== "object" || Array.isArray(payload) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(payload))) {
    throw new Error("요소 선택 화면의 상태가 올바르지 않습니다.");
  }
  const entries = Object.entries(payload);
  if (entries.length > 32 || entries.some(([key, value]) => key.length > 80 ||
      !(value === null || typeof value === "boolean" || (typeof value === "string" && value.length <= 4096) ||
        (typeof value === "number" && Number.isFinite(value))))) {
    throw new Error("요소 선택 화면의 상태가 올바르지 않습니다.");
  }
  const view = Object.fromEntries(entries);
  if (view.action !== undefined) view.action = requestedAction(view.action);
  if (view.undoToken !== undefined && view.undoToken !== null && !validPickerToken(view.undoToken)) {
    throw new Error("되돌리기 연결 정보가 올바르지 않습니다.");
  }
  return view;
}

async function relayPickerMessage(message, sender) {
  const context = senderContext(sender);
  if (!Number.isInteger(sender.tab.id) || sender.tab.id < 0 || !validPickerToken(message.token)) {
    throw new Error("요소 선택 화면의 연결 정보가 올바르지 않습니다.");
  }
  let forwarded;
  let target;
  if (message.type === "PICKER_BRIDGE") {
    if (!Number.isInteger(sender.frameId) || sender.frameId <= 0 || !pickerEvents.has(message.event)) {
      throw new Error("광고 프레임에서만 요소 선택 상태를 전달할 수 있습니다.");
    }
    const payload = pickerViewPayload(message.payload);
    if (message.event === "show" || message.event === "update") Object.assign(payload, context, { action: requestedAction(payload.action) });
    forwarded = {
      type: "FRAME_PICKER_EVENT", event: message.event, token: message.token, payload,
      sourceFrameId: sender.frameId, sourceDocumentId: sender.documentId || null
    };
    target = { frameId: 0 };
  } else {
    if (sender.frameId !== 0 || !Number.isInteger(message.frameId) || message.frameId <= 0 ||
        !pickerCommands.has(message.command) ||
        !(message.documentId == null || validPickerToken(message.documentId))) {
      throw new Error("본문의 요소 선택 화면에서만 광고 프레임을 조작할 수 있습니다.");
    }
    forwarded = { type: "FRAME_PICKER_COMMAND", token: message.token, command: message.command };
    target = { frameId: message.frameId, ...(message.documentId ? { documentId: message.documentId } : {}) };
  }
  try {
    // The browser-supplied tab and document IDs prevent cross-tab commands or
    // delivery to a replacement document after a frame navigates.
    const response = await chrome.tabs.sendMessage(sender.tab.id, forwarded, target);
    if (!response || typeof response !== "object" || typeof response.ok !== "boolean") {
      throw new Error("요소 선택 화면에서 응답하지 않습니다. 페이지를 새로고침해 주세요.");
    }
    return response;
  } catch (error) {
    throw new Error(`요소 선택 화면에 연결하지 못했습니다. 페이지를 새로고침해 주세요. ${error.message}`);
  }
}

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string") throw new Error("잘못된 요청입니다.");
  const state = await readState();
  if (message.type === "GET_CONTEXT") {
    const { site, frameHost } = senderContext(sender);
    const context = contextFor(state, site, frameHost);
    try { context.publicFiltersEnabled = context.publicFiltersEnabled && (await chrome.declarativeNetRequest.getEnabledRulesets()).includes(PUBLIC_RULESET_ID); }
    catch { context.publicFiltersEnabled = false; }
    return context;
  }
  if (message.type === "GET_FILTER_STATUS") {
    requireSettings(sender);
    return { ok: true, filterStatus: await filterStatus(state) };
  }
  if (message.type === "GET_PUBLIC_COSMETICS") {
    const { frameHost } = senderContext(sender);
    // Return the same packaged host selection even while the switch is off.
    // Content gates application with GET_CONTEXT, so a concurrent toggle can
    // never leave a cached empty selection after the pack is enabled again.
    return { ok: true, selection: await selectedPublicCosmetics(frameHost) };
  }
  if (message.type === "GET_STATE") {
    requireSettings(sender);
    let site = null;
    if (Number.isInteger(message.tabId)) {
      try { site = hostFromUrl((await chrome.tabs.get(message.tabId)).url); } catch { /* Tab closed. */ }
    }
    return { ok: true, state, site: validHost(site) ? site : null };
  }
  if (message.type === "GET_DIAGNOSTICS") {
    requireSettings(sender);
    await ensureMenu();
    const diagnostics = {
      networkEnabled: null, menuReady: menuStatus.ready, menuError: menuStatus.error,
      contentReady: false, contentError: null, autoHiddenCount: null, manualHiddenCount: null,
      publicCosmeticsEnabled: false, publicSelectorCount: null, publicCosmeticsError: null
    };
    let site;
    try { site = hostFromUrl((await chrome.tabs.get(message.tabId)).url); } catch { /* Tab may be gone. */ }
    if (!validHost(site)) {
      diagnostics.contentError = "일반 HTTP/HTTPS 웹페이지에서 사용할 수 있습니다.";
      return { ok: true, diagnostics };
    }
    try {
      const rulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
      const activeRules = await chrome.declarativeNetRequest.getDynamicRules();
      const samePolicy = JSON.stringify(canonical(activeRules)) === JSON.stringify(canonical(buildNetworkRules(state)));
      const samePublicPolicy = rulesets.includes(PUBLIC_RULESET_ID) === state.publicFiltersEnabled;
      diagnostics.networkEnabled = samePolicy && samePublicPolicy ? rulesets.includes("banner_ads") && enabledForSite(state, site) : null;
    } catch { /* Unavailable is distinct from a disabled filter. */ }
    try {
      const response = await chrome.tabs.sendMessage(message.tabId, { type: "GET_PAGE_STATUS" }, { frameId: 0 });
      diagnostics.contentReady = response?.ok === true;
      if (!diagnostics.contentReady) diagnostics.contentError = response?.error || "페이지를 새로고침해 주세요.";
      if (Number.isInteger(response?.autoHiddenCount)) diagnostics.autoHiddenCount = response.autoHiddenCount;
      if (Number.isInteger(response?.manualHiddenCount)) diagnostics.manualHiddenCount = response.manualHiddenCount;
      if (typeof response?.publicCosmeticsEnabled === "boolean") diagnostics.publicCosmeticsEnabled = response.publicCosmeticsEnabled;
      if (Number.isInteger(response?.publicSelectorCount) && response.publicSelectorCount >= 0) diagnostics.publicSelectorCount = response.publicSelectorCount;
      if (typeof response?.publicCosmeticsError === "string") diagnostics.publicCosmeticsError = response.publicCosmeticsError;
    } catch {
      diagnostics.contentError = "페이지 연결이 없습니다. 이 사이트의 확장 권한을 허용하고 페이지를 새로고침해 주세요.";
    }
    return { ok: true, diagnostics };
  }
  if (message.type === "START_PICKER") {
    requireSettings(sender);
    const action = requestedAction(message.action);
    if (!Number.isInteger(message.tabId)) throw new Error("웹페이지를 먼저 열어 주세요.");
    const site = hostFromUrl((await chrome.tabs.get(message.tabId)).url);
    if (!enabledForSite(state, site)) throw new Error("먼저 이 사이트의 광고 차단을 켜 주세요.");
    try {
      const response = await chrome.tabs.sendMessage(message.tabId, { type: "START_PICKER", action }, { frameId: 0 });
      if (!response?.ok) throw new Error(response?.error || "요소 선택을 시작하지 못했습니다.");
      return { ok: true };
    } catch (error) {
      throw new Error(`페이지를 새로고침한 뒤 다시 선택해 주세요. ${error.message}`);
    }
  }
  if (message.type === "PREVIEW_IMPORT_BACKUP") {
    requireSettings(sender);
    return { ok: true, preview: previewImport(state, message.backup) };
  }
  let next = state;
  let savedRule;
  let previousRule = null;
  switch (message.type) {
    case "ADD_RULE": {
      const { site, frameHost } = senderContext(sender);
      const action = requestedAction(message.action);
      if (!enabledForSite(state, site)) throw new Error("먼저 이 사이트의 광고 차단을 켜 주세요.");
      if (!validSelector(message.selector)) throw new Error("이 요소는 안전하게 저장할 수 없습니다. 다른 영역을 선택해 주세요.");
      const duplicate = state.customRules.find(rule => rule.site === site &&
        rule.frameHost === frameHost && rule.selector === message.selector);
      if (duplicate) {
        if (duplicate.enabled !== false && duplicate.action === action) return { ok: true, rule: duplicate, state, undoToken: null };
        previousRule = duplicate;
        savedRule = { ...duplicate, action, enabled: true };
        next = { ...state, customRules: state.customRules.map(rule => rule.id === duplicate.id ? savedRule : rule) };
        break;
      }
      if (state.customRules.length >= MAX_CUSTOM_RULES) throw new Error("저장된 숨김·이동 규칙이 1,000개입니다. 기존 규칙을 정리해 주세요.");
      savedRule = {
        id: crypto.randomUUID(), site, frameHost, selector: message.selector, action,
        label: typeof message.label === "string" ? message.label.slice(0, 100) : action === "move" ? "이동한 요소" : "숨긴 요소",
        enabled: true,
        createdAt: Date.now()
      };
      next = { ...state, customRules: [...state.customRules, savedRule] };
      break;
    }
    case "UNDO_RULE": {
      const owner = undoOwner(sender);
      const undo = ruleUndos.get(message.undoToken);
      const current = undo && state.customRules.find(rule => rule.id === undo.after.id);
      if (!undo || undo.owner !== owner || undo.expiresAt <= Date.now() ||
          JSON.stringify(current) !== JSON.stringify(undo.after)) {
        throw new Error("되돌리기 시간이 지났거나 규칙이 변경되었습니다. 규칙 관리에서 확인해 주세요.");
      }
      next = { ...state, customRules: undo.before
        ? state.customRules.map(rule => rule.id === undo.after.id ? undo.before : rule)
        : state.customRules.filter(rule => rule.id !== undo.after.id) };
      break;
    }
    case "DELETE_RULE": {
      if (typeof message.id !== "string") throw new Error("숨김 규칙을 찾을 수 없습니다.");
      const rule = state.customRules.find(rule => rule.id === message.id);
      if (!isSettings(sender)) {
        const { site, frameHost } = senderContext(sender);
        if (rule && (rule.site !== site || rule.frameHost !== frameHost)) throw new Error("다른 사이트의 규칙은 변경할 수 없습니다.");
      }
      next = { ...state, customRules: state.customRules.filter(rule => rule.id !== message.id) };
      break;
    }
    case "SET_RULE_ENABLED": {
      requireSettings(sender);
      if (typeof message.enabled !== "boolean" || !state.customRules.some(rule => rule.id === message.id)) {
        throw new Error("숨김 규칙 또는 설정을 확인해 주세요.");
      }
      next = { ...state, customRules: state.customRules.map(rule => rule.id === message.id ? { ...rule, enabled: message.enabled } : rule) };
      break;
    }
    case "ADD_NETWORK_RULE": {
      requireSettings(sender);
      const domain = typeof message.domain === "string" ? message.domain.trim().toLowerCase() : "";
      if (!validNetworkDomain(domain)) throw new Error("광고 서버의 도메인만 입력해 주세요. 주소 경로, 와일드카드, IP 주소는 지원하지 않습니다.");
      if (!(message.site === null || validHost(message.site))) throw new Error("적용할 요청 출처의 호스트 이름을 확인해 주세요.");
      const duplicate = state.networkRules.find(rule => rule.domain === domain && rule.site === message.site);
      if (duplicate) {
        if (duplicate.enabled !== false) return { ok: true, state, rule: duplicate };
        savedRule = { ...duplicate, enabled: true };
        next = { ...state, networkRules: state.networkRules.map(rule => rule.id === duplicate.id ? savedRule : rule) };
        break;
      }
      if (state.networkRules.length >= MAX_NETWORK_RULES) throw new Error("요청 차단 규칙은 최대 1,000개까지 저장할 수 있습니다.");
      savedRule = { id: crypto.randomUUID(), domain, site: message.site, enabled: true, createdAt: Date.now() };
      next = { ...state, networkRules: [...state.networkRules, savedRule] };
      break;
    }
    case "DELETE_NETWORK_RULE":
      requireSettings(sender);
      if (typeof message.id !== "string") throw new Error("요청 차단 규칙을 찾을 수 없습니다.");
      next = { ...state, networkRules: state.networkRules.filter(rule => rule.id !== message.id) };
      break;
    case "SET_NETWORK_RULE_ENABLED":
      requireSettings(sender);
      if (typeof message.enabled !== "boolean" || !state.networkRules.some(rule => rule.id === message.id)) {
        throw new Error("요청 차단 규칙 또는 설정을 확인해 주세요.");
      }
      next = { ...state, networkRules: state.networkRules.map(rule => rule.id === message.id ? { ...rule, enabled: message.enabled } : rule) };
      break;
    case "IMPORT_BACKUP":
      requireSettings(sender);
      // The settings page previews first; revalidate against the latest state in
      // the write queue so intervening edits cannot bypass limits or overwrite it.
      next = mergeBackup(state, message.backup);
      break;
    case "CLEAR_SITE_RULES":
      requireSettings(sender);
      if (!validHost(message.site)) throw new Error("지원되는 웹사이트 주소가 아닙니다.");
      next = { ...state, customRules: state.customRules.filter(rule => rule.site !== message.site) };
      break;
    case "SET_ENABLED":
      requireSettings(sender);
      if (typeof message.enabled !== "boolean") throw new Error("잘못된 설정입니다.");
      next = { ...state, enabled: message.enabled };
      break;
    case "SET_PRIVACY_PROTECTION":
      requireSettings(sender);
      if (!["trackingProtectionEnabled", "errorMonitoringBlocked", "videoAdBlockingEnabled", "youtubeAdBlockingEnabled", "fingerprintProtectionEnabled", "globalPrivacyControlEnabled", "privacySandboxBlocked"].includes(message.setting) || typeof message.enabled !== "boolean") throw new Error("보호 설정을 확인해 주세요.");
      next = { ...state, [message.setting]: message.enabled };
      break;
    case "SET_PUBLIC_FILTERS_ENABLED":
      requireSettings(sender);
      if (typeof message.enabled !== "boolean") throw new Error("공개 필터 설정을 확인해 주세요.");
      next = { ...state, publicFiltersEnabled: message.enabled };
      break;
    case "SET_SITE_ENABLED":
      requireSettings(sender);
      if (typeof message.enabled !== "boolean") throw new Error("잘못된 설정입니다.");
      next = setSiteEnabled(state, message.site, message.enabled);
      break;
    default: throw new Error("지원하지 않는 요청입니다.");
  }
  // Retrying the same saved public setting can repair a quota/startup mismatch;
  // it still participates in the same rollback transaction as a new setting.
  await writeState(state, next, message.type === "SET_PUBLIC_FILTERS_ENABLED");
  if (message.type === "ADD_RULE") {
    const undoToken = crypto.randomUUID();
    ruleUndos.set(undoToken, { before: previousRule, after: savedRule, owner: undoOwner(sender), expiresAt: Date.now() + UNDO_TTL_MS });
    // Keep memory bounded even during unusually frequent picker saves.
    if (ruleUndos.size > MAX_CUSTOM_RULES) ruleUndos.delete(ruleUndos.keys().next().value);
    return { ok: true, state: next, rule: savedRule, undoToken };
  }
  return { ok: true, state: next, ...(savedRule ? { rule: savedRule } : {}) };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Content may ask GET_CONTEXT while START_PICKER is awaiting the page reply.
  // Only mutations own the write queue, avoiding a cross-context message deadlock.
  // Picker relays must not even wait on that queue: their receiving frame can
  // call ADD_RULE/DELETE_RULE and send a bridge update before replying.
  const response = pickerRelayMessages.has(message?.type)
    ? relayPickerMessage(message, sender)
    : readOnlyMessages.has(message?.type)
      ? pending.then(() => handleMessage(message, sender))
      : serialize(() => handleMessage(message, sender));
  response.then(sendResponse, error => {
    console.warn("Basic Banner Blocker:", error);
    sendResponse({ ok: false, error: error instanceof Error ? error.message : "요청을 처리하지 못했습니다." });
  });
  return true;
});

async function registerMenu() {
  await chrome.contextMenus.removeAll();
  for (const [id, title] of [[MENU_ID, "이 요소 숨기기…"], [MOVE_MENU_ID, "이 요소 이동시키기…"]]) await new Promise((resolve, reject) => {
    chrome.contextMenus.create({
      // URL restrictions also hide this menu inside about:blank/srcdoc ad frames.
      // Actual support is validated from the trusted sender when the menu is used.
      id, title, contexts: ["page", "frame", "selection", "link", "image"]
    }, () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve());
  });
}

function ensureMenu() {
  if (menuTask) return menuTask;
  menuTask = registerMenu().then(() => {
    menuStatus = { ready: true, error: null };
  }, error => {
    menuStatus = { ready: false, error: error.message };
    console.warn("우클릭 메뉴 등록:", error);
  }).finally(() => { menuTask = null; });
  return menuTask;
}

async function showPicker(info, tab) {
  if (![MENU_ID, MOVE_MENU_ID].includes(info.menuItemId) || tab?.id === undefined) return;
  const action = info.menuItemId === MOVE_MENU_ID ? "move" : "hide";
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: "PICK_ELEMENT", action }, { frameId: info.frameId ?? 0 });
    if (!result?.ok) throw new Error(result?.error || "선택한 요소를 찾을 수 없습니다.");
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    await chrome.action.setTitle({ tabId: tab.id, title: "Basic Banner Blocker" });
  } catch (error) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#b54708" });
    await chrome.action.setTitle({ tabId: tab.id,
      title: `요소 ${action === "move" ? "이동시키기" : "숨기기"}: ${error.message} 페이지를 새로고침한 뒤 다시 시도해 주세요.` });
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  showPicker(info, tab).catch(error => console.warn("요소 선택:", error));
});

function initialize() {
  // Menu registration must still succeed if a network-rule update fails.
  const menu = ensureMenu();
  const network = serialize(async () => {
    const state = await readState();
    // A public-pack quota failure must not prevent local blocking, menu
    // recovery, saved user rules or state migration from working.
    try { await syncNetwork(state); } catch (error) { console.error("기본 광고 차단 초기화:", error); }
    try { await syncPublicFilters(state); } catch (error) { console.error("공개 필터 초기화:", error); }
    try { await applyProtectionScripts(protectionRegistrations(state)); } catch (error) { console.error("보호 스크립트 초기화:", error); }
    await chrome.storage.local.set({ [STATE_KEY]: state });
  }).catch(error => console.error("광고 차단 초기화:", error));
  return Promise.all([menu, network]);
}

chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);
// Recover a missing menu on any worker wake, including an already open popup.
void ensureMenu();
