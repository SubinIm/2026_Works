import 'fake-indexeddb/auto';import test from 'node:test';import assert from 'node:assert/strict';
import {normalize,parseBackup} from '../model.js';import {all,save,get,applyMetadata,recordActivity} from '../db.js';
import {planSavedBibliography,metadataPreview,metadataOrigins} from '../bibliography.js';import {metadataFromPDF} from '../pdf-matching.js';
import {capturePage} from '../capture.js';import {fromTab,planTabs} from '../organizer.js';import {normalizeReferences,mergeReferences} from '../references.js';
import {makePDF} from './pdf-fixture.js';import {MemoryDirectory} from './memory-folder.js';import {writeFolder,listFolder,readFolder} from '../folder-store.js';
const attachment=(options={})=>({name:'Sun_2016_Meas._Sci._Technol._27_085008.pdf',data:'data:application/pdf;base64,'+Buffer.from(makePDF(options)).toString('base64')});

test('attached local PDF takes priority over complete web metadata and requests no site access',async()=>{
 const old={...normalize({title:'Sun_2016_Meas._Sci._Technol._27_085008.pdf',url:'https://example.org/paper',kind:'paper',notes:'keep'}),attachment:attachment()};
 const item=planSavedBibliography([old],{includeTechnicalPages:true})[0];assert.deepEqual(metadataOrigins([item]),[]);
 const api={tabs:{get:async()=>{throw Error('must not read a tab');}},permissions:{contains:async()=>{throw Error('must not request site access');}}};item.tabIds=[1];
 const {readBibliography}=await import('../dist/bibliography.js');const incoming=await readBibliography(item,api);assert.equal(incoming.title,'Urban airspace risk and safety analysis');assert.match(incoming.metadataStatus,/첨부 PDF/);assert.equal(incoming.authors,'A Researcher; B Researcher');
 const preview=metadataPreview(item,incoming,[old]);assert.equal(preview.record.title,incoming.title);assert.equal(preview.record.notes,'keep');assert.equal(preview.record.attachment,old.attachment);
});
test('filename embedded as PDF Title is replaced by text of the first page',async()=>{
 const {readPDF}=await import('../dist/pdf-reader.js');const parsed=await readPDF(makePDF({embeddedTitle:'Sun_2016_Meas._Sci._Technol._27_085008.pdf'}),'Sun_2016_Meas._Sci._Technol._27_085008.pdf');
 assert.equal(parsed.title,'Urban airspace risk and safety analysis');assert.equal(parsed.titleGuessed,true);assert.equal(parsed.doi,'10.1234/paperdesk.fixture');
});
test('bibliographic cover title overrides a plausible but stale embedded PDF Title',()=>{
 const parsed=metadataFromPDF({info:{Title:'Unrelated old working manuscript'},lines:['Citation (APA)','Sun, J. (2016). Verified measurement research title. In Measurement Science and Technology','Important note']},'Sun_2016.pdf');
 assert.equal(parsed.title,'Verified measurement research title.');assert.equal(parsed.authors,'Sun, J.');assert.equal(parsed.date,'2016');
});
test('the word bibliography in a title does not truncate own DOI or publication date',()=>{
 const parsed=metadataFromPDF({lines:['A bibliography study on control systems','DOI: 10.1234/own','Published 2026','References','Author 10.5678/cited']},'paper.pdf');assert.equal(parsed.doi,'10.1234/own');assert.equal(parsed.date,'2026');
});
test('linked PDF aliases provide bytes to parent lookup and invalid local data never falls through to network',async()=>{
 const parent=normalize({id:'parent',title:'Saved scholarly paper',url:'https://example.org/article'}),alias={...normalize({id:'alias',title:'Local file',linkedTo:parent.id}),attachment:attachment()};
 const plan=planSavedBibliography([parent,alias]);assert.equal(plan.length,1);assert.equal(plan[0].localAttachment,alias.attachment);assert.deepEqual(metadataOrigins(plan),[]);
 const {readBibliography}=await import('../dist/bibliography.js');await assert.rejects(readBibliography({...plan[0],localAttachment:{name:'broken.pdf',data:'data:application/pdf;base64,AAAA'}}),/로컬 PDF 분석 실패/);
});
test('reviewed selected PDF is linked once and preserves concurrent usage and existing attachment',async()=>{
 const old=normalize({id:'local-selected',title:'measurement.pdf',notes:'research note',status:'done'});await save(old);const pdf=attachment(),plan=metadataPreview(planSavedBibliography([old],{includeTechnicalPages:true})[0],{title:'Verified measurement research title',doi:'10.1234/selected',authors:'Sun'},[old]);
 await recordActivity(old.id,'lookup');assert.equal((await applyMetadata([{...plan,attachment:pdf}])).changed,1);let saved=await get(old.id);assert.equal(saved.attachment.name,pdf.name);assert.equal(saved.notes,old.notes);assert.equal(saved.status,'done');assert.equal(saved.activity.lookup,1);
 const next=planSavedBibliography([saved])[0];assert.equal((await applyMetadata([{...next,record:{...saved,authors:'Sun; Researcher'},attachment:attachment({title:'Another file'})}])).changed,1);saved=await get(old.id);assert.equal(saved.attachment.data,pdf.data);
 assert.equal(metadataPreview(next,{doi:'10.9999/wrong',title:'A different paper'},[saved]).metadataReady,false);
});
test('figure page title and visited context become references while paper title stays canonical',()=>{
 const title='Figure 6 | Flight Path Error Estimation and Management Strategy for Four-Dimensional Trajectory',url='https://www.mdpi.com/fixture#fig6';
 const from=fromTab({id:6,title,url});assert.equal(from.record.title,title.split(' | ')[1]);assert.equal(from.record.references[0].text,title);assert.equal(from.record.references[0].url,url);
 const grouped=planTabs([{id:6,title,url},{id:7,title:'Table 2 | '+from.record.title,url:'https://www.mdpi.com/fixture#table2'}]);assert.equal(grouped.items.length,1);assert.equal(grouped.items[0].record.references.length,2);
 const doc={title,querySelectorAll:s=>s==='meta'?[{content:from.record.title,getAttribute:k=>k==='name'?'citation_title':''}]:[],querySelector:()=>null,defaultView:{getSelection:()=>({toString:()=> 'Selected flight path error paragraph'})},getElementById:()=>({textContent:'Figure 6. Flight path error distribution.'})};
 const captured=capturePage(doc,url);assert.equal(captured.title,from.record.title);assert.deepEqual(captured.references.map(r=>r.source),['page-title','selection','anchor']);
 const old=normalize({title,url,notes:'note'}),preview=metadataPreview(planSavedBibliography([old],{includeTechnicalPages:true})[0],captured,[old]);assert.equal(preview.record.title,from.record.title);assert.ok(preview.record.references.some(r=>r.text===title));assert.ok(preview.record.references.some(r=>r.text.startsWith('Selected')));
 const titled=metadataPreview({...preview,record:preview.record},{title:'download.pdf',authors:'Author'},[preview.record]);assert.equal(titled.record.title,from.record.title);
});
test('reading contexts survive database review, backups and per-browser folder snapshots without overwrite',async()=>{
 const old=normalize({id:'contexts',title:'Figure 6 | Flight path management research',url:'https://example.org/fig6',notes:'keep'});await save(old);
 const proposed=metadataPreview(planSavedBibliography([old],{includeTechnicalPages:true})[0],{title:'Flight path management research',references:[{text:'Selected paragraph',url:old.url,source:'selection',at:123}]},[old]);await applyMetadata([proposed]);const current=await get(old.id);assert.equal(current.references.length,2);
 const backup=parseBackup(JSON.stringify({format:'paperdesk',version:1,records:[current]}))[0];assert.deepEqual(backup.references,current.references);
 const folder=new MemoryDirectory('references');await writeFolder(folder,[current],{clientId:'chrome-ref',browser:'Chrome'});const sources=await listFolder(folder);assert.deepEqual((await readFolder(folder,sources[0]))[0].references,current.references);
 assert.equal(normalizeReferences([{text:'safe',url:'javascript:alert(1)'},{text:'token',url:'https://example.org/?token=secret'}]).every(r=>!r.url),true);assert.equal(mergeReferences(current.references,current.references).length,2);
});
