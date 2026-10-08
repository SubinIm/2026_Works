import {bibliographyQuality,checkedBibliography,savedBibliographyIncluded} from './bibliography-state.js';
import {readCrossref,searchCrossref,searchTitle} from './bibliography-recovery.js';
import {identifierDOIs,sourceLanding} from './bibliography-identifiers.js';
import {readRegistration,registrationOrigins} from './bibliography-registries.js';
import {readSourceBrowser} from './bibliography-tabs.js';
import { capturePage } from './capture.js';
import { normalize, duplicate, doi, metadataText } from './model.js';
import { inferKind,paperKinds } from './taxonomy.js';
import { classify } from './organizer.js';
import { resourceIdentity, isPDF } from './identity.js';
import { safePdfRequest, fetchPDF, readPDF } from './pdf-reader.js';
import { usefulTitle } from './pdf-matching.js';
import {sameBibliographicDocument,mergeBibliographyPersonal} from './bibliography-merge.js';
import {referenceFromTitle,mergeReferences} from './references.js';

export const metadataFields=['title','authors','date','doi','venue','version','kind','url','pdfUrl','collection','tags','bibliography'];
const cleanRecord=record=>({...record,...Object.fromEntries(['title','authors','date','doi','venue','version'].map(key=>[key,metadataText(record[key])]))});
export function planSavedBibliography(records,options={}){const attachment=r=>r.attachment || records.find(a=>a.linkedTo===r.id && a.attachment)?.attachment;return records.filter(r=>!r.linkedTo && savedBibliographyIncluded({...r,attachment:attachment(r)},options)).map(record=>({record:cleanRecord(record),queueRecord:cleanRecord(record),localAttachment:attachment(record),targetId:record.id,beforeVersion:record.updated,existing:true,metadataReady:false,selected:true,sourceUrl:record.url || record.pdfUrl,tabIds:[],tabUrls:[],reason:'저장된 자료 · 연결된 PDF를 우선 읽고 서지정보 보완안을 확인하세요.'}));}
export function metadataOrigins(items){
 const origins=new Set();
 for(const item of items){if(!item.preferWeb && (item.localAttachment || item.record.attachment))continue;const identity=resourceIdentity(item.record.url),landing=/^(dbpia|arxiv|patent|ieee):/.test(identity);
  for(const value of [...(item.tabUrls || []),item.sourceUrl,sourceLanding(item.record),landing || !item.tabIds?.length || isPDF(item.record.url)?item.record.url:'',item.record.pdfUrl]){if(!value)continue;try{origins.add(safePdfRequest(value).origin+'/*');}catch{}}
 }
 return [...origins];
}
export function metadataPreview(item,incoming,records){
 const old=records.find(r=>r.id===item.targetId);
 if(old?.doi && incoming.doi && doi(old.doi)!==doi(incoming.doi))return {...item,selected:false,metadataReady:false,reason:'기존 DOI와 읽은 DOI가 달라 보완하지 않습니다.'};
 const viewed=referenceFromTitle(item.record.title,item.sourceUrl || item.record.url),found=referenceFromTitle(incoming.title,incoming.url);
 const raw={...item.record,title:viewed.title};for(const key of metadataFields)if(incoming[key] && (key!=='title' || !/\.pdf\s*$/i.test(incoming.title)))raw[key]=key==='title'?found.title:incoming[key];
 raw.references=mergeReferences(item.record.references,incoming.references,viewed.references,found.references);
 raw.kind=inferKind(raw);const proposed=classify(raw);
 const mergeSources=[...(item.mergeSources || [])],record=normalize({...raw,...proposed});
 let match=old || duplicate(records,raw);
 if(old && item.queueRecord){
  const ids=new Set(mergeSources.map(s=>s.id)),targets=records.filter(r=>r.id!==old.id && !r.linkedTo && !ids.has(r.id) && sameBibliographicDocument(r,raw));
  if(targets.length>1)return {...item,selected:false,metadataReady:false,reason:'같은 DOI·원문 주소의 기존 논문이 여러 개입니다. 연결할 항목을 먼저 정리해주세요.'};
  if(targets.length===1){match=targets[0];if(!ids.has(old.id))mergeSources.push({id:old.id,beforeVersion:old.updated});}
 }
 record.bibliography=checkedBibliography(record,incoming.metadataStatus || '원문 서지정보');
 record.bibliography.doiStatus=record.doi?'found':incoming.doiStatus || 'unknown';
 if(incoming.titleGuessed || /검토|충돌/.test(incoming.metadataStatus || ''))record.bibliography.status='partial';
 if(match){
  // Only the reviewed bibliographic fields change. Keep all personal content and attachments.
  let merged=cleanRecord(match);for(const key of metadataFields)if(record[key])merged[key]=record[key];
  merged.references=mergeReferences(match.references,record.references,referenceFromTitle(match.title,match.url).references);
  merged.collection=match.collection && match.collection!=='분류 검토'?match.collection:record.collection;
  merged.tags=[...new Set([...(match.tags || '').split(','),...record.tags.split(',')].map(t=>t.trim()).filter(Boolean))].join(', ');
  if(match.doi && incoming.doi && doi(match.doi)!==doi(incoming.doi))return {...item,selected:false,metadataReady:false,reason:'DOI가 다른 자료는 보완하지 않습니다.'};
  if(mergeSources.length)merged=mergeBibliographyPersonal(merged,mergeSources.map(s=>records.find(r=>r.id===s.id)).filter(Boolean));
  merged.bibliography.signature=checkedBibliography(merged).signature;
  return {...item,mergeSources,record:merged,existing:true,targetId:match.id,beforeVersion:match.updated,selected:true,metadataReady:true,reason:`${mergeSources.length?'기존 논문에 PDF 항목 연결 제안: '+match.title:'기존 자료 보완 제안'} · ${incoming.metadataStatus || '문서 서지정보'} · 메모·PDF·읽기 상태 유지`};
 }
 return {...item,record,metadataReady:true,reason:incoming.metadataStatus || '문서의 서지정보를 읽었습니다. 빈 항목은 확인되지 않았습니다.'};
}
async function publicHTML(value){
 const url=safePdfRequest(value),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetch(url.href,{credentials:'omit',redirect:'error',signal:controller.signal});
  if(!response.ok)throw Error('서지 페이지 응답 오류: '+response.status);
  if(!/text\/html|application\/xhtml/i.test(response.headers.get('content-type') || ''))throw Error('서지 페이지가 HTML이 아닙니다.');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error('서지 페이지가 너무 큽니다.');}parts.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  // Detached DOMParser document: scripts are not executed or added to the live document.
  return capturePage(new DOMParser().parseFromString(new TextDecoder().decode(bytes),'text/html'),url.href);
 }finally{clearTimeout(timer);}
}
export function localPDFMetadata(metadata,record,name){
 const found=!!(usefulTitle(metadata.title) || metadata.authors || metadata.doi || metadata.venue || metadata.date);
 return {...metadata,title:usefulTitle(metadata.title)?metadata.title:'',metadataFound:found,metadataStatus:`첨부 PDF 서지정보 · ${name}${!usefulTitle(metadata.title)?' · 제목 확인 필요':metadata.titleGuessed?' · 첫 페이지 제목 추정, 검토 필요':''}`,url:record.url,pdfUrl:record.pdfUrl};
}
export async function readBibliography(item,api=globalThis.chrome){
 let result={},detail='';const problems=[];
 const problem=(stage,error)=>problems.push(stage+': '+String(error?.message || error));
 const attachment=item.localAttachment || item.record.attachment;
 if(attachment && !item.preferWeb){
  try{const bytes=Uint8Array.from(atob(attachment.data.split(',')[1]),c=>c.charCodeAt(0));
   const metadata=localPDFMetadata(await readPDF(bytes,attachment.name),item.record,attachment.name);
   if(metadata.metadataFound)return metadata;
   throw Error('첨부 PDF에서 텍스트 서지정보를 찾지 못했습니다. 다른 PDF 선택 또는 수동 입력이 필요합니다.');
  }catch(e){throw Error('로컬 PDF 분석 실패: '+e.message);}
 }
 for(const id of item.tabIds || []){
  try{
   const tab=await api.tabs.get(id);if(tab.incognito){problem('열린 탭','시크릿 탭은 읽지 않습니다.');continue;}if(tab.pendingUrl){problem('열린 탭','페이지 이동 중입니다. 로딩 완료 후 다시 읽으세요.');continue;}
   if(id===item.recoveryTabId?!item.tabUrls?.includes(tab.url):resourceIdentity(tab.url)!==resourceIdentity(item.sourceUrl)){problem('열린 탭','연결한 문서와 다른 주소로 이동했습니다. 원문 탭을 다시 연결하세요.');continue;}
   const origin=safePdfRequest(tab.url).origin+'/*';if(!await api.permissions.contains({origins:[origin]})){problem('열린 탭','사이트 읽기 권한이 없습니다. 원문 탭 로딩 후 다시 읽고 권한을 허용하세요.');continue;}
   const frames=await api.scripting.executeScript({target:{tabId:id},func:capturePage});const found=frames[0]?.result;
   if(found?.metadataFound){result=found;detail=found.metadataUrl || '';if(!bibliographyQuality({...item.record,...found,bibliography:undefined}).missing.length && !/검토|충돌/.test(found.metadataStatus || ''))return found;}
   else problem('열린 탭',found?.accessIssue==='blocked'?'접속 차단·확인 화면입니다. 원문 탭에서 정상 접근을 확인하세요.':'화면을 읽었지만 문서 서지정보를 찾지 못했습니다. 원문 로딩을 확인하거나 DOI 조회를 사용하세요.');
  }catch(e){problem('열린 탭',e);}
 }
 // Stable bibliography landing pages; no paid reader/proxy fetching.
 const identity=resourceIdentity(item.record.url);
 detail ||= sourceLanding(item.record);
 if(identity.startsWith('dbpia:') || identity.startsWith('patent:'))detail ||= item.record.url;
 if(identity.startsWith('ieee:'))detail ||= 'https://ieeexplore.ieee.org/document/'+identity.slice(5);
 if(!item.tabIds?.length && !isPDF(item.record.url))detail ||= item.record.url;
 if(detail && (!result.authors || !result.date || /pdfView\.do/.test(item.sourceUrl || ''))){
  try{const origin=safePdfRequest(detail).origin+'/*';if(await api.permissions.contains({origins:[origin]})){
   const landing=await publicHTML(detail);if(result.doi && landing.doi && doi(result.doi)!==doi(landing.doi))throw Error('원문과 서지 페이지의 DOI가 다릅니다. 보완을 중단했습니다.');if(landing.metadataFound)result={...result,...Object.fromEntries(Object.entries(landing).filter(([,v])=>v!=='')),references:mergeReferences(result.references,landing.references),pdfUrl:landing.pdfUrl || result.pdfUrl || item.record.pdfUrl};
   else problem('공개 원문',landing.accessIssue==='blocked'?'접속 차단·확인 화면입니다.':'응답에 서지정보가 없습니다. 열린 원문 탭 읽기 또는 DOI 조회가 필요합니다.');
  }else problem('공개 원문','사이트 읽기 권한이 없습니다.');}catch(e){problem('공개 원문',e);}
 }
 if(item.autoOpen && detail && !isPDF(detail) && (!result.metadataFound || bibliographyQuality({...item.record,...result,bibliography:undefined}).missing.length)){
  try{const found=await readSourceBrowser(item,detail,api);if(found.metadataFound){result={...result,...found};if(!bibliographyQuality({...item.record,...result,bibliography:undefined}).missing.length)return result;}}
  catch(e){problem('일반 원문 탭',e);}
 }
 if((!result.metadataFound || bibliographyQuality({...item.record,...result,bibliography:undefined}).missing.length) && isPDF(result.pdfUrl || item.record.pdfUrl || item.record.url)){
  try{const link=result.pdfUrl || item.record.pdfUrl || item.record.url;const origin=safePdfRequest(link).origin+'/*';if(await api.permissions.contains({origins:[origin]})){
   const file=await fetchPDF(link),metadata=await readPDF(await file.arrayBuffer(),file.name);
   if(result.doi && metadata.doi && doi(result.doi)!==doi(metadata.doi))throw Error('원문과 PDF의 DOI가 다릅니다. PDF 보완을 중단했습니다.');
   result={...metadata,...Object.fromEntries(Object.entries(result).filter(([,v])=>v!=='')),metadataFound:!!(result.metadataFound || usefulTitle(metadata.title)),metadataStatus:metadata.titleGuessed?'PDF 제목 추정 · 검토 필요':'원문·PDF 서지정보',url:item.record.url,pdfUrl:link};
  }else problem('온라인 PDF','사이트 읽기 권한이 없습니다.');}catch(e){problem('온라인 PDF',e);}
 }
 if(!result.metadataFound)throw Error(problems.join(' · ') || '문서 서지정보를 확인하지 못했습니다. PDF 직접 선택 또는 수동 입력이 필요합니다.');
 if(problems.length)result.metadataStatus=(result.metadataStatus || '원문 서지정보')+' · 추가 보완 실패: '+problems.join(' · ');
 return result;
}
// The queue can supplement a blocked/partial source with an exact DOI registration.
// Host permission is requested synchronously by its click handler, never after a PDF await.
export async function readBibliographyWithFallback(item,api=globalThis.chrome,lookup=readRegistration,search=searchCrossref){
 let incoming,error;const failures=[];
 const allowed=await api.permissions.contains({origins:registrationOrigins(item.record)}),crossrefAllowed=await api.permissions.contains({origins:['https://api.crossref.org/*']});
 const identifiers=identifierDOIs(item.record),initialKey=doi(metadataText(item.record.doi)) || (identifiers.length===1?identifiers[0]:undefined);
 if(!initialKey && identifiers.length>1)failures.push('파일명·주소의 DOI 후보가 서로 다릅니다. 원문 또는 로컬 PDF로 같은 자료인지 확인하세요.');
 const registeredResult=(registered,found)=>{const result={...found,...Object.fromEntries(Object.entries(registered).filter(([,v])=>v!==''))};delete result.titleGuessed;
  if(!item.record.url || isPDF(item.record.url))result.url=sourceLanding(item.record) || registered.canonicalUrl || 'https://doi.org/'+registered.doi;else result.url=found?.url || item.record.url;
  const identity=resourceIdentity(item.record.url),version=identity.match(/^arxiv:.*(v\d+)$/i)?.[1];if(version){result.version=version;if(found?.metadataFound && found.title && !found.titleGuessed)result.title=found.title;else if(searchTitle(item.record)){result.title=item.record.title;result.metadataStatus+=' · 버전 원문 미확인, 제목 검토 필요';}}
  result.pdfUrl=found?.pdfUrl || item.record.pdfUrl || (isPDF(item.record.url)?item.record.url:'') || (version?'https://arxiv.org/pdf/'+identity.slice(6):registered.pdfUrl) || '';return result;};
 // Identify filename-only items and resolve exact registered DOI before a blocked PDF request.
 if(allowed && initialKey && !/^arxiv:.*v\d+$/i.test(resourceIdentity(item.record.url)) && (!item.tabIds?.length || !searchTitle(item.record)) && (!item.localAttachment && !item.record.attachment || item.preferWeb)){
  try{const registered=await lookup({doi:initialKey});const result=registeredResult(registered);if(!bibliographyQuality({...item.record,...result,bibliography:undefined}).missing.length)return result;incoming=result;}
  catch(e){failures.push('DOI 등록정보: '+e.message);}
 }
 try{const source=await readBibliography(item,api);incoming={...incoming,...source};}catch(e){error=e;}
 const key=incoming?.doi || initialKey;
 const incomplete=!incoming || bibliographyQuality({...item.record,...incoming,bibliography:undefined}).missing.length || incoming.titleGuessed || /검토|충돌/.test(incoming.metadataStatus || '');
 if(incomplete && key && allowed && !failures.length){
  try{const registered=await lookup({doi:key});if(incoming?.doi && doi(incoming.doi)!==doi(registered.doi))throw Error('DOI가 다른 보완 결과입니다.');
   return registeredResult(registered,incoming);
  }catch(e){failures.push('DOI 보완 실패: '+e.message);}
 }
 const record={...item.record,...incoming};
 if(crossrefAllowed && !key && !incoming?.doiStatus?.includes('not-listed') && paperKinds.includes(inferKind(record)) && searchTitle(record) && !/충돌|서로 다른 DOI/.test(incoming?.metadataStatus || '')){
  try{const matches=await search(record);if(matches.accepted)return registeredResult(matches.accepted,incoming);
   if(matches.candidates?.length)return {...incoming,title:incoming?.title || record.title,metadataFound:!!incoming?.metadataFound,candidates:matches.candidates,metadataStatus:'제목 검색 후보 · 일치 여부 검토 필요'};
   failures.push('제목 검색: 일치하는 등록 논문을 찾지 못했습니다.');
  }catch(e){failures.push('제목 검색: '+e.message);}
 }
 if(incoming)return {...incoming,metadataStatus:(incoming.metadataStatus || '원문 서지정보')+(failures.length?' · '+failures.join(' · '):'')};
 throw Error([error?.message || '원문 확인 실패',...failures].join(' · '));
}
