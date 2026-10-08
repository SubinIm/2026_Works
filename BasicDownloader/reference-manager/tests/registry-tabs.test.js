import test from 'node:test';import assert from 'node:assert/strict';
import {corpus} from './corpus-examples.js';
import {dataciteMetadata,readRegistration,registrationOrigins,bibliographyFetch,registrationForRecord} from '../bibliography-registries.js';
import {readSourceBrowser} from '../bibliography-tabs.js';
import {sourceLanding,identifierDOIs} from '../bibliography-identifiers.js';
import {resourceIdentity} from '../identity.js';import {recordKeys,normalize,duplicate} from '../model.js';
import {readBibliographyWithFallback} from '../bibliography.js';
import {readPDF} from '../pdf-reader.js';import {makePDF} from './pdf-fixture.js';
import {presentationCover} from '../pdf-matching.js';

test('four observed arXiv registrations map exact DOI, all authors, date, venue and PDF',()=>{
 for(const r of corpus.registries.filter(r=>r.provider==='datacite')){
  const metadata=dataciteMetadata(r.data,r.key);assert.deepEqual(metadata,r.expected);assert.equal(metadata.kind,'preprint');assert.equal(metadata.venue,'arXiv');assert.ok(metadata.authors.includes('; '));
  assert.throws(()=>dataciteMetadata(r.data,'10.48550/arxiv.9999.99999'),/다릅니다/);
 }
 const response=structuredClone(corpus.registries[0]);response.data.data.attributes.url='https://other.example/abs/2312.15347';assert.throws(()=>dataciteMetadata(response.data,response.key),/식별자/);
});
test('explicit DOI refresh also preserves the verified arXiv version title and its PDF',()=>{
 const metadata=corpus.registries.find(r=>r.key==='10.48550/arxiv.2507.07805').expected,record={...corpus.records.find(r=>r.row===46),authors:metadata.authors,date:'2025-07-10'};const result=registrationForRecord(record,metadata);assert.equal(result.title,record.title);assert.equal(result.pdfUrl,'https://arxiv.org/pdf/2507.07805v1');assert.equal(result.version,'v1');assert.doesNotMatch(result.metadataStatus,/검토/);assert.match(registrationForRecord({...record,authors:''},metadata).metadataStatus,/검토/);assert.throws(()=>registrationForRecord(record,corpus.registries[0].expected),/식별자/);
});
test('arXiv PDF/html/abs and version paths resolve to their own landing pages and a validated DOI candidate',()=>{
 for(const r of corpus.records.filter(r=>r.kind==='preprint')){assert.match(sourceLanding(r),/^https:\/\/arxiv.org\/abs\//);assert.equal(registrationOrigins(r)[0],'https://api.datacite.org/*');assert.equal(identifierDOIs(r).length,1);}
 assert.equal(sourceLanding(corpus.records.find(r=>r.row===46)),'https://arxiv.org/abs/2507.07805v1');
 for(const r of corpus.records.filter(r=>/1-s2/.test(r.title)))assert.match(sourceLanding(r),/^https:\/\/www.sciencedirect.com\/science\/article\/pii\/S/);
 assert.equal(resourceIdentity('https://arxiv.org/html/2507.07805v1'),resourceIdentity('https://arxiv.org/pdf/2507.07805v1'));
});
test('DataCite lookup sends exact public DOI only and rejects wrong DOI, content type and size',async()=>{
 const r=corpus.registries[0];let requested;
 const fetcher=async(url,options)=>{requested={url,options};return new Response(JSON.stringify(r.data),{headers:{'content-type':'application/vnd.api+json'}});};
 assert.deepEqual(await readRegistration({doi:r.key,notes:'PRIVATE',localSource:'PRIVATE'},fetcher),r.expected);assert.equal(decodeURIComponent(new URL(requested.url).pathname),'/dois/'+r.key);assert.equal(requested.options.credentials,'omit');assert.equal(requested.options.redirect,'error');assert.ok(!JSON.stringify(requested).includes('PRIVATE'));
 await assert.rejects(readRegistration({doi:r.key},async()=>new Response('<html>',{headers:{'content-type':'text/html'}})),/JSON/);
 await assert.rejects(readRegistration({doi:r.key},async()=>new Response(' '.repeat(1024*1024+1),{headers:{'content-type':'application/json'}})),/너무 큽니다/);
});
test('registry queue caches duplicates, spaces requests and respects long/invalid 429 cooldowns',async()=>{
 let calls=0,clock=1000,waits=[];const fetcher=bibliographyFetch(async()=>{calls++;return new Response('{}',{headers:{'content-type':'application/json'}});},{now:()=>clock,sleep:async ms=>{waits.push(ms);clock+=ms;}});
 const first='https://api.crossref.org/works/one';await fetcher(first);await fetcher(first);await fetcher('https://api.crossref.org/works/two');assert.equal(calls,2);assert.deepEqual(waits,[1100]);
 const limited=bibliographyFetch(async()=>{calls++;return new Response('',{status:429,headers:{'retry-after':'120'}});},{now:()=>clock,sleep:async()=>assert.fail('long sleep')});const before=calls;
 await assert.rejects(limited(first),/120초/);await assert.rejects(limited(first),/120초/);assert.equal(calls,before+1);
 const invalid=bibliographyFetch(async()=>new Response('',{status:429,headers:{'retry-after':'invalid'}}),{now:()=>clock});await assert.rejects(invalid(first),/5초/);
 await assert.rejects(fetcher('https://other.example/'),/API 주소/);
});
function sourceAPI({existing=false,blocked=false,moved=false,deny=false,pinned=false}={}){
 const url='https://ieeexplore.ieee.org/document/1561886',log={created:0,removed:[],reads:0,gets:0},metadata={title:'Survey of maneuvering target tracking. Part V: Multiple-model methods',authors:'X. Rong Li; V. P. Jilkov',date:'2005-10-31',venue:'IEEE Transactions on Aerospace and Electronic Systems',doi:'10.1109/taes.2005.1561886',kind:'journal',metadataFound:true};
 const api={permissions:{contains:async()=>!deny},tabs:{query:async()=>existing?[{id:9,url,status:'complete'}]:[],create:async()=>{log.created++;return {id:9,url,status:'loading'};},get:async()=>{log.gets++;return {id:9,url:moved?'https://example.org/other':url,status:log.gets<2 && !existing?'loading':'complete',pinned};},remove:async id=>log.removed.push(id)},scripting:{executeScript:async()=>{log.reads++;return [{result:blocked?{accessIssue:'blocked'}:metadata}];}}};return {api,log,url,metadata};
}
test('normal source reader waits for rendered page, closes only its successful temporary tab and keeps existing tabs',async()=>{
 for(const existing of [false,true]){const {api,log,url,metadata}=sourceAPI({existing});let waits=0;const item={record:{kind:'paper'}};assert.equal((await readSourceBrowser(item,url,api,{sleep:async()=>waits++})).title,metadata.title);assert.equal(log.created,existing?0:1);assert.deepEqual(log.removed,existing?[]:[9]);if(!existing)assert.equal(waits,1);}
});
test('normal source reader keeps blocked/navigated/pinned tabs and never scripts denied or changed documents',async()=>{
 for(const options of [{blocked:true},{moved:true},{deny:true},{pinned:true}]){const {api,log,url}=sourceAPI(options);const task=readSourceBrowser({record:{kind:'paper'}},url,api,{sleep:async()=>{},attempts:2});if(options.pinned)await task;else await assert.rejects(task);assert.deepEqual(log.removed,[]);if(options.moved || options.deny)assert.equal(log.reads,0);}
});
test('blocked arXiv PDF resolves from DataCite before any PDF request',async()=>{
 const original=globalThis.fetch;globalThis.fetch=()=>assert.fail('PDF should not be fetched');try{const r=corpus.records[0],expected=corpus.registries[0].expected;const result=await readBibliographyWithFallback({record:r},{permissions:{contains:async({origins})=>origins[0].includes('datacite')}},async()=>expected);assert.equal(result.title,expected.title);assert.equal(result.url,'https://arxiv.org/abs/2312.15347');assert.equal(result.pdfUrl,'https://arxiv.org/pdf/2312.15347');}finally{globalThis.fetch=original;}
});
test('same arXiv DOI retains separate v1 and latest records while identical versions deduplicate',()=>{
 const v1=normalize({title:'Version one title',doi:'10.48550/arxiv.2507.07805',url:'https://arxiv.org/html/2507.07805v1',pdfUrl:'https://arxiv.org/pdf/2507.07805v1',version:'v1'}),latest=normalize({...v1,id:'latest',url:'https://arxiv.org/abs/2507.07805',pdfUrl:'https://arxiv.org/pdf/2507.07805',version:''});assert.equal(duplicate([v1],latest),undefined);assert.ok(duplicate([v1],{...v1,id:'another-v1',url:'https://arxiv.org/abs/2507.07805v1'}));assert.ok(recordKeys(v1).includes('doi:10.48550/arxiv.2507.07805:v1'));
});
test('source-root PDF reader uses the built vendor/worker fallback',async()=>{const result=await readPDF(makePDF(),'fixture.pdf');assert.equal(result.doi,'10.1234/paperdesk.fixture');assert.match(result.title,/Urban airspace/);});
test('PowerPoint cover uses actual presenter and event date instead of PDF creator and ingestion date',()=>{
 const result=presentationCover(['CORUS Safety Approach','U-space ConOps and Research Dissemination','Conference','David Martín Marrero','Safety Specialist at Eurocontrol','30 th September 2019'],'Microsoft PowerPoint - slide.pptx','CORUS Safety Approach');assert.equal(result.authors,'David Martín Marrero');assert.equal(result.date,'2019-09-30');assert.equal(result.kind,'report');assert.deepEqual(presentationCover(['No presenter'],'Microsoft PowerPoint - slide.pptx','Some slide title'),{});
});
