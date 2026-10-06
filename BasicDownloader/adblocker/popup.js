const elements = Object.fromEntries([
  "overall-status", "global-toggle", "site-name", "site-status", "site-toggle",
  "site-note", "rule-count", "clear-rules", "clear-confirmation", "cancel-clear",
  "confirm-clear", "rules-list", "empty-rules", "feedback",
  "diagnostics-card", "refresh-diagnostics", "network-status", "content-status",
  "auto-hidden-count", "public-cosmetics-status", "menu-status", "diagnostics-note", "start-picker", "start-move-picker", "open-options", "open-sidebar",
].map((id) => [id, document.getElementById(id)]));

let state = null;
let site = null;
let tabId;
let busy = true;
let confirmingClear = false;
let refreshQueued = false;
let refreshRunning = false;
let mutationVersion = 0;
let diagnostics = null;
let diagnosticsLoading = true;
let diagnosticsError = "";
let diagnosticsVersion = 0;
let pageSupported = null;
const isSidePanel = document.body.dataset.surface === "sidepanel";
let windowId;
let targetVersion = 0;
let targetLoading = true;

function siteIsPaused() {
  return Boolean(site && state?.disabledSites.some((host) => site === host || site.endsWith(`.${host}`)));
}

function currentRules() {
  return state?.customRules.filter((rule) => rule.site === site) ?? [];
}

function setFeedback(message = "", isError = false) {
  elements.feedback.textContent = message;
  elements.feedback.dataset.error = String(isError);
}

function renderDiagnostics() {
  const loadingText = diagnosticsLoading ? "확인 중…" : "확인 불가";
  const supported = pageSupported === true;
  const contentReady = diagnostics?.contentReady === true;
  elements["diagnostics-card"].setAttribute("aria-busy", String(diagnosticsLoading));
  elements["refresh-diagnostics"].disabled = diagnosticsLoading;
  elements["network-status"].textContent = pageSupported === false ? "적용 대상 아님"
    : diagnostics?.networkEnabled === true ? "활성"
      : diagnostics?.networkEnabled === false ? "비활성" : loadingText;
  elements["content-status"].textContent = pageSupported === false ? "지원하지 않는 페이지"
    : contentReady ? "연결됨"
      : diagnostics?.contentReady === false ? "페이지 새로고침 필요" : loadingText;
  const count = diagnostics?.autoHiddenCount;
  elements["auto-hidden-count"].textContent = supported && contentReady && Number.isInteger(count) && count >= 0
    ? `${count}개` : diagnosticsLoading ? "확인 중…" : "확인 불가";
  elements["public-cosmetics-status"].textContent = pageSupported === false ? "적용 대상 아님"
    : diagnostics?.publicCosmeticsError ? "불러오기 실패"
      : diagnostics?.publicCosmeticsEnabled === true ? `${Number(diagnostics.publicSelectorCount || 0).toLocaleString()}개 규칙 적용`
        : contentReady ? "비활성 / 연결 중" : loadingText;
  elements["public-cosmetics-status"].title = diagnostics?.publicCosmeticsError || "현재 문서에 적용 가능한 공개 CSS 규칙 수이며, 숨긴 광고 수가 아닙니다.";
  elements["menu-status"].textContent = diagnostics?.menuReady === true ? "등록됨"
    : diagnostics?.menuReady === false ? "등록 실패" : loadingText;
  elements["content-status"].dataset.warning = String(supported && diagnostics?.contentReady === false);
  elements["menu-status"].dataset.warning = String(diagnostics?.menuReady === false);
  elements["content-status"].title = diagnostics?.contentError || "";
  elements["menu-status"].title = diagnostics?.menuError || "";
  elements["diagnostics-note"].title = diagnosticsError;
  elements["diagnostics-note"].textContent = diagnosticsError
    ? "상태를 확인하지 못했습니다. 확장 프로그램을 다시 로드한 뒤 상태를 확인해 주세요."
    : pageSupported === false ? "일반 http 또는 https 웹사이트에서 사용할 수 있습니다."
      : diagnostics?.contentReady === false ? "확장을 설치하거나 다시 로드했다면 이 웹페이지도 새로고침해 주세요."
        : diagnostics?.menuReady === false ? "우클릭 메뉴 등록에 실패했습니다. 아래 요소 선택 버튼을 사용하거나 확장을 다시 로드해 주세요."
          : "숨김 수는 현재 문서의 기본 규칙 기준입니다. 공개 필터의 규칙 수는 차단한 광고 수가 아닙니다.";
  elements["start-picker"].disabled = busy || targetLoading || !state?.enabled || !site || siteIsPaused() || !supported || !contentReady;
  elements["start-move-picker"].disabled = elements["start-picker"].disabled;
}

function render() {
  const locked = busy || targetLoading;
  const hasState = Boolean(state);
  const enabled = Boolean(state?.enabled);
  const paused = siteIsPaused();
  const rules = currentRules();

  elements["global-toggle"].disabled = locked || !hasState;
  elements["global-toggle"].setAttribute("aria-checked", String(enabled));
  elements["overall-status"].textContent = hasState
    ? enabled ? "광고 차단 설정 켜짐" : "전체 광고 차단 설정 꺼짐"
    : busy ? "설정을 불러오는 중…" : "설정을 불러오지 못했습니다";

  elements["site-name"].textContent = site ?? (!hasState ? busy ? "확인하는 중…" : "사이트를 확인하지 못했습니다" : "일반 웹사이트를 열어 주세요");
  elements["site-toggle"].disabled = locked || !hasState || !site;
  elements["site-toggle"].setAttribute("aria-checked", String(Boolean(site && !paused)));
  elements["site-status"].dataset.muted = String(!site || !enabled || paused);
  elements["site-status"].textContent = !hasState ? busy ? "잠시만 기다려 주세요." : "팝업을 다시 열어 주세요."
    : !site
    ? "크롬 내부 페이지에서는 사용할 수 없습니다."
    : paused ? "이 사이트에서 일시 중지됨"
      : enabled ? "이 사이트의 차단 설정 켜짐" : "전체 차단을 켜면 적용됩니다";
  elements["site-note"].textContent = site
    ? "하위 도메인에도 적용 · 변경 후 페이지 새로고침"
    : "http 또는 https 웹페이지에서 사용할 수 있습니다.";

  elements["rule-count"].textContent = hasState ? String(rules.length) : "—";
  elements["clear-rules"].disabled = locked || !site || rules.length === 0;
  if (rules.length === 0) confirmingClear = false;
  elements["clear-confirmation"].hidden = !confirmingClear;
  elements["cancel-clear"].disabled = locked;
  elements["confirm-clear"].disabled = locked;
  elements["empty-rules"].hidden = rules.length > 0;
  elements["empty-rules"].textContent = site
    ? "아직 직접 숨기거나 이동한 항목이 없습니다."
    : "웹사이트를 열면 저장한 항목을 확인할 수 있습니다.";

  elements["rules-list"].replaceChildren();
  for (const rule of [...rules].reverse()) {
    const row = document.createElement("li");
    row.className = "rule-row";
    const copy = document.createElement("div");
    copy.className = "rule-copy";
    const label = document.createElement("p");
    label.className = "rule-label";
    label.textContent = rule.label || (rule.action === "move" ? "직접 이동한 요소" : "직접 숨긴 요소");
    label.title = label.textContent;
    const detail = document.createElement("p");
    detail.className = "rule-detail";
    const date = new Date(rule.createdAt);
    const dateText = Number.isNaN(date.getTime()) ? "저장한 항목" : date.toLocaleDateString("ko-KR");
    const frameText = rule.frameHost && rule.frameHost !== site ? ` · ${rule.frameHost}` : "";
    const actionText = rule.action === "move" ? "화면 밖 이동" : "숨김";
    detail.textContent = `${actionText} · ${dateText}${frameText}${rule.enabled === false ? " · 일시 중지" : ""}`;
    detail.title = detail.textContent;
    copy.append(label, detail);
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "restore-button";
    restore.textContent = "복원";
    restore.setAttribute("aria-label", `${label.textContent} 복원`);
    restore.disabled = locked;
    restore.addEventListener("click", () => mutate(
      { type: "DELETE_RULE", id: rule.id },
      `${actionText} 규칙을 삭제했습니다. 이 규칙의 적용을 해제했습니다.`,
    ));
    row.append(copy, restore);
    elements["rules-list"].append(row);
  }
  renderDiagnostics();
}

async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "확장 프로그램에 연결하지 못했습니다.");
  if (!response.state || !Array.isArray(response.state.disabledSites) || !Array.isArray(response.state.customRules)) {
    throw new Error("설정 응답을 확인하지 못했습니다.");
  }
  return response;
}

async function refreshDiagnostics() {
  if (targetLoading) return;
  const version = ++diagnosticsVersion;
  diagnosticsLoading = true;
  diagnosticsError = "";
  diagnostics = null;
  renderDiagnostics();
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_DIAGNOSTICS", tabId });
    if (!response?.ok || !response.diagnostics) {
      throw new Error(response?.error || "진단 응답을 확인하지 못했습니다.");
    }
    if (version === diagnosticsVersion) diagnostics = response.diagnostics;
  } catch (error) {
    if (version === diagnosticsVersion) diagnosticsError = error.message || "페이지 상태를 확인하지 못했습니다.";
  } finally {
    if (version === diagnosticsVersion) {
      diagnosticsLoading = false;
      renderDiagnostics();
    }
  }
}

async function refresh() {
  if (busy || targetLoading || refreshRunning) {
    refreshQueued = true;
    return;
  }
  refreshRunning = true;
  const versionAtStart = mutationVersion;
  const targetAtStart = targetVersion;
  try {
    const response = await request({ type: "GET_STATE", tabId });
    // A local action may have started while this read was in flight.
    // Its response owns the UI until another refresh can read the new state.
    if (busy || targetLoading || versionAtStart !== mutationVersion || targetAtStart !== targetVersion) refreshQueued = true;
    else {
      state = response.state;
      site = response.site ?? null;
      render();
      void refreshDiagnostics();
    }
  } catch (error) {
    if (!busy && targetAtStart === targetVersion) setFeedback(error.message || "설정을 다시 불러오지 못했습니다.", true);
  } finally {
    refreshRunning = false;
    if (refreshQueued && !busy && !targetLoading) {
      refreshQueued = false;
      void refresh();
    }
  }
}

async function mutate(message, successMessage) {
  if (busy || targetLoading) return;
  busy = true;
  mutationVersion += 1;
  diagnosticsVersion += 1;
  diagnostics = null;
  diagnosticsLoading = false;
  setFeedback();
  render();
  try {
    const response = await request(message);
    state = response.state;
    confirmingClear = false;
    setFeedback(successMessage);
  } catch (error) {
    setFeedback(error.message || "변경 사항을 저장하지 못했습니다. 다시 시도해 주세요.", true);
  } finally {
    busy = false;
    render();
    void refreshDiagnostics();
    if (refreshQueued) {
      refreshQueued = false;
      void refresh();
    }
  }
}

elements["global-toggle"].addEventListener("click", () => {
  if (!state) return;
  void mutate({ type: "SET_ENABLED", enabled: !state.enabled }, "설정을 저장했습니다. 새로고침하면 광고 요청 차단 변경이 반영됩니다.");
});

elements["site-toggle"].addEventListener("click", () => {
  if (!site) return;
  void mutate({ type: "SET_SITE_ENABLED", site, enabled: siteIsPaused() }, "사이트 설정을 저장했습니다. 새로고침하면 광고 요청 차단 변경이 반영됩니다.");
});

elements["clear-rules"].addEventListener("click", () => {
  confirmingClear = true;
  render();
  elements["cancel-clear"].focus();
});

elements["cancel-clear"].addEventListener("click", () => {
  confirmingClear = false;
  render();
  elements["clear-rules"].focus();
});

elements["confirm-clear"].addEventListener("click", () => {
  if (!site) return;
  void mutate({ type: "CLEAR_SITE_RULES", site }, "이 사이트의 직접 숨김·이동 규칙을 모두 해제했습니다.");
});

elements["refresh-diagnostics"].addEventListener("click", () => void refreshDiagnostics());

elements["open-options"].addEventListener("click", async () => {
  try {
    await chrome.runtime.openOptionsPage();
    if (!isSidePanel) window.close();
  } catch {
    setFeedback("규칙 관리 화면을 열지 못했습니다. 확장 관리 화면의 ‘확장 프로그램 옵션’을 눌러 주세요.", true);
  }
});

async function startPicker(action) {
  if (busy || targetLoading || !site || !state?.enabled || siteIsPaused()) return;
  if (diagnostics?.contentReady !== true) {
    setFeedback("웹페이지를 새로고침한 뒤 다시 시도해 주세요.", true);
    return;
  }
  busy = true;
  setFeedback();
  render();
  try {
    const response = await chrome.runtime.sendMessage({ type: "START_PICKER", tabId, action });
    if (!response?.ok) throw new Error(response?.error || "요소 선택을 시작하지 못했습니다. 웹페이지를 새로고침해 주세요.");
    if (!isSidePanel) window.close();
    else setFeedback("웹페이지에서 대상을 선택해 주세요. 사이드바는 열린 상태로 유지됩니다.");
  } catch (error) {
    setFeedback(error.message || "웹페이지를 새로고침한 뒤 다시 시도해 주세요.", true);
  } finally {
    busy = false;
    render();
  }
}

elements["start-picker"].addEventListener("click", () => void startPicker("hide"));
elements["start-move-picker"].addEventListener("click", () => void startPicker("move"));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.adblockState) void refresh();
});

elements["open-sidebar"].addEventListener("click", async () => {
  try {
    // Call directly from this user gesture, without an intervening message hop.
    await chrome.sidePanel.open({ windowId });
    window.close();
  } catch {
    setFeedback("사이드바를 열지 못했습니다. 확장을 새로고침한 뒤 다시 시도해 주세요.", true);
  }
});

async function syncActiveTab() {
  const version = ++targetVersion;
  targetLoading = true;
  diagnosticsVersion++;
  diagnostics = null;
  pageSupported = null;
  site = null;
  confirmingClear = false;
  setFeedback();
  render();
  try {
    const [tab] = await chrome.tabs.query({ active: true, ...(Number.isInteger(windowId) ? { windowId } : { currentWindow: true }) });
    if (version !== targetVersion) return;
    tabId = tab?.id;
    windowId ??= tab?.windowId;
    elements["open-sidebar"].disabled = !chrome.sidePanel?.open || !Number.isInteger(windowId);
    try {
      const url = new URL(tab?.url);
      pageSupported = ["http:", "https:"].includes(url.protocol)
        && url.hostname !== "chromewebstore.google.com"
        && !(url.hostname === "chrome.google.com" && url.pathname.startsWith("/webstore"));
    } catch {
      pageSupported = false;
    }
  } catch (error) {
    if (version !== targetVersion) return;
    tabId = undefined;
    pageSupported = false;
    setFeedback(error.message || "현재 탭을 확인하지 못했습니다.", true);
  } finally {
    if (version === targetVersion) {
      targetLoading = false;
      void refresh();
    }
  }
}

async function initialize() {
  try { if (chrome.windows?.getCurrent) windowId = (await chrome.windows.getCurrent()).id; }
  catch { /* tabs.query still resolves the containing window. */ }
  busy = false;
  await syncActiveTab();
  if (isSidePanel) {
    chrome.tabs.onActivated.addListener(info => {
      if (info.windowId === windowId) void syncActiveTab();
    });
    chrome.tabs.onUpdated.addListener((id, change) => {
      if (id === tabId && (change.url || change.status)) void syncActiveTab();
    });
  }
}

void initialize();
