import test from 'node:test';import assert from 'node:assert/strict';
import {otherReason,isOther} from '../relevance.js';import {inferKind} from '../taxonomy.js';
import {classify,planExisting,fromTab} from '../organizer.js';import {normalize,parseBackup} from '../model.js';
import 'fake-indexeddb/auto';import {save,get,organize} from '../db.js';

test('reported Parts119 saved page and Korean parts lookup titles become Other',()=>{
 const title='파츠119 - 수입차부품 74만개 | 차대번호로 내차 부품 바로 확인';
 for(const url of ['https://www.parts119.com/?go=pncar&v=fixture','https://m.parts119.com/','https://example.org/parts']){
  const record=normalize({title,url,kind:'document',collection:'분류 검토'});
  assert.ok(otherReason(record));assert.equal(inferKind(record),'other');assert.equal(isOther(record),true);
  const proposal=planExisting([record],{onlyOther:true})[0];assert.equal(proposal.selected,true);assert.equal(proposal.record.kind,'other');assert.equal(proposal.record.collection,'기타');
 }
 assert.equal(otherReason({title:'자동차 부품 모터 설계',url:'https://example.org/engineering'}),'');
 assert.equal(otherReason({title:'차대번호를 활용한 자동차 부품 조회에 관한 연구',url:'https://example.org/paper'}),'');
 assert.equal(otherReason({title,url:'https://example.org/paper',doi:'10.1234/parts'}),'');
 assert.equal(otherReason({title:'General technical notes',url:'https://parts119.com.example.org/doc'}),'');
});
test('already saved Parts119 document is updated by the classification transaction',async()=>{
 const old=normalize({id:'parts119',title:'파츠119 - 수입차부품 74만개 | 차대번호로 내차 부품 바로 확인',url:'https://www.parts119.com/?go=pncar&v=fixture',kind:'document',collection:'분류 검토',notes:'보존할 정비 메모',status:'reading'});await save(old);
 const item=planExisting([await get(old.id)],{onlyOther:true})[0];assert.deepEqual(await organize([{id:old.id,before:item.before,kind:item.record.kind,collection:item.record.collection,tags:item.record.tags}]),{changed:1,skipped:0});
 const after=await get(old.id);assert.equal(after.kind,'other');assert.equal(after.collection,'기타');assert.equal(after.title,old.title);assert.equal(after.url,old.url);assert.equal(after.notes,old.notes);assert.equal(after.status,old.status);
});

test('shopping and BMW parts override motor/wind words, while notes alone cannot mark a paper as shopping',()=>{
 for(const record of [
  {title:'BMW 320d F30 motor parts',url:'https://www.realoem.com/bmw/enUS/select',notes:'motor 연구'},
  {title:'BMW 320d',url:'https://example.org/cars/320d'},
  {title:'Windshield motor for BMW 320d',url:'https://www.ebay.com/itm/123'},
  {title:'ESC Motor 할인 배송',url:'https://example.org/shop/motor'},
  {title:'휴대전화 장바구니',url:'https://example.org/phone'}
 ]){assert.ok(otherReason(record));const kind=record.url.includes('ebay')?'product':/할인|장바구니/.test(record.title)?'shopping':'other';assert.equal(inferKind(record),kind);assert.equal(classify(record).collection,kind==='other'?'기타':'쇼핑·상품정보');assert.doesNotMatch(classify(record).tags,/추진|GIS/);}
 assert.equal(otherReason({title:'Motor control',url:'https://example.org/research',notes:'BMW 320d 구매: https://www.ebay.com/itm/123'}),'');
 assert.equal(otherReason({title:'Motor control',url:'https://not-ebay.com/research'}),'');
});
test('bibliographic evidence and genuine tools/documents protect research from shopping rules',()=>{
 for(const record of [
  {title:'BMW 320d motor',url:'https://www.mdpi.com/1996-1073/1'},
  {title:'BMW 320d motor',url:'https://example.org/doc',doi:'10.1234/example'},
  {title:'BMW 320d motor',url:'https://example.org/doc',authors:'Author',venue:'Journal of Engines'},
  {title:'A study of BMW 320d engine emissions',url:'https://example.org/doc'},
  {title:'BMW 320d service manual',url:'https://example.org/manual.pdf'},
  {title:'BMW 320d wind control',url:'https://patents.google.com/patent/US1234567A/en'},
  {title:'Windy weather',url:'https://www.windy.com'},
  {title:'Motor control book',url:'https://us.artechhouse.com/book'},
  {title:'Motor control',url:'https://www.amazon.com/dp/example',isbn:'9781234567890'}
 ])assert.equal(otherReason(record),'',record.url);
 assert.equal(inferKind({title:'BMW 320d service manual',url:'https://example.org/manual.pdf'}),'manual');
 assert.equal(inferKind({title:'Windy weather',url:'https://www.windy.com'}),'webtool');
 assert.equal(fromTab({title:'Motor for BMW 320d',url:'https://www.ebay.com/itm/123'}).selected,false);
});
test('saved wrong automatic topics are corrected; focused review can move curated shopping collections',()=>{
 const old=normalize({title:'BMW 320d motor',url:'https://www.realoem.com/bmw/',kind:'document',collection:'추진·모터',tags:'추진·모터, GIS·환경, 개인정비',notes:'내 메모',status:'done'});old.attachment={name:'parts.pdf',data:'unchanged'};
 const item=planExisting([old])[0];assert.equal(item.selected,true);assert.equal(item.record.kind,'other');assert.equal(item.record.collection,'기타');assert.equal(item.record.tags,'개인정비, 쇼핑·생활');assert.equal(item.record.notes,old.notes);assert.deepEqual(item.record.attachment,old.attachment);assert.equal(item.record.status,'done');assert.equal(old.collection,'추진·모터');
 const curated={...old,collection:'개인 정비'};assert.equal(planExisting([curated])[0].record.collection,'개인 정비');assert.equal(planExisting([curated],{onlyOther:true})[0].record.collection,'기타');
 assert.equal(planExisting([old,{title:'Safety filter',url:'https://arxiv.org/abs/2507.07805'}],{onlyOther:true}).length,1);
 const applied={...item.record};assert.equal(planExisting([applied],{onlyOther:true})[0].selected,false);
 assert.equal(parseBackup(JSON.stringify({format:'paperdesk',version:1,records:[{...applied,attachment:{name:'parts.pdf',data:'data:application/pdf;base64,JVBERi0='}}]}))[0].kind,'other');
});
test('exclude filter detects unapplied saved shopping without mutating it',()=>{
 const records=[normalize({title:'BMW 320d motor',url:'https://www.ebay.com/itm/123',collection:'추진·모터'}),normalize({title:'Safety filters',url:'https://arxiv.org/abs/2507.07805'}),normalize({title:'Personal item',kind:'other'})];const before=JSON.stringify(records);
 assert.equal(records.filter(r=>!isOther(r)).length,1);assert.equal(JSON.stringify(records),before);
 assert.equal(isOther({kind:'webpage',collection:'기타'}),true);
});
test('actual classification transaction preserves concurrent personal edits and skips stale classification',async()=>{
 const old=normalize({id:'shopping',title:'BMW 320d motor',url:'https://www.ebay.com/itm/123',collection:'추진·모터',tags:'추진·모터, 내태그',notes:'메모',status:'reading',version:'F30',localSource:'file:///C:/Example/parts.pdf'});old.attachment={name:'parts.pdf',data:'unchanged'};await save(old);
 const item=planExisting([old],{onlyOther:true})[0];await save({...old,notes:'수정한 메모'});
 const change={id:old.id,before:item.before,collection:item.record.collection,tags:item.record.tags,kind:item.record.kind};assert.deepEqual(await organize([change]),{changed:1,skipped:0});const after=await get(old.id);
 assert.equal(after.kind,'product');assert.equal(after.collection,'쇼핑·상품정보');assert.equal(after.notes,'수정한 메모');for(const key of ['status','version','localSource'])assert.equal(after[key],old[key]);assert.deepEqual(after.attachment,old.attachment);
 assert.deepEqual(await organize([change]),{changed:0,skipped:1});
});

test('Cults model products override a previously saved webtool without relabeling actual tools or technical PDFs',()=>{
 const old=normalize({title:'Red Bull Fastest Camera Drone · STEP File for 3D printing · Cults',url:'https://cults3d.com/en/3d-model/gadget/red-bull-fastest-camera-drone/similar-designs',kind:'webtool',collection:'추진·모터',tags:'추진·모터, 개인설계',notes:'CAD 참고'});
 assert.equal(inferKind(old),'product');const item=planExisting([old],{onlyOther:true})[0];assert.equal(item.selected,true);assert.equal(item.record.kind,'product');assert.equal(item.record.collection,'쇼핑·상품정보');assert.equal(item.record.notes,old.notes);assert.match(item.record.tags,/개인설계/);assert.doesNotMatch(item.record.tags,/추진/);assert.equal(fromTab({id:1,title:old.title,url:old.url}).selected,false);
 assert.equal(inferKind({title:'Windy weather',url:'https://windy.com',kind:'webtool'}),'webtool');assert.equal(inferKind({title:'ESC technical datasheet',url:'https://example.org/product/motor.pdf',kind:'document'}),'document');assert.equal(otherReason({...old,doi:'10.1234/research',kind:'paper'}),'');
 for(const kind of ['shopping','product'])assert.equal(parseBackup(JSON.stringify({format:'paperdesk',version:1,records:[{title:'Commerce record',kind}]}))[0].kind,kind);
});
test('shopping and product forms are separate while prior vehicle catalog Other remains intact',()=>{
 for(const [url,kind] of [['https://amazon.com/dp/B0000','product'],['https://example.org/cart','shopping'],['https://cults3d.com/en/3d-model/tool/drone','product'],['https://parts119.com/','other']])assert.equal(inferKind({title:'Vehicle motor',url,kind:'webtool'}),kind);
 assert.equal(inferKind({title:'Safety report',url:'https://example.org/report',authors:'Author',venue:'Safety Journal'}),'journal');
});
