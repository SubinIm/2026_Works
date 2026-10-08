import test from 'node:test';
import assert from 'node:assert/strict';
import { planTabs, planExisting, classify, resourceIdentity, fromTab } from '../organizer.js';
import { duplicate, normalize, parseBackup } from '../model.js';

test('IEEE abstract and PDF become one candidate with the descriptive title and PDF link',()=>{
 const result=planTabs([{id:1,title:'IEEE Xplore Full-Text PDF:',url:'https://ieeexplore.ieee.org/stamp/stamp.jsp?arnumber=9925807&tag=1'},{id:2,title:'Airspace Geofencing Volume Sizing | IEEE Conference Publication | IEEE Xplore',url:'https://ieeexplore.ieee.org/abstract/document/9925807'}]);
 assert.equal(result.items.length,1);assert.equal(result.merged,1);assert.equal(result.items[0].record.title,'Airspace Geofencing Volume Sizing');assert.match(result.items[0].record.pdfUrl,/arnumber=9925807$/);assert.equal(result.items[0].record.collection,'공역·UTM·위험도');
});
test('ScienceDirect repetition and signed PDF map to a stable public article without tokens',()=>{
 const result=planTabs([{id:1,title:'A flight risk field model',url:'https://pdf.sciencedirectassets.com/271795/1-s2.0-S0965856424003161/main.pdf?X-Amz-Security-Token=secret'},{id:2,title:'A flight risk field model - ScienceDirect',url:'https://www.sciencedirect.com/science/article/pii/S0965856424003161?ref=pdf_download&rr=123'},{id:3,title:'A flight risk field model',url:'https://www.sciencedirect.com/science/article/pii/S0965856424003161#section'}]);
 assert.equal(result.items.length,1);assert.equal(result.merged,2);assert.equal(result.items[0].record.url,'https://www.sciencedirect.com/science/article/pii/S0965856424003161');assert.equal(result.items[0].record.pdfUrl,'');assert.doesNotMatch(JSON.stringify(result.items[0].record),/secret|X-Amz/);
});
test('DOI full text, PDF and metadata DOI deduplicate without relying on title',()=>{
 const a=fromTab({title:'Full article: Flight procedure design',url:'https://www.tandfonline.com/doi/full/10.1080/0305215X.2024.2413645#section'}).record;
 const b=fromTab({title:'Different PDF title',url:'https://www.tandfonline.com/doi/epdf/10.1080/0305215X.2024.2413645?needAccess=true'}).record;
 assert.equal(a.doi,b.doi);assert.ok(duplicate([a],b));assert.ok(duplicate([normalize({title:'Old',doi:a.doi})],b));
});
test('chart editions and meaningful URL query arguments stay separate',()=>{
 const a='https://aim.koca.go.kr/Package/2020-05-07/pdf/AD/RKPU/chart.pdf',b=a.replace('2020-05-07','2023-01-12');
 assert.notEqual(resourceIdentity(a),resourceIdentity(b));assert.notEqual(resourceIdentity('https://example.org/doc?id=1'),resourceIdentity('https://example.org/doc?id=2'));
 assert.equal(planTabs([{title:'RKPU chart',url:a},{title:'RKPU chart',url:b}]).items.length,2);
});
test('internal, search, private chats, incognito and signed unknown links are excluded',()=>{
 for(const tab of [{url:'chrome://extensions/'},{url:'https://www.google.com/search?q=airspace'},{url:'https://github.com/settings/profile'},{url:'https://uniai.unist.ac.kr/chat/123'},{url:'https://portal.unist.ac.kr/irj/portal'},{url:'https://example.org/paper?access_token=secret'},{url:'https://user:password@example.org/paper'},{url:'https://example.org/paper',incognito:true}])assert.ok(fromTab(tab).excluded,tab.url);
 const general=fromTab({title:'Parts shop',url:'https://example.org/shop'});assert.equal(general.selected,false);
});
test('local PDF metadata is preserved in backups, unsafe local links are not opened',()=>{
 const r=fromTab({title:'Quantification of UAV Flight Safety Margins',url:'file:///C:/Users/example/Downloads/applsci.pdf'}).record;
 assert.equal(r.url,'');assert.equal(r.pdfUrl,'');assert.match(r.localSource,/applsci.pdf$/);assert.match(r.tags,/PDF/);assert.equal(parseBackup(JSON.stringify({format:'paperdesk',version:1,records:[r]}))[0].localSource,r.localSource);
 assert.equal(normalize({title:'Unsafe',localSource:'javascript:alert(1)'}).localSource,'');assert.equal(normalize({title:'Other file',localSource:'file:///C:/secret.txt'}).localSource,'');
 assert.ok(duplicate([r],{...r,id:'other'}));assert.equal(duplicate([r],{...r,id:'other',localSource:'file:///D:/applsci.pdf'}),undefined);
});
test('saved duplicates are deselected and curated collections, tags and contents survive proposals',()=>{
 const old=normalize({title:'Airspace paper',url:'https://www.sciencedirect.com/science/article/pii/S0965856424003161?ref=pdf_download',collection:'과제 보고서',tags:'중요',notes:'내 메모',status:'done'});old.attachment={name:'paper.pdf',data:'unchanged'};
 const plan=planTabs([{title:'Airspace paper',url:'https://www.sciencedirect.com/science/article/pii/S0965856424003161?rr=123'}],[old]);assert.equal(plan.items[0].existing,true);assert.equal(plan.items[0].selected,false);
 const proposed=planExisting([old])[0];assert.equal(proposed.record.collection,'과제 보고서');assert.match(proposed.record.tags,/중요/);assert.equal(proposed.record.notes,old.notes);assert.equal(proposed.record.attachment,old.attachment);assert.equal(proposed.record.status,'done');assert.equal(old.tags,'중요');
});
test('observed research topics choose specific collections and keep multi-topic tags',()=>{
 for(const [title,collection] of [['Deep QP Safety Filter and Reachability','안전제어·도달가능성'],['MOC SC VTOL Issue 2','인증·규정'],['ICAO PANS-OPS Doc 8168','비행절차·공항'],['Axial Flux Synchronous Motor','추진·모터'],['Urban airspace capacity and risk','공역·UTM·위험도'],['Terrain wind and GIS','GIS·환경']])assert.equal(classify({title}).collection,collection);
 const mixed=classify({title:'Reachability for unmanned airspace management'});assert.match(mixed.tags,/안전제어/);assert.match(mixed.tags,/공역/);
 assert.equal(classify({title:'s41598-026-53111-4.pdf'}).collection,'분류 검토');
});
test('malformed encoded URLs and empty tab titles never crash batch planning',()=>{
 assert.doesNotThrow(()=>planTabs([{url:'https://example.org/%ZZ'},{url:'file:///C:/bad%ZZ.pdf'},{url:'https://example.org/doi/10.1234/%ZZ'}]));
});
