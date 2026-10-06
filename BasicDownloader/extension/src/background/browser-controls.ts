import { normalizePreferences, PREFERENCES_KEY, type ManagerPreferences } from "../shared/preferences.ts";

let preferenceWrites: Promise<void> = Promise.resolve();
export async function getPreferences(): Promise<ManagerPreferences> {
  await preferenceWrites;
  return normalizePreferences((await chrome.storage.local.get(PREFERENCES_KEY))[PREFERENCES_KEY]);
}
export async function configureView(preferences: ManagerPreferences): Promise<void> {
  await chrome.action?.setPopup({ popup: preferences.viewMode === "popup" ? "popup/popup.html" : "" });
  await chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: preferences.viewMode === "sidepanel" });
}
export function savePreferences(patch: unknown): Promise<ManagerPreferences> {
  let saved: ManagerPreferences;
  const mutation = preferenceWrites.then(async () => {
    const old = normalizePreferences((await chrome.storage.local.get(PREFERENCES_KEY))[PREFERENCES_KEY]);
    saved = normalizePreferences({ ...old, ...(patch && typeof patch === "object" ? patch : {}) });
    await chrome.storage.local.set({ [PREFERENCES_KEY]: saved });
    await configureView(saved);
  });
  preferenceWrites = mutation.catch(() => {});
  return mutation.then(() => saved!);
}
export async function openSidePanel(tabId: unknown): Promise<{ ok: true }> {
  if (!Number.isInteger(tabId) || (tabId as number) < 0) throw new Error("먼저 영상 탭을 선택해 주세요.");
  if (!chrome.sidePanel?.open) throw new Error("이 Chrome에서는 사이드바를 사용할 수 없습니다.");
  // Invoke before any await so the UI/context-menu click's activation is retained.
  await chrome.sidePanel.open({ tabId: tabId as number });
  return { ok: true };
}
export async function openPopup(): Promise<{ ok: true }> {
  if (!chrome.action?.openPopup) throw new Error("Chrome 도구 모음의 확장 아이콘을 눌러 주세요.");
  await savePreferences({ viewMode: "popup" });
  await chrome.action.openPopup();
  return { ok: true };
}
export function initializeBrowserControls(): void {
  void getPreferences().then(configureView).catch(() => console.error("Manager view configuration failed"));
  chrome.contextMenus?.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "stream-candidates" || info.menuItemId === "stream-sidepanel") {
      // Never download a context-menu srcUrl: it may be blob: or a segment.
      void openSidePanel(tab?.id).catch(() => console.error("Unable to open stream manager"));
    }
  });
  if (chrome.contextMenus) {
    void chrome.contextMenus.removeAll().then(() => {
      for (const [id, title] of [["stream-candidates", "이 탭의 다운로드 후보 보기"], ["stream-sidepanel", "다운로드 사이드바 열기"]]) {
        chrome.contextMenus.create({ id: id!, title: title!, contexts: ["page", "video", "audio", "link"], documentUrlPatterns: ["http://*/*", "https://*/*"] });
      }
    }).catch(() => console.error("Stream context menu setup failed"));
  }
}
export async function notifyJob(job: Record<string, any>, previousState?: string): Promise<void> {
  if (!chrome.notifications || !["completed", "failed", "unsupported_drm"].includes(job.state)
      || ["completed", "failed", "unsupported_drm"].includes(previousState ?? "")) return;
  if (!(await getPreferences()).notifyOnComplete) return;
  await chrome.notifications.create(`stream-job-${job.jobId}`, {
    type: "basic", iconUrl: chrome.runtime.getURL("icons/downloader.png"),
    title: job.state === "completed" ? "다운로드 완료" : "다운로드 확인 필요",
    // Avoid putting filenames, page titles or authenticated URLs on the lock screen.
    message: job.state === "completed" ? "영상 파일을 저장했습니다. 확장 목록에서 재생하거나 폴더를 열 수 있습니다." : "다운로드하지 못했습니다. 확장 목록에서 오류 안내를 확인해 주세요.",
  });
}
