import type { RequestContext } from "./models.ts";
export const PROTOCOL_VERSION = 1;
export type HostRequestType = "hello"|"health_check"|"probe_media"|"start_download"|"cancel_job"|"list_jobs"|"open_output_folder"|"open_output_file"|"reveal_output_file"|"remove_jobs"|"shutdown_when_idle";
export type HostResponseType = "hello_result"|"health_result"|"probe_result"|"job_started"|"job_progress"|"job_completed"|"job_cancelled"|"job_failed"|"protocol_error";
const RESPONSE_TYPES=new Set<HostResponseType>(["hello_result","health_result","probe_result","job_started","job_progress","job_completed","job_cancelled","job_failed","protocol_error"]);
export interface Envelope<T=unknown>{protocolVersion:number;messageId:string;type:string;payload:T}
export interface DownloadRequest { url:string; filename:string; container:"auto"|"mp4"|"mkv"; overwrite:"number"|"overwrite"|"cancel"; liveMode:"until_stopped"|"duration"; durationSeconds?:number; verifiedDurationSeconds?:number; requestContext:RequestContext; keepPartial?:boolean; allowVideoOnly?:boolean }
export function envelope<T>(type:HostRequestType,payload:T):Envelope<T>{return {protocolVersion:PROTOCOL_VERSION,messageId:crypto.randomUUID(),type,payload};}
export function validEnvelope(v:unknown):v is Envelope { if(!v||typeof v!=="object")return false; const x=v as Record<string,unknown>; return x.protocolVersion===1&&typeof x.messageId==="string"&&x.messageId.length>0&&typeof x.type==="string"&&RESPONSE_TYPES.has(x.type as HostResponseType)&&!!x.payload&&typeof x.payload==="object"; }
