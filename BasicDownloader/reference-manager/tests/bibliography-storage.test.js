import 'fake-indexeddb/auto';import test from 'node:test';import assert from 'node:assert/strict';import {save,get,all,applyMetadata} from '../db.js';import {normalize} from '../model.js';
test('review saves arXiv v1 and latest with their shared DOI without losing either version',async()=>{
 const versioned=normalize({id:'arxiv-v1',title:'First version',kind:'preprint',url:'https://arxiv.org/html/2507.07805v1',notes:'Keep first-version note'}),latest=normalize({id:'arxiv-latest',title:'Latest version',kind:'preprint',url:'https://arxiv.org/pdf/2507.07805',notes:'Keep latest-version note'});await save(versioned);await save(latest);
 const result=await applyMetadata([versioned,latest].map(r=>({targetId:r.id,beforeVersion:r.updated,record:{...r,doi:'10.48550/arxiv.2507.07805',authors:'Author One',date:'2025',version:r.id==='arxiv-v1'?'v1':'',pdfUrl:r.id==='arxiv-v1'?'https://arxiv.org/pdf/2507.07805v1':'https://arxiv.org/pdf/2507.07805'}})));
 assert.equal(result.changed,2);assert.equal(result.skipped,0);assert.equal((await get(versioned.id)).notes,versioned.notes);assert.equal((await get(latest.id)).notes,latest.notes);
});
test('reviewed bibliographic repair preserves notes, reading state, attachment and local source',async()=>{
 const before=normalize({id:'repair',title:'DBpia',notes:'Keep this note',status:'done',localSource:'file:///C:/Example/paper.pdf',version:'v2'});before.attachment={name:'paper.pdf',data:'unchanged'};await save(before);
 const r=await applyMetadata([{targetId:before.id,beforeVersion:before.updated,record:{...before,title:'Actual conference paper title',authors:'김주영; 김나현; 이금진',kind:'conference',date:'2023-11'}}]);
 assert.equal(r.changed,1);const after=await get(before.id);assert.equal(after.title,'Actual conference paper title');for(const key of ['notes','status','localSource','version'])assert.equal(after[key],before[key]);assert.deepEqual(after.attachment,before.attachment);
});
test('stale/deleted target and new duplicate DOI are skipped atomically',async()=>{
 const before=await get('repair');await save({...before,updated:before.updated+100});
 assert.equal((await applyMetadata([{targetId:before.id,beforeVersion:before.updated,record:{...before,title:'Stale overwrite'}}])).skipped,1);
 assert.equal((await applyMetadata([{targetId:'missing',beforeVersion:0,record:normalize({title:'Missing target'})}])).skipped,1);
 const existing=normalize({id:'doi-owner',title:'Existing journal article',doi:'10.1234/existing'});await save(existing);
 const current=await get('repair');assert.equal((await applyMetadata([{targetId:current.id,beforeVersion:current.updated,record:{...current,doi:existing.doi}}])).skipped,1);
 assert.equal((await get('repair')).doi,'');assert.equal((await all()).filter(r=>!r.id.startsWith('arxiv-')).length,2);
});
