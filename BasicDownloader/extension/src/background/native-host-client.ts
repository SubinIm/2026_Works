import { envelope, validEnvelope, type Envelope, type HostRequestType } from "../shared/messages.ts";
const HOST="com.personal.stream_downloader";
export class NativeHostClient {
  private port:chrome.runtime.Port|null=null; private pending=new Map<string,{resolve:(v:Envelope)=>void;reject:(e:Error)=>void;timer:number}>();
  onDisconnect:((reason:string)=>void)|null=null;
  onEvent:((message:Envelope)=>void|Promise<void>)|null=null;
  connect():void{if(this.port)return; this.port=chrome.runtime.connectNative(HOST); this.port.onMessage.addListener((m:unknown)=>this.onMessage(m)); this.port.onDisconnect.addListener(()=>{const reason=chrome.runtime.lastError?.message??"Native Host disconnected"; for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error(reason));}this.pending.clear();this.port=null;this.onDisconnect?.(reason);});}
  request<T>(type:HostRequestType,payload:T,timeoutMs=15000):Promise<Envelope>{this.connect();const msg=envelope(type,payload);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(msg.messageId);reject(new Error("Native Host timed out"));},timeoutMs) as unknown as number;this.pending.set(msg.messageId,{resolve,reject,timer});this.port!.postMessage(msg);});}
  private onMessage(raw:unknown):void{
    if(!validEnvelope(raw))return;
    // The worker owns this Port. runtime.sendMessage does not loop back to its sender.
    try { Promise.resolve(this.onEvent?.(raw)).catch(() => console.error("Native Host event handling failed")); }
    catch { console.error("Native Host event handling failed"); }
    const p=this.pending.get(raw.messageId);if(p){clearTimeout(p.timer);this.pending.delete(raw.messageId);p.resolve(raw);}
    chrome.runtime.sendMessage({type:"host_event",message:raw}).catch(()=>{});
  }
}
