import type { MediaCandidate } from "../shared/models.ts";
import { youtubePageUrl } from "../shared/youtube-page.ts";
import { enrichJobDuration } from "../background/probe-duration-cache.ts";
import { BLOB_NOTICE, candidateControlState, hostHealthLabel, isHostReady, orderCandidates, presentHostResponse, presentJobProgress } from "./presentation.ts";
import { ACTIVE_STATES, MANAGER_DEFAULTS, candidateBadges, candidateGroupKey, candidateTitle, completedJobActions, hostSupportsManager, isRemovableJob, jobDisplayName, matchesJobFilter, safeThumbnail, suggestedFilename, type JobFilter, type ManagerPreferences } from "./manager-controls.ts";

const main = document.querySelector<HTMLElement>("#candidates")!;
const jobsPanel = document.querySelector<HTMLElement>("#jobs")!;
const health = document.querySelector<HTMLElement>("#health")!;
const page = document.querySelector<HTMLElement>("#page")!;
const managerMessage = document.querySelector<HTMLElement>("#manager-message")!;
const menu = document.querySelector<HTMLElement>("#job-menu")!;
const isSidepanel = typeof location !== "undefined" && new URL(location.href).searchParams.get("view") === "sidepanel";
document.querySelector("html")!.classList.toggle("sidepanel", isSidepanel);
document.querySelector("body")!.classList.toggle("sidepanel", isSidepanel);
// A disconnected worker/port must produce the same friendly error as a Host response.
const call = async (message: unknown): Promise<any> => {
  try { return await chrome.runtime.sendMessage(message); }
  catch { return { ok: false, error: "Native Host disconnected" }; }
};

interface JobView {
  message: HTMLElement;
  technical: HTMLDetailsElement;
  result: HTMLPreElement;
  cancel: HTMLButtonElement;
  open: HTMLButtonElement;
  copyError: HTMLButtonElement;
}
interface CandidateView {
  root: HTMLElement;
  update: (candidate: MediaCandidate) => void;
  updateControls: () => void;
  job: JobView;
}

let tabId = -1;
let hostReady = false;
let managerHostReady = false;
let optionalProbeSupported = false;
let audioOnlySupported = false;
let findingAV = false;
let searchRevision = 0;
interface SearchDownloadOptions { filename?:string; container:string; overwrite:string; probeBeforeDownload:boolean; }
interface AutoAttempt { tabId:number; pageUrl:string; revision:number; excludeIds:string[]; candidateId:string; downloadOptions?:SearchDownloadOptions; }
const automaticStarts = new Map<string,AutoAttempt>();
const automaticJobs = new Map<string,AutoAttempt>();
let selectedCandidateId: string | undefined;
let currentPageUrl = "";
let youtubeReady=false,youtubeBusy=false,youtubeError='',youtubeJobId:string|undefined,youtubeFilenamePage='';
function updateYoutubeControls():void {
  const url=youtubePageUrl(currentPageUrl),panel=document.querySelector<HTMLElement>('#youtube-panel')!;
  panel.classList.toggle('hidden',!url);
  document.querySelector<HTMLButtonElement>('#youtube-probe')!.disabled=!url||!youtubeReady||youtubeBusy;
  document.querySelector<HTMLButtonElement>('#youtube-download')!.disabled=!url||!youtubeReady||youtubeBusy;
  if(url&&youtubeFilenamePage!==url){
    youtubeFilenamePage=url;youtubeJobId=undefined;
    document.querySelector<HTMLInputElement>('#youtube-filename')!.value=preferences.autoTitle?(page.textContent??'YouTube video').replace(/\s*-\s*YouTube\s*$/,''):preferences.defaultFilename;
    document.querySelector('#youtube-status')!.textContent=youtubeReady?'쿠키 미전송 · 현재 영상 페이지 URL로 조회합니다.':youtubeError||'Host v0.3.0 및 YouTube 엔진 설정이 필요합니다.';
  }else if(url&&!youtubeReady&&!youtubeBusy)document.querySelector('#youtube-status')!.textContent=youtubeError||'Host v0.3.0 및 YouTube 엔진 설정이 필요합니다.';
}
function youtubeOptions(){
  const value=document.querySelector<HTMLSelectElement>('#youtube-height')!.value;
  return {filename:document.querySelector<HTMLInputElement>('#youtube-filename')!.value,maxHeight:value?Number(value):null,
    container:document.querySelector<HTMLSelectElement>('#youtube-container')!.value,audioOnly:document.querySelector<HTMLInputElement>('#youtube-audio-only')!.checked,
    probeBeforeDownload:document.querySelector<HTMLInputElement>('#youtube-input-probe')!.checked};
}
async function runYoutube(type:'youtube_probe'|'youtube_download'):Promise<void>{
  if(youtubeBusy||!youtubeReady||!youtubePageUrl(currentPageUrl))return;
  const scopedPage=currentPageUrl,scopedTab=tabId;
  youtubeBusy=true;updateYoutubeControls();
  const status=document.querySelector<HTMLElement>('#youtube-status')!;
  status.textContent=type==='youtube_probe'?'YouTube 저장 형식을 확인하는 중입니다…':'YouTube 다운로드를 시작하는 중입니다…';
  try{
    const response=await call({type,tabId:scopedTab,pageUrl:scopedPage,options:youtubeOptions()});
    if(scopedPage!==currentPageUrl||scopedTab!==tabId)return;
    const payload=response?.payload??{};
    if(type==='youtube_probe'&&response.type==='probe_result'){
      status.textContent=`쿠키 미전송 · 영상 ${payload.videoStreams?.length??0}개 · 음성 ${payload.audioStreams?.length??0}개 · 길이 ${payload.duration??'미상'}초\n사용 가능한 해상도: ${(payload.heights??[]).join(', ')}p`;
      if(preferences.autoTitle&&typeof payload.title==='string')document.querySelector<HTMLInputElement>('#youtube-filename')!.value=payload.title;
    }else if(response.type==='job_started'){
      youtubeJobId=payload.jobId;status.textContent='다운로드가 시작됐습니다. 다운로드 목록에서 진행·취소·완료 파일을 확인하세요.';
      const jobs=await call({type:'list_jobs'});renderJobs(jobs.jobs??[]);
    }else status.textContent=presentHostResponse(response).message;
  }finally{youtubeBusy=false;updateYoutubeControls();}
}
document.querySelector<HTMLButtonElement>('#youtube-probe')!.onclick=()=>void runYoutube('youtube_probe');
document.querySelector<HTMLButtonElement>('#youtube-download')!.onclick=()=>void runYoutube('youtube_download');
let healthRevision = 0;
let refreshRevision = 0;
let pageScanDiagnostic:{sabrDetected?:boolean;scanUnavailable?:boolean}|undefined;
let helpSequence=0;
function initializeHelp(root:ParentNode):void {
  for(const wrap of root.querySelectorAll<HTMLElement>('.help-wrap')){
    const trigger=wrap.querySelector<HTMLButtonElement>('.help-trigger')!;
    const tip=wrap.querySelector<HTMLElement>('.help-tip')!;
    tip.id=`option-help-${++helpSequence}`;
    trigger.setAttribute('aria-describedby',tip.id);
    trigger.setAttribute('aria-expanded','false');
    trigger.addEventListener('click',()=>{
      const pinned=wrap.classList.toggle('help-pinned');
      wrap.classList.remove('help-dismissed');
      trigger.setAttribute('aria-expanded',String(pinned));
    });
    trigger.addEventListener('keydown',event=>{
      if(event.key==='Escape'){wrap.classList.remove('help-pinned');wrap.classList.add('help-dismissed');trigger.setAttribute('aria-expanded','false');event.preventDefault();}
    });
    wrap.addEventListener('mouseleave',()=>wrap.classList.remove('help-dismissed'));
    trigger.addEventListener('focus',()=>wrap.classList.remove('help-dismissed'));
  }
}
let candidatesRevision = 0;
let jobsRevision = 0;
const jobViews = new Map<string, JobView>();
const jobSnapshots = new Map<string, Record<string, any>>();
const candidateViews = new Map<string, CandidateView>();
const jobRows = new Map<string, JobRow>();
const selectedJobs = new Set<string>();
const groupHeaders = new Map<string, HTMLButtonElement>();
const collapsedGroups = new Set<string>();
let latestCandidates: MediaCandidate[] = [];
let preferences: ManagerPreferences = { ...MANAGER_DEFAULTS };
let jobFilter: JobFilter = "all";

function managerStatus(text: string, error = false): void {
  managerMessage.textContent = text;
  managerMessage.classList.toggle("error", error);
}

async function savePreferences(partial: Partial<ManagerPreferences>): Promise<void> {
  preferences = { ...preferences, ...partial };
  applyPreferences();
  const result = await call({ type: "save_preferences", preferences: partial });
  if (result?.ok === false) managerStatus("설정을 저장하지 못했습니다. 다시 시도하세요.", true);
}

function applyPreferences(): void {
  document.querySelector<HTMLInputElement>("#batch-probe")!.checked = preferences.batchProbe;
  document.querySelector<HTMLInputElement>("#download-after-probe")!.checked = preferences.downloadAfterProbe;
  document.querySelector("#find-av")!.textContent = preferences.batchProbe ? "전체 후보 Probe" : "영상+음성 후보 찾기";
  document.querySelector<HTMLInputElement>("#group-candidates")!.checked = preferences.groupCandidates;
  document.querySelector("#jobs-content")!.classList.toggle("hidden", preferences.jobsCollapsed);
  const toggle = document.querySelector<HTMLButtonElement>("#jobs-toggle")!;
  toggle.textContent = `다운로드 목록 (${jobSnapshots.size}) ${preferences.jobsCollapsed ? "▸" : "▾"}`;
  toggle.setAttribute("aria-expanded", String(!preferences.jobsCollapsed));
  document.querySelector("#switch-view")!.textContent = isSidepanel ? "팝업으로 보기" : "사이드바로 보기";
}

async function loadPreferences(): Promise<void> {
  const result = await call({ type: "get_preferences" });
  if (result?.preferences) preferences = { ...MANAGER_DEFAULTS, ...result.preferences };
  applyPreferences();
}

function setHostReady(ready: boolean, response?: unknown): void {
  hostReady = ready;
  managerHostReady = ready && hostSupportsManager(response);
  optionalProbeSupported = ready && (response as any)?.payload?.capabilities?.optionalInputProbe === true;
  audioOnlySupported = ready && (response as any)?.payload?.capabilities?.audioOnly === true;
  const wasYoutubeReady=youtubeReady;
  youtubeReady=ready&&(response as any)?.payload?.youtubeAvailable===true;
  youtubeError=(response as any)?.payload?.youtubeError??'';
  if(youtubeReady&&!wasYoutubeReady&&!youtubeBusy)document.querySelector('#youtube-status')!.textContent='쿠키 미전송 · 현재 영상 페이지 URL로 조회합니다.';
  updateYoutubeControls();
  updateRefreshNote(latestCandidates);
  document.querySelector<HTMLButtonElement>("#find-av")!.disabled = !ready || findingAV;
  health.textContent = hostHealthLabel(response) + (ready && !managerHostReady ? " · 파일 관리 기능에는 Host v0.2.0 이상이 필요합니다." : "");
  for (const view of candidateViews.values()) view.updateControls();
  for (const [id, row] of jobRows) { const job = jobSnapshots.get(id); if (job) row.update(job); }
  updateSelection();
}

async function checkHealth(): Promise<void> {
  const revision = ++healthRevision;
  const response = await call({ type: "health" });
  if (revision === healthRevision) setHostReady(isHostReady(response), response);
}

async function refresh(): Promise<void> {
  const revision = ++refreshRevision;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (revision !== refreshRevision || tab?.id === undefined) return;
  if(tabId!==tab.id||currentPageUrl!==(tab.url??"")){++searchRevision;pageScanDiagnostic=undefined;}
  if (tabId !== tab.id) {
    candidateViews.clear();
    jobViews.clear();
    main.replaceChildren();
    groupHeaders.clear();
    collapsedGroups.clear();
  }
  tabId = tab.id;
  currentPageUrl = tab.url ?? "";
  page.textContent = tab.title ?? "현재 탭";
  updateYoutubeControls();
  // Render candidates independently of a potentially slow Native Host handshake.
  const candidateSnapshot = candidatesRevision;
  const jobSnapshot = jobsRevision;
  const candidates = call({ type: "list_candidates", tabId, refresh:true }).then(response => {
    if (revision === refreshRevision) {
      pageScanDiagnostic={sabrDetected:response.diagnostic?.sabrDetected,scanUnavailable:response.scanUnavailable};
      if(candidateSnapshot === candidatesRevision)render(response.candidates ?? []);
      else updateRefreshNote(latestCandidates);
    }
  });
  const jobs = call({ type: "list_jobs" }).then(response => {
    if (revision === refreshRevision && jobSnapshot === jobsRevision) renderJobs(response.jobs ?? []);
  });
  await Promise.all([candidates, jobs, checkHealth()]);
}

function updateRefreshNote(items: MediaCandidate[]):void {
  let summary='',detail='';
  if(pageScanDiagnostic?.sabrDetected&&!items.some(c=>(!c.pageUrl||c.pageUrl===currentPageUrl)&&!candidateControlState(c,true).underlyingStreamRequired)){
    summary=youtubeReady?'브라우저 SABR 스트림 — YouTube 보조 엔진 사용 가능':'브라우저 SABR 스트림 — 보조 엔진 설정 필요';
    detail="이 영상은 YouTube 전용 전송 방식(SABR)으로 재생되고 있습니다. 현재 FFmpeg 방식이 사용할 HTTP(S) MP4·HLS·DASH 주소는 제공되지 않았습니다. Premium 가입 여부가 원인이라고 판단할 수 없으며, 반복 새로고침이나 Cookie 포함으로 해결된다고 보장할 수 없습니다.";
    if(youtubeReady)detail+=' 아래 YouTube 페이지 다운로드 기능으로 별도 저장 형식을 조회할 수 있습니다.';
  }else if(pageScanDiagnostic?.scanUnavailable){summary='미디어 주소 재확인 필요';detail="페이지의 미디어 주소를 다시 읽지 못했습니다. 영상 페이지를 새로고침한 뒤 재생해 주세요.";}
  else if(items.length&&items.every(c=>candidateControlState(c,true).underlyingStreamRequired)){
    summary='브라우저 내부 주소만 탐지됨';
    detail="페이지의 재생 요소와 리소스를 다시 확인했지만 현재는 브라우저 내부 주소만 있습니다. 이 새로고침은 네트워크 요청을 재실행하지 않습니다. 영상 페이지에서 새로고침 후 재생해 주세요.";
  }
  document.querySelector('#refresh-summary')!.textContent=summary;
  document.querySelector('#refresh-note')!.textContent=detail;
  document.querySelector('#refresh-details')!.classList.toggle('hidden',!detail);
}
function render(items: MediaCandidate[]): void {
  updateRefreshNote(items);
  latestCandidates = items;
  const ids = new Set(items.map(candidate => candidate.id));
  for (const [id, view] of candidateViews) {
    if (ids.has(id)) continue;
    view.root.remove();
    candidateViews.delete(id);
    for (const [jobId, job] of jobViews) if (job === view.job) jobViews.delete(jobId);
  }
  main.querySelector(".empty")?.remove();
  const groups = new Map<string, MediaCandidate[]>();
  for (const item of orderCandidates(items)) {
    const key = candidateGroupKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const [key, header] of groupHeaders) {
    if (!preferences.groupCandidates || (groups.get(key)?.length ?? 0) < 2) { header.remove(); groupHeaders.delete(key); }
  }
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "탐지된 미디어가 없습니다. 페이지에서 영상을 재생하세요.";
    main.append(empty);
    return;
  }
  let index = 0;
  for (const group of groups.values()) group.sort((a,b)=>Number(b.id===selectedCandidateId)-Number(a.id===selectedCandidateId));
  const arranged = preferences.groupCandidates ? [...groups.values()].flat() : orderCandidates(items).sort((a,b)=>Number(b.id===selectedCandidateId)-Number(a.id===selectedCandidateId));
  const emittedGroups = new Set<string>();
  for (const candidate of arranged) {
    const key = candidateGroupKey(candidate);
    if (preferences.groupCandidates && (groups.get(key)?.length ?? 0) > 1 && !emittedGroups.has(key)) {
      emittedGroups.add(key);
      let header = groupHeaders.get(key);
      if (!header) {
        header = document.createElement("button");
        header.className = "candidate-group";
        header.onclick = () => { if (collapsedGroups.has(key)) collapsedGroups.delete(key); else collapsedGroups.add(key); render(latestCandidates); };
        groupHeaders.set(key, header);
        collapsedGroups.add(key);
      }
      header.textContent = `대표 후보 · 다른 후보 ${groups.get(key)!.length - 1}개 ${collapsedGroups.has(key) ? "▸" : "▾"} — 음성·화질 확인 결과 우선`;
      header.setAttribute("aria-expanded", String(!collapsedGroups.has(key)));
      const current = main.children[index++];
      if (current !== header) main.insertBefore(header, current ?? null);
    }
    let view = candidateViews.get(candidate.id);
    if (!view) {
      view = createCandidateView(candidate);
      candidateViews.set(candidate.id, view);
    } else view.update(candidate);
    const isHead = groups.get(key)?.[0]?.id === candidate.id;
    view.root.classList.toggle("recommended", preferences.groupCandidates && isHead);
    view.root.classList.toggle("hidden", preferences.groupCandidates && !isHead && collapsedGroups.has(key));
    // Reuse the card so filename, session choice and technical disclosure survive updates.
    const current = main.children[index++];
    if (current !== view.root) main.insertBefore(view.root, current ?? null);
  }
}

function createCandidateView(initial: MediaCandidate): CandidateView {
  const fragment = document.querySelector<HTMLTemplateElement>("#card")!.content.cloneNode(true) as DocumentFragment;
  const root = fragment.querySelector<HTMLElement>("article")!;
  initializeHelp(root);
  // DocumentFragment becomes empty when mounted. Always query the retained article.
  const query = <T extends Element>(selector: string) => root.querySelector<T>(selector)!;
  let candidate = initial;
  let busy = false;
  const result = query<HTMLPreElement>(".result");
  const message = query<HTMLElement>(".message");
  const technical = query<HTMLDetailsElement>(".technical");
  const session = query<HTMLInputElement>(".session");
  const allowVideoOnly = query<HTMLInputElement>(".allow-video-only");
  const audioOnly = query<HTMLInputElement>(".audio-only");
  audioOnly.addEventListener("change", () => { if(audioOnly.checked)allowVideoOnly.checked=false; updateControls(); });
  const probeBeforeDownload = query<HTMLInputElement>(".probe-before-download");
  probeBeforeDownload.checked = true;
  const probe = query<HTMLButtonElement>(".probe");
  const download = query<HTMLButtonElement>(".download");
  const start = query<HTMLButtonElement>(".start");
  const cancel = query<HTMLButtonElement>(".cancel");
  const open = query<HTMLButtonElement>(".open");
  const copyError = query<HTMLButtonElement>(".copy-error");
  const filename = query<HTMLInputElement>(".filename");
  const autoTitle = query<HTMLInputElement>(".auto-title");
  const thumbnail = query<HTMLImageElement>(".thumbnail");
  const duplicateWarning = query<HTMLElement>(".duplicate-warning");
  let previousSuggested = "";
  let thumbnailUrl: string | undefined;
  let duplicateApprovedFor: string | undefined;
  autoTitle.checked = preferences.autoTitle;
  thumbnail.crossOrigin = "anonymous";
  thumbnail.referrerPolicy = "no-referrer";
  thumbnail.onerror = () => { thumbnail.classList.add("hidden"); query(".thumbnail-fallback").classList.remove("hidden"); };
  const job = { message, technical, result, cancel, open, copyError };

  function updateControls(): void {
    const controls = candidateControlState(candidate, hostReady);
    probe.disabled = controls.probeDisabled || busy;
    download.disabled = start.disabled = controls.downloadDisabled || busy;
    session.disabled = controls.sessionDisabled || busy;
    allowVideoOnly.disabled = controls.downloadDisabled || busy || audioOnly.checked;
    audioOnly.disabled = controls.downloadDisabled || busy || !audioOnlySupported;
    query(".audio-option-note").textContent = audioOnlySupported ? "영상을 제외하고 음성만 MP4/MKV로 저장합니다(재인코딩 없음). 음성 트랙이 있는 후보에서만 저장할 수 있으며, 다른 후보의 소리를 임의로 합치지 않습니다." : "음성만 저장하려면 Host v0.2.2 이상이 필요합니다.";
    probeBeforeDownload.disabled = !optionalProbeSupported || controls.downloadDisabled || busy;
    query(".probe-option-note").textContent = optionalProbeSupported
      ? "끄면 입력 Probe를 생략합니다. 기본 스트림을 저장하므로 화질 선택·남은 시간 정보가 제한될 수 있습니다. DRM 검사와 저장 결과 검증은 유지됩니다."
      : "시작 전 Probe를 끄려면 Host v0.2.1 이상으로 갱신해 주세요.";
    probe.title = download.title = controls.reason ?? "";
    cancel.disabled = !hostReady;
    open.disabled = !managerHostReady;
    query<HTMLButtonElement>(".duplicate-play").disabled = !managerHostReady;
    query<HTMLButtonElement>(".duplicate-reveal").disabled = !managerHostReady;
  }

  function update(next: MediaCandidate): void {
    // An input event usually disables auto-fill. The value check also protects
    // autofill/accessibility edits that occur without an input event.
    if (filename.value && previousSuggested && filename.value !== previousSuggested) autoTitle.checked = false;
    candidate = next;
    if ((candidate.mediaTitle?.trim() || candidate.pageTitle?.trim()) && message.textContent?.startsWith("제목을 아직 찾지 못해")) message.textContent = "";
    const suggested = suggestedFilename(candidate, preferences.filenameTemplate, new Date(), preferences.defaultFilename);
    if (autoTitle.checked) filename.value = suggested;
    previousSuggested = suggested;
    query(".media-title").textContent = candidateTitle(candidate);
    query(".media-badges").textContent = candidateBadges(candidate).join(" · ");
    query(".thumbnail-source").textContent = candidate.thumbnailSource === "page-image" ? "페이지 대표 이미지 · 영상 일치 미확인" : candidate.thumbnailSource === "video-poster" ? "영상 포스터" : "미리보기 없음";
    const nextThumbnail = safeThumbnail(candidate.thumbnailUrl);
    if (nextThumbnail !== thumbnailUrl) {
      thumbnailUrl = nextThumbnail;
      if (nextThumbnail) thumbnail.src = nextThumbnail; else thumbnail.removeAttribute("src");
      thumbnail.classList.toggle("hidden", !nextThumbnail);
      query(".thumbnail-fallback").classList.toggle("hidden", !!nextThumbnail);
    }
    const controls = candidateControlState(candidate, hostReady);
    query(".kind").textContent = candidate.flags.blobUrl ? "브라우저 내부" : candidate.mediaKind;
    query(".score").textContent = `${candidate.confidenceScore}점`;
    query(".flags").textContent = [
      candidate.flags.likelyMasterManifest && !candidate.probeSummary ? "manifest URL 추정 · 구성 미확인" : "",
      candidate.flags.likelyAdvertisement ? "광고 의심" : "",
      controls.underlyingStreamRequired ? "원본 스트림 필요" : "",
    ].filter(Boolean).join(" · ");
    query(".host").textContent = safeHost(candidate.url);
    query(".url").textContent = candidate.url;
    const source = { "webRequest-url": "네트워크 URL", "webRequest-mime": "네트워크 응답", "video-element": "재생 요소", "performance-entry": "브라우저 리소스" }[candidate.source];
    query(".seen").textContent = `${source} · 네트워크 요청 ${candidate.requestCount}회 · ${new Date(candidate.lastSeenAt).toLocaleTimeString()}`;
    const notice = query<HTMLElement>(".notice");
    notice.textContent = controls.underlyingStreamRequired ? BLOB_NOTICE : "";
    notice.classList.toggle("hidden", !controls.underlyingStreamRequired);
    query('.notice-container').classList.toggle('hidden',!controls.underlyingStreamRequired);
    updateControls();
  }

  function begin(text: string): void {
    busy = true;
    updateControls();
    message.textContent = text;
    message.classList.remove("error");
    message.classList.remove("warning");
    technical.open = false;
    technical.classList.add("hidden");
    copyError.classList.add("hidden");
  }

  query<HTMLButtonElement>(".copy").onclick = () => void navigator.clipboard.writeText(candidate.url);
  probe.onclick = async () => {
    if (probe.disabled) return;
    if(preferences.batchProbe){await runCandidateSearch();return;}
    begin("미디어 정보를 확인하는 중입니다…");
    try {
      showResponse(job, await call({ type: "probe", tabId, candidateId: candidate.id, includeSession: session.checked, userAgent: navigator.userAgent }));
    } finally { busy = false; updateControls(); }
  };
  const searchOptions=():SearchDownloadOptions=>({...(autoTitle.checked?{}:{filename:filename.value}),container:query<HTMLSelectElement>('.container').value,overwrite:query<HTMLSelectElement>('.overwrite').value,probeBeforeDownload:probeBeforeDownload.checked});
  const shouldSelectCandidate=()=>preferences.downloadAfterProbe&&probeBeforeDownload.checked&&!session.checked&&!audioOnly.checked&&!allowVideoOnly.checked;
  download.onclick = async () => {
    if(download.disabled||findingAV)return;
    if(shouldSelectCandidate()){await runCandidateSearch([],preferences.batchProbe,searchOptions());return;}
    query(".options").classList.toggle("hidden");
  };
  filename.value = autoTitle.checked ? suggestedFilename(candidate, preferences.filenameTemplate, new Date(), preferences.defaultFilename) : preferences.defaultFilename;
  previousSuggested = filename.value;
  filename.addEventListener("input", () => { autoTitle.checked = false; void savePreferences({ autoTitle: false }); });
  autoTitle.addEventListener("change", () => {
    filename.value = previousSuggested = autoTitle.checked ? suggestedFilename(candidate, preferences.filenameTemplate, new Date(), preferences.defaultFilename) : preferences.defaultFilename;
    if (autoTitle.checked && !candidate.mediaTitle?.trim() && !candidate.pageTitle?.trim()) {
      message.textContent = "제목을 아직 찾지 못해 기본 파일명을 사용합니다. 영상 페이지를 새로고침하거나 파일명을 직접 입력하세요.";
    }
    void savePreferences({ autoTitle: autoTitle.checked });
  });
  query<HTMLButtonElement>(".duplicate-dismiss").onclick = () => { duplicateWarning.classList.add("hidden"); duplicateApprovedFor = undefined; };
  query<HTMLButtonElement>(".duplicate-continue").onclick = () => { duplicateApprovedFor = candidate.id; duplicateWarning.classList.add("hidden"); void start.click(); };
  start.onclick = async () => {
    if (start.disabled) return;
    const automatic=automaticStarts.get(candidate.id);
    automaticStarts.delete(candidate.id);
    if(!automatic&&shouldSelectCandidate()){
      if(!findingAV)await runCandidateSearch([],preferences.batchProbe,searchOptions());
      return;
    }
    begin("다운로드를 연결하는 중입니다…");
    try {
      if (duplicateApprovedFor !== candidate.id) {
        const duplicate = await call({ type: "check_duplicate", candidateId: candidate.id, tabId });
        const existing = Array.isArray(duplicate?.jobs) ? duplicate.jobs.find(completedJobActions) : undefined;
        if (existing) {
          query(".duplicate-message").textContent = `이미 다운로드한 항목이 있습니다: ${jobDisplayName(existing)}. 기존 파일을 열거나 새로 다운로드할 수 있습니다.`;
          query<HTMLButtonElement>(".duplicate-play").onclick = async () => showResponse(job, await call({ type: "play_file", jobId: existing.jobId }));
          query<HTMLButtonElement>(".duplicate-reveal").onclick = async () => showResponse(job, await call({ type: "reveal_file", jobId: existing.jobId }));
          duplicateWarning.classList.remove("hidden");
          message.textContent = "중복 다운로드 여부를 선택하세요.";
          return;
        }
      }
      duplicateApprovedFor = undefined;
      const response = await call({
        type: "download", tabId, candidateId: candidate.id, includeSession: session.checked, userAgent: navigator.userAgent,
        options: { filename: query<HTMLInputElement>(".filename").value, container: query<HTMLSelectElement>(".container").value, overwrite: query<HTMLSelectElement>(".overwrite").value, liveMode: "until_stopped", allowVideoOnly: !audioOnly.checked && allowVideoOnly.checked, audioOnly: audioOnlySupported && audioOnly.checked, probeBeforeDownload: optionalProbeSupported ? probeBeforeDownload.checked : true },
      });
      showResponse(job, response);
      const jobId = response?.payload?.jobId;
      if (jobId && response.type === "job_started") {
        if(automatic){automaticJobs.set(jobId,automatic);handleAutomaticFailure(jobSnapshots.get(jobId));}
        jobViews.set(jobId, job);
        cancel.classList.remove("hidden");
        cancel.onclick = () => void call({ type: "cancel", jobId });
        open.onclick = async () => showResponse(job, await call({ type: "reveal_file", jobId }));
      }
    } finally { busy = false; updateControls(); }
  };
  copyError.onclick = () => void navigator.clipboard.writeText(result.textContent ?? "");
  query<HTMLButtonElement>(".retry-candidates").onclick=()=>void runCandidateSearch([candidate.id],true);
  update(initial);
  return { root, update, updateControls, job };
}

function showResponse(view: JobView, raw: unknown): void {
  const presented = presentHostResponse(raw);
  view.message.textContent = presented.message;
  view.message.classList.toggle("error", presented.isError);
  view.message.classList.toggle("warning", !!presented.isWarning);
  view.result.textContent = presented.technical;
  view.technical.classList.remove("hidden");
  view.copyError.classList.toggle("hidden", !presented.isError);
}

function renderJobs(jobs: any[]): void {
  jobSnapshots.clear();
  for (const job of jobs) {
    if (typeof job?.jobId !== "string") continue;
    jobSnapshots.set(job.jobId, job);
    const view = jobViews.get(job.jobId);
    if (view && ["queued", "probing", "running", "finalizing"].includes(job.state)) {
      showResponse(view, { type: "job_progress", payload: job });
    }
  }
  for (const [id, row] of jobRows) {
    if (!jobSnapshots.has(id)) { row.root.remove(); jobRows.delete(id); selectedJobs.delete(id); }
  }
  jobsPanel.querySelector(".empty")?.remove();
  let index = 0;
  for (const job of jobSnapshots.values()) {
    if (!isRemovableJob(job)) selectedJobs.delete(job.jobId);
    let row = jobRows.get(job.jobId);
    if (!row) { row = createJobRow(job); jobRows.set(job.jobId, row); }
    row.update(job);
    row.root.classList.toggle("hidden", !matchesJobFilter(job, jobFilter));
    const current = jobsPanel.children[index++];
    if (current !== row.root) jobsPanel.insertBefore(row.root, current ?? null);
  }
  if (![...jobSnapshots.values()].some(job => matchesJobFilter(job, jobFilter))) {
    const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "표시할 다운로드가 없습니다."; jobsPanel.append(empty);
  }
  updateSelection();
  applyPreferences();
}

interface JobRow { root: HTMLElement; update(job: Record<string, any>): void; selection: HTMLInputElement }

function createJobRow(initial: Record<string, any>): JobRow {
  let job = initial;
  const root = document.createElement("div"); root.className = "job";
  const header = document.createElement("div"); header.className = "job-header";
  const selectLabel = document.createElement("label"); selectLabel.className = "job-select-label";
  const selection = document.createElement("input"); selection.type = "checkbox"; selection.className = "job-select";
  const selectText = document.createElement("span"); selectText.textContent = "목록 항목 선택";
  selectLabel.append(selection, selectText);
  const title = document.createElement("span"); title.className = "job-title";
  const thumbnail = document.createElement("img"); thumbnail.className = "job-thumb hidden"; thumbnail.loading = "lazy"; thumbnail.crossOrigin = "anonymous"; thumbnail.referrerPolicy = "no-referrer"; thumbnail.alt = "영상 미리보기";
  const thumbnailFallback = document.createElement("span"); thumbnailFallback.className = "job-thumb-placeholder"; thumbnailFallback.textContent = "▶"; thumbnailFallback.setAttribute("aria-hidden", "true");
  let thumbnailUrl: string | undefined;
  thumbnail.onerror = () => { thumbnail.classList.add("hidden"); thumbnailFallback.classList.remove("hidden"); };
  const state = document.createElement("b");
  const menuButton = document.createElement("button"); menuButton.className = "job-menu-button"; menuButton.textContent = "⋯"; menuButton.setAttribute("aria-label", "다운로드 명령");
  header.append(selectLabel, thumbnail, thumbnailFallback, title, state, menuButton);
  const detail = document.createElement("small");
  const measurements = document.createElement("div");
  const disclosure = document.createElement("details"); disclosure.className = "job-details";
  const summary = document.createElement("summary"); summary.textContent = "작업 상세";
  const technical = document.createElement("pre"); technical.className = "job-technical";
  disclosure.append(summary, technical);
  const actions = document.createElement("div"); actions.className = "job-actions";
  const buttons = new Map<string, HTMLButtonElement>();
  for (const [action, label] of [["play_file", "재생"], ["reveal_file", "폴더에서 선택"], ["copy_path", "경로 복사"], ["cancel", "취소"], ["remove", "목록에서 제거"]] as const) {
    const button = document.createElement("button"); button.className = `job-${action}`; button.textContent = label;
    button.onclick = () => void performJobAction(action, job);
    buttons.set(action, button); actions.append(button);
  }
  selection.addEventListener("change", () => {
    if (selection.checked && isRemovableJob(job)) selectedJobs.add(job.jobId); else selectedJobs.delete(job.jobId);
    updateSelection();
  });
  menuButton.onclick = () => { const rect = menuButton.getBoundingClientRect(); showJobMenu(job, rect.left, rect.bottom); };
  root.addEventListener("contextmenu", event => { event.preventDefault(); showJobMenu(job, event.clientX, event.clientY); });
  root.addEventListener("keydown", event => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault(); const rect = root.getBoundingClientRect(); showJobMenu(job, rect.left, rect.top);
    }
  });
  root.append(header, detail, measurements, actions, disclosure);
  function update(next: Record<string, any>): void {
    job = next;
    const presented = presentJobProgress(job);
    title.textContent = jobDisplayName(job);
    const nextThumbnail = safeThumbnail(job.thumbnailUrl);
    if (nextThumbnail !== thumbnailUrl) {
      thumbnailUrl = nextThumbnail;
      if (nextThumbnail) thumbnail.src = nextThumbnail; else thumbnail.removeAttribute("src");
      thumbnail.classList.toggle("hidden", !nextThumbnail);
      thumbnailFallback.classList.toggle("hidden", !!nextThumbnail);
    }
    state.textContent = presented.label;
    detail.textContent = job.error || job.errorSummary || job.errorCode ? presentHostResponse({ type: "job_failed", payload: { errorCode: job.errorCode, errorSummary: job.errorSummary ?? job.error } }).message : job.outputPath ?? job.jobId;
    selection.disabled = !isRemovableJob(job);
    selection.checked = selectedJobs.has(job.jobId);
    selection.title = selection.disabled ? "진행 중 작업은 목록에서 제거할 수 없습니다." : "목록 항목 선택";
    // Only measurement elements change during progress. Buttons, focus, selection
    // and the disclosure remain the same DOM nodes throughout a job's lifetime.
    measurements.replaceChildren();
    if (presented.percent !== null || ACTIVE_STATES.has(job.state)) {
      const progress = document.createElement("progress"); progress.max = 100; progress.setAttribute("aria-label", "다운로드 진행률 (읽기 전용)");
      if (presented.percent !== null) progress.value = presented.percent;
      measurements.append(progress);
    }
    for (const [className, text] of [["progress-metrics", presented.metrics], ["progress-note", presented.note], ["warning", job.warning ? "무음 허용 옵션으로 영상만 저장합니다. 이 파일에는 음성 트랙이 없습니다." : ""]] as const) {
      if (!text) continue;
      const paragraph = document.createElement("p"); paragraph.className = className; paragraph.textContent = text; measurements.append(paragraph);
    }
    for (const [action, button] of buttons) {
      const visible = action === "cancel" ? ACTIVE_STATES.has(job.state) : action === "remove" ? isRemovableJob(job) : completedJobActions(job);
      button.classList.toggle("hidden", !visible);
      button.disabled = action === "copy_path" ? false : action === "cancel" ? !hostReady : !managerHostReady;
      button.title = action !== "copy_path" && action !== "cancel" && !managerHostReady ? "Host v0.2.0 이상에 연결해야 사용할 수 있습니다." : "";
    }
    technical.textContent = presentHostResponse({ type: "job_details", payload: job }).technical;
  }
  update(initial);
  return { root, update, selection };
}

async function performJobAction(action: string, job: Record<string, any>): Promise<void> {
  hideJobMenu();
  if (action === "copy_path") {
    if (!completedJobActions(job)) return;
    try { await navigator.clipboard.writeText(job.outputPath); managerStatus("파일 경로를 복사했습니다."); }
    catch { managerStatus("파일 경로를 복사하지 못했습니다.", true); }
    return;
  }
  if (action === "remove") { await removeJobs([job.jobId]); return; }
  const result = await call({ type: action, jobId: job.jobId });
  const shown = presentHostResponse(result);
  managerStatus(shown.isError ? shown.message : action === "play_file" ? "Windows 기본 플레이어로 열었습니다." : action === "reveal_file" ? "탐색기에서 파일을 선택했습니다." : "취소를 요청했습니다.", shown.isError);
}

async function removeJobs(ids: string[]): Promise<void> {
  const removable = ids.filter(id => { const job = jobSnapshots.get(id); return job && isRemovableJob(job); });
  if (!removable.length) { managerStatus("완료·실패·취소된 항목을 선택하세요."); return; }
  const result = await call({ type: "remove_jobs", jobIds: removable });
  const shown = presentHostResponse(result);
  if (shown.isError) { managerStatus(shown.message, true); return; }
  const removed = Array.isArray(result?.payload?.removedJobIds) ? result.payload.removedJobIds : [];
  const rejected = Array.isArray(result?.payload?.rejectedJobIds) ? result.payload.rejectedJobIds : [];
  for (const id of removed) { selectedJobs.delete(id); jobSnapshots.delete(id); }
  renderJobs([...jobSnapshots.values()]);
  managerStatus(`${removed.length}개 항목을 목록에서 지웠습니다. 영상 파일은 유지됩니다.${rejected.length ? ` ${rejected.length}개 항목은 제거할 수 없습니다.` : ""}`, rejected.length > 0);
}

function updateSelection(): void {
  const visible = [...jobSnapshots.values()].filter(job => matchesJobFilter(job, jobFilter) && isRemovableJob(job));
  const selectAll = document.querySelector<HTMLInputElement>("#select-jobs")!;
  selectAll.checked = visible.length > 0 && visible.every(job => selectedJobs.has(job.jobId));
  selectAll.indeterminate = !selectAll.checked && visible.some(job => selectedJobs.has(job.jobId));
  selectAll.disabled = visible.length === 0;
  document.querySelector<HTMLButtonElement>("#remove-selected")!.disabled = selectedJobs.size === 0 || !managerHostReady;
  document.querySelector<HTMLButtonElement>("#clear-completed")!.disabled = !managerHostReady || ![...jobSnapshots.values()].some(job => job.state === "completed");
}

function hideJobMenu(): void { menu.classList.add("hidden"); }

function showJobMenu(job: Record<string, any>, x: number, y: number): void {
  menu.replaceChildren();
  for (const [action, label] of [["play_file", "재생"], ["reveal_file", "폴더에서 선택"], ["copy_path", "경로 복사"], ["cancel", "다운로드 취소"], ["remove", "목록에서 제거 (파일 유지)"]] as const) {
    if (action === "cancel" ? !ACTIVE_STATES.has(job.state) : action === "remove" ? !isRemovableJob(job) : !completedJobActions(job)) continue;
    const button = document.createElement("button"); button.textContent = label; button.setAttribute("role", "menuitem");
    button.disabled = action === "copy_path" ? false : action === "cancel" ? !hostReady : !managerHostReady;
    button.onclick = () => void performJobAction(action, job); menu.append(button);
  }
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - 230))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - 210))}px`;
  menu.classList.remove("hidden");
  menu.querySelector<HTMLButtonElement>("button")?.focus();
}

function safeHost(raw: string): string {
  try { return new URL(raw).hostname || "브라우저 내부 URL"; } catch { return "알 수 없는 URL"; }
}

document.querySelector("#refresh")!.addEventListener("click", () => void refresh());
document.querySelector("#clear")!.addEventListener("click", async () => { ++searchRevision; await call({ type: "clear_candidates", tabId }); await refresh(); });
document.querySelector("#switch-view")!.addEventListener("click", async () => {
  const response = await call({ type: isSidepanel ? "open_popup" : "open_sidepanel", tabId });
  if (response?.ok === false) managerStatus("보기 전환에 실패했습니다. 확장 아이콘 또는 Chrome 사이드 패널에서 다시 열어주세요.", true);
  else await savePreferences({ viewMode: isSidepanel ? "popup" : "sidepanel" });
});
document.querySelector("#settings")!.addEventListener("click", async () => {
  const result = await call({ type: "open_settings" });
  if (result?.ok === false) managerStatus("설정을 열지 못했습니다.", true);
});
document.querySelector<HTMLInputElement>("#group-candidates")!.addEventListener("change", () => {
  void savePreferences({ groupCandidates: document.querySelector<HTMLInputElement>("#group-candidates")!.checked });
  render(latestCandidates);
});
document.querySelector("#jobs-toggle")!.addEventListener("click", () => void savePreferences({ jobsCollapsed: !preferences.jobsCollapsed }));
document.querySelector<HTMLSelectElement>("#job-filter")!.addEventListener("change", () => {
  jobFilter = document.querySelector<HTMLSelectElement>("#job-filter")!.value as JobFilter;
  renderJobs([...jobSnapshots.values()]);
});
document.querySelector<HTMLInputElement>("#select-jobs")!.addEventListener("change", () => {
  const selected = document.querySelector<HTMLInputElement>("#select-jobs")!.checked;
  for (const job of jobSnapshots.values()) if (matchesJobFilter(job, jobFilter) && isRemovableJob(job)) {
    if (selected) selectedJobs.add(job.jobId); else selectedJobs.delete(job.jobId);
  }
  renderJobs([...jobSnapshots.values()]);
});
document.querySelector("#remove-selected")!.addEventListener("click", () => void removeJobs([...selectedJobs]));
document.querySelector("#clear-completed")!.addEventListener("click", () => void removeJobs([...jobSnapshots.values()].filter(job => job.state === "completed").map(job => job.jobId)));
document.addEventListener("click", event => { if (event.target instanceof Node && !menu.contains(event.target) && !(event.target instanceof Element && event.target.classList.contains("job-menu-button"))) hideJobMenu(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") hideJobMenu(); });
menu.addEventListener("keydown", event => {
  const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button")).filter(button => !button.disabled);
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (["ArrowDown", "ArrowUp"].includes(event.key) && buttons.length) {
    event.preventDefault(); buttons[(index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  }
});
if (isSidepanel) {
  chrome.tabs.onActivated?.addListener(() => void refresh());
  chrome.tabs.onUpdated?.addListener((updatedTabId, change) => { if (updatedTabId === tabId && (change.url || change.title || change.status === "complete")) void refresh(); });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.managerPreferences) {
    preferences = { ...MANAGER_DEFAULTS, ...changes.managerPreferences.newValue as Partial<ManagerPreferences> };
    applyPreferences();
    render(latestCandidates);
  }
  if (area !== "session") return;
  if (changes.mediaCandidatesByTab) {
    ++candidatesRevision;
    const byTab = changes.mediaCandidatesByTab.newValue as Record<string, MediaCandidate[]> | undefined;
    render(byTab?.[String(tabId)] ?? []);
  }
  if (changes.downloadJobs) {
    ++jobsRevision;
    const jobs = changes.downloadJobs.newValue;
    renderJobs(Array.isArray(jobs) ? jobs : []);
    if(Array.isArray(jobs))for(const job of jobs)handleAutomaticFailure(job);
  }
  if (changes.nativeHostStatus) {
    const status = changes.nativeHostStatus.newValue as { connected?: boolean } | undefined;
    if (!status?.connected) { ++healthRevision; setHostReady(false); }
    else if (!hostReady) void checkHealth();
  }
});
chrome.runtime.onMessage.addListener((event: any) => {
  if (event.type !== "host_event") return;
  const payload = event.message?.payload;
  if(payload?.jobId===youtubeJobId&&['job_completed','job_failed','job_cancelled'].includes(event.message?.type)){
    document.querySelector('#youtube-status')!.textContent=presentHostResponse(event.message).message;
    youtubeJobId=undefined;
  }
  if(event.message?.type==="job_failed")handleAutomaticFailure({...payload,state:"failed"});
  if(["job_completed","job_cancelled"].includes(event.message?.type))automaticJobs.delete(payload?.jobId);
  const view = jobViews.get(payload?.jobId);
  if (!view) return;
  // Legacy Hosts omit Probe metadata from progress events. Reuse the worker's
  // job-specific verified snapshot, while fresh event/live metadata wins.
  const snapshot = jobSnapshots.get(payload?.jobId);
  let response = event.message;
  if (event.message.type === "job_progress" && snapshot) {
    const fresh = enrichJobDuration({ ...snapshot, ...payload, progress: payload });
    jobSnapshots.set(payload.jobId, fresh);
    response = { ...event.message, payload: fresh };
  }
  showResponse(view, response);
  if(event.message.type==="job_failed"&&payload?.errorCode==="audio_stream_missing"){
    for(const candidateView of candidateViews.values())if(candidateView.job===view)candidateView.root.querySelector(".retry-candidates")?.classList.remove("hidden");
  }
  if (event.message.type === "job_completed") { view.cancel.classList.add("hidden"); view.open.classList.remove("hidden"); }
  if (["job_failed", "job_cancelled"].includes(event.message.type)) view.cancel.classList.add("hidden");
});
function handleAutomaticFailure(job:any):void{
  const attempt=automaticJobs.get(job?.jobId);
  if(!attempt||!["failed","unsupported_drm","completed","cancelled"].includes(job.state))return;
  automaticJobs.delete(job.jobId);
  if(job.state!=="failed"||job.errorCode!=="audio_stream_missing"||!preferences.downloadAfterProbe)return;
  if(attempt.revision!==searchRevision||attempt.tabId!==tabId||attempt.pageUrl!==currentPageUrl)return;
  void runCandidateSearch([...new Set([...attempt.excludeIds,attempt.candidateId])],true,attempt.downloadOptions);
}
async function runCandidateSearch(excludeIds:string[]=[],forceAll=false,downloadOptions?:SearchDownloadOptions): Promise<void> {
  if(findingAV||!hostReady)return;
  const searchTab=tabId, searchPage=currentPageUrl;
  const revision=++searchRevision, autoDownload=preferences.downloadAfterProbe;
  const button=document.querySelector<HTMLButtonElement>("#find-av")!;
  const status=document.querySelector<HTMLElement>("#find-av-status")!;
  findingAV=true;button.disabled=true;status.textContent=(forceAll||preferences.batchProbe)?`전체 HTTP(S) 후보를 다시 확인하는 중입니다…${excludeIds.length?` 음성 없음 실패 후보 ${excludeIds.length}개 제외`:""}`:"영상+음성 후보를 순차 확인하는 중입니다…";
  try{
    const result=await call({type:"find_av",tabId:searchTab,pageUrl:searchPage,all:forceAll||preferences.batchProbe,excludeIds,userAgent:navigator.userAgent});
    if(revision!==searchRevision||tabId!==searchTab||currentPageUrl!==searchPage)return;
    const snapshot=await call({type:"list_candidates",tabId:searchTab});
    if(revision!==searchRevision||tabId!==searchTab||currentPageUrl!==searchPage)return;
    selectedCandidateId=typeof result.candidateId==="string"&&!excludeIds.includes(result.candidateId)?result.candidateId:undefined;
    const tally=`새 검사 ${result.checked??0}개 · 영상+음성 ${result.withAudioVideo??0}개 · 영상만 ${result.videoOnly??0}개 · 음성만 ${result.audioOnly??0}개 · 실패 ${result.failed??0}개. `;
    render(snapshot.candidates??latestCandidates);
    if(selectedCandidateId){
      const view=candidateViews.get(selectedCandidateId);
      view?.root.querySelector(".options")?.classList.remove("hidden");
      view?.root.scrollIntoView?.({block:"nearest"});
      status.textContent=tally+"영상+음성 후보를 선택했습니다. 파일명을 확인하고 시작을 누르세요.";
      if(view && autoDownload && preferences.downloadAfterProbe){
        // The batch uses anonymous Probe; do not inherit a card's cookie or
        // extraction choices for the automatic full-video download.
        view.root.querySelector<HTMLInputElement>(".session")!.checked=false;
        view.root.querySelector<HTMLInputElement>(".audio-only")!.checked=false;
        view.root.querySelector<HTMLInputElement>(".allow-video-only")!.checked=false;
        if(downloadOptions){
          if(downloadOptions.filename!==undefined){view.root.querySelector<HTMLInputElement>('.auto-title')!.checked=false;view.root.querySelector<HTMLInputElement>('.filename')!.value=downloadOptions.filename;}
          view.root.querySelector<HTMLSelectElement>('.container')!.value=downloadOptions.container;
          view.root.querySelector<HTMLSelectElement>('.overwrite')!.value=downloadOptions.overwrite;
          view.root.querySelector<HTMLInputElement>('.probe-before-download')!.checked=downloadOptions.probeBeforeDownload;
        }
        view.updateControls();
        const start=view.root.querySelector<HTMLButtonElement>(".start")!;
        if(!start.disabled){
          automaticStarts.set(selectedCandidateId,{tabId:searchTab,pageUrl:searchPage,revision,excludeIds,candidateId:selectedCandidateId,downloadOptions});
          status.textContent=tally+"적합한 1개에 다운로드를 요청했습니다. 음성 없음으로 실패하면 해당 후보를 제외하고 계속 확인합니다.";start.click();
        }
      }
    }else status.textContent=result.ok===false?"후보 확인에 실패했습니다. Host 연결을 확인하세요.":tally+`확인 범위에서 영상+음성이 함께 있는 후보를 찾지 못했습니다.${result.limited?" · 20개 제한 도달":""} 로그인 필요 후보는 개별 Probe를 사용하세요. 음성만 있는 후보는 음성 전용 저장이 가능합니다.`;
  }finally{findingAV=false;button.disabled=!hostReady;}
}
document.querySelector<HTMLButtonElement>("#find-av")!.onclick=()=>runCandidateSearch();
for(const [id,key] of [["batch-probe","batchProbe"],["download-after-probe","downloadAfterProbe"]] as const){
  document.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener("change",()=>void savePreferences({[key]:document.querySelector<HTMLInputElement>(`#${id}`)!.checked}));
}
initializeHelp(document);
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  for(const wrap of document.querySelectorAll<HTMLElement>('.help-wrap')){
    wrap.classList.remove('help-pinned');
    wrap.classList.add('help-dismissed');
    wrap.querySelector('.help-trigger')!.setAttribute('aria-expanded','false');
  }
});
void loadPreferences().then(refresh);
