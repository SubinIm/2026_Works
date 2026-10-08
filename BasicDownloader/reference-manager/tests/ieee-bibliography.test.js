import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {capturePage} from '../capture.js';import {readBibliography,planSavedBibliography,metadataPreview} from '../bibliography.js';
import {normalize} from '../model.js';import {bibliographyQuality,bibliographyProblem} from '../bibliography-state.js';import {scholarURL} from '../bibliography-recovery.js';
const source='https://ieeexplore.ieee.org/document/10311166',key='10.1109/dasc58513.2023.10311166';
const title='Simulation of Strategic Conflict Management Performance for Advanced Air Mobility Operations';
const node=(textContent,href='')=>({textContent,getAttribute:k=>k==='href'?href:null});
// Observed Angular header/abstract facts on the user's open IEEE article: no citation meta or JSON-LD.
function ieeeDocument(overrides={}){const selectors={
 'h1.document-title':[node(title)],
 '.authors-info-container a[href*="/author/"]':[node('Wallace Silva Sant’Anna Souza'),node('Mayara Condé Rocha Murça')],
 '.stats-document-abstract-publishedIn a':[node('2023 IEEE/AIAA 42nd Digital Avionics Systems Conference (DASC)')],
 '.stats-document-abstract-doi a[href*="doi.org/"]':[node('DOI', 'https://doi.org/'+key)],
 '.doc-abstract-confdate':[node('Date of Conference: 01-05 October 2023')],
 '.doc-abstract-dateadded':[node('Date Added to IEEE Xplore: 10 November 2023')],
 'a[href*="/stamp/stamp.jsp"]':[node('PDF','/stamp/stamp.jsp?tp=&arnumber=10311166')],
 ...overrides};return {title:title+' | IEEE Conference Publication | IEEE Xplore',querySelector:s=>selectors[s]?.[0] || null,querySelectorAll:s=>selectors[s] || []};}
const item=()=>{const r=normalize({title:'ieeexplore.ieee.org/stamp/stamp.jsp',kind:'paper',url:source,pdfUrl:'https://ieeexplore.ieee.org/stamp/stamp.jsp?arnumber=10311166',notes:'Keep personal note'});return {...planSavedBibliography([r])[0],tabIds:[7],tabUrls:[source]};};
test('serialized IEEE reader captures rendered bibliography without citation tags or runtime globals',()=>{
 const r=vm.runInNewContext('('+capturePage.toString()+')()',{document:ieeeDocument(),location:{href:source},URL,Date});
 assert.equal(r.metadataFound,true);assert.equal(r.title,title);assert.equal(r.authors,'Wallace Silva Sant’Anna Souza; Mayara Condé Rocha Murça');assert.equal(r.date,'2023');assert.equal(r.doi,key);assert.equal(r.kind,'conference');assert.equal(r.url,source);assert.match(r.pdfUrl,/arnumber=10311166/);assert.equal(bibliographyQuality(r).confirmed,true);
});
test('IEEE ingestion date and unrelated global author/DOI links do not become bibliography',()=>{
 const doc=ieeeDocument({'.doc-abstract-confdate':[],'.authors-info-container a[href*="/author/"]':[],'.stats-document-abstract-doi a[href*="doi.org/"]':[], 'a[href*="/author/"]':[node('Reference author')],'a[href*="doi.org/"]':[node('Reference DOI','https://doi.org/10.1234/other')]});
 const r=capturePage(doc,source);assert.equal(r.date,'');assert.equal(r.authors,'');assert.equal(r.doi,'');
 const journal=capturePage(ieeeDocument({'.doc-abstract-pubdate':[node('Date of Publication: 12 March 2024')],'.stats-document-abstract-publishedIn a':[node('IEEE Transactions on Aerospace and Electronic Systems')]}),source);assert.equal(journal.date,'2024-03-12');assert.equal(journal.kind,'journal');
});
test('IEEE challenge and mismatched PDF links are not accepted as a document',()=>{
 const blocked={title:'Access Denied',querySelector:()=>null,querySelectorAll:()=>[]};const r=capturePage(blocked,source);assert.equal(r.metadataFound,false);assert.equal(r.accessIssue,'blocked');
 assert.equal(capturePage(ieeeDocument({'a[href*="/stamp/stamp.jsp"]':[node('Recommended PDF','/stamp/stamp.jsp?arnumber=999999')]}),source).pdfUrl,'');
});
test('complete open IEEE tab stops before background HTML/PDF fetching, preserves note in preview',async()=>{
 const i=item(),captured=capturePage(ieeeDocument(),source);let checks=0,scripts=0;const api={tabs:{get:async()=>({url:source})},permissions:{contains:async()=>{checks++;if(checks>1)throw Error('Unexpected background request');return true;}},scripting:{executeScript:async({target})=>{scripts++;assert.deepEqual(target,{tabId:7});return [{result:captured}];}}};
 const found=await readBibliography(i,api);assert.equal(found.doi,key);assert.equal(checks,1);assert.equal(scripts,1);const p=metadataPreview(i,found,[i.record]);assert.equal(p.record.notes,'Keep personal note');assert.equal(p.record.title,title);assert.equal(p.record.kind,'conference');
});
test('failed source diagnostics retain opened tab and online PDF stages instead of hiding behind fetch error',async()=>{
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Failed to fetch');};
 try{const i=item(),api={tabs:{get:async()=>({url:source})},permissions:{contains:async()=>true},scripting:{executeScript:async()=>[{result:{metadataFound:false,accessIssue:'blocked'}}]}};await assert.rejects(readBibliography(i,api),e=>{const msg=bibliographyProblem(e);assert.match(msg,/열린 탭: 접속 차단/);assert.match(msg,/공개 원문: Failed to fetch/);assert.match(msg,/온라인 PDF: Failed to fetch/);return true;});api.permissions.contains=async()=>false;await assert.rejects(readBibliography(i,api),/열린 탭: 사이트 읽기 권한/);}finally{globalThis.fetch=oldFetch;}
 assert.doesNotMatch(bibliographyProblem(Error('fetch https://example.org/paper?token=secret')),/secret|token/);
});
test('legacy undefined metadata remains missing and is cleaned in previews without changing original records',()=>{
 const legacy={...normalize({id:'legacy',title:'Technical report',kind:'report',date:'2023',notes:'undefined'}),authors:'undefined',venue:undefined,version:'null'};assert.equal(bibliographyQuality(legacy).confirmed,false);const p=planSavedBibliography([legacy],{includeTechnicalPages:true})[0];assert.equal(p.record.authors,'');assert.equal(p.record.venue,'');assert.equal(p.beforeVersion,legacy.updated);assert.equal(legacy.authors,'undefined');const preview=metadataPreview(p,{title:'Technical report',date:'2023',metadataStatus:'原文'},[legacy]);assert.equal(preview.record.authors,'');assert.equal(preview.record.venue,'');assert.equal(preview.record.notes,'undefined');assert.equal(normalize({...legacy,venue:'undefined'}).venue,'');
});
test('Scholar rejects viewer URLs and filenames, and uses IEEE bibliographic title or exact DOI',()=>{
 for(const value of ['ieeexplore.ieee.org/stamp/stamp.jsp','https://ieeexplore.ieee.org/document/10311166','download.pdf','undefined'])assert.throws(()=>scholarURL({title:value}),/논문 제목/);
 assert.equal(new URL(scholarURL({title:title+' | IEEE Conference Publication | IEEE Xplore'})).searchParams.get('q'),title);assert.equal(new URL(scholarURL({title:'download.pdf',doi:key})).searchParams.get('q'),key);
});
