import {capturePage} from './capture.js';
import {resourceIdentity,isPDF} from './identity.js';
import {safePdfRequest} from './pdf-reader.js';
import {bibliographyQuality} from './bibliography-state.js';

export async function readSourceBrowser(item,url,api=globalThis.chrome,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),attempts=12}={}){
 const source=safePdfRequest(url).href,identity=resourceIdentity(source);
 if(isPDF(source))throw Error('PDF 뷰어 대신 서지 원문 페이지가 필요합니다.');
 if(!await api.permissions.contains({permissions:['tabs'],origins:[new URL(source).origin+'/*']}))throw Error('원문 탭 읽기 권한이 없습니다.');
 const tabs=await api.tabs.query({});let tab=tabs.find(t=>!t.incognito && !t.pendingUrl && !isPDF(t.url) && resourceIdentity(t.url)===identity),created=false;
 if(!tab){tab=await api.tabs.create({url:source,active:false});created=true;}
 if(!Number.isInteger(tab.id))throw Error('원문 탭을 열지 못했습니다.');
 item.recoveryTabId=tab.id;item.tabIds=[tab.id];item.tabUrls=[source];item.sourceUrl=source;
 let partial;
 try{for(let n=0;n<attempts;n++){
  const current=await api.tabs.get(tab.id);
  if(current.incognito || current.pendingUrl && resourceIdentity(current.pendingUrl)!==identity || resourceIdentity(current.url)!==identity && current.status==='complete')throw Error('다른 문서로 이동해 원문 읽기를 중단했습니다.');
  if(current.status==='complete' && !current.pendingUrl){
   const frames=await api.scripting.executeScript({target:{tabId:tab.id},func:capturePage}),found=frames[0]?.result;
   if(found?.accessIssue==='blocked')throw Error('원문 탭에 접속 확인 화면이 표시됐습니다. 직접 확인한 뒤 열린 원문 탭 읽기를 사용하세요.');
   if(found?.metadataFound){partial=found;if(!bibliographyQuality({...item.record,...found,bibliography:undefined}).missing.length)return {...found,metadataStatus:(found.metadataStatus || '원문 서지정보')+' · 일반 탭 로딩 후 확인'};}
  }
  if(n<attempts-1)await sleep(1000);
 }
 if(partial)return partial;throw Error('원문 탭 로딩 후 서지정보를 찾지 못했습니다. 열린 원문 탭을 직접 확인하세요.');
 }finally{if(created && partial && !bibliographyQuality({...item.record,...partial,bibliography:undefined}).missing.length){try{const current=await api.tabs.get(tab.id);if(!current.incognito && !current.pendingUrl && !current.pinned && !current.audible && resourceIdentity(current.url)===identity){await api.tabs.remove(tab.id);delete item.recoveryTabId;item.tabIds=[];item.tabUrls=[];}}catch{}}}
}
