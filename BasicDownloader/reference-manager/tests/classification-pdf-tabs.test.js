import test from 'node:test';import assert from 'node:assert/strict';
import {inferKind,kindLabels} from '../taxonomy.js';
import {normalize,bibtex,parseBackup} from '../model.js';
import {metadataFromPDF,doiCandidates,matchPDF,pdfProposal,enrichRecord} from '../pdf-matching.js';
import {planSavedTabs,closeSavedTabs} from '../saved-tabs.js';
import {readPDF,safePdfRequest} from '../dist/pdf-reader.js';
import {makePDF} from './pdf-fixture.js';

test('specific kinds include web tools, journal and conference papers; legacy kinds roundtrip',()=>{
 assert.equal(inferKind({title:'Windy weather',url:'https://www.windy.com/?wind',kind:'document'}),'webtool');
 assert.equal(inferKind({title:'Airspace planning | IEEE Conference Publication | IEEE Xplore',kind:'paper'}),'conference');
 assert.equal(inferKind({url:'https://www.sciencedirect.com/science/article/pii/S123',kind:'paper'}),'journal');
 assert.equal(inferKind({title:'MOC SC VTOL Issue 2',kind:'document'}),'standard');
 for(const kind of Object.keys(kindLabels)){const r=normalize({title:'Test',kind,venue:'Venue'});assert.equal(parseBackup(JSON.stringify({format:'paperdesk',version:1,records:[r]}))[0].kind,kind);}
 assert.equal(normalize({title:'X',kind:'constructor'}).kind,'document');
 assert.match(bibtex([normalize({title:'Test',kind:'conference',venue:'Conference 2026'})]),/@inproceedings[\s\S]*booktitle = \{Conference 2026\}/);
 assert.match(bibtex([normalize({title:'Test',kind:'journal',venue:'Journal'})]),/@article[\s\S]*journal = \{Journal\}/);
});
test('DOI extraction ignores reference list, trims unmatched punctuation and leaves ambiguity for review',()=>{
 assert.deepEqual(doiCandidates('https://doi.org/10.1234/ABC).'),['10.1234/abc']);
 const a=metadataFromPDF({info:{Title:'An actual research paper'},lines:['DOI: 10.1234/own','References','10.1234/reference']},'a.pdf');assert.equal(a.doi,'10.1234/own');
 const b=metadataFromPDF({info:{Title:'An actual research paper'},lines:['10.1234/one and 10.1234/two']},'b.pdf');assert.equal(b.doi,'');assert.equal(b.doiCandidates.length,2);
 const c=metadataFromPDF({info:{Title:'An actual research paper',Subject:'doi:10.1234/meta'},lines:['10.1234/other']},'c.pdf');assert.equal(c.doi,'10.1234/meta');
});
test('real PDF.js parser returns title, author, publication type, DOI and year from a PDF',async()=>{
 const meta=await readPDF(makePDF(),'fixture.pdf');assert.equal(meta.title,'Urban airspace risk and safety analysis');assert.equal(meta.doi,'10.1234/paperdesk.fixture');assert.equal(meta.authors,'A Researcher; B Researcher');assert.equal(meta.kind,'journal');assert.equal(meta.date,'2026');
 assert.equal((await readPDF(Buffer.from(makePDF()),'buffer.pdf')).doi,meta.doi);
 await assert.rejects(()=>readPDF(new TextEncoder().encode('<html>not PDF</html>')),/PDF/);
});
test('PDF matching uses DOI then exact normalized title, refusing DOI mismatch and filename ambiguity',()=>{
 const r=normalize({id:'existing',title:'Urban airspace risk and safety analysis',doi:'10.1234/own'});
 assert.equal(matchPDF([r],{doi:'10.1234/own',title:'Unknown'},'x.pdf').target.id,r.id);
 assert.equal(matchPDF([r],{title:'Urban Airspace — Risk and Safety Analysis'},'x.pdf').target.id,r.id);
 assert.equal(matchPDF([r],{doi:'10.1234/different',title:r.title},'x.pdf').target,undefined);
 const a=normalize({title:'First local',localSource:'file:///C:/a.pdf'}),b=normalize({title:'Second local',localSource:'file:///D:/a.pdf'});assert.equal(matchPDF([a,b],{},'a.pdf').target,undefined);
 assert.deepEqual(pdfProposal([r,a,b],{doi:r.doi,title:r.title,kind:'journal'},{name:'a.pdf',data:'test'}).sourceIds,[]);
});
test('PDF enrichment retains curated fields and attachment and fills missing bibliographic data',()=>{
 const current=normalize({title:'My curated paper title',notes:'Keep notes',status:'done',collection:'My project',kind:'paper'});current.attachment={name:'original.pdf',data:'original'};
 const incoming=normalize({title:'Extracted title for paper',doi:'10.1234/own',kind:'journal',venue:'Journal',collection:'New collection',notes:'New note'});
 const enriched=enrichRecord(current,incoming,{name:'new.pdf',data:'new'});assert.equal(enriched.title,current.title);assert.equal(enriched.notes,'Keep notes\n\nNew note');assert.equal(enriched.status,'done');assert.equal(enriched.collection,'My project');assert.equal(enriched.attachment,current.attachment);assert.equal(enriched.doi,'10.1234/own');assert.equal(enriched.kind,'journal');
 assert.throws(()=>enrichRecord({...current,doi:'10.1234/other'},incoming,{name:'new.pdf'}),/DOI/);
});
test('saved tab closure excludes unsaved, pinned and incognito tabs and skips navigation or deleted records',async()=>{
 const record=normalize({id:'paper',title:'A paper title',url:'https://example.org/paper'}),calls=[];
 const tabs=[{id:1,url:record.url,title:record.title},{id:2,url:'https://example.org/unsaved'},{id:3,url:record.url,pinned:true},{id:4,url:record.url,incognito:true}];
 const plan=planSavedTabs(tabs,[record]);assert.equal(plan.length,1);
 const api={get:async id=>tabs.find(t=>t.id===id),remove:async id=>calls.push(id)};
 let result=await closeSavedTabs(plan,{tabs:api,readRecords:async()=>[record]});assert.equal(result.closed,1);assert.deepEqual(calls,[1]);
 tabs[0].url='https://example.org/navigated';result=await closeSavedTabs(plan,{tabs:api,readRecords:async()=>[record]});assert.equal(result.skipped,1);
 tabs[0].url=record.url;result=await closeSavedTabs(plan,{tabs:api,readRecords:async()=>[]});assert.equal(result.skipped,1);
 tabs[0].audible=true;result=await closeSavedTabs(plan,{tabs:api,readRecords:async()=>[record]});assert.equal(result.skipped,1);
});
test('online PDF fetch guard rejects credentials, tokens and local files',()=>{
 assert.equal(safePdfRequest('https://example.org/paper.pdf').origin,'https://example.org');
 for(const url of ['file:///C:/a.pdf','https://user:pass@example.org/a.pdf','https://example.org/a.pdf?token=secret'])assert.throws(()=>safePdfRequest(url));
});
