import {all,recordActivity} from './db.js';import {recordKeys} from './model.js';import {resourceIdentity} from './identity.js';import {trackingEnabled} from './tracking-settings.js';
export function visitedRecord(tab,records){
 if(tab?.incognito || !tab?.active || tab.pendingUrl || tab.status==='loading')return null;
 const key=resourceIdentity(tab.url);if(!key)return null;
 const found=records.find(r=>recordKeys(r).includes(key));if(!found)return null;
 return found.linkedTo?records.find(r=>r.id===found.linkedTo && !r.linkedTo) || null:found;
}
export async function trackTabVisit(tab,source,api=globalThis.chrome,{enabled=trackingEnabled,records=all,record=recordActivity}={}){
 if(!await enabled() || !await api.permissions.contains({permissions:['tabs']}))return false;
 const found=visitedRecord(tab,await records());if(!found)return false;
 await record(found.id,'visit',{browser:/Edg\//.test(globalThis.navigator?.userAgent || '')?'Edge':'Chrome',source,tabId:tab.id});return true;
}
