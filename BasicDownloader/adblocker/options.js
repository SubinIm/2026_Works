import { createBackup, MAX_BACKUP_BYTES } from "./backup.js";

const ids = [
  "tracking-protection-toggle", "error-monitoring-toggle", "video-ad-toggle", "youtube-ad-toggle", "fingerprint-toggle", "sandbox-toggle", "gpc-toggle",
  "global-status", "feedback", "rule-search", "refresh-state", "cosmetic-list", "cosmetic-count", "cosmetic-empty",
  "network-form", "network-fields", "network-domain", "network-site", "network-list", "network-count", "network-empty",
  "sites-list", "sites-count", "sites-empty", "export-backup", "import-file", "import-size-note", "import-preview",
  "import-filename", "import-custom-count", "import-network-count", "import-sites-count", "import-duplicates",
  "apply-import", "cancel-import",
  "public-filter-toggle", "public-filter-status", "public-filter-error", "public-filter-version", "public-filter-updated",
  "public-network-count", "public-cosmetic-count", "public-filter-sources",
];
const elements = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
let state = null;
let busy = false;
let refreshQueued = false;
let pendingImport = null;
let filterStatus = null;
let filterStatusLoading = false;

function setFeedback(message = "", error = false) {
  elements.feedback.textContent = message;
  elements.feedback.dataset.error = String(error);
}

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function matchesSearch(...values) {
  const query = elements["rule-search"].value.trim().toLocaleLowerCase();
  return !query || values.some(value => String(value ?? "").toLocaleLowerCase().includes(query));
}

function actionButton(text, label, onClick, danger = false) {
  const button = node("button", danger ? "danger" : "quiet", text);
  button.type = "button";
  button.disabled = busy || !state;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

function renderRule(rule, kind) {
  const network = kind === "network";
  const enabled = rule.enabled !== false;
  const label = network ? rule.domain : rule.label || (rule.action === "move" ? "직접 이동한 요소" : "직접 숨긴 요소");
  const row = node("li", "rule-row");
  row.dataset.paused = String(!enabled);
  const copy = node("div", "rule-copy");
  const title = node("p", "rule-title", label);
  if (!enabled) title.append(node("span", "rule-state", "일시 중지"));
  copy.append(title);
  if (network) {
    copy.append(node("p", "rule-detail", rule.site ? `요청을 보낸 사이트: ${rule.site} 및 하위 도메인` : "요청을 보낸 사이트: 전체"));
    copy.append(node("p", "rule-detail", "외부 배너 관련 요청 · 광고 도메인의 하위 도메인 포함"));
  } else {
    copy.append(node("p", "rule-detail", `동작: ${rule.action === "move" ? "화면 밖 이동" : "숨김"}`));
    copy.append(node("p", "rule-detail", `적용 사이트: ${rule.site}`));
    copy.append(node("p", "rule-detail", `요소가 있는 프레임: ${rule.frameHost}`));
    copy.append(node("code", "selector", rule.selector));
  }
  const actions = node("div", "rule-actions");
  const toggleType = network ? "SET_NETWORK_RULE_ENABLED" : "SET_RULE_ENABLED";
  const deleteType = network ? "DELETE_NETWORK_RULE" : "DELETE_RULE";
  actions.append(
    actionButton(enabled ? "일시 중지" : "다시 적용", `${label} ${enabled ? "일시 중지" : "다시 적용"}`, () => {
      void mutate({ type: toggleType, id: rule.id, enabled: !enabled }, enabled
        ? "규칙을 일시 중지했습니다. 요청 차단 변경은 페이지 새로고침 후 반영됩니다."
        : "규칙을 다시 켰습니다. 전체 차단과 사이트 차단이 켜져 있을 때 적용됩니다.");
    }),
    actionButton("삭제", `${label} 삭제`, () => {
      void mutate({ type: deleteType, id: rule.id }, "규칙을 삭제했습니다. 요청 차단 변경은 페이지 새로고침 후 반영됩니다.");
    }, true),
  );
  row.append(copy, actions);
  return row;
}

function renderRules(kind, rules) {
  const filtered = rules.filter(rule => kind === "network"
    ? matchesSearch(rule.domain, rule.site)
    : matchesSearch(rule.site, rule.frameHost, rule.label, rule.selector, rule.action === "move" ? "화면 밖 이동" : "숨김"));
  elements[`${kind}-list`].replaceChildren(...[...filtered].reverse().map(rule => renderRule(rule, kind)));
  elements[`${kind}-count`].textContent = state ? `${filtered.length} / ${rules.length}개` : "—";
  elements[`${kind}-empty`].hidden = filtered.length > 0;
  elements[`${kind}-empty`].textContent = !state ? busy ? "설정을 불러오는 중입니다." : "설정을 불러오지 못했습니다. 다시 불러오기를 눌러 주세요."
    : rules.length === 0 ? kind === "network" ? "직접 추가한 요청 규칙이 없습니다." : "웹페이지에서 우클릭하여 항목을 숨기거나 이동하면 이곳에 나타납니다."
      : "검색 조건에 맞는 규칙이 없습니다.";
}

function renderSites() {
  const sites = state?.disabledSites ?? [];
  const filtered = sites.filter(site => matchesSearch(site));
  elements["sites-count"].textContent = state ? `${filtered.length} / ${sites.length}개` : "—";
  elements["sites-list"].replaceChildren(...filtered.map(site => {
    const row = node("li", "rule-row");
    const copy = node("div", "rule-copy");
    copy.append(node("p", "rule-title", site), node("p", "rule-detail", "하위 도메인 포함 · 차단 일시 중지"));
    const actions = node("div", "rule-actions");
    actions.append(actionButton("차단 재개", `${site} 차단 재개`, () => {
      void mutate({ type: "SET_SITE_ENABLED", site, enabled: true }, "사이트 예외를 해제했습니다. 전체 차단이 켜져 있을 때 적용되며, 웹페이지를 새로고침해 주세요.");
    }));
    row.append(copy, actions);
    return row;
  }));
  elements["sites-empty"].hidden = filtered.length > 0;
  elements["sites-empty"].textContent = !state ? busy ? "설정을 불러오는 중입니다." : "설정을 불러오지 못했습니다."
    : sites.length ? "검색 조건에 맞는 사이트가 없습니다." : "모든 사이트에서 차단 설정을 따릅니다.";
}

function renderImport() {
  const preview = pendingImport?.preview;
  elements["import-preview"].hidden = !pendingImport;
  elements["apply-import"].disabled = busy || !state || !preview;
  elements["cancel-import"].disabled = busy || !pendingImport;
  if (!pendingImport) return;
  elements["import-filename"].textContent = pendingImport.name;
  elements["import-custom-count"].textContent = preview ? `${preview.added.customRules}개` : "확인 중…";
  elements["import-network-count"].textContent = preview ? `${preview.added.networkRules}개` : "확인 중…";
  elements["import-sites-count"].textContent = preview ? `${preview.added.disabledSites}개` : "확인 중…";
  elements["import-duplicates"].textContent = preview
    ? `중복 건너뛰기: 숨김·이동 ${preview.duplicates.customRules}개 · 요청 ${preview.duplicates.networkRules}개 · 사이트 ${preview.duplicates.disabledSites}개`
    : "현재 설정과 비교하고 있습니다.";
}

function renderPublicFilters() {
  elements["tracking-protection-toggle"].checked = state?.trackingProtectionEnabled === true;
  elements["error-monitoring-toggle"].checked = state?.errorMonitoringBlocked === true;
  elements["tracking-protection-toggle"].disabled = busy || !state;
  elements["error-monitoring-toggle"].disabled = busy || !state;
  elements["video-ad-toggle"].checked = state?.videoAdBlockingEnabled === true;
  elements["fingerprint-toggle"].checked = state?.fingerprintProtectionEnabled === true;
  elements["video-ad-toggle"].disabled = busy || !state;
  elements["youtube-ad-toggle"].checked = state?.youtubeAdBlockingEnabled === true;
  elements["youtube-ad-toggle"].disabled = busy || !state;
  elements["fingerprint-toggle"].disabled = busy || !state;
  elements["sandbox-toggle"].checked = state?.privacySandboxBlocked === true;
  elements["gpc-toggle"].checked = state?.globalPrivacyControlEnabled === true;
  elements["sandbox-toggle"].disabled = busy || !state;
  elements["gpc-toggle"].disabled = busy || !state;
  elements["public-filter-toggle"].checked = state?.publicFiltersEnabled !== false;
  elements["public-filter-toggle"].disabled = busy || !state || filterStatusLoading;
  const actual = filterStatus?.enabled;
  const desired = state?.publicFiltersEnabled !== false;
  elements["public-filter-status"].textContent = filterStatusLoading ? "적용 상태를 확인하는 중입니다."
    : actual === true && desired ? state?.enabled === false ? "필터 준비됨 · 전체 차단은 꺼져 있습니다." : "공개 필터 적용 중"
      : actual === false && !desired ? "공개 필터 꺼짐" : "공개 필터 적용 확인 필요";
  elements["public-filter-error"].textContent = filterStatus?.error || "";
  elements["public-filter-error"].hidden = !filterStatus?.error;
  const metadata = filterStatus?.metadata;
  elements["public-filter-version"].textContent = typeof metadata?.filterVersion === "string" ? metadata.filterVersion : "정보 없음";
  const generatedAt = metadata?.generatedAt ? new Date(metadata.generatedAt) : null;
  elements["public-filter-updated"].textContent = generatedAt && !Number.isNaN(generatedAt.getTime())
    ? generatedAt.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "정보 없음";
  const count = value => Number.isInteger(value) && value >= 0 ? `${value.toLocaleString("ko-KR")}개` : "정보 없음";
  elements["public-network-count"].textContent = count(metadata?.network?.ruleCount);
  elements["public-cosmetic-count"].textContent = count(metadata?.cosmetic?.selectorCount);
  const sources = Array.isArray(metadata?.sources) ? metadata.sources.filter(source => source && typeof source === "object") : [];
  elements["public-filter-sources"].replaceChildren(...sources.map(source => {
    const item = node("li", "");
    const name = typeof source.name === "string" ? source.name : "공개 필터";
    let url;
    try { url = new URL(source.url); } catch { /* Invalid packaged link remains plain text. */ }
    if (url?.protocol === "https:") {
      const link = node("a", "", name);
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      item.append(link);
    } else item.append(document.createTextNode(name));
    const details = [source.sourceVersion, source.license].filter(value => typeof value === "string" && value);
    if (details.length) item.append(document.createTextNode(` · ${details.join(" · ")}`));
    return item;
  }));
}

function render() {
  elements["global-status"].textContent = !state ? busy ? "불러오는 중…" : "연결 확인 필요"
    : state.enabled ? "전체 차단 켜짐" : "전체 차단 꺼짐";
  elements["global-status"].dataset.paused = String(state?.enabled === false);
  elements["refresh-state"].disabled = busy;
  elements["network-fields"].disabled = busy || !state;
  elements["export-backup"].disabled = busy || !state;
  elements["import-file"].disabled = busy || !state;
  renderRules("cosmetic", state?.customRules ?? []);
  renderRules("network", state?.networkRules ?? []);
  renderSites();
  renderImport();
  renderPublicFilters();
}

async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "확장 프로그램에 연결하지 못했습니다. 확장을 다시 로드한 뒤 시도해 주세요.");
  return response;
}

function acceptState(response) {
  if (!response.state || !Array.isArray(response.state.customRules) || !Array.isArray(response.state.networkRules) || !Array.isArray(response.state.disabledSites)) {
    throw new Error("설정 응답을 읽지 못했습니다. 확장을 다시 로드한 뒤 시도해 주세요.");
  }
  state = response.state;
}

async function refreshFilterStatus() {
  filterStatusLoading = true;
  renderPublicFilters();
  try {
    const response = await request({ type: "GET_FILTER_STATUS" });
    if (!response.filterStatus || ![true, false, null].includes(response.filterStatus.enabled)) throw new Error("공개 필터 적용 상태를 확인하지 못했습니다.");
    filterStatus = response.filterStatus;
  } catch (error) {
    filterStatus = { enabled: null, metadata: null, error: error.message || "공개 필터 정보를 불러오지 못했습니다." };
  } finally {
    filterStatusLoading = false;
    renderPublicFilters();
  }
}

async function getPreview(backup) {
  const { preview } = await request({ type: "PREVIEW_IMPORT_BACKUP", backup });
  if (!["added", "duplicates", "totals"].every(group => ["customRules", "networkRules", "disabledSites"].every(key =>
    Number.isInteger(preview?.[group]?.[key]) && preview[group][key] >= 0))) {
    throw new Error("백업 미리보기를 확인하지 못했습니다.");
  }
  return preview;
}

function clearImport() {
  pendingImport = null;
  elements["import-file"].value = "";
}

async function refreshPendingImport() {
  if (!pendingImport) return;
  pendingImport.preview = null;
  renderImport();
  try {
    pendingImport.preview = await getPreview(pendingImport.backup);
  } catch (error) {
    clearImport();
    setFeedback(`현재 설정에서 백업을 가져올 수 없습니다. ${error.message}`, true);
  }
}

function finishOperation() {
  busy = false;
  render();
  if (refreshQueued) {
    refreshQueued = false;
    void refresh();
  }
}

async function refresh() {
  if (busy) { refreshQueued = true; return; }
  busy = true;
  render();
  try {
    const [stateResult] = await Promise.allSettled([request({ type: "GET_STATE" }), refreshFilterStatus()]);
    if (stateResult.status === "rejected") throw stateResult.reason;
    acceptState(stateResult.value);
    await refreshPendingImport();
  } catch (error) {
    setFeedback(error.message || "설정을 불러오지 못했습니다.", true);
  } finally {
    finishOperation();
  }
}

async function mutate(message, success, afterSuccess) {
  if (busy || !state) return;
  busy = true;
  setFeedback();
  render();
  try {
    acceptState(await request(message));
    afterSuccess?.();
    setFeedback(success);
    await refreshPendingImport();
  } catch (error) {
    setFeedback(error.message || "변경 사항을 저장하지 못했습니다.", true);
  } finally {
    if (message.type === "SET_PUBLIC_FILTERS_ENABLED") await refreshFilterStatus();
    finishOperation();
  }
}

elements["rule-search"].addEventListener("input", render);
for (const [id, setting] of [["tracking-protection-toggle", "trackingProtectionEnabled"], ["error-monitoring-toggle", "errorMonitoringBlocked"], ["video-ad-toggle", "videoAdBlockingEnabled"], ["youtube-ad-toggle", "youtubeAdBlockingEnabled"], ["fingerprint-toggle", "fingerprintProtectionEnabled"], ["sandbox-toggle", "privacySandboxBlocked"], ["gpc-toggle", "globalPrivacyControlEnabled"]]) {
  elements[id].addEventListener("change", () => void mutate({ type: "SET_PRIVACY_PROTECTION", setting, enabled: elements[id].checked }, "설정을 저장했습니다. 웹페이지를 새로고침해 적용해 주세요."));
}
elements["refresh-state"].addEventListener("click", () => { setFeedback(); void refresh(); });
elements["public-filter-toggle"].addEventListener("change", () => {
  const enabled = elements["public-filter-toggle"].checked;
  void mutate({ type: "SET_PUBLIC_FILTERS_ENABLED", enabled }, enabled
    ? "공개 필터를 켰습니다. 전체 차단과 사이트 차단이 켜져 있을 때 적용됩니다. 웹페이지를 새로고침해 주세요."
    : "공개 필터를 껐습니다. 직접 저장한 규칙은 유지됩니다. 웹페이지를 새로고침해 주세요.");
});
elements["network-form"].addEventListener("submit", event => {
  event.preventDefault();
  if (busy || !state) return;
  const domain = elements["network-domain"].value.trim().toLowerCase();
  const site = elements["network-site"].value.trim().toLowerCase() || null;
  void mutate({ type: "ADD_NETWORK_RULE", domain, site }, "요청 규칙을 저장했습니다. 해당 웹페이지를 새로고침해 주세요.", () => elements["network-form"].reset());
});

elements["export-backup"].addEventListener("click", () => {
  if (busy || !state) return;
  busy = true;
  render();
  let url;
  try {
    const backup = createBackup(state);
    url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `basic-banner-blocker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setFeedback("백업 파일 다운로드를 요청했습니다. 브라우저의 다운로드 목록을 확인하세요.");
  } catch (error) {
    setFeedback(error.message || "백업을 만들지 못했습니다.", true);
  } finally {
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    finishOperation();
  }
});

elements["import-size-note"].textContent = `최대 ${MAX_BACKUP_BYTES / 1024 / 1024} MB · 파일 내용을 먼저 확인한 후 별도로 적용합니다.`;
elements["import-file"].addEventListener("change", async () => {
  if (busy || !state) return;
  const file = elements["import-file"].files?.[0];
  clearImport();
  if (!file) { renderImport(); return; }
  busy = true;
  setFeedback("백업 파일을 확인하고 있습니다…");
  render();
  try {
    if (file.size > MAX_BACKUP_BYTES) throw new Error(`백업 파일은 ${MAX_BACKUP_BYTES / 1024 / 1024} MB 이하여야 합니다.`);
    let backup;
    try { backup = JSON.parse(await file.text()); }
    catch { throw new Error("JSON 백업 파일을 읽지 못했습니다. 올바른 백업 파일을 선택해 주세요."); }
    const preview = await getPreview(backup);
    pendingImport = { backup, preview, name: file.name };
    setFeedback("가져올 내용을 확인하세요. 아직 설정은 변경되지 않았습니다.");
  } catch (error) {
    clearImport();
    setFeedback(error.message || "백업을 확인하지 못했습니다.", true);
  } finally {
    finishOperation();
  }
});

elements["cancel-import"].addEventListener("click", () => {
  if (busy) return;
  clearImport();
  setFeedback("가져오기를 취소했습니다.");
  renderImport();
});
elements["apply-import"].addEventListener("click", () => {
  if (busy || !pendingImport?.preview) return;
  void mutate({ type: "IMPORT_BACKUP", backup: pendingImport.backup }, "백업 내용을 병합했습니다. 전체 차단 설정은 유지됩니다. 웹페이지를 새로고침해 주세요.", clearImport);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.adblockState) void refresh();
});
void refresh();
