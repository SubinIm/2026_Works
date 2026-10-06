import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { NativeHostClient } from "../src/background/native-host-client.ts";
import type { Envelope } from "../src/shared/messages.ts";

function event() {
  const listeners: ((...args: any[]) => any)[] = [];
  return {
    addListener: (listener: (...args: any[]) => any) => listeners.push(listener),
    emit: (...args: any[]) => listeners.map(listener => listener(...args)),
  };
}

function fixture() {
  const original = globalThis.chrome;
  const sent: Envelope[] = [], broadcasts: any[] = [];
  const runtimeMessages = event();
  const data: Record<string, any> = {};
  const localData: Record<string, any> = {};
  const delay = () => new Promise(resolve => setTimeout(resolve, 1));
  const createPort=()=>({onMessage:event(),onDisconnect:event(),postMessage:(message:Envelope)=>sent.push(message)});
  let port=createPort();
  globalThis.chrome = {
    runtime: {
      connectNative: () => {port=createPort();return port;},
      sendMessage: async (message: any) => { broadcasts.push(message); throw new Error("No popup receiver"); },
      onMessage: runtimeMessages, onInstalled: event(),
    },
    tabs: { onRemoved: event() },
    webRequest: { onBeforeRequest: event(), onBeforeSendHeaders: event(), onHeadersReceived: event(), onCompleted: event(), onErrorOccurred: event() },
    storage: {
      local: { get: async (key:string) => ({[key]:structuredClone(localData[key])}), set:async(value:any)=>{Object.assign(localData,structuredClone(value));} },
      session: {
        get: async (key: string) => { const copy = structuredClone({ [key]: data[key] }); await delay(); return copy; },
        set: async (value: Record<string, any>) => { await delay(); Object.assign(data, structuredClone(value)); },
      },
    },
  } as unknown as typeof chrome;
  return {
    sent, broadcasts, data, localData, get port(){return port;},
    receive: (type: string, payload: any, messageId = `event-${Math.random()}`) => port.onMessage.emit({ protocolVersion: 1, messageId, type, payload }),
    uiRequest: (message: any, sender: any={}) => new Promise<any>(resolve => runtimeMessages.emit(message, sender, resolve)),
    restore: () => { globalThis.chrome = original; },
  };
}

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for asynchronous Native Host state");
}

test('worker YouTube requests are opt-in, page-bound, anonymous and options-whitelisted',async()=>{
  const mock=fixture();
  try{
    (chrome.tabs as any).get=async()=>({id:7,url:'https://www.youtube.com/watch?v=D2cUkF-MPJU',title:'Guest video'});
    const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/background/service-worker.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser'});
    await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}#youtube-guard-test`);
    mock.receive('health_result',{jobs:[]},mock.sent[0]!.messageId);
    const url='https://www.youtube.com/watch?v=D2cUkF-MPJU';
    let response=await mock.uiRequest({type:'youtube_download',tabId:7,pageUrl:url});
    assert.equal(response.ok,false);assert.match(response.error,/활성화/);
    mock.localData.settings={youtubeEnabled:true,ytDlpPath:'C:\\trusted\\yt-dlp.exe'};
    for(const payload of [{pageUrl:'blob:'+url},{pageUrl:'https://www.youtube.com/watch?v=AAAAAAAAAAA'},{pageUrl:url,includeSession:true}]){
      const before=mock.sent.length;
      response=await mock.uiRequest({type:'youtube_download',tabId:7,...payload});
      assert.equal(response.ok,false);assert.equal(mock.sent.length,before);
    }
    const request=mock.uiRequest({type:'youtube_download',tabId:7,pageUrl:url+'&token=PRIVATE',options:{filename:'guest',maxHeight:720,probeBeforeDownload:false,
      requestContext:{cookieHeader:'SECRET'},url:'file:///unsafe',settings:{ytDlpPath:'C:\\evil.exe'},args:['--cookies-from-browser','chrome']}});
    await waitFor(()=>mock.sent.at(-1)?.type==='youtube_download');
    const envelope=mock.sent.at(-1)!,payload=envelope.payload as any;
    assert.equal(payload.url,url);assert.equal(payload.probeBeforeDownload,false);
    assert.equal(payload.settings.ytDlpPath,'C:\\trusted\\yt-dlp.exe');
    assert.equal(payload.requestContext,undefined);assert.equal(payload.args,undefined);
    assert.equal(payload.includeSession,undefined);assert.ok(!JSON.stringify(payload).includes('SECRET'));
    mock.receive('job_started',{jobId:'youtube-guard-job',state:'queued',engine:'youtube'},envelope.messageId);
    assert.equal((await request).type,'job_started');
    await waitFor(()=>mock.data.downloadJobs?.some((j:any)=>j.jobId==='youtube-guard-job'));
  }finally{mock.restore();}
});

test("validated Native Port events reach the owner even when popup broadcast rejects", async () => {
  const mock = fixture();
  try {
    const client = new NativeHostClient(), received: Envelope[] = [];
    client.onEvent = message => {
      assert.equal(mock.broadcasts.length, received.length, "owner callback precedes broadcast");
      received.push(message);
    };
    const requested = client.request("start_download", { url: "https://x/movie.mp4" });
    mock.receive("job_started", { jobId: "a", state: "queued" }, mock.sent[0]!.messageId);
    mock.receive("job_progress", { jobId: "a", outTimeSeconds: 1 });
    mock.receive("job_completed", { jobId: "a", outputPath: "output.mp4" });
    mock.receive("unexpected_type", { jobId: "bad" });
    assert.equal((await requested).type, "job_started");
    assert.deepEqual(received.map(message => message.type), ["job_started", "job_progress", "job_completed"]);
    assert.equal(mock.broadcasts.length, 3);
    await Promise.resolve();
  } finally { mock.restore(); }
});

test("pending requests reject on disconnect and a later request opens a fresh Port", async () => {
  const mock = fixture();
  try {
    const client = new NativeHostClient(), reasons: string[] = [];
    client.onDisconnect = reason => reasons.push(reason);
    const pending = client.request("health_check", {});
    const disconnectedPort=mock.port;
    const rejection = assert.rejects(pending, /Native Host disconnected/);
    mock.port.onDisconnect.emit();
    await rejection;
    assert.deepEqual(reasons, ["Native Host disconnected"]);
    const response = client.request("health_check", {});
    assert.notEqual(mock.port,disconnectedPort);
    mock.receive("health_result", { ready: true }, mock.sent[1]!.messageId);
    assert.equal((await response).type, "health_result");
  } finally { mock.restore(); }
});

test("worker persists job events without popup and serializes job-list snapshots with progress", async () => {
  const mock = fixture();
  try {
    // Bundle the worker as production does, including TypeScript parameter properties.
    const bundle=await build({entryPoints:[fileURLToPath(new URL("../src/background/service-worker.ts",import.meta.url))],bundle:true,write:false,format:"esm",platform:"browser"});
    await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString("base64")}`);
    assert.equal(mock.sent[0]!.type, "list_jobs");
    mock.receive("health_result", { jobs: [] }, mock.sent[0]!.messageId);
    mock.receive("job_started", { jobId: "a", state: "queued" });
    mock.receive("job_started", { jobId: "b", state: "queued" });
    mock.receive("job_progress", { jobId: "a", outTimeSeconds: 3, percent: 30, progress: "continue" });
    mock.receive("job_progress", { jobId: "b", outTimeSeconds: 4, percent: 40, progress: "continue" });
    mock.receive("job_completed", { jobId: "a", outputPath: "output.mp4" });
    await waitFor(() => mock.data.downloadJobs?.find((job: any) => job.jobId === "a")?.state === "completed");
    assert.equal(mock.data.downloadJobs.length, 2);
    assert.equal(mock.data.downloadJobs.find((job: any) => job.jobId === "a").outputPath, "output.mp4");
    assert.equal(mock.data.downloadJobs.find((job: any) => job.jobId === "b").progress.outTimeSeconds, 4);
    assert.equal(mock.data.downloadJobs.find((job: any) => job.jobId === "b").progress.percent, 40);

    const list = mock.uiRequest({ type: "list_jobs" });
    const request = mock.sent.at(-1)!;
    assert.equal(request.type, "list_jobs");
    mock.receive("health_result", { jobs: [{ jobId: "a", state: "completed" }, { jobId: "b", state: "running", progress: { outTimeSeconds: 4, percent: 40 } }] }, request.messageId);
    // A newer completion arrives before the list_jobs await continuation can run.
    mock.receive("job_progress", { jobId: "b", outTimeSeconds: 6, percent: 100, progress: "end" });
    mock.receive("job_completed", { jobId: "b", outputPath: "second.mp4" });
    const listed = await list;
    assert.equal(listed.jobs.find((job: any) => job.jobId === "b").state, "completed");
    assert.equal(mock.data.downloadJobs.find((job: any) => job.jobId === "b").progress.outTimeSeconds, 6);
    assert.equal(mock.data.downloadJobs.find((job: any) => job.jobId === "b").progress.percent, 100);
    assert.equal(mock.data.downloadJobs.find((job: any) => job.jobId === "b").outputPath, "second.mp4");
    const spoof = await mock.uiRequest({ type: "host_event", message: { type: "job_failed", payload: { jobId: "a" } } });
    assert.equal(spoof.ok, false);
    assert.equal(mock.data.downloadJobs.find((job: any) => job.jobId === "a").state, "completed");
    await waitFor(() => mock.data.nativeHostStatus?.connected === true);

    const staleList=mock.uiRequest({type:"list_jobs"});
    const staleRequest=mock.sent.at(-1)!;
    mock.receive("health_result",{jobs:mock.data.downloadJobs},staleRequest.messageId);
    // Disconnect before the delayed snapshot write completes.
    mock.port.onDisconnect.emit();
    await staleList;
    await waitFor(()=>mock.data.nativeHostStatus?.connected===false);
    assert.equal(mock.data.nativeHostStatus.connected,false,"an old list response cannot mark a disconnected Port ready");
    const recovery=mock.uiRequest({type:"list_jobs"});
    mock.receive("health_result",{jobs:mock.data.downloadJobs},mock.sent.at(-1)!.messageId);
    await recovery;
    assert.equal(mock.data.nativeHostStatus.connected,true);

    await mock.uiRequest({type:"content_candidates",pageUrl:"https://example.test/watch",pageTitle:"Player",items:[{url:"blob:https://example.test/media-id",source:"video-element"}]},{tab:{id:17}});
    const candidates=await mock.uiRequest({type:"list_candidates",tabId:17});
    const blob=candidates.candidates[0];
    assert.equal(blob.flags.blobUrl,true);
    const nativeCount=mock.sent.length;
    for(const type of ["probe","download"]){
      const blocked=await mock.uiRequest({type,tabId:17,candidateId:blob.id,includeSession:true});
      assert.equal(blocked.ok,false);
      assert.match(blocked.error,/underlying_stream_required/);
    }
    assert.equal(mock.sent.length,nativeCount,"blob Probe and Download never reach Native Port");

    mock.receive("job_started", { jobId: "phases", state: "queued" });
    mock.receive("job_progress", { jobId: "phases", phase: "probing" });
    await waitFor(() => mock.data.downloadJobs?.find((job: any) => job.jobId === "phases")?.state === "probing");
    mock.receive("job_progress", {
      jobId: "phases", phase: "downloading", mediaSeconds: 4, percent: 50,
      etaSeconds: 2, totalBytes: 1024, speed: "2x", durationSeconds: 8,
      probe: { duration: 8, videoStreams: [{ index: 0 }], audioStreams: [{ index: 1 }] },
    });
    await waitFor(() => mock.data.downloadJobs?.find((job: any) => job.jobId === "phases")?.progress?.percent === 50);
    const running = mock.data.downloadJobs.find((job: any) => job.jobId === "phases");
    assert.equal(running.state, "running");
    assert.equal(running.durationSeconds, 8);
    assert.equal(running.progress.etaSeconds, 2);
    assert.equal(running.probe.audioStreams.length, 1);
    mock.receive("job_progress", { jobId: "phases", phase: "verifying", percent: 99.9 });
    await waitFor(() => mock.data.downloadJobs?.find((job: any) => job.jobId === "phases")?.state === "finalizing");
    mock.receive("job_completed", { jobId: "phases", outputPath: "with-audio.mp4" });
    mock.receive("job_progress", { jobId: "phases", phase: "probing" });
    mock.receive("job_started", { jobId: "phases", state: "queued" });
    // The following marker guarantees both stale events have passed the serial queue.
    mock.receive("job_started", { jobId: "phase-marker", state: "queued" });
    await waitFor(() => mock.data.downloadJobs?.some((job: any) => job.jobId === "phase-marker"));
    assert.equal(mock.data.downloadJobs.find((job: any) => job.jobId === "phases").state, "completed");

    await mock.uiRequest({type:"content_candidates",pageUrl:"https://example.test/watch",pageTitle:"Player",items:[{url:"https://example.test/video-only.m3u8",source:"performance-entry"}]},{tab:{id:18}});
    const httpCandidates=await mock.uiRequest({type:"list_candidates",tabId:18});
    const probing=mock.uiRequest({type:"probe",tabId:18,candidateId:httpCandidates.candidates[0].id,includeSession:false});
    await waitFor(()=>mock.sent.at(-1)?.type==="probe_media");
    mock.receive("probe_result",{duration:120,isLive:false,videoStreams:[{index:0}],audioStreams:[{index:1}]},mock.sent.at(-1)!.messageId);
    assert.equal((await probing).payload.duration,120);
    const download=mock.uiRequest({type:"download",tabId:18,candidateId:httpCandidates.candidates[0].id,includeSession:false,options:{filename:"explicit-video-only",container:"mp4",overwrite:"number",allowVideoOnly:true}});
    await waitFor(()=>mock.sent.at(-1)?.type==="start_download");
    const downloadRequest=mock.sent.at(-1)!;
    assert.equal((downloadRequest.payload as any).allowVideoOnly,true,"explicit silent-video opt-in reaches Host");
    assert.equal((downloadRequest.payload as any).verifiedDurationSeconds,120,"manual Probe result reaches start_download");
    assert.equal((downloadRequest.payload as any).durationSeconds,undefined,"Probe duration is not a recording limit");
    mock.receive("job_started",{jobId:"video-only",state:"queued"},downloadRequest.messageId);
    assert.equal((await download).type,"job_started");
    await waitFor(()=>mock.data.downloadJobs?.some((job:any)=>job.jobId==="video-only"));
    mock.receive("job_progress",{jobId:"video-only",mediaSeconds:30,speed:"2x"});
    await waitFor(()=>mock.data.downloadJobs?.find((job:any)=>job.jobId==="video-only")?.progress?.mediaSeconds===30);
    assert.equal(mock.data.downloadJobs.find((job:any)=>job.jobId==="video-only").durationSeconds,120,"legacy progress retains manual Probe length");
    const restore=mock.uiRequest({type:"list_jobs"});
    mock.receive("health_result",{jobs:[{jobId:"video-only",state:"running",progress:{mediaSeconds:40,speed:"2x"}}]},mock.sent.at(-1)!.messageId);
    const restored=await restore;
    assert.equal(restored.jobs[0].durationSeconds,120,"list_jobs synchronization retains local verified metadata");
    assert.equal(restored.jobs[0].progress.mediaSeconds,40);
    mock.receive("job_progress",{jobId:"video-only",mediaSeconds:45,speed:"2x",probe:{duration:90,durationSource:"stream"},durationSeconds:90,durationSource:"stream"});
    await waitFor(()=>mock.data.downloadJobs?.[0]?.durationSeconds===90);
    assert.equal(mock.data.downloadJobs[0].durationSource,"stream","fresh Host duration replaces manual Probe hint");

    // Client options cannot inject trusted metadata for a different, unprobed URL.
    await mock.uiRequest({type:"content_candidates",pageUrl:"https://example.test/watch",pageTitle:"Player",items:[{url:"https://example.test/other.mpd",source:"performance-entry"}]},{tab:{id:19}});
    const other=await mock.uiRequest({type:"list_candidates",tabId:19});
    const fresh=mock.uiRequest({type:"download",tabId:19,candidateId:other.candidates[0].id,includeSession:false,options:{verifiedDurationSeconds:999}});
    const count=mock.sent.length;
    await waitFor(()=>mock.sent.length>count);
    assert.equal((mock.sent.at(-1)!.payload as any).verifiedDurationSeconds,undefined);
    mock.receive("job_started",{jobId:"fresh",state:"queued"},mock.sent.at(-1)!.messageId);
    await fresh;
    await waitFor(()=>mock.data.downloadJobs?.some((job:any)=>job.jobId==="fresh"));
    const freshSource=(mock.sent.at(-1)!.payload as any).sourceKey;
    assert.match(freshSource,/^[a-f0-9]{64}$/);
    mock.receive("job_completed",{jobId:"fresh",outputPath:"C:\\Downloads\\fresh.mp4"});
    await waitFor(()=>mock.data.downloadJobs?.find((j:any)=>j.jobId==="fresh")?.state==="completed");
    const dup=mock.uiRequest({type:"check_duplicate",tabId:19,candidateId:other.candidates[0].id});
    const dupCount=mock.sent.length;
    await waitFor(()=>mock.sent.length>dupCount);
    mock.receive("health_result",{jobs:mock.data.downloadJobs},mock.sent.at(-1)!.messageId);
    assert.equal((await dup).jobs[0].jobId,"fresh");
    const preserved=structuredClone(mock.data.downloadJobs);
    const removal=mock.uiRequest({type:"remove_jobs",jobIds:["fresh"]});
    assert.equal(mock.sent.at(-1)!.type,"remove_jobs");
    mock.receive("health_result",{removedJobIds:["fresh"],rejectedJobIds:[]},mock.sent.at(-1)!.messageId);
    await removal;
    assert.ok(!mock.data.downloadJobs.some((j:any)=>j.jobId==="fresh"));
    mock.receive("job_progress",{jobId:"fresh",mediaSeconds:1});
    const stale=mock.uiRequest({type:"list_jobs"});
    mock.receive("health_result",{jobs:preserved},mock.sent.at(-1)!.messageId);
    assert.ok(!(await stale).jobs.some((j:any)=>j.jobId==="fresh"),"late event/snapshot cannot resurrect removed history");

    for(const [type,native] of [["play_file","open_output_file"],["reveal_file","reveal_output_file"],["open_folder","open_output_folder"]]){
      const action=mock.uiRequest({type,jobId:"known",path:"C:\\unsafe.exe"});
      assert.equal(mock.sent.at(-1)!.type,native);
      assert.deepEqual(mock.sent.at(-1)!.payload,{jobId:"known"},"caller paths never forwarded");
      mock.receive("health_result",{opened:true},mock.sent.at(-1)!.messageId);
      await action;
    }
    const pref=await mock.uiRequest({type:"save_preferences",preferences:{autoTitle:false,viewMode:"sidepanel"}});
    assert.equal(pref.preferences.autoTitle,false);
    assert.equal((await mock.uiRequest({type:"get_preferences"})).preferences.viewMode,"sidepanel");
    await mock.uiRequest({type:"save_preferences",preferences:{autoProbe:true,defaultFilename:"Capture"}});
    await mock.uiRequest({type:"content_candidates",pageUrl:"https://example.test/music",pageTitle:"Music title",pageMetadata:{mediaTitle:"Real music",thumbnailUrl:"https://image.test/music.jpg",thumbnailSource:"page-image"},items:[]},{tab:{id:20}});
    const network=chrome.webRequest as any;
    const detail={requestId:"mime-only",url:"https://media.test/api/manifest/hls/id/1",tabId:20,frameId:0,method:"GET",type:"xmlhttprequest",timeStamp:Date.now()};
    network.onBeforeRequest.emit(detail);
    network.onHeadersReceived.emit({...detail,statusCode:200,responseHeaders:[{name:"Content-Type",value:"application/vnd.apple.mpegurl"}]});
    network.onCompleted.emit(detail);
    await waitFor(()=>mock.sent.at(-1)?.type==="health_check");
    mock.receive("health_result",{ffmpegAvailable:true,hostVersion:"0.2.0"},mock.sent.at(-1)!.messageId);
    await waitFor(()=>mock.sent.at(-1)?.type==="probe_media");
    const autoRequest=mock.sent.at(-1)!;
    assert.equal((autoRequest.payload as any).requestContext.cookieHeader,undefined,"automatic probing never includes cookies");
    assert.equal((autoRequest.payload as any).requestContext.referer,"https://example.test/music");
    mock.receive("probe_result",{duration:200,videoStreams:[{index:0,width:1920,height:1080}],audioStreams:[{index:1}]},autoRequest.messageId);
    await waitFor(()=>mock.data.mediaCandidatesByTab?.["20"]?.[0]?.probeSummary?.audioCount===1);
    const enriched=await mock.uiRequest({type:"list_candidates",tabId:20});
    assert.equal(enriched.candidates[0].mediaTitle,"Real music");
    assert.equal(enriched.candidates[0].thumbnailUrl,"https://image.test/music.jpg");
    const beforeSearch=mock.sent.length;
    const selected=await mock.uiRequest({type:"find_av",tabId:20,pageUrl:"https://example.test/music"});
    assert.equal(selected.candidateId,enriched.candidates[0].id);
    assert.equal(mock.sent.length,beforeSearch,"verified AV result is reused without another Native request");
    assert.equal((await mock.uiRequest({type:"find_av",tabId:20,pageUrl:"https://example.test/other"})).candidateId,null);
    assert.equal((await mock.uiRequest({type:"find_av",tabId:20,pageUrl:"https://example.test/music",excludeIds:[enriched.candidates[0].id]})).candidateId,null);
    const attempt=mock.uiRequest({type:"download",tabId:20,candidateId:enriched.candidates[0].id,options:{filename:"missing-audio"}});
    await waitFor(()=>mock.sent.at(-1)?.type==="start_download");
    mock.receive("job_started",{jobId:"missing-audio",state:"queued"},mock.sent.at(-1)!.messageId);
    await attempt;
    mock.receive("job_failed",{jobId:"missing-audio",state:"failed",errorCode:"audio_stream_missing",probe:{videoStreams:[{index:0,width:1080,height:1080}],audioStreams:[],selectedStreamIndices:[0],duration:303}});
    await waitFor(()=>mock.data.mediaCandidatesByTab?.["20"]?.[0]?.probeSummary?.audioCount===0);
    assert.equal(mock.data.mediaCandidatesByTab["20"][0].probeSummary.height,1080,"download failure updates candidate audio/resolution metadata");
    assert.equal((await mock.uiRequest({type:"get_preferences"})).preferences.defaultFilename,"Capture");
    await mock.uiRequest({type:"save_preferences",preferences:{autoProbe:false}});
  } finally { mock.restore(); }
});
