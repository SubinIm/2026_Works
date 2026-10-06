import { duplicate } from './model.js';
const ready = new Promise((resolve,reject) => {
  const req = indexedDB.open('paperdesk', 1);
  req.onupgradeneeded = () => req.result.createObjectStore('records', {keyPath:'id'});
  req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
});
export async function all() {
  const db = await ready;
  return new Promise((resolve,reject) => { const r=db.transaction('records').objectStore('records').getAll(); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
}
export async function save(record) {
  const db = await ready;
  return new Promise((resolve,reject) => {
    const tx=db.transaction('records','readwrite'), store=tx.objectStore('records'); let conflict;
    const req=store.getAll();
    req.onsuccess=()=>{ conflict=duplicate(req.result,record); if (!conflict) store.put(record); };
    tx.oncomplete=()=>resolve(conflict); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error || new Error('저장이 취소되었습니다.'));
  });
}
export async function remove(id) {
  const db=await ready;
  return new Promise((resolve,reject)=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
}
export async function merge(records) {
  const db=await ready;
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('records','readwrite'),store=tx.objectStore('records'); let added=0;
    const req=store.getAll(); req.onsuccess=()=>{
      const existing=req.result;
      for (const record of records) {
        if (existing.some(r=>r.id===record.id) || duplicate(existing,record)) continue;
        store.add(record); existing.push(record); added++;
      }
    };
    tx.oncomplete=()=>resolve(added);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || new Error('가져오기가 취소되었습니다.'));
  });
}
