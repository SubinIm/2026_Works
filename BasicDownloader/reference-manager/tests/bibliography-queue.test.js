import 'fake-indexeddb/auto';import test from 'node:test';import assert from 'node:assert/strict';
import {normalize,parseBackup} from '../model.js';
import {bibliographyQuality,checkedBibliography,bibliographyProblem} from '../bibliography-state.js';
import {planSavedBibliography,metadataPreview,metadataOrigins,readBibliography,readBibliographyWithFallback} from '../bibliography.js';
import {crossrefMetadata,readCrossref,openSourceTab,scholarURL} from '../bibliography-recovery.js';
import {save,get,applyMetadata,recordActivity} from '../db.js';
import {MemoryDirectory} from './memory-folder.js';import {writeFolder,listFolder,readFolder} from '../folder-store.js';
const paper=(input={})=>normalize({title:'Actual airspace research title',kind:'journal',...input});
const complete=()=>paper({id:'complete',authors:'One; Two',date:'2024',doi:''});
const registered=(key='10.1234/exact')=>({message:{DOI:key,title:['Registered bibliographic title'],author:[{given:'A',family:'Researcher'},{name:'Research Institute'}],published:{'date-parts':[[2024,3,4]]},'container-title':['Research Journal'],type:'journal-article',publisher:'Publisher',URL:'https://unsafe.example/redirect'}});
test('default queue excludes legacy complete papers, linked aliases and nonacademic records; both categories are opt-in',()=>{
 const missing=paper({id:'missing'}),web=normalize({id:'product',title:'Red Bull camera drone',kind:'product',url:'https://cults3d.com/en/3d-model/drone'}),alias=paper({linkedTo:'missing'}),records=[complete(),missing,web,alias];
 assert.deepEqual(planSavedBibliography(records).map(i=>i.targetId),['missing']);
 assert.deepEqual(planSavedBibliography(records,{includeConfirmed:true}).map(i=>i.targetId),['complete','missing']);
 assert.deepEqual(planSavedBibliography(records,{includeOther:true}).map(i=>i.targetId),['missing','product']);
 assert.equal(planSavedBibliography(records,{includeOther:true,includeConfirmed:true}).length,3);
 assert.equal(planSavedBibliography(records)[0].queueRecord.title,missing.title);
});
test('field quality accepts DOI-less conferences and institutional document versions, but rejects filename/site/figure titles',()=>{
 assert.equal(bibliographyQuality({...complete(),kind:'conference'}).confirmed,true);
 assert.equal(bibliographyQuality(normalize({title:'Airspace manual',kind:'manual',venue:'ICAO',version:'2.0'})).confirmed,true);
 for(const title of ['download.pdf','DBpia','Figure 6 | Actual paper'])assert.equal(bibliographyQuality({...complete(),title}).confirmed,false);
 assert.deepEqual(bibliographyQuality(paper()).missing,['저자','발행일']);
 assert.match(bibliographyProblem(Error('403 Forbidden')),/원문 탭/);
});
test('partial/ambiguous metadata stays queued despite complete fields, and reviewed confirmation is invalid after a bibliographic edit',()=>{
 const r=complete();r.bibliography={...checkedBibliography(r,'PDF 제목 추정'),status:'partial'};assert.equal(bibliographyQuality(r).confirmed,false);
 const preview=metadataPreview(planSavedBibliography([paper()])[0],{title:r.title,authors:r.authors,date:r.date,titleGuessed:true},[]);assert.equal(preview.record.bibliography.status,'partial');
 const manual=paper();manual.bibliography=checkedBibliography(manual,'수동 확인',true);assert.equal(bibliographyQuality(manual).confirmed,true);manual.title='Changed incomplete title';assert.equal(bibliographyQuality(manual).confirmed,false);
 const changed=complete();changed.bibliography=checkedBibliography(changed,'Crossref');changed.title='Changed title with other fields intact';assert.equal(bibliographyQuality(changed).confirmed,false);
});
test('reviewed state persists atomically with metadata and survives backups/folder snapshots without losing usage',async()=>{
 const before=paper({id:'review-state',notes:'Keep note',status:'done'});await save(before);const preview=metadataPreview(planSavedBibliography([before])[0],crossrefMetadata(registered(),'10.1234/exact'),[before]);
 assert.equal(bibliographyQuality(await get(before.id)).confirmed,false);await recordActivity(before.id,'lookup');await applyMetadata([preview]);const after=await get(before.id);
 assert.equal(after.notes,before.notes);assert.equal(after.activity.lookup,1);assert.equal(after.bibliography.status,'confirmed');assert.equal(planSavedBibliography([after]).length,0);
 const backup=parseBackup(JSON.stringify({format:'paperdesk',version:1,records:[after]}))[0];assert.deepEqual(backup.bibliography,after.bibliography);
 const folder=new MemoryDirectory('reviewed');await writeFolder(folder,[after],{clientId:'chrome-review',browser:'Chrome'});assert.deepEqual((await readFolder(folder,(await listFolder(folder))[0]))[0].bibliography,after.bibliography);
});
test('explicit manual confirmation can record genuinely absent fields without forcing a DOI or author guess',async()=>{
 const r=normalize({id:'manual-state',title:'Institutional manual',kind:'manual'});await save(r);await applyMetadata([{targetId:r.id,beforeVersion:r.updated,record:r,manuallyConfirmed:true,bibliographySource:'수동 확인'}]);assert.equal(planSavedBibliography([await get(r.id)]).length,0);
});
test('Crossref exact DOI enrichment maps registered authors/date/type and rejects wrong or missing DOI',()=>{
 const result=crossrefMetadata(registered(),'https://doi.org/10.1234/EXACT');assert.equal(result.title,'Registered bibliographic title');assert.equal(result.authors,'A Researcher; Research Institute');assert.equal(result.date,'2024-03-04');assert.equal(result.kind,'journal');assert.equal(result.url,undefined);
 assert.throws(()=>crossrefMetadata(registered('10.1234/different'),'10.1234/exact'),/다릅니다/);
 assert.throws(()=>crossrefMetadata({message:{title:['Wrong work']}},'10.1234/exact'),/다릅니다/);
});
test('DOI lookup requests only the exact DOI with no credentials; rejects oversized/invalid/nonregistered responses',async()=>{
 let called;const fetcher=async(url,options)=>{called={url,options};return new Response(JSON.stringify(registered()),{headers:{'content-type':'application/json'}});};
 await readCrossref({doi:'10.1234/exact',notes:'private',localSource:'file:///C:/secret.pdf'},fetcher);assert.equal(called.url,'https://api.crossref.org/works/10.1234%2Fexact');assert.equal(called.options.credentials,'omit');assert.equal(called.options.redirect,'error');assert.equal(called.options.body,undefined);
 await assert.rejects(readCrossref({doi:'invalid'},fetcher),/유효한/);
 await assert.rejects(readCrossref({doi:'10.1234/exact'},async()=>new Response('{}',{status:404})),/등록되지/);
 await assert.rejects(readCrossref({doi:'10.1234/exact'},async()=>new Response('x'.repeat(1024*1024+1),{headers:{'content-type':'application/json'}})),/너무 큽니다/);
});
test('source recovery reuses normal tabs, ignores incognito and requests redirected origin even with local PDF',async()=>{
 let created=0,updated=0;const item={record:paper({url:'https://example.org/article'}),localAttachment:{data:'broken'},tabIds:[],tabUrls:[]};
 const api={tabs:{query:async()=>[{id:1,url:item.record.url,incognito:true},{id:2,url:item.record.url}],update:async()=>{updated++;},create:async()=>{created++;return {id:3,url:item.record.url};}}};
 await openSourceTab(item,api);assert.equal(item.recoveryTabId,2);assert.equal(created,0);assert.equal(updated,1);
 item.tabUrls=['https://publisher.example/article'];assert.ok(metadataOrigins([item]).includes('https://publisher.example/*'));
 const incoming={title:'Actual airspace research title',authors:'Author',date:'2024',doi:'10.1234/exact',metadataFound:true};
 api.tabs.get=async()=>({id:2,url:item.tabUrls[0]});api.permissions={contains:async()=>true};api.scripting={executeScript:async()=>[{result:incoming}]};assert.equal((await readBibliography(item,api)).authors,'Author');
 api.tabs.get=async()=>({id:2,url:'https://moved.example/other'});let reads=0;api.permissions.contains=async()=>false;api.scripting.executeScript=async()=>{reads++;};await assert.rejects(readBibliography(item,api));assert.equal(reads,0);
 assert.throws(()=>scholarURL({}),/검색할/);assert.equal(new URL(scholarURL({title:'Title',doi:'10.1234/exact',notes:'private'})).searchParams.get('q'),'10.1234/exact');
});
test('queue automatically supplements blocked sources by exact DOI when Crossref permission is granted',async()=>{
 const item=planSavedBibliography([paper({doi:'10.1234/exact'})])[0];
 const api={permissions:{contains:async({origins})=>origins[0]==='https://api.crossref.org/*'}};let calls=0;
 const result=await readBibliographyWithFallback(item,api,async r=>{calls++;assert.equal(r.doi,item.record.doi);return crossrefMetadata(registered(),r.doi);});
 assert.equal(result.title,'Registered bibliographic title');assert.equal(calls,1);
 api.permissions.contains=async()=>false;await assert.rejects(readBibliographyWithFallback(item,api,async()=>{calls++;}));assert.equal(calls,1);
});
test('partial rendered title is replaced by the registered title and partial metadata remains usable when DOI service fails',async()=>{
 const item=planSavedBibliography([paper({url:'https://example.org/article',doi:'10.1234/exact'})])[0];item.tabIds=[4];
 const api={tabs:{get:async()=>({url:item.sourceUrl})},permissions:{contains:async()=>true},scripting:{executeScript:async()=>[{result:{title:'Rendered partial title',doi:'10.1234/exact',metadataFound:true}}]}};
 // Tab with a partial result normally attempts detached HTML. Deny that origin after scripting.
 let originChecks=0;api.permissions.contains=async({origins})=>origins[0]==='https://api.crossref.org/*' || originChecks++===0;
 const result=await readBibliographyWithFallback(item,api,async()=>crossrefMetadata(registered(),'10.1234/exact'));assert.equal(result.title,'Registered bibliographic title');assert.equal(result.authors,'A Researcher; Research Institute');
 originChecks=0;const partial=await readBibliographyWithFallback(item,api,async()=>{throw Error('미등록 DOI');});assert.equal(partial.title,'Rendered partial title');assert.match(partial.metadataStatus,/DOI 보완 실패/);
});
