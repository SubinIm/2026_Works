import { CandidateStore } from "./candidate-store.ts";
import { NetworkObserver } from "./network-observer.ts";
import { NativeHostClient } from "./native-host-client.ts";
import { detectCandidate } from "./candidate-detector.ts";
import { DEFAULT_SETTINGS, type ExtensionSettings, type RequestContext } from "../shared/models.ts";
import { assertAllowedHostUrl } from "../shared/host-url-policy.ts";
import { ProbeDurationCache, probeIdentity, enrichJobDuration } from "./probe-duration-cache.ts";
import { getPreferences, savePreferences, openSidePanel, openPopup, initializeBrowserControls, notifyJob } from "./browser-controls.ts";
import { sourceIdentity, summarizeProbe } from "./job-metadata.ts";
import { AutoProbeQueue } from "./auto-probe.ts";
import { findAudioVideo } from "./find-av.ts";
import { scanPageMedia } from "./page-media-scan.ts";
import { youtubePageUrl } from "../shared/youtube-page.ts";
const avSearches=new Map<string,Promise<unknown>>();
const store=new CandidateStore(); const host=new NativeHostClient(); new NetworkObserver(store).start();
const probeDurations=new ProbeDurationCache();
const autoProbe=new AutoProbeQueue(async()=>(await getPreferences()).autoProbe,async candidate=>{
  const current=(await store.list(candidate.tabId)).find(item=>item.id===candidate.id);
  if(!current||current.probeSummary)return;
  const health=await handle({type:"health"},{} ) as any;
  if(health?.type!=="health_result"||health.payload?.ffmpegAvailable!==true)return;
  return handle({type:"probe",tabId:candidate.tabId,candidateId:candidate.id,includeSession:false,userAgent:typeof navigator!=="undefined"?navigator.userAgent:undefined},{});
});
store.onCandidate=candidate=>{void autoProbe.consider(candidate).catch(()=>{});};
const JOBS_KEY="downloadJobs",HOST_KEY="nativeHostStatus";let reconnectAttempt=0,reconnectTimer:number|undefined;
const REMOVED_KEY="removedDownloadJobIds";
let jobStateMutations:Promise<void>=Promise.resolve();
let hostStateMutations:Promise<void>=Promise.resolve(),connectionRevision=0;
host.onEvent=persistHostEvent;
host.onDisconnect=reason=>{const revision=++connectionRevision;void persistHostStatus({connected:false,error:reason},revision).catch(()=>console.error("Native Host status persistence failed"));scheduleReconnect();};
void syncHostState();
initializeBrowserControls();
chrome.tabs.onRemoved.addListener(tabId=>void store.clear(tabId));
chrome.runtime.onInstalled.addListener(()=>void chrome.storage.local.get("settings").then(r=>{if(!r.settings)return chrome.storage.local.set({settings:DEFAULT_SETTINGS});}));
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{void handle(message,sender).then(sendResponse,e=>sendResponse({ok:false,error:e instanceof Error?e.message:String(e)}));return true;});
async function handle(message:any,sender:chrome.runtime.MessageSender):Promise<unknown>{
  if(message.type==="content_candidates"&&sender.tab?.id!==undefined){
    await store.updatePageMetadata(sender.tab.id,message.pageUrl,message.pageTitle,message.pageMetadata??{});
    for(const item of message.items??[]){const c=detectCandidate({url:item.url,tabId:sender.tab.id,pageUrl:message.pageUrl,pageTitle:message.pageTitle,source:item.source,mediaTitle:item.mediaTitle,metadataSource:item.metadataSource,thumbnailUrl:item.thumbnailUrl,thumbnailSource:item.thumbnailSource});if(c)await store.upsert(c);}return {ok:true};}
  const tabId=message.tabId as number;
  if(message.type==='youtube_probe'||message.type==='youtube_download'){
    const tab=await chrome.tabs.get(tabId),url=tab.url&&youtubePageUrl(tab.url);
    if(!url||url!==youtubePageUrl(message.pageUrl??''))throw new Error('현재 YouTube 영상 페이지가 변경되었습니다. 새로고침하세요.');
    if(message.includeSession===true)throw new Error('YouTube 보조 엔진은 현재 쿠키 미전송 모드만 지원합니다.');
    const saved=(await chrome.storage.local.get('settings')).settings as Partial<ExtensionSettings>|undefined,settings={...DEFAULT_SETTINGS,...saved};
    if(!settings.youtubeEnabled)throw new Error('설정에서 YouTube 보조 엔진을 활성화하세요.');
    const sourceKey=await sourceIdentity(url);
    const options=message.options??{};
    const response=await host.request(message.type,{url,settings,sourceKey,displayTitle:tab.title??'YouTube video',
      filename:options.filename??'YouTube video',maxHeight:options.maxHeight??null,container:options.container??'mkv',
      audioOnly:options.audioOnly===true,probeBeforeDownload:options.probeBeforeDownload!==false,overwrite:'number',keepPartial:settings.keepPartialFiles},message.type==='youtube_probe'?75000:15000);
    if(response.type==='job_started'&&typeof (response.payload as any)?.jobId==='string')await rememberJobMetadata((response.payload as any).jobId,{sourceKey});
    return response;
  }
  if(message.type==="find_av"){
    const excluded=new Set<string>(Array.isArray(message.excludeIds)?message.excludeIds.filter((id:unknown)=>typeof id==="string").slice(0,500):[]);
    const searchKey=JSON.stringify([tabId,message.pageUrl??"",message.all===true,[...excluded].sort()]);
    if(avSearches.has(searchKey))return avSearches.get(searchKey);
    const search=(async()=>{
      const items=await store.list(tabId);
      const scoped=typeof message.pageUrl==="string"&&message.pageUrl?items.filter(c=>c.pageUrl===message.pageUrl||!c.pageUrl):items;
      return findAudioVideo(scoped.filter(c=>!excluded.has(c.id)),c=>handle({type:"probe",tabId,candidateId:c.id,includeSession:false,userAgent:message.userAgent},{}),message.all===true);
    })();
    avSearches.set(searchKey,search);
    try{return await search;}finally{avSearches.delete(searchKey);}
  }
  if(message.type==="get_preferences")return {ok:true,preferences:await getPreferences()};
  if(message.type==="save_preferences")return {ok:true,preferences:await savePreferences(message.preferences)};
  if(message.type==="open_sidepanel"){const result=await openSidePanel(tabId);await savePreferences({viewMode:"sidepanel"});return result;}
  if(message.type==="open_popup")return openPopup();
  if(message.type==="open_settings"){await chrome.runtime.openOptionsPage();return {ok:true};}
  if(message.type==="list_candidates"){
    let diagnostic:ReturnType<typeof scanPageMedia>["diagnostic"]|undefined;
    let scanUnavailable=false;
    if(message.refresh===true)try{
      const tab=await chrome.tabs.get(tabId);
      if(tab.url&&/^https?:\/\//i.test(tab.url)){
        const [result]=await chrome.scripting.executeScript({target:{tabId},world:"MAIN",func:scanPageMedia});
        const scan=result?.result;
        if(scan&&scan.pageUrl===tab.url){
          diagnostic=scan.diagnostic;
          for(const item of scan.items){const candidate=detectCandidate({...item,tabId,pageUrl:scan.pageUrl,pageTitle:scan.pageTitle});if(candidate)await store.upsert(candidate);}
        }
      }
    }catch{scanUnavailable=true;}
    return {ok:true,candidates:await store.list(tabId),diagnostic,scanUnavailable};
  }
  if(message.type==="list_jobs")return {ok:true,jobs:await syncHostState()};
  if(message.type==="clear_candidates"){await store.clear(tabId);return {ok:true};}
  if(message.type==="health"){const saved=(await chrome.storage.local.get("settings")).settings as Partial<ExtensionSettings>|undefined,settings={...DEFAULT_SETTINGS,...saved};return host.request("health_check",{settings});}
  if(message.type==="check_duplicate"){
    const candidate=(await store.list(tabId)).find(c=>c.id===message.candidateId);
    const url=candidate&&store.resolveUrl(candidate);
    if(!url)return {ok:true,jobs:[]};
    const key=await sourceIdentity(url),jobs=await syncHostState();
    return {ok:true,jobs:jobs.filter(job=>job.state==="completed"&&job.sourceKey===key)};
  }
  if(message.type==="probe"||message.type==="download"){
    const candidates=await store.list(tabId),candidate=candidates.find(c=>c.id===message.candidateId);if(!candidate)throw new Error("Candidate not found");const downloadUrl=store.resolveUrl(candidate);if(!downloadUrl)throw new Error("Signed URL 원문이 만료되었습니다. 페이지에서 미디어를 다시 재생해 탐지하세요.");assertAllowedHostUrl(downloadUrl);
    const context:RequestContext={pageUrl:candidate.pageUrl,referer:candidate.documentUrl??candidate.pageUrl,origin:safeOrigin(candidate.pageUrl),userAgent:message.userAgent};
    if(message.includeSession===true){const cookies=await chrome.cookies.getAll({url:downloadUrl});context.cookieHeader=cookies.map(c=>`${c.name}=${c.value}`).join("; ");}
    const saved=(await chrome.storage.local.get("settings")).settings as Partial<ExtensionSettings>|undefined,settings={...DEFAULT_SETTINGS,...saved};
    const key=await probeIdentity({candidateId:candidate.id,url:downloadUrl,includeSession:message.includeSession===true,pageUrl:context.referer??candidate.pageUrl,userAgent:context.userAgent,cookieHeader:context.cookieHeader,origin:context.origin});
    if(message.type==="probe"){
      const response=await host.request("probe_media",{url:downloadUrl,mediaKind:candidate.mediaKind,requestContext:context,settings},30000);
      await probeDurations.remember(key,response);
      const summary=summarizeProbe(response);
      if(summary)await store.updateProbeSummary(tabId,candidate.id,summary);
      return response;
    }
    const verified=await probeDurations.get(key);
    if(message.options?.probeBeforeDownload===false||message.options?.audioOnly===true){
      const capabilities=await host.request("health_check",{settings});
      if(message.options?.probeBeforeDownload===false&&(capabilities.payload as any)?.capabilities?.optionalInputProbe!==true)throw new Error("시작 전 Probe 생략에는 Host v0.2.1 이상이 필요합니다.");
      if(message.options?.audioOnly===true&&(capabilities.payload as any)?.capabilities?.audioOnly!==true)throw new Error("음성만 저장에는 Host v0.2.2 이상이 필요합니다.");
    }
    // The trusted Probe metadata is separate from the user's recording limit (-t).
    const sourceKey=await sourceIdentity(downloadUrl),displayTitle=candidate.mediaTitle||candidate.pageTitle||"download";
    const response=await host.request("start_download",{...message.options,url:downloadUrl,mediaKind:candidate.mediaKind,requestContext:context,keepPartial:settings.keepPartialFiles,settings,verifiedDurationSeconds:verified?.durationSeconds,displayTitle,sourceKey},15000);
    const payload=response.payload as any;
    if(response.type==="job_started"&&typeof payload?.jobId==="string"){
      await rememberJobMetadata(payload.jobId,{candidateId:candidate.id,candidateTabId:tabId,...(verified?{verifiedProbeDurationSeconds:verified.durationSeconds,verifiedProbeAt:verified.checkedAt}:{}),sourceKey,thumbnailUrl:candidate.thumbnailUrl,thumbnailSource:candidate.thumbnailSource});
    }
    return response;
  }
  if(message.type==="cancel")return host.request("cancel_job",{jobId:message.jobId});
  if(message.type==="open_folder")return host.request("open_output_folder",{jobId:message.jobId});
  if(message.type==="play_file")return host.request("open_output_file",{jobId:message.jobId});
  if(message.type==="reveal_file")return host.request("reveal_output_file",{jobId:message.jobId});
  if(message.type==="remove_jobs"){
    if(!Array.isArray(message.jobIds)||message.jobIds.length>100||!message.jobIds.every((id:unknown)=>typeof id==="string"))throw new Error("Invalid job selection");
    const response=await host.request("remove_jobs",{jobIds:message.jobIds});
    await jobStateMutations;
    return response;
  }
  throw new Error("Unknown extension message");
}
function safeOrigin(raw:string):string|undefined{try{return new URL(raw).origin;}catch{return undefined;}}
async function syncHostState():Promise<any[]>{
  const revision=connectionRevision;
  try{
    const response=await host.request("list_jobs",{},5000);
    if(response.type!=="health_result"||!Array.isArray((response.payload as any).jobs))throw new Error("Invalid job list response");
    // The onEvent callback queues the snapshot at receive time, before later events.
    await jobStateMutations;
    const cached=(await chrome.storage.session.get(JOBS_KEY))[JOBS_KEY];
    if(revision===connectionRevision){
      reconnectAttempt=0;
      if(reconnectTimer!==undefined){clearTimeout(reconnectTimer);reconnectTimer=undefined;}
      await persistHostStatus({connected:true},revision);
    }
    return Array.isArray(cached)?cached:[];
  }
  catch(error){await jobStateMutations;const cached=(await chrome.storage.session.get(JOBS_KEY))[JOBS_KEY];scheduleReconnect();return Array.isArray(cached)?cached:[];}
}
function persistHostStatus(status:{connected:boolean;error?:string},revision:number):Promise<void>{
  const mutation=hostStateMutations.then(async()=>{
    if(revision!==connectionRevision)return;
    await chrome.storage.session.set({[HOST_KEY]:{...status,updatedAt:Date.now()}});
  });
  hostStateMutations=mutation.catch(()=>{});
  return mutation;
}
function persistHostEvent(message:any):Promise<void>{
  const payload=message?.payload;
  const snapshot=message.type==="health_result"&&Array.isArray(payload?.jobs);
  const removal=message.type==="health_result"&&Array.isArray(payload?.removedJobIds);
  const jobId=payload?.jobId;
  if(!snapshot&&!removal&&(!["job_started","job_progress","job_completed","job_cancelled","job_failed"].includes(message.type)||typeof jobId!=="string"||!jobId))return Promise.resolve();
  const mutation=jobStateMutations.then(async()=>{
    const removedValue=(await chrome.storage.session.get(REMOVED_KEY))[REMOVED_KEY];
    const removed=new Set<string>(Array.isArray(removedValue)?removedValue:[]);
    if(removal){
      for(const id of payload.removedJobIds)if(typeof id==="string")removed.add(id);
      const saved=(await chrome.storage.session.get(JOBS_KEY))[JOBS_KEY];
      await chrome.storage.session.set({[REMOVED_KEY]:[...removed].slice(-1000),[JOBS_KEY]:(Array.isArray(saved)?saved:[]).filter(j=>!removed.has(j.jobId))});return;
    }
    if(snapshot){
      const saved=(await chrome.storage.session.get(JOBS_KEY))[JOBS_KEY];
      const previous=new Map<string,any>((Array.isArray(saved)?saved:[]).map(j=>[j.jobId,j]));
      const jobs=payload.jobs.filter((job:any)=>!removed.has(job.jobId)).slice(0,100).map((job:any)=>{
        const local=previous.get(job.jobId);
        return enrichJobDuration({...job,candidateId:local?.candidateId,candidateTabId:local?.candidateTabId,verifiedProbeDurationSeconds:local?.verifiedProbeDurationSeconds,verifiedProbeAt:local?.verifiedProbeAt,thumbnailUrl:local?.thumbnailUrl,thumbnailSource:local?.thumbnailSource});
      });
      await chrome.storage.session.set({[JOBS_KEY]:jobs});return;
    }
    if(removed.has(jobId))return;
    const current=(await chrome.storage.session.get(JOBS_KEY))[JOBS_KEY] as any[]|undefined,jobs=Array.isArray(current)?current:[],index=jobs.findIndex(j=>j.jobId===jobId),previous=index>=0?jobs[index]:{jobId};
    const terminal=["completed","cancelled","failed","unsupported_drm"].includes(previous.state);
    // A late start/progress event must not undo a completed job or an earlier phase.
    if(terminal&&(message.type==="job_started"||message.type==="job_progress"))return;
    let state=previous.state;
    if(message.type==="job_started")state=previous.state??payload.state??"queued";
    if(message.type==="job_progress")state=payload.phase==="probing"?"probing":payload.phase==="verifying"||payload.phase==="finalizing"?"finalizing":"running";
    if(message.type==="job_completed")state="completed";
    if(message.type==="job_cancelled")state="cancelled";
    if(message.type==="job_failed")state=payload.state??"failed";
    // Native progress events are flat; persisted registry jobs use a nested object.
    const {jobId:_,...progress}=payload;
    const update=message.type==="job_progress"?{
      progress,
      ...(payload.probe?{probe:payload.probe}:{}),
      ...(payload.durationSeconds!==undefined?{durationSeconds:payload.durationSeconds}:{}),
      ...(payload.durationSource!==undefined?{durationSource:payload.durationSource}:{}),
      ...(payload.warning!==undefined?{warning:payload.warning}:{}),
    }:payload;
    const next=enrichJobDuration({...previous,...update,state,updatedAt:Date.now()});if(index>=0)jobs[index]=next;else jobs.unshift(next);await chrome.storage.session.set({[JOBS_KEY]:jobs.slice(0,100)});
    await updateCandidateFromJob(next);
    void notifyJob(next,previous.state).catch(()=>console.error("Download notification failed"));
  });
  jobStateMutations=mutation.catch(()=>{});
  return mutation;
}
async function updateCandidateFromJob(job:any):Promise<void>{
  if(typeof job.candidateId!=="string"||!Number.isInteger(job.candidateTabId))return;
  const summary=summarizeProbe({type:"probe_result",payload:job.probe});
  if(summary)await store.updateProbeSummary(job.candidateTabId,job.candidateId,summary);
}
function rememberJobMetadata(jobId:string,metadata:Record<string,unknown>):Promise<void>{
  const mutation=jobStateMutations.then(async()=>{
    const removed=(await chrome.storage.session.get(REMOVED_KEY))[REMOVED_KEY];
    if(Array.isArray(removed)&&removed.includes(jobId))return;
    const saved=(await chrome.storage.session.get(JOBS_KEY))[JOBS_KEY],jobs=Array.isArray(saved)?saved:[];
    const index=jobs.findIndex(j=>j.jobId===jobId);
    const next=enrichJobDuration({...jobs[index],jobId,...metadata});
    if(index>=0)jobs[index]=next;else jobs.unshift({...next,state:"queued"});
    await chrome.storage.session.set({[JOBS_KEY]:jobs.slice(0,100)});
    await updateCandidateFromJob(next);
  });
  jobStateMutations=mutation.catch(()=>{});
  return mutation;
}
function scheduleReconnect():void{if(reconnectTimer!==undefined)return;const delay=Math.min(30000,1000*2**Math.min(reconnectAttempt++,5));reconnectTimer=setTimeout(()=>{reconnectTimer=undefined;void syncHostState();},delay) as unknown as number;}
