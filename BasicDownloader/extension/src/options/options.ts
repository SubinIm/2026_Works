import { DEFAULT_SETTINGS, type ExtensionSettings } from "../shared/models.ts";
import { normalizePreferences } from "../shared/preferences.ts";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
async function load() {
  const r = await chrome.storage.local.get("settings"), saved = (r.settings ?? {}) as Partial<ExtensionSettings>;
  const s = { ...DEFAULT_SETTINGS, ...saved };
  $<HTMLInputElement>("root").value = s.downloadRoot;
  $<HTMLInputElement>("ffmpeg").value = s.ffmpegPath;
  $<HTMLInputElement>("max").value = String(s.maxCandidatesPerTab);
  $<HTMLInputElement>("partial").checked = s.keepPartialFiles;
  $<HTMLInputElement>('youtube-enabled').checked=s.youtubeEnabled===true;
  $<HTMLInputElement>('yt-dlp').value=s.ytDlpPath??'';
  $<HTMLInputElement>('js-runtime').value=s.jsRuntimePath??'';
  const result = await chrome.runtime.sendMessage({ type: "get_preferences" });
  const p = normalizePreferences(result.preferences);
  $<HTMLInputElement>("default-filename").value = p.defaultFilename;
  $<HTMLInputElement>("auto-probe").checked = p.autoProbe;
  $<HTMLInputElement>("batch-probe").checked = p.batchProbe;
  $<HTMLInputElement>("download-after-probe").checked = p.downloadAfterProbe;
  $<HTMLSelectElement>("view").value = p.viewMode;
  $<HTMLInputElement>("auto-title").checked = p.autoTitle;
  $<HTMLInputElement>("filename-template").value = p.filenameTemplate;
  $<HTMLInputElement>("group").checked = p.groupCandidates;
  $<HTMLInputElement>("notify").checked = p.notifyOnComplete;
}
$("save").onclick = async () => {
  try {
    const old = (await chrome.storage.local.get("settings")).settings ?? {};
    await chrome.storage.local.set({ settings: { ...old,
      downloadRoot: $<HTMLInputElement>("root").value.trim(), ffmpegPath: $<HTMLInputElement>("ffmpeg").value.trim(),
      maxCandidatesPerTab: Math.max(10, Math.min(500, Number($<HTMLInputElement>("max").value) || 100)),
      keepPartialFiles: $<HTMLInputElement>("partial").checked,
      youtubeEnabled:$<HTMLInputElement>('youtube-enabled').checked,ytDlpPath:$<HTMLInputElement>('yt-dlp').value.trim(),jsRuntimePath:$<HTMLInputElement>('js-runtime').value.trim(),
    } });
    const result = await chrome.runtime.sendMessage({ type: "save_preferences", preferences: {
      defaultFilename: $<HTMLInputElement>("default-filename").value,
      autoProbe: $<HTMLInputElement>("auto-probe").checked,
      batchProbe: $<HTMLInputElement>("batch-probe").checked,
      downloadAfterProbe: $<HTMLInputElement>("download-after-probe").checked,
      viewMode: $<HTMLSelectElement>("view").value, autoTitle: $<HTMLInputElement>("auto-title").checked,
      filenameTemplate: $<HTMLInputElement>("filename-template").value, groupCandidates: $<HTMLInputElement>("group").checked,
      notifyOnComplete: $<HTMLInputElement>("notify").checked,
    } });
    if (!result.ok) throw new Error("저장 실패");
    $<HTMLInputElement>("filename-template").value = result.preferences.filenameTemplate;
    $<HTMLInputElement>("default-filename").value = result.preferences.defaultFilename;
    $("status").textContent = "저장했습니다. 파일명 형식은 {title}, {quality}, {date}를 사용할 수 있습니다.";
  } catch { $("status").textContent = "설정을 저장하지 못했습니다. 확장을 새로고침한 뒤 다시 시도해 주세요."; }
};
void load().catch(() => { $("status").textContent = "설정을 읽지 못했습니다. 확장을 새로고침해 주세요."; });
