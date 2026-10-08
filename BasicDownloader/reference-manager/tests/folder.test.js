import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,writeFile,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {writeFolder,listFolder,readFolder,readFolderPDF} from '../folder-store.js';
import {groupFolderRecords} from '../folder-view.js';
import {normalize} from '../model.js';
import {NodeDirectory} from './node-folder.js';
const pdf='%PDF-1.7\nPaperdesk fixture\n%%EOF',attachment={name:'review.pdf',data:'data:application/pdf;base64,'+btoa(pdf)};
async function fixture(t,hooks){const tmp=await mkdtemp(path.join(os.tmpdir(),'paperdesk-folder-test-'));assert.ok(path.resolve(tmp).startsWith(path.resolve(os.tmpdir())+path.sep+'paperdesk-folder-test-'));t.after(()=>rm(tmp,{recursive:true,force:true}));return new NodeDirectory(tmp,hooks);}
const record=(id,notes='Chrome note',status='unread')=>({...normalize({id,title:'Shared journal paper',doi:'10.1234/example',kind:'journal',venue:'Example Journal',notes,status}),attachment});
const opts=(clientId,browser,date='2026-10-07T08:00:00.000Z')=>({clientId,browser,now:new Date(date)});
test('Chrome and Edge snapshots remain separate; identical PDFs share one disk object',async t=>{
 const dir=await fixture(t);await writeFolder(dir,[record('chrome-record')],opts('chrome-fixture','Chrome'));const result=await writeFolder(dir,[record('edge-record','Edge note','done')],opts('edge-fixture','Edge'));
 assert.equal(result.reused,1);assert.equal((await readdir(path.join(dir.dir,'Paperdesk','pdfs'))).length,1);
 const entries=await listFolder(dir);assert.equal(entries.length,2);assert.deepEqual(new Set(entries.map(e=>e.browser)),new Set(['Chrome','Edge']));
 for(const entry of entries){const [saved]=await readFolder(dir,entry);assert.equal(saved.attachment.data,attachment.data);assert.equal(saved.kind,'journal');assert.equal(saved.venue,'Example Journal');assert.equal(saved.notes,entry.browser+' note');assert.equal(saved.status,entry.browser==='Edge'?'done':'unread');}
});
test('Combined view groups same DOI and keeps per-browser notes/status without mutating sources',async t=>{
 const dir=await fixture(t);await writeFolder(dir,[record('one')],opts('chrome-fixture','Chrome'));await writeFolder(dir,[record('two','Edge note','done'),normalize({id:'tool',title:'Windy',url:'https://windy.com',kind:'webtool'})],opts('edge-fixture','Edge'));
 const sources=[];for(const entry of await listFolder(dir))sources.push({entry,records:await readFolder(dir,entry,{includePDFs:false})});
 const before=JSON.stringify(sources),groups=groupFolderRecords(sources);assert.equal(groups.length,2);const shared=groups.find(g=>g.variants.length===2);assert.deepEqual(new Set(shared.variants.map(v=>v.record.notes)),new Set(['Chrome note','Edge note']));assert.equal(JSON.stringify(sources),before);assert.ok(shared.variants.every(v=>v.record.folderAttachment && !v.record.attachment));
});
test('Latest complete snapshot wins per client; interrupted index falls back to previous complete one',async t=>{
 const dir=await fixture(t);await writeFolder(dir,[record('one','old')],opts('chrome-fixture','Chrome'));const latest=await writeFolder(dir,[record('one','latest')],opts('chrome-fixture','Chrome','2026-10-07T09:00:00.000Z'));
 assert.equal((await readFolder(dir,(await listFolder(dir))[0]))[0].notes,'latest');await writeFile(path.join(dir.dir,latest.file),'{unfinished');const entries=await listFolder(dir);assert.equal(entries.length,1);assert.equal((await readFolder(dir,entries[0]))[0].notes,'old');
});
test('Failure writing a new index preserves prior snapshot and shared PDF',async t=>{
 const hooks={},dir=await fixture(t,hooks);await writeFolder(dir,[record('one','original')],opts('chrome-fixture','Chrome'));hooks.fail=file=>file.endsWith('.json');await assert.rejects(writeFolder(dir,[record('one','changed')],opts('chrome-fixture','Chrome','2026-10-07T09:00:00.000Z')),/Simulated/);assert.equal((await readFolder(dir,(await listFolder(dir))[0]))[0].notes,'original');
});
test('Tampered PDF is rejected on restore and subsequent export preserves corrupted file',async t=>{
 const dir=await fixture(t);await writeFolder(dir,[record('one')],opts('chrome-fixture','Chrome'));const entry=(await listFolder(dir))[0],[meta]=await readFolder(dir,entry,{includePDFs:false}),file=path.join(dir.dir,'Paperdesk',meta.folderAttachment.path);
 const tampered=pdf.replace('fixture','altered');assert.equal(tampered.length,pdf.length);await writeFile(file,tampered);await assert.rejects(readFolder(dir,entry),/변경/);await assert.rejects(readFolderPDF(dir,meta.folderAttachment),/변경/);await assert.rejects(writeFolder(dir,[record('one')],opts('edge-fixture','Edge')),/변경/);assert.equal(await readFile(file,'utf8'),tampered);
});
test('Untrusted snapshot paths and PDF reference traversal cannot access outside the selected folder',async t=>{
 const dir=await fixture(t);await assert.rejects(writeFolder(dir,[],opts('../escape','Chrome')),/식별자/);await assert.rejects(readFolder(dir,{clientId:'../escape',name:'x.json'}),/경로/);
 const saved=await writeFolder(dir,[record('one')],opts('chrome-fixture','Chrome')),file=path.join(dir.dir,saved.file),data=JSON.parse(await readFile(file,'utf8'));data.records[0].attachment.path='../outside.pdf';await writeFile(file,JSON.stringify(data));await assert.rejects(readFolder(dir,(await listFolder(dir))[0],{includePDFs:false}),/참조/);
});
test('Same title alone never merges resources; linked PDF originals do not double-count active records',()=>{
 const entry={browser:'Chrome',clientId:'fixture'},primary=normalize({id:'a',title:'Shared title',url:'https://example.org/a'}),alias=normalize({id:'alias',title:'PDF',linkedTo:'a'}),other=normalize({id:'b',title:'Shared title',url:'https://example.org/b'});
 assert.equal(groupFolderRecords([{entry,records:[primary,alias,other]}]).length,2);
});
test('Empty folder is valid; invalid attachment and excessive record count cannot publish a snapshot',async t=>{
 const dir=await fixture(t);assert.deepEqual(await listFolder(dir),[]);await assert.rejects(writeFolder(dir,[{...record('one'),attachment:{name:'bad.pdf',data:'data:application/pdf;base64,'+btoa('not pdf')}}],opts('chrome-fixture','Chrome')),/PDF/);assert.deepEqual(await listFolder(dir),[]);await assert.rejects(writeFolder(dir,Array(10001).fill(record('x')),opts('chrome-fixture','Chrome')),/10,000/);
});
