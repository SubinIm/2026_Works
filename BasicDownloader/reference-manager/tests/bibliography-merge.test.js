import 'fake-indexeddb/auto';import test from 'node:test';import assert from 'node:assert/strict';
import {save,get,all,applyMetadata,recordActivity,remove} from '../db.js';
import {normalize,parseBackup} from '../model.js';
import {planSavedBibliography,metadataPreview} from '../bibliography.js';
import {sameBibliographicDocument} from '../bibliography-merge.js';
import {corpus} from './corpus-examples.js';
import {groupFolderRecords} from '../folder-view.js';
const pdf=name=>({name,data:'data:application/pdf;base64,JVBERi0='});
async function pair(label,at=0){
 const metadata={...corpus.local[at],doi:['first','second'].includes(label)?corpus.local[at].doi:'10.1234/merge-'+label},source=normalize({id:'pdf-'+label,title:metadata.name,localSource:'file:///C:/Example/'+label+'.pdf',kind:'journal',notes:'PDF note '+label,tags:'PDF, 중요',status:'reading'}),primary=normalize({id:'paper-'+label,...metadata,url:'https://doi.org/'+metadata.doi,notes:'Paper note '+label,tags:'원문',collection:'내 연구',status:'done'});
 source.attachment=pdf(metadata.name);await save(primary);await save(source);return {source,primary,metadata};
}
const preview=async({source,metadata})=>{const records=await all();return metadataPreview(planSavedBibliography(records).find(i=>i.targetId===source.id),{...metadata,metadataFound:true,metadataStatus:'원문 서지정보'},records);};
test('the two observed Elsevier filename entries link to existing papers and disappear from the queue without data loss',async()=>{
 const pairs=[await pair('first',0),await pair('second',1)];for(const p of pairs)await recordActivity(p.source.id,'lookup');
 const proposals=await Promise.all(pairs.map(preview));for(let i=0;i<2;i++){assert.equal(proposals[i].targetId,pairs[i].primary.id);assert.deepEqual(proposals[i].mergeSources,[{id:pairs[i].source.id,beforeVersion:pairs[i].source.updated}]);assert.match(proposals[i].reason,/PDF 항목 연결/);}
 const result=await applyMetadata(proposals);assert.equal(result.changed,2);assert.equal(result.linked,2);assert.equal(result.skipped,0);
 for(const p of pairs){const primary=await get(p.primary.id),source=await get(p.source.id);assert.equal(source.linkedTo,primary.id);assert.equal(primary.title,p.metadata.title);assert.match(primary.notes,/Paper note/);assert.match(primary.notes,/PDF note/);assert.equal(primary.collection,'내 연구');assert.equal(primary.status,'done');assert.match(primary.tags,/중요/);assert.deepEqual(primary.attachment,p.source.attachment);assert.equal(source.notes,p.source.notes);assert.equal(source.localSource,p.source.localSource);assert.equal(source.status,p.source.status);assert.equal(source.activity.lookup,1);assert.equal(primary.activity.lookup,0);}
 const records=await all();assert.equal(planSavedBibliography(records).filter(i=>pairs.some(p=>[p.primary.id,p.source.id].includes(i.targetId))).length,0);
 const backup=parseBackup(JSON.stringify({format:'paperdesk',version:1,records}));assert.equal(backup.filter(r=>r.linkedTo).length,2);assert.equal(groupFolderRecords([{records:backup,entry:{browser:'Edge',clientId:'test'}}]).length,2);
});
test('re-reading a proposal retains its source guards and does not duplicate notes',async()=>{
 const p=await pair('repeat'),first=await preview(p),second=metadataPreview(first,{...p.metadata,metadataStatus:'원문 서지정보'},await all());assert.equal(second.mergeSources.length,1);await applyMetadata([second]);const primary=await get(p.primary.id);assert.equal(primary.notes.split(p.source.notes).length,2);
});
test('an existing primary PDF is kept while the linked source retains its other attachment',async()=>{
 const p=await pair('attachment');await save({...p.primary,attachment:pdf('already-attached.pdf')});const proposal=await preview(p);assert.equal((await applyMetadata([proposal])).linked,1);assert.equal((await get(p.primary.id)).attachment.name,'already-attached.pdf');assert.equal((await get(p.source.id)).attachment.name,p.source.attachment.name);
});
test('changed or removed merge sources and changed targets leave both records untouched with a visible reason',async()=>{
 for(const action of ['source-change','target-change','source-remove']){const p=await pair(action),proposal=await preview(p);if(action==='source-change')await save({...p.source,notes:'Concurrent note',updated:p.source.updated+1});if(action==='target-change')await save({...p.primary,notes:'Concurrent paper note',updated:p.primary.updated+1});if(action==='source-remove')await remove(p.source.id);const result=await applyMetadata([proposal]);assert.equal(result.skipped,1);assert.equal(result.changed,0);assert.equal(result.linked,0);assert.match(result.failures[0].reason,/변경/);assert.equal((await get(p.primary.id)).attachment,undefined);if(action!=='source-remove')assert.equal((await get(p.source.id)).linkedTo,'');}
});
test('a DOI edited to a different paper after the merge preview is rejected atomically',async()=>{
 const p=await pair('wrong-doi'),proposal=await preview(p);proposal.record.doi='10.1234/other';const result=await applyMetadata([proposal]);assert.equal(result.skipped,1);assert.equal((await get(p.source.id)).linkedTo,'');assert.equal((await get(p.primary.id)).doi,p.primary.doi);
});
test('two reviewed PDFs for one primary can link in one transaction using the review snapshot',async()=>{
 const p=await pair('batch'),second=normalize({...p.source,id:'pdf-batch-two',localSource:'file:///C:/Example/batch-two.pdf',notes:'Second PDF note'});second.attachment=pdf('second.pdf');await save(second);const plans=[await preview(p),await preview({...p,source:second})];const result=await applyMetadata(plans);assert.equal(result.linked,2);assert.equal(result.skipped,0);assert.equal((await get(second.id)).linkedTo,p.primary.id);assert.match((await get(p.primary.id)).notes,/Second PDF note/);
});
test('exact article URLs can join DOI-less entries; similar titles and different arXiv versions cannot',()=>{
 const paper={kind:'paper',url:'https://arxiv.org/abs/1410.6445',title:'Research article'};assert.equal(sameBibliographicDocument(paper,{...paper,url:'https://arxiv.org/pdf/1410.6445'}),true);assert.equal(sameBibliographicDocument(paper,{...paper,url:'https://arxiv.org/abs/1410.6445v1'}),false);assert.equal(sameBibliographicDocument(paper,{...paper,url:'https://example.org/another'}),false);assert.equal(sameBibliographicDocument({...paper,doi:'10.1234/a'},{...paper,doi:'10.1234/b'}),false);
});
test('ambiguous existing DOI targets require review and explicit arXiv versions override a shared PDF URL',()=>{
 const metadata=corpus.local[0],old=normalize({id:'ambiguous-pdf',title:metadata.name,kind:'paper',localSource:'file:///C:/Example/ambiguous.pdf'}),papers=['a','b'].map(id=>normalize({...metadata,id,kind:'journal',url:'https://doi.org/'+metadata.doi})),records=[old,...papers];
 const proposal=metadataPreview(planSavedBibliography(records).find(i=>i.targetId===old.id),metadata,records);assert.equal(proposal.metadataReady,false);assert.equal(proposal.selected,false);assert.match(proposal.reason,/여러/);
 const common={kind:'preprint',doi:'10.48550/arxiv.2507.07805',pdfUrl:'https://arxiv.org/pdf/2507.07805'};assert.equal(sameBibliographicDocument({...common,url:'https://arxiv.org/abs/2507.07805v1'},{...common,url:'https://arxiv.org/abs/2507.07805'}),false);
});
