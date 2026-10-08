import 'fake-indexeddb/auto';import test from 'node:test';import assert from 'node:assert/strict';
import {normalize,parseBackup} from '../model.js';import {all,get,save,recordActivity,applyMetadata} from '../db.js';
import {nextActivity,normalizeActivity,documentFingerprint} from '../activity.js';import {kindMatches} from '../taxonomy.js';
import {planSavedBibliography,metadataPreview,readBibliography} from '../bibliography.js';import {visitedRecord,trackTabVisit} from '../visit-tracker.js';
import {setTrackingEnabled,trackingEnabled} from '../tracking-settings.js';import {MemoryDirectory} from './memory-folder.js';import {writeFolder,listFolder,readFolder} from '../folder-store.js';import {makePDF} from './pdf-fixture.js';

test('hierarchy includes paper/technical families and unresolved subtypes separately',()=>{
 for(const kind of ['journal','conference','preprint','thesis','paper'])assert.ok(kindMatches(kind,'papers'));
 for(const kind of ['patent','standard','report','manual','document'])assert.ok(kindMatches(kind,'technical'));
 assert.ok(kindMatches('paper','review'));assert.ok(kindMatches('document','review'));assert.equal(kindMatches('journal','review'),false);assert.equal(kindMatches('patent','papers'),false);assert.ok(kindMatches('conference','papers','conference'));assert.equal(kindMatches('journal','papers','conference'),false);assert.ok(kindMatches('wiki','web'));assert.ok(kindMatches('other','other'));assert.ok(kindMatches('book'));
});
test('classified existing records are lookup candidates without pending classification and with personal fields intact',()=>{
 const old=normalize({id:'classified',title:'Safety filters',url:'https://arxiv.org/abs/2507.07805',kind:'preprint',collection:'내 연구',notes:'메모',status:'done'});const item=planSavedBibliography([old,{...old,id:'alias',linkedTo:old.id}])[0];
 assert.equal(item.selected,true);assert.equal(item.targetId,old.id);assert.equal(item.metadataReady,false);assert.equal(item.beforeVersion,old.updated);
 const preview=metadataPreview(item,{title:'Safety filters clarified',authors:'Author',date:'2026',doi:'10.1234/safety',metadataFound:true},[old]);assert.equal(preview.metadataReady,true);assert.equal(preview.record.collection,old.collection);assert.equal(preview.record.notes,old.notes);assert.equal(preview.record.status,'done');
});
test('usage counters are atomic across concurrent writers, preserve editing and metadata version guards',async()=>{
 const old=normalize({id:'usage',title:'Usage paper',doi:'10.1234/usage',notes:'old',collection:'내 연구'});await save(old);
 await Promise.all(Array.from({length:12},(_,i)=>recordActivity(old.id,'open',{at:1000+i})));let current=await get(old.id);assert.equal(current.activity.open,12);assert.equal(current.updated,old.updated);assert.match(current.activity.fingerprint,/^[a-f0-9]{64}$/);
 await save({...old,notes:'edited'});current=await get(old.id);assert.equal(current.activity.open,12);assert.equal(current.notes,'edited');
 const plan=planSavedBibliography([current])[0];await recordActivity(old.id,'lookup',{at:2000});assert.equal((await applyMetadata([{...plan,record:{...current,authors:'New Author'}}])).changed,1);assert.equal((await get(old.id)).activity.lookup,1);
});
test('automatic visit pairs deduplicate while later focus and reload remain separate',()=>{
 let a=nextActivity({},'visit',{source:'auto-focus',tabId:7,at:1000});a=nextActivity(a,'visit',{source:'auto-load',tabId:7,at:1100});assert.equal(a.visit,1);
 a=nextActivity(a,'visit',{source:'auto-focus',tabId:7,at:1200});assert.equal(a.visit,2);a=nextActivity(a,'visit',{source:'auto-load',tabId:7,at:7000});assert.equal(a.visit,3);
 a=nextActivity(a,'visit',{source:'auto-load',tabId:8,at:7100});assert.equal(a.visit,4);
 for(let i=0;i<205;i++)a=nextActivity(a,'lookup',{at:8000+i});assert.equal(a.lookup,205);assert.equal(a.recent.length,200);assert.equal(a.first,1000);
});
test('automatic tracking only matches saved active documents and resolves linked PDF aliases',async()=>{
 const paper=normalize({id:'active',title:'Paper',doi:'10.1234/active'}),alias=normalize({id:'alias',title:'PDF',localSource:'file:///C:/Example/active.pdf',linkedTo:paper.id});const records=[paper,alias],tab={id:11,active:true,url:'https://example.org/doi/pdf/10.1234/active',status:'complete'};
 assert.equal(visitedRecord(tab,records).id,paper.id);assert.equal(visitedRecord({...tab,url:alias.localSource},records).id,paper.id);
 for(const extra of [{incognito:true},{active:false},{pendingUrl:'https://example.org/else'},{status:'loading'},{url:'https://example.org/unrelated'},{url:'chrome://settings'}])assert.equal(visitedRecord({...tab,...extra},records),null);
 let calls=0;const options={enabled:async()=>false,records:async()=>records,record:async()=>{calls++;}};assert.equal(await trackTabVisit(tab,'auto-focus',{permissions:{contains:async()=>true}},options),false);assert.equal(calls,0);
 options.enabled=async()=>true;assert.equal(await trackTabVisit(tab,'auto-focus',{permissions:{contains:async()=>false}},options),false);assert.equal(await trackTabVisit(tab,'auto-focus',{permissions:{contains:async()=>true}},options),true);assert.equal(calls,1);
});
test('worker registers top-level listeners, persists enable state, and disables after permission removal',async()=>{
 const handlers={},event=key=>({addListener:f=>{handlers[key]=f;}});await setTrackingEnabled(false);const row=normalize({id:'worker-record',title:'Worker paper',url:'https://example.org/worker'});await save(row);
 let tabReads=0;globalThis.chrome={tabs:{onActivated:event('activated'),onUpdated:event('updated'),get:async id=>{tabReads++;return {id,url:row.url,active:true,status:'complete'};}},permissions:{onRemoved:event('removed'),contains:async()=>true}};
 await import('../background.js');assert.equal(typeof handlers.activated,'function');await handlers.activated({tabId:19});assert.equal(tabReads,0);
 await setTrackingEnabled(true);assert.equal(await trackingEnabled(),true);await handlers.activated({tabId:19});assert.equal((await get(row.id)).activity.visit,1);await handlers.updated(19,{status:'complete'},{id:19,url:row.url,active:true,status:'complete'});assert.equal((await get(row.id)).activity.visit,1);
 await handlers.removed({permissions:['tabs']});assert.equal(await trackingEnabled(),false);delete globalThis.chrome;
});
test('history and document fingerprints survive backup and Chrome/Edge folder snapshots without merging counts',async()=>{
 const current=await get('usage'),backup=parseBackup(JSON.stringify({format:'paperdesk',version:1,records:[current]}))[0];assert.deepEqual(backup.activity,current.activity);
 const parent=new MemoryDirectory('usage-fixture');await writeFolder(parent,[current],{clientId:'chrome-usage',browser:'Chrome'});await writeFolder(parent,[{...current,activity:{...current.activity,open:2}}],{clientId:'edge-usage',browser:'Edge'});const sources=await listFolder(parent);const chrome=await readFolder(parent,sources.find(s=>s.browser==='Chrome')),edge=await readFolder(parent,sources.find(s=>s.browser==='Edge'));assert.equal(chrome[0].activity.open,12);assert.equal(edge[0].activity.open,2);assert.equal(chrome[0].activity.fingerprint,edge[0].activity.fingerprint);
 assert.equal(await documentFingerprint('doi:10.1234/usage'),current.activity.fingerprint);assert.equal(normalizeActivity({open:-1,lookup:Infinity,recent:[{action:'private-url',at:1,url:'secret'}]}).recent.length,0);
});
test('an already attached PDF can supply saved bibliography without page permissions',async()=>{
 const item=planSavedBibliography([{...normalize({id:'attached',title:'Old PDF title',kind:'paper'}),attachment:{name:'paper.pdf',data:'data:application/pdf;base64,'+Buffer.from(makePDF()).toString('base64')}}])[0];
 const {readBibliography:builtReader}=await import('../dist/bibliography.js');const read=await builtReader(item,{permissions:{contains:async()=>false}});assert.equal(read.metadataFound,true);assert.match(read.metadataStatus,/첨부 PDF/);assert.ok(read.title);
});
