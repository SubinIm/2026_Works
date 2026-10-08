import 'fake-indexeddb/auto';import test from 'node:test';import assert from 'node:assert/strict';import {registeredExamples} from './registered-examples.js';
import {identifierDOIs} from '../bibliography-identifiers.js';import {crossrefMetadata,searchCrossref,titleCandidates,scholarURL} from '../bibliography-recovery.js';
import {readBibliographyWithFallback,planSavedBibliography} from '../bibliography.js';import {savedBibliographyIncluded} from '../bibliography-state.js';import {normalize,parseBackup} from '../model.js';
import {save,get,all,recordActivity,setBibliographyExcluded,applyMetadata} from '../db.js';import {saveCapture} from '../capture-actions.js';import {saveCaptureDraft,loadCaptureDraft,clearCaptureDraft} from '../capture-drafts.js';import {resourceIdentity} from '../identity.js';
const work=(doi,title='Precise research title about urban airspace allocation',author='Alice Author',year=2024)=>({DOI:doi,title:[title],author:[{name:author}],published:{'date-parts':[[year,2,3]]},type:'journal-article','container-title':['Research Journal'],resource:{primary:{URL:'https://publisher.example/article'}},URL:'https://doi.org/'+doi});
test('publisher filename candidates are restricted to document identifiers, never notes or reference DOI links',()=>{
 assert.deepEqual(identifierDOIs({title:'s41598-025-32450-8.pdf'}),['10.1038/s41598-025-32450-8']);assert.deepEqual(identifierDOIs({title:'ffutr-2021-626935 1..20'}),['10.3389/ffutr.2021.626935']);
 assert.deepEqual(identifierDOIs({title:'download.pdf',notes:'s41598-025-32450-8.pdf',references:[{text:'ffutr-2021-626935'}]}),[]);assert.deepEqual(identifierDOIs({title:'unknown-2021-626935.pdf'}),[]);
 assert.equal(new URL(scholarURL({title:'s41598-025-32450-8.pdf'})).searchParams.get('q'),'10.1038/s41598-025-32450-8');
});
test('real example filename records resolve registered bibliography and original without fetching blocked source',async()=>{
 const examples=registeredExamples;
 const titles=['s41598-025-32450-8.pdf','ffutr-2021-626935 1..20'];for(const [i,example] of examples.entries()){
  let calls=0;const record=normalize({title:titles[i],kind:'paper'}),result=await readBibliographyWithFallback(planSavedBibliography([record])[0],{permissions:{contains:async()=>true}},async r=>{calls++;assert.equal(r.doi,example.requested);return crossrefMetadata(example,r.doi);});
  assert.equal(result.doi,example.requested);assert.equal(result.title,example.message.title[0]);assert.equal(result.date,i?'2021-04-26':'2026-01-19');assert.equal(result.url,example.message.resource.primary.URL);assert.ok(result.authors);assert.equal(calls,1);if(!i)assert.equal(result.pdfUrl,result.url+'.pdf');assert.equal(record.doi,'');assert.equal(record.title,titles[i]);
 }
});
test('unregistered filename guesses are not assigned, and denied Crossref access issues no lookup',async()=>{
 const item=planSavedBibliography([normalize({title:'s41598-025-32450-8.pdf',kind:'paper'})])[0];let calls=0;await assert.rejects(readBibliographyWithFallback(item,{permissions:{contains:async()=>true}},async()=>{calls++;throw Error('not registered');}),/not registered/);assert.equal(item.record.doi,'');assert.equal(calls,1);
 await assert.rejects(readBibliographyWithFallback(item,{permissions:{contains:async()=>false}},async()=>{calls++;}));assert.equal(calls,1);
});
test('contradictory filename and source identifiers never select the first guessed DOI',async()=>{
 const item=planSavedBibliography([normalize({title:'s41598-025-32450-8.pdf',localSource:'file:///C:/s41598-025-32451-8.pdf',kind:'paper'})])[0];let lookups=0;await assert.rejects(readBibliographyWithFallback(item,{permissions:{contains:async()=>true}},async()=>{lookups++;}),/후보가 서로 다릅니다/);assert.equal(lookups,0);assert.equal(item.record.doi,'');
});
test('title registration search sends only bibliographic title, excludes notes/files and rejects unsafe responses',async()=>{
 const title='Precise research title about urban airspace allocation';let seen;const r=await searchCrossref({title,notes:'private note',localSource:'file:///secret.pdf'},async(url,options)=>{seen={url,options};return new Response(JSON.stringify({message:{items:[work('10.1234/exact',title)]}}),{headers:{'content-type':'application/json'}});});
 assert.equal(new URL(seen.url).searchParams.get('query.bibliographic'),title);assert.doesNotMatch(seen.url,/private|secret/);assert.equal(seen.options.credentials,'omit');assert.equal(seen.options.redirect,'error');assert.equal(r.accepted.doi,'10.1234/exact');
 await assert.rejects(searchCrossref({title:'download.pdf'}),/논문 제목/);await assert.rejects(searchCrossref({title},async()=>new Response('x'.repeat(1024*1024+1),{headers:{'content-type':'application/json'}})),/너무 큽니다/);
});
test('ambiguous/fuzzy title, contradictory author and publication year remain review candidates',()=>{
 const title='Precise research title about urban airspace allocation',a=work('10.1234/a',title),b=work('10.1234/b',title);
 assert.equal(titleCandidates({message:{items:[a,b]}},{title}).accepted,undefined);assert.equal(titleCandidates({message:{items:[a]}},{title,authors:'Alice Other'}).accepted,undefined);assert.equal(titleCandidates({message:{items:[a]}},{title,date:'2023'}).accepted,undefined);
 const fuzzy=titleCandidates({message:{items:[work('10.1234/fuzzy',title+' improvement')]}},{title});assert.equal(fuzzy.accepted,undefined);assert.equal(fuzzy.candidates.length,1);
});
test('a blocked DOI-less paper recovers an exact title match, while ambiguous search remains unsaved candidates',async()=>{
 const title='Precise research title about urban airspace allocation',item=planSavedBibliography([normalize({title,kind:'paper'})])[0],api={permissions:{contains:async()=>true}};
 const found=await readBibliographyWithFallback(item,api,async()=>{throw Error('No DOI expected');},async r=>titleCandidates({message:{items:[work('10.1234/exact',title)]}},r));assert.equal(found.doi,'10.1234/exact');assert.equal(found.url,'https://publisher.example/article');
 const candidates=await readBibliographyWithFallback(item,api,undefined,async r=>titleCandidates({message:{items:[work('10.1234/a',title),work('10.1234/b',title)]}},r));assert.equal(candidates.metadataFound,false);assert.equal(candidates.candidates.length,2);assert.equal(item.record.doi,'');
});
test('technical page-only, persistent exclusion and kind scopes are independent opt-in filters; linked PDFs stay eligible',()=>{
 const page=normalize({id:'page',title:'ERNIP technical guidance',kind:'manual',url:'https://example.org/ernip'}),pdf={...page,id:'pdf',pdfUrl:'https://example.org/manual.pdf'},excluded={...pdf,id:'excluded',bibliographyExcluded:true};
 assert.equal(savedBibliographyIncluded(page),false);assert.equal(savedBibliographyIncluded(page,{includeTechnicalPages:true}),true);assert.equal(savedBibliographyIncluded(pdf),true);assert.equal(savedBibliographyIncluded(excluded),false);assert.equal(savedBibliographyIncluded(excluded,{includeExcluded:true}),true);assert.equal(savedBibliographyIncluded(pdf,{kinds:['journal']}),false);
 assert.deepEqual(planSavedBibliography([page,{...pdf,id:'alias',linkedTo:'page',attachment:{name:'manual.pdf',data:'fixture'}}]).map(i=>i.targetId),['page']);
});
test('explicit exclusion preserves current data and version guard; metadata saves and backups retain it',async()=>{
 const r=normalize({id:'exclude-regression',title:'Incomplete paper',kind:'paper',notes:'Keep note'});await save(r);const excluded=await setBibliographyExcluded(r.id,true);assert.equal(excluded.previousUpdated,r.updated);assert.ok(excluded.updated>r.updated);assert.equal((await get(r.id)).previousUpdated,undefined);
 await recordActivity(r.id,'lookup');await applyMetadata([{targetId:r.id,beforeVersion:excluded.updated,record:{...excluded,title:'Updated research title',bibliographyExcluded:false}}]);const current=await get(r.id);assert.equal(current.bibliographyExcluded,true);assert.equal(current.activity.lookup,1);assert.equal(current.notes,'Keep note');assert.equal(parseBackup(JSON.stringify({format:'paperdesk',version:1,records:[current]}))[0].bibliographyExcluded,true);
});
test('popup duplicate directly updates one existing item and preserves private fields; stale proposals fail',async()=>{
 const before=normalize({id:'popup-saved',title:'Old research title',url:'https://paper.example/article',kind:'journal',notes:'Keep private note',status:'done',bibliographyExcluded:true});before.attachment={name:'research.pdf',data:'fixture'};await save(before);await recordActivity(before.id,'lookup');
 const {record}=await saveCapture({title:'Registered research title',url:before.url,kind:'journal',authors:'Author',date:'2024'});assert.equal(record.id,before.id);assert.equal(record.title,'Registered research title');assert.equal(record.notes,before.notes);assert.equal(record.status,'done');assert.deepEqual(record.attachment,before.attachment);assert.equal(record.bibliographyExcluded,true);assert.equal(record.activity.lookup,1);assert.equal((await all()).filter(r=>r.url===before.url).length,1);
 await assert.rejects(saveCapture({...record,title:'Stale popup overwrite'},{targetId:record.id,beforeVersion:before.updated}),/변경/);assert.equal((await get(record.id)).title,'Registered research title');
});
test('draft transfer separates windows/tabs and clearing saved tab does not remove another draft',async()=>{
 await saveCaptureDraft(1,10,{record:{title:'Popup draft'},dirty:true});await saveCaptureDraft(1,11,{record:{title:'Other tab'}});await saveCaptureDraft(2,10,{record:{title:'Other window'}});assert.equal((await loadCaptureDraft(1,10)).record.title,'Popup draft');assert.equal((await loadCaptureDraft(1)).record.title,'Other tab');assert.equal((await loadCaptureDraft(2)).record.title,'Other window');await clearCaptureDraft(1,11);assert.equal(await loadCaptureDraft(1,11),undefined);assert.equal((await loadCaptureDraft(1,10)).record.title,'Popup draft');
});
test('Nature article, PDF and figure/table pages share resource identity without collapsing distinct documents',()=>{
 const article='https://www.nature.com/articles/s41598-025-32450-8';for(const suffix of ['.pdf','/figures/6','/tables/1'])assert.equal(resourceIdentity(article+suffix),resourceIdentity(article));assert.notEqual(resourceIdentity(article),resourceIdentity('https://www.nature.com/articles/s41598-025-32451-8'));
});
test('new popup capture preserves user-edited collection and tags through automatic classification',async()=>{
 const {record}=await saveCapture({title:'Drone airspace paper',url:'https://newpaper.example/article',kind:'journal',authors:'Author',date:'2024',collection:'User collection',tags:'User tag'});assert.equal(record.collection,'User collection');assert.equal(record.tags,'User tag');
});
