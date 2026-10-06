import { detectCandidate } from "./candidate-detector.ts";
import { CandidateStore } from "./candidate-store.ts";
import { isSegment } from "../shared/url-utils.ts";
interface PartialRequest { url:string;tabId:number;frameId:number;initiator?:string;documentUrl?:string;method:string;resourceType:string;requestTimestamp:number;responseTimestamp?:number;contentType?:string;contentLength?:string;finalUrl?:string;statusCode?:number;redirected:boolean;referer?:string;origin?:string;userAgent?:string;captured?:boolean }
export class NetworkObserver {
  private requests=new Map<string,PartialRequest>();
  private store:CandidateStore;
  constructor(store:CandidateStore){this.store=store;}
  start():void{
    const filter={urls:["http://*/*","https://*/*"]};
    chrome.webRequest.onBeforeRequest.addListener(d=>{this.before(d);},filter);
    chrome.webRequest.onBeforeSendHeaders.addListener(d=>{this.sent(d);},filter,["requestHeaders"]);
    chrome.webRequest.onHeadersReceived.addListener(d=>{this.headers(d);},filter,["responseHeaders"]);
    chrome.webRequest.onCompleted.addListener(d=>{void this.done(d).catch(()=>console.error("Candidate capture failed"));},filter);
    chrome.webRequest.onErrorOccurred.addListener(d=>this.requests.delete(d.requestId),filter);
  }
  private before(d:chrome.webRequest.OnBeforeRequestDetails):void{if(d.tabId<0)return;const detail=d as chrome.webRequest.OnBeforeRequestDetails&{documentUrl?:string},previous=this.requests.get(d.requestId);this.requests.set(d.requestId,{url:previous?.url??d.url,finalUrl:d.url,tabId:d.tabId,frameId:d.frameId,initiator:d.initiator,documentUrl:detail.documentUrl,method:d.method,resourceType:d.type,requestTimestamp:previous?.requestTimestamp??d.timeStamp,redirected:!!previous});}
  private sent(d:chrome.webRequest.OnBeforeSendHeadersDetails):void{const r=this.requests.get(d.requestId);if(!r)return;for(const h of d.requestHeaders??[]){const n=h.name.toLowerCase();if(n==="referer")r.referer=h.value;if(n==="origin")r.origin=h.value;if(n==="user-agent")r.userAgent=h.value;}}
  private headers(d:chrome.webRequest.OnHeadersReceivedDetails):void{const r=this.requests.get(d.requestId);if(!r)return;r.finalUrl=d.url;r.statusCode=d.statusCode;r.responseTimestamp=d.timeStamp;r.contentType=(d.responseHeaders??[]).find(h=>h.name.toLowerCase()==="content-type")?.value;r.contentLength=(d.responseHeaders??[]).find(h=>h.name.toLowerCase()==="content-length")?.value;void this.capture(r,d.timeStamp).catch(()=>console.error("Candidate capture failed"));}
  private async done(d:chrome.webRequest.OnCompletedDetails):Promise<void>{
    const r=this.requests.get(d.requestId);this.requests.delete(d.requestId);if(!r)return;
    const url=r.finalUrl??r.url;
    if(isSegment(url,r.contentType)){await this.store.addSegmentEvidence(r.tabId);return;}
    await this.capture(r,d.timeStamp);
  }
  private async capture(r:PartialRequest,timestamp:number):Promise<void>{
    if(r.captured||r.method!=="GET"||(r.statusCode!==undefined&&(r.statusCode<200||r.statusCode>=300)))return;
    const url=r.finalUrl??r.url;
    const c=detectCandidate({url,contentType:r.contentType,tabId:r.tabId,pageUrl:r.documentUrl,initiator:r.initiator,documentUrl:r.documentUrl,source:r.contentType?"webRequest-mime":"webRequest-url",timestamp});
    if(!c)return;
    r.captured=true;
    try {
      const tab=await chrome.tabs.get(r.tabId);
      c.pageUrl ||= tab.url ?? "";
      c.pageTitle = tab.title ?? "";
    } catch { /* A closed tab or unavailable tab metadata must not lose detection. */ }
    await this.store.upsert(c);
  }
}
