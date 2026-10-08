import {checkedBibliography,bibliographySignature} from './bibliography-state.js';
import { duplicate, normalize, recordKeys } from './model.js';
import {normalizeActivity,nextActivity,documentFingerprint} from './activity.js';
import { metadataFields } from './bibliography.js';
import { enrichRecord } from './pdf-matching.js';
import {mergeReferences} from './references.js';
import {sameBibliographicDocument,mergeBibliographyPersonal} from './bibliography-merge.js';
function announce(){if(typeof window!=='undefined')window.dispatchEvent(new Event('paperdesk-changed'));if(typeof BroadcastChannel==='function'){const c=new BroadcastChannel('paperdesk-changes');c.postMessage('changed');c.close();}}
const ready = new Promise((resolve,reject) => {
  const req = indexedDB.open('paperdesk', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('records', {keyPath:'id'});
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
});
export async function all() {
  const db = await ready;
  return new Promise((resolve,reject) => { const r=db.transaction('records').objectStore('records').getAll(); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
}
export async function get(id){const db=await ready;return new Promise((resolve,reject)=>{const req=db.transaction('records').objectStore('records').get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
// Exclusion is an explicit local preference, independent of bibliography completion.
export async function setBibliographyExcluded(id,excluded){const db=await ready;return new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');let next,previousUpdated;const req=store.get(id);req.onsuccess=()=>{if(req.result){previousUpdated=req.result.updated;next={...req.result,bibliographyExcluded:!!excluded,updated:Math.max(Date.now(),(previousUpdated || 0)+1)};store.put(next);}};tx.oncomplete=()=>{if(next)announce();resolve(next?{...next,previousUpdated}:undefined);};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || Error('제외 설정 저장이 취소되었습니다.'));});}
export async function applyPDFs(plans){
 const db=await ready;
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');const result={added:0,linked:0,skipped:0,retained:0};
  const req=store.getAll();req.onsuccess=()=>{
   try{const records=req.result,versions=new Map(records.map(r=>[r.id,r.updated]));
    for(const plan of plans){if(!plan.selected)continue;
     let current=plan.targetId?records.find(r=>r.id===plan.targetId):duplicate(records,plan.record);
     if(plan.targetId && (!current || (plan.before!==undefined && versions.get(current.id)!==plan.before))){result.skipped++;continue;}
     if(current){const enriched=enrichRecord(current,plan.record,plan.attachment);const conflict=duplicate(records.filter(r=>!(plan.sourceIds || []).includes(r.id)),enriched);if(conflict){result.skipped++;continue;}if(current.attachment)result.retained++;store.put(enriched);Object.assign(current,enriched);result.linked++;}
     else {current={...plan.record,attachment:plan.attachment};store.add(current);records.push(current);result.added++;}
     for(const id of plan.sourceIds || []){const source=records.find(r=>r.id===id);if(source && source.id!==current.id){const linked={...enrichRecord(source,plan.record,plan.attachment),linkedTo:current.id};store.put(linked);Object.assign(source,linked);}}
    }
   }catch(error){tx.abort();reject(error);}
  };tx.oncomplete=()=>{if(result.added || result.linked)announce();resolve(result);};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('PDF 연결이 취소되었습니다.'));
 });
}
export async function save(record) {
  const db = await ready;
  return new Promise((resolve,reject) => {
    const tx=db.transaction('records','readwrite'), store=tx.objectStore('records'); let conflict;
    const req=store.getAll();
    req.onsuccess=()=>{ conflict=duplicate(req.result,record); if (!conflict) {const current=req.result.find(r=>r.id===record.id);store.put({...record,bibliographyExcluded:current?.bibliographyExcluded ?? record.bibliographyExcluded,bibliography:current?.bibliography?.signature===bibliographySignature(record)?current.bibliography:record.bibliography,activity:normalizeActivity(current?.activity || record.activity),references:mergeReferences(current?.references,record.references)});} };
    tx.oncomplete=()=>{if(!conflict)announce();resolve(conflict);}; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error || new Error('저장이 취소되었습니다.'));
  });
}
// Update usage atomically without changing bibliography version guards.
export async function recordActivity(id,action,options={}){
 const original=await get(id);if(!original)return false;
 const fingerprint=original.activity?.fingerprint || await documentFingerprint(recordKeys(original)[0] || 'id:'+id),db=await ready;
 return new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');let changed=false;
  const req=store.get(id);req.onsuccess=()=>{const current=req.result;if(!current)return;try{const activity=nextActivity(current.activity,action,options);changed=activity[action]!==normalizeActivity(current.activity)[action];if(changed)store.put({...current,activity:{...activity,fingerprint:current.activity?.fingerprint || fingerprint}});}catch(e){tx.abort();reject(e);}};
  tx.oncomplete=()=>{if(changed)announce();resolve(changed);};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || Error('방문 기록 저장이 취소되었습니다.'));
 });
}
export async function remove(id) {
  const db=await ready;
  return new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').delete(id);tx.oncomplete=()=>{announce();resolve();};tx.onerror=()=>reject(tx.error);});
}
export async function merge(records) {
  const db=await ready;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readwrite'),store=tx.objectStore('records'); let added=0;
    const req=store.getAll(); req.onsuccess=()=>{
      const existing=req.result;
      const idMap=new Map();
      for (const record of records.filter(r=>!r.linkedTo)) {
        const match=existing.find(r=>r.id===record.id) || duplicate(existing,record);
        if (match){idMap.set(record.id,match.id);continue;}
        store.add(record); existing.push(record);idMap.set(record.id,record.id);added++;
      }
      for(const original of records.filter(r=>r.linkedTo)){if(existing.some(r=>r.id===original.id))continue;const record={...original,linkedTo:idMap.get(original.linkedTo) || original.linkedTo};store.add(record);existing.push(record);added++;}
    };
    tx.oncomplete=()=>{if(added)announce();resolve(added);};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('가져오기가 취소되었습니다.'));
  });
}
// Update only classification; keep current notes, attachments and reading status.
export async function organize(changes) {
  const db=await ready;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');let changed=0,skipped=0;
    for(const change of changes){const req=store.get(change.id);req.onsuccess=()=>{
      const current=req.result;
      if(!current || current.collection!==change.before.collection || current.tags!==change.before.tags || (change.before.kind!==undefined && current.kind!==change.before.kind)){skipped++;return;}
      store.put({...current,collection:change.collection,tags:change.tags,kind:change.kind || current.kind,updated:Date.now()});changed++;
    };}
    tx.oncomplete=()=>{if(changed)announce();resolve({changed,skipped});};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('분류 저장이 취소되었습니다.'));
  });
}
// Atomic reviewed bibliography updates. Never normalize away personal fields/attachments.
export async function applyMetadata(plans){
 const db=await ready;
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('records','readwrite'),store=tx.objectStore('records'),result={added:0,changed:0,linked:0,skipped:0,failures:[],savedIds:[]};
  const req=store.getAll();req.onsuccess=()=>{try{
   const records=req.result,versions=new Map(records.map(r=>[r.id,r.updated]));
   const skip=(plan,reason)=>{result.skipped++;result.failures.push({targetId:plan.targetId,sourceIds:(plan.mergeSources || []).map(s=>s.id),title:plan.record.title,reason});};
   for(const plan of plans){
    const current=plan.targetId?records.find(r=>r.id===plan.targetId):null;
    if(plan.targetId && (!current || current.linkedTo || versions.get(current.id)!==plan.beforeVersion)){skip(plan,'저장 대상이 변경·삭제되었습니다. 다시 조회해주세요.');continue;}
    const input=normalize(plan.record),sources=(plan.mergeSources || []).map(s=>({guard:s,record:records.find(r=>r.id===s.id)}));
    if(sources.some(s=>!s.record || s.record.id===current?.id || s.record.linkedTo || versions.get(s.record.id)!==s.guard.beforeVersion || s.record.doi && !sameBibliographicDocument(s.record,input)) || sources.length && (!current || !sameBibliographicDocument(current,input))){skip(plan,'연결할 PDF·DOI·기존 논문이 변경되었습니다. 다시 조회해주세요.');continue;}
    let next=current?{...current}:input;
    if(current){for(const key of metadataFields)next[key]=input[key];next.updated=input.updated;}
    if(plan.attachment && !next.attachment)next.attachment=plan.attachment;
    next.references=mergeReferences(current?.references,input.references);
    next.bibliography=checkedBibliography(next,plan.bibliographySource || input.bibliography?.source || '수동 입력',!!plan.manuallyConfirmed);
    if(input.bibliography?.doiStatus)next.bibliography.doiStatus=input.bibliography.doiStatus;
    if(!plan.manuallyConfirmed && input.bibliography?.status==='partial')next.bibliography.status='partial';
    if(sources.length)next=mergeBibliographyPersonal(next,sources.map(s=>s.record));
    const sourceIds=new Set(sources.map(s=>s.record.id));
    if(duplicate(records.filter(r=>!sourceIds.has(r.id)),next)){skip(plan,'같은 DOI·주소의 다른 자료가 있습니다. 다시 조회하면 연결 대상을 확인할 수 있습니다.');continue;}
    if(current){store.put(next);Object.assign(current,next);result.changed++;}
    else{store.add(next);records.push(next);result.added++;}
    for(const {record:source} of sources){const alias={...source,linkedTo:next.id,updated:Math.max(Date.now(),source.updated+1)};for(const key of metadataFields)if(next[key])alias[key]=next[key];alias.attachment ||= plan.attachment;store.put(alias);Object.assign(source,alias);result.linked++;}
    result.savedIds.push(plan.targetId || next.id,...sourceIds);
   }
  }catch(e){tx.abort();reject(e);}};
  tx.oncomplete=()=>{if(result.added || result.changed)announce();resolve(result);};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || Error('서지정보 저장이 취소되었습니다.'));
 });
}
