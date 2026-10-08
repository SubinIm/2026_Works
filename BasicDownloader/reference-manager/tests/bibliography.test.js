import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {capturePage} from '../capture.js';import {metadataOrigins,metadataPreview,readBibliography} from '../bibliography.js';
import {fromTab,planTabs,classify} from '../organizer.js';import {normalize,bibtex,parseBackup} from '../model.js';import {inferKind} from '../taxonomy.js';import {metadataFromPDF} from '../pdf-matching.js';
// Minimal DOM read adapter for metadata rules; browser fixture additionally runs real DOMParser.
function documentFixture({title='',metas=[],jsonld=[],selectors={}}={}){
 return {title,querySelectorAll:s=>s==='meta'?metas.map(([name,content])=>({content,getAttribute:k=>k==='name'?name:null})):s==='script[type="application/ld+json"]'?jsonld.map(j=>({textContent:JSON.stringify(j)})):selectors[s] || [],querySelector:s=>selectors[s]?.[0] || null};
}
const sageDoc=()=>documentFixture({title:'SAGE',metas:[['citation_journal_title','Transportation Research Record'],['dc.Title','Comparing Urban Air Mobility Network Airspaces: Experiments and Insights'],['dc.Creator','Christopher Cummings'],['dc.Creator','Hani Mahmassani'],['dc.Date','2024-4'],['dc.Identifier','10.1177/03611981231185146'],['dc.Identifier','10.1177_03611981231185146'],['og:title','Wrong title including authors']]});
test('observed SAGE DC fields collect all authors and own DOI; serialized reader has no imports',()=>{
 const doc=sageDoc(),href='https://journals.sagepub.com/doi/10.1177/03611981231185146';
 const r=vm.runInNewContext('('+capturePage.toString()+')()',{document:doc,location:{href},URL,Date});
 assert.equal(r.title,'Comparing Urban Air Mobility Network Airspaces: Experiments and Insights');assert.equal(r.authors,'Christopher Cummings; Hani Mahmassani');assert.equal(r.doi,'10.1177/03611981231185146');assert.equal(r.kind,'journal');
});
test('observed DBpia conference venue overrides citation_journal_title and keeps DOI absent',()=>{
 const r=capturePage(documentFixture({title:'DBpia',metas:[['citation_title','Reich CRM을 활용한 도심항공교통(UAM) 종적분리기준에 관한 연구'],['citation_author','김주영'],['citation_author','김나현'],['citation_author','이금진'],['citation_journal_title','한국항공우주학회 학술발표회 초록집'],['citation_publication_date','2023/11'],['citation_doi','']]}),'https://www.dbpia.co.kr/journal/articleDetail?nodeId=NODE11657988');
 assert.equal(r.authors,'김주영; 김나현; 이금진');assert.equal(r.kind,'conference');assert.equal(r.date,'2023-11');assert.equal(r.doi,'');
});
test('DBpia viewer reads direct header text and same-origin rendered first page without reader keys',()=>{
 const frame=documentFixture({selectors:{'.page[data-page-number="1"] .textLayer span':[{textContent:'한국항공우주학회 2023 추계학술대회 논문집'},{textContent:'김주영1*, 김나현1, 이금진1'}]}});
 const doc=documentFixture({title:'논문보기 - DBpia',metas:[['og:title','DBpia']],selectors:{'#header_title':[{textContent:'Reich CRM을 활용한 도심항공교통(UAM) 종적분리기준에 관한 연구 AI 뷰어로 전환'}],'#headerSwitchDiv':[{textContent:'AI 뷰어로 전환'}],'#pdfIframe':[{contentDocument:frame}]}});
 const r=capturePage(doc,'https://www.dbpia.co.kr/pdf/pdfView.do?nodeId=NODE11657988&width=1238');
 assert.match(r.title,/Reich CRM/);assert.doesNotMatch(r.title,/AI 뷰어/);assert.equal(r.authors,'김주영; 김나현; 이금진');assert.equal(r.kind,'conference');assert.match(r.url,/articleDetail/);assert.match(r.pdfUrl,/pdfView/);assert.equal(r.doi,'');
});
test('article JSON-LD ignores site organizations, FAQ answers and unrelated reference DOI',()=>{
 const href='https://example.org/article';const doc=documentFixture({jsonld:[{'@type':'Organization',name:'Site',author:{name:'Wrong author'}},{'@graph':[{'@type':'BreadcrumbList'},{'@type':['Article','ScholarlyArticle'],url:href,headline:'Verified research article',author:[{name:'One'},{name:'Two'}],datePublished:'2024-01',identifier:{propertyID:'DOI',value:'10.1234/own'},isPartOf:{isPartOf:{name:'Annual Conference'}}}]},{'@type':'FAQPage',mainEntity:[{'@type':'Question',acceptedAnswer:{text:'10.9999/reference'}}]}]});
 const r=capturePage(doc,href);assert.equal(r.authors,'One; Two');assert.equal(r.doi,'10.1234/own');assert.equal(r.kind,'conference');assert.equal(r.venue,'Annual Conference');
});
test('conflicting structured DOI is flagged instead of trusting the URL',()=>{
 const r=capturePage(documentFixture({metas:[['citation_title','Example title'],['citation_doi','10.1234/a'],['dc.identifier','10.1234/b']]}),'https://example.org/doi/10.1234/a');assert.equal(r.doi,'');assert.match(r.metadataStatus,/검토/);
});
test('patent, wiki and book survive normalization, backup, filters and book citations',()=>{
 for(const [url,kind] of [['https://patentimages.storage.googleapis.com/aa/WO2020096819A1.pdf','patent'],['https://en.wikipedia.org/wiki/Control_theory','wiki'],['https://namu.wiki/w/제어','wiki'],['https://us.artechhouse.com/Design-and-Analysis-of-Modern-Tracking-Systems-P170.aspx','book']]){
  const r=fromTab({id:1,title:'Resource',url}).record;assert.equal(r.kind,kind);assert.equal(parseBackup(JSON.stringify({format:'paperdesk',version:1,records:[r]}))[0].kind,kind);
 }
 assert.equal(inferKind({title:'A paper referencing Wikipedia',kind:'paper',url:'https://example.org/paper'}),'paper');assert.equal(inferKind({kind:'manual',url:'https://example.org/wiki/Manual'}),'manual');
 assert.match(bibtex([normalize({title:'Tracking systems',kind:'book'})]),/^@book/);assert.equal(classify({title:'Design and Analysis of Modern Tracking Systems'}).collection,'탐지·추적');
});
test('DBpia, arXiv and patent bibliography/PDF pairs group by stable identifiers',()=>{
 for(const urls of [['https://www.dbpia.co.kr/pdf/pdfView.do?nodeId=NODE11657988&width=1238','https://www.dbpia.co.kr/journal/articleDetail?nodeId=NODE11657988'],['https://arxiv.org/pdf/2507.07805','https://arxiv.org/abs/2507.07805'],['https://patentimages.storage.googleapis.com/aa/WO2020096819A1.pdf','https://patents.google.com/patent/WO2020096819A1/en']])assert.equal(planTabs(urls.map((url,id)=>({url,id,title:'Research'}))).items.length,1);
});
test('review matches existing record after DOI discovery and preserves personal fields',()=>{
 const old=normalize({id:'curated',title:'Old generic title',doi:'10.1234/own',collection:'과제',tags:'중요',notes:'Note',status:'done'});old.attachment={name:'existing.pdf',data:'unchanged'};
 const item=fromTab({id:1,title:'Generic title',url:'https://example.org/article'});
 const proposal=metadataPreview(item,{title:'Exact article title',authors:'One; Two',doi:old.doi,kind:'journal'},[old]);
 assert.equal(proposal.targetId,old.id);assert.equal(proposal.record.title,'Exact article title');assert.equal(proposal.record.notes,'Note');assert.equal(proposal.record.status,'done');assert.equal(proposal.record.attachment,old.attachment);assert.equal(proposal.record.collection,'과제');assert.match(proposal.record.tags,/중요/);
 assert.equal(metadataPreview({...item,targetId:old.id},{doi:'10.1234/other'},[old]).metadataReady,false);
});
test('site permission requests omit signed URLs and internal/local pages',()=>{
 const origins=metadataOrigins([{sourceUrl:'https://example.org/paper?token=secret',record:{url:'https://arxiv.org/abs/2507.07805',pdfUrl:'file:///C:/paper.pdf'}},{record:{url:'chrome://extensions'}}]);assert.deepEqual(origins,['https://arxiv.org/*']);
});
test('bibliography collection skips moved/incognito tabs and checks origin before scripting',async()=>{
 let calls=0;const item={sourceUrl:'https://example.org/article',record:{url:'https://example.org/article'},tabIds:[1]};
 const api={tabs:{get:async()=>({url:'https://example.org/other'})},permissions:{contains:async()=>false},scripting:{executeScript:async()=>{calls++;}}};
 await assert.rejects(readBibliography(item,api));assert.equal(calls,0);
 api.tabs.get=async()=>({url:item.sourceUrl});await assert.rejects(readBibliography(item,api));assert.equal(calls,0);
 api.permissions.contains=async()=>true;api.scripting.executeScript=async()=>{calls++;return [{result:capturePage(sageDoc(),'https://example.org/article')}];};
 assert.equal((await readBibliography(item,api)).authors,'Christopher Cummings; Hani Mahmassani');assert.equal(calls,1);
});
test('Korean references and reference-only DOI annotations never become the document DOI',()=>{
 const r=metadataFromPDF({info:{Title:'A paper without an assigned DOI'},lines:['Document header','참고 문헌','Smith 10.1234/referenced'],links:['https://doi.org/10.1234/referenced']},'paper.pdf');assert.equal(r.doi,'');
});
test('repository APA cover overrides observed IEEE template title/author with actual bibliography',()=>{
 const r=metadataFromPDF({xmp:{'dc:title':'Paper Title (use style: paper title)','dc:creator':['IEEE']},lines:['Delft University of Technology','Citation (APA)','Hoekstra, J., Maas, J. B., Tra, M. A. P., & Sunil, E. (2016). How Do Layered Airspace Design Parameters Affect','Airspace Capacity and Safety? In 7th International Conference on Research in Air Transportation: Philadelphia, USA','Important note','Please cite the published version']},'ICRAT_2016_paper_6.pdf');
 assert.equal(r.title,'How Do Layered Airspace Design Parameters Affect Airspace Capacity and Safety?');assert.equal(r.authors,'Hoekstra, J.; Maas, J. B.; Tra, M. A. P.; Sunil, E.');assert.equal(r.date,'2016');assert.equal(r.kind,'conference');assert.equal(r.doi,'');assert.match(r.venue,/^7th International Conference/);
});
test('arXiv own DOI link is read without adopting reference DOI links',()=>{
 const doc=documentFixture({metas:[['citation_title','Tunable Real-Time Safety Filters via Set-Based Control Barrier Functions'],['citation_author','Wabersich, Kim P.'],['citation_author','Berkel, Felix']],selectors:{'#arxiv-doi-link':[{getAttribute:()=> 'https://doi.org/10.48550/arXiv.2507.07805'}]}});
 const r=capturePage(doc,'https://arxiv.org/abs/2507.07805');assert.equal(r.doi,'10.48550/arxiv.2507.07805');assert.equal(r.kind,'preprint');
});
test('observed Google Patent contributor roles exclude assignee and dateSubmitted',()=>{
 const metas=[['DC.title','Passive variable pitch propellers'],['DC.date','2019-10-29','dateSubmitted'],['DC.date','2020-05-14'],['DC.contributor','Louis Legrand','inventor'],['DC.contributor','John Brodie','inventor'],['DC.contributor','Gur Kimchi','inventor'],['DC.contributor','Amazon Technologies Inc','assignee']];
 const doc=documentFixture();doc.querySelectorAll=s=>s==='meta'?metas.map(([name,content,scheme])=>({content,getAttribute:k=>k==='name'?name:k==='scheme'?scheme || null:null})):[];
 const r=capturePage(doc,'https://patents.google.com/patent/WO2020096819A1/en');assert.equal(r.date,'2020-05-14');assert.equal(r.authors,'Louis Legrand; John Brodie; Gur Kimchi');assert.equal(r.kind,'patent');assert.equal(r.doi,'');
});
