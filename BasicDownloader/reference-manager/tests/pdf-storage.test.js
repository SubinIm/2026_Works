import 'fake-indexeddb/auto';import test from 'node:test';import assert from 'node:assert/strict';
import {all,save,applyPDFs,merge,get} from '../db.js';
import {normalize,parseBackup} from '../model.js';import {pdfProposal} from '../pdf-matching.js';
import {planTabs} from '../organizer.js';

test('transaction connects matching PDF and preserves original placeholder, notes and reading state',async()=>{
 const primary=normalize({id:'primary',title:'Original curated journal paper',doi:'10.1234/storage',notes:'Research note',status:'done',collection:'Existing collection',kind:'paper'});
 const source=normalize({id:'source',title:'download.pdf',localSource:'file:///C:/Example/download.pdf',collection:'분류 검토',notes:'PDF note'});
 await save(primary);await save(source);
 const attachment={name:'download.pdf',data:'data:application/pdf;base64,JVBERi0='};
 const metadata={title:'PDF extracted paper title',doi:primary.doi,authors:'Author',kind:'journal',venue:'Journal',doiCandidates:[primary.doi]};
 const plan=pdfProposal(await all(),metadata,attachment,{sourceId:source.id});assert.equal(plan.targetId,primary.id);
 const result=await applyPDFs([plan]);assert.equal(result.linked,1);const actual=await get(primary.id),alias=await get(source.id);
 assert.equal(actual.title,primary.title);assert.equal(actual.status,'done');assert.equal(actual.collection,primary.collection);assert.match(actual.notes,/Research note/);assert.match(actual.notes,/PDF note/);assert.equal(actual.attachment.name,'download.pdf');assert.equal(actual.kind,'journal');assert.equal(alias.linkedTo,primary.id);assert.equal(alias.notes,source.notes);assert.ok(alias.attachment);
});

test('recollecting a linked local PDF keeps the original match instead of adding a duplicate',async()=>{
 const records=await all(),source=await get('source');
 const plan=planTabs([{id:9,title:'download.pdf',url:source.localSource}],records);
 assert.equal(plan.items[0].existing,true);assert.equal(plan.items[0].selected,false);
 assert.equal(await merge([normalize({title:'download.pdf',localSource:source.localSource})]),0);
 const primary=await get('primary');assert.equal(await save({...primary,notes:primary.notes+'\nEdit after linking'}),undefined);
});
test('stale PDF plan is skipped and replacement attachment is not silently overwritten',async()=>{
 const current=await get('primary');const metadata={title:current.title,doi:current.doi,kind:'journal'};const plan=pdfProposal(await all(),metadata,{name:'another.pdf',data:'data:application/pdf;base64,JVBERi0='});
 await save({...current,notes:'Changed during review',updated:current.updated+1000});assert.equal((await applyPDFs([plan])).skipped,1);
 const fresh=pdfProposal(await all(),metadata,{name:'another.pdf',data:'data:application/pdf;base64,JVBERi0='});assert.equal((await applyPDFs([fresh])).retained,1);assert.equal((await get('primary')).attachment.name,'download.pdf');
});
test('backup import remaps connected PDF aliases onto an existing matching record',async()=>{
 const primary=normalize({id:'imported-copy',title:'Copy of primary',doi:'10.1234/storage'}),alias=normalize({id:'imported-alias',title:'Imported PDF source',linkedTo:primary.id,notes:'Imported source note'});alias.attachment={name:'import.pdf',data:'data:application/pdf;base64,JVBERi0='};
 const imported=parseBackup(JSON.stringify({format:'paperdesk',version:1,records:[alias,primary]}));assert.equal(await merge(imported),1);const actual=await get(alias.id);assert.equal(actual.linkedTo,'primary');assert.equal(actual.notes,'Imported source note');assert.ok(actual.attachment);
});
