export const actionLabels={open:'문서 열기',lookup:'서지정보 조회',visit:'브라우저 방문'};
const integer=v=>Number.isSafeInteger(v) && v>=0?Math.min(v,Number.MAX_SAFE_INTEGER-1):0;
export function normalizeActivity(value={}){
 const recent=Array.isArray(value?.recent)?value.recent.filter(e=>e && Object.hasOwn(actionLabels,e.action) && Number.isFinite(e.at) && e.at>0).slice(-200).map(e=>({action:e.action,at:e.at,browser:e.browser==='Edge'?'Edge':'Chrome',source:['auto-focus','auto-load','paperdesk'].includes(e.source)?e.source:'paperdesk',...(Number.isInteger(e.tabId)?{tabId:e.tabId}:{})})):[];
 return {fingerprint:/^[a-f0-9]{64}$/.test(value?.fingerprint)?value.fingerprint:'',open:integer(value?.open),lookup:integer(value?.lookup),visit:integer(value?.visit),first:Number.isFinite(value?.first)?value.first:0,last:Number.isFinite(value?.last)?value.last:0,recent};
}
export function nextActivity(value,action,{at=Date.now(),browser='Chrome',source='paperdesk',tabId}={}){
 if(!Object.hasOwn(actionLabels,action) || !Number.isFinite(at) || at<=0)throw Error('방문 기록 형식이 올바르지 않습니다.');
 const activity=normalizeActivity(value),last=activity.recent.findLast(e=>e.action==='visit');
 // One activation/load pair is one visit; a later focus or reload is another visit.
 if(action==='visit' && last?.action==='visit' && last.tabId===tabId && last.browser===browser && last.source!==source && at-last.at>=0 && at-last.at<5000)return activity;
 const event={action,at,browser:browser==='Edge'?'Edge':'Chrome',source,...(Number.isInteger(tabId)?{tabId}:{})};
 return {...activity,[action]:activity[action]+1,first:activity.first?Math.min(activity.first,at):at,last:Math.max(activity.last,at),recent:[...activity.recent,event].slice(-200)};
}
export async function documentFingerprint(key){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function activityText(record){const a=normalizeActivity(record.activity);return `문서 열기 ${a.open}회 · 서지 조회 ${a.lookup}회 · 방문 ${a.visit}회`+(a.last?' · 최근 '+new Date(a.last).toLocaleString():'');}
