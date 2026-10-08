import {doi} from './model.js';
import {identifierDOIs} from './bibliography-identifiers.js';
import {readCrossref} from './bibliography-recovery.js';
import {safePdfRequest} from './pdf-reader.js';
import {resourceIdentity} from './identity.js';
import {bibliographyQuality} from './bibliography-state.js';

export function registrationForRecord(record,metadata){
 const identity=resourceIdentity(record.url),version=identity.match(/^arxiv:.*(v\d+)$/i)?.[1];
 if(!version || !metadata.doi.startsWith('10.48550/arxiv.'))return metadata;
 if(metadata.doi!=='10.48550/arxiv.'+identity.slice(6).replace(/v\d+$/i,''))throw Error('arXiv 원문 식별자와 조회 DOI가 다릅니다.');
 return {...metadata,title:record.title || metadata.title,version,pdfUrl:'https://arxiv.org/pdf/'+identity.slice(6),canonicalUrl:'https://arxiv.org/abs/'+identity.slice(6),metadataStatus:metadata.metadataStatus+(bibliographyQuality(record).confirmed?' · 확인한 arXiv 버전 제목 유지':' · 버전 원문 미확인, 제목 검토 필요')};
}

export function registrationOrigins(record){
 const key=doi(record.doi) || identifierDOIs(record)[0];
 return key?.startsWith('10.48550/arxiv.')?['https://api.datacite.org/*']:['https://api.crossref.org/*'];
}
export function dataciteMetadata(data,requested){
 const key=doi(requested),entry=data?.data,m=entry?.attributes;
 if(!/^10\.\d{4,9}\/\S+$/i.test(key) || doi(entry?.id)!==key || doi(m?.doi)!==key)throw Error('조회 DOI와 DataCite 응답 DOI가 다릅니다.');
 const title=(m.titles || []).find(t=>!t.titleType && typeof t.title==='string')?.title || m.titles?.[0]?.title;
 if(typeof title!=='string' || !title.trim())throw Error('DataCite 등록정보에 제목이 없습니다.');
 const issued=(m.dates || []).find(d=>d.dateType==='Issued')?.date;
 const date=/^(?:19|20)\d{2}(?:-\d{2}(?:-\d{2})?)?$/.test(issued || '')?issued:String(m.publicationYear || '');
 const publisher=typeof m.publisher==='string'?m.publisher:m.publisher?.name || '';
 const result={title:title.trim(),authors:(m.creators || []).map(a=>[a.givenName,a.familyName].filter(Boolean).join(' ') || a.name || '').filter(Boolean).join('; '),date,doi:key,venue:m.container?.title || publisher,kind:key.startsWith('10.48550/arxiv.')?'preprint':m.types?.resourceTypeGeneral==='Dissertation'?'thesis':'paper',metadataFound:true,metadataStatus:'DataCite DOI 등록 서지정보'};
 try{result.canonicalUrl=safePdfRequest(m.url).href;}catch{}
 if(key.startsWith('10.48550/arxiv.') && result.canonicalUrl){const id=key.slice(15),url=new URL(result.canonicalUrl);if(!/^(?:www\.)?arxiv\.org$/i.test(url.hostname) || url.pathname!=='/abs/'+id)throw Error('arXiv DOI와 등록 원문 식별자가 다릅니다.');result.pdfUrl='https://arxiv.org/pdf/'+id;}
 return result;
}
export async function readRegistration(record,fetcher=globalThis.fetch){
 const key=doi(record.doi);
 if(!key.startsWith('10.48550/arxiv.'))return readCrossref(record,fetcher);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{const response=await fetcher('https://api.datacite.org/dois/'+encodeURIComponent(key),{credentials:'omit',redirect:'error',signal:controller.signal,headers:{Accept:'application/vnd.api+json'}});
  if(!response.ok)throw Error('DataCite DOI 조회 응답 오류: '+response.status);
  if(!/application\/(?:vnd\.api\+)?json/i.test(response.headers.get('content-type') || ''))throw Error('DataCite 응답이 JSON이 아닙니다.');
  const reader=response.body.getReader(),parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw Error('DataCite 응답이 너무 큽니다.');}parts.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}return registrationForRecord(record,dataciteMetadata(JSON.parse(new TextDecoder().decode(bytes)),key));
 }finally{clearTimeout(timer);}
}
// One dialog operation owns this cache and throttling state. No persistent browsing data.
export function bibliographyFetch(fetcher=globalThis.fetch,{now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),interval=1100}={}){
 const cache=new Map(),next=new Map();
 return async(url,options)=>{
  const host=new URL(url).hostname;if(!['api.crossref.org','api.datacite.org'].includes(host))throw Error('등록정보 API 주소만 조회할 수 있습니다.');
  if(cache.has(url))return cache.get(url).clone();
  const wait=(next.get(host) || 0)-now();if(wait>3000)throw Error('등록정보 API 요청 제한: '+Math.ceil(wait/1000)+'초 뒤 다시 조회하세요.');if(wait>0)await sleep(wait);
  next.set(host,now()+interval);let response=await fetcher(url,options);
  if(response.status===429){const raw=response.headers.get('retry-after'),parsed=raw && /^\d+$/.test(raw)?Number(raw):raw?Math.ceil((Date.parse(raw)-now())/1000):5,seconds=Number.isFinite(parsed)?Math.min(Math.max(parsed,1),3600):5;next.set(host,now()+seconds*1000);
   if(seconds<=3){await sleep(Math.max(seconds,1)*1000);response=await fetcher(url,options);}
   if(response.status===429)throw Error('등록정보 API 요청 제한 (429): '+Math.max(seconds,1)+'초 뒤 다시 조회하세요. 원문 탭·로컬 PDF는 계속 읽을 수 있습니다.');
  }
  if(response.ok)cache.set(url,response.clone());return response;
 };
}
