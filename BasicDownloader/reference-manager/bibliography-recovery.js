import {doi,metadataText} from './model.js';
import {safePdfRequest} from './pdf-reader.js';
import {resourceIdentity} from './identity.js';
import {inferKind,paperKinds} from './taxonomy.js';
import {identifierDOIs,sourceLanding} from './bibliography-identifiers.js';
export function crossrefMetadata(data,requested){
 const m=data?.message,key=doi(requested);
 if(!m || doi(m.DOI)!==key || !/^10\.\d{4,9}\/\S+$/i.test(key))throw Error('조회 DOI와 응답 DOI가 다릅니다. 보완하지 않습니다.');
 const title=(m.title || []).find(t=>typeof t==='string' && t.trim()) || '';
 if(!title)throw Error('DOI 등록 정보에 제목이 없습니다.');
 const parts=(m.published || m['published-print'] || m['published-online'] || m.issued)?.['date-parts']?.[0] || [];
 const date=parts.length && Number.isInteger(parts[0])?parts.slice(0,3).map((n,i)=>i?String(n).padStart(2,'0'):String(n)).join('-'):'';
 const kind=({'journal-article':'journal','proceedings-article':'conference','posted-content':'preprint','dissertation':'thesis','report':'report','standard':'standard','book':'book','book-chapter':'book'})[m.type];
 const metadata={title,authors:(m.author || []).map(a=>[a.given,a.family].filter(Boolean).join(' ') || a.name || '').filter(Boolean).join('; '),date,doi:key,venue:(m['container-title'] || [])[0] || m.publisher || '',metadataFound:true,metadataStatus:'Crossref DOI 등록 서지정보'};
 if(kind)metadata.kind=kind;
 for(const url of [m.resource?.primary?.URL,m.URL]){try{metadata.canonicalUrl=safePdfRequest(url).href;break;}catch{}}
 for(const link of m.link || []){if(link['content-type']!=='application/pdf')continue;try{metadata.pdfUrl=safePdfRequest(link.URL).href;break;}catch{}}
 // Keep the saved source URL/PDF and local attachment; DOI link is already available separately.
 return metadata;
}
export async function readCrossref(record,fetcher=globalThis.fetch){
 const key=doi(record.doi);if(!/^10\.\d{4,9}\/\S+$/i.test(key))throw Error('유효한 DOI를 먼저 입력해주세요.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{const response=await fetcher('https://api.crossref.org/works/'+encodeURIComponent(key),{credentials:'omit',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});
  if(!response.ok)throw Error(response.status===404?'Crossref에 등록되지 않은 DOI입니다. 원문·Scholar에서 확인하세요.':'DOI 조회 응답 오류: '+response.status);
  if(!/application\/json/i.test(response.headers.get('content-type') || ''))throw Error('DOI 조회 응답이 JSON이 아닙니다.');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw Error('DOI 조회 응답이 너무 큽니다.');}parts.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  return crossrefMetadata(JSON.parse(new TextDecoder().decode(bytes)),key);
 }finally{clearTimeout(timer);}
}
export function scholarURL(record){const candidates=identifierDOIs(record),key=doi(metadataText(record.doi)) || (candidates.length===1?candidates[0]:''),title=metadataText(record.title).replace(/\s*\|\s*IEEE (?:Conference Publication|Journals?[^|]*|Xplore).*$/i,'').trim();const query=key || title;
 if(!query || (!key && (/\.pdf\s*$|^(?:https?:|file:|ieeexplore\.|IEEE Xplore|stamp\.jsp|document\d*|논문보기)/i.test(title) || /^\S+\.(?:org|com|net)\//i.test(title))))throw Error('검색할 논문 제목이나 DOI가 필요합니다. 파일명·뷰어 주소 대신 열린 원문 탭 읽기 또는 수동 입력으로 제목을 확인해주세요.');
 return 'https://scholar.google.com/scholar?q='+encodeURIComponent(query);
}
export function searchTitle(record){
 const title=metadataText(record.title).replace(/\s*\|\s*(?:IEEE (?:Conference Publication|Journals?[^|]*|Xplore)|Scientific Reports|SpringerLink|ScienceDirect).*$/i,'').trim();
 if(title.length<20 || /\.pdf\s*$|^(?:https?:|file:|ieeexplore\.|IEEE Xplore|stamp\.jsp|document\d*|논문보기|s\d{5}-|srep\d+|f[a-z]{2,12}-\d{4}-|1-s2\.0-)/i.test(title) || /^\S+\.(?:org|com|net)\//i.test(title))return '';
 return title;
}
export const registrationPossible=record=>!!(record.doi || identifierDOIs(record).length || (paperKinds.includes(inferKind(record)) && searchTitle(record)));
const keyText=text=>String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function sameAuthor(a,b){const names=s=>String(s || '').split(';').map(n=>n.normalize('NFKC').toLowerCase().match(/[\p{L}]{2,}/gu) || []);return names(a).some(left=>names(b).some(right=>left.length && right.length && left.every(t=>right.includes(t))));}
export function titleCandidates(data,record){
 const title=searchTitle(record),target=keyText(title),year=String(record.date || '').match(/\b(?:19|20)\d{2}\b/)?.[0],seen=new Set(),candidates=[];
 if(!title)return {candidates:[]};
 for(const work of (data?.message?.items || []).slice(0,5)){
  try{const r=crossrefMetadata({message:work},work.DOI);if(!paperKinds.includes(r.kind) || seen.has(r.doi))continue;seen.add(r.doi);
   const normalized=keyText(r.title),words=s=>new Set(String(s).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]),a=words(title),b=words(r.title),intersection=[...a].filter(w=>b.has(w)).length,score=target===normalized?1:intersection/(new Set([...a,...b]).size || 1);
   if(score<0.6)continue;
   const compatible=(!year || r.date.startsWith(year)) && (!metadataText(record.authors) || sameAuthor(record.authors,r.authors));
   candidates.push({...r,score,exact:normalized===target,compatible});
  }catch{}
 }
 candidates.sort((a,b)=>b.score-a.score);
 // A fuzzy match or duplicate title never silently chooses a different work.
 const strong=candidates.filter(c=>c.exact && c.compatible && c.authors && c.date);
 return {candidates,accepted:strong.length===1?{...strong[0],metadataStatus:'Crossref 제목 일치·저자/발행일 검증 서지정보'}:undefined};
}
export async function searchCrossref(record,fetcher=globalThis.fetch){
 const title=searchTitle(record);if(!title)throw Error('논문 제목이 필요합니다. 파일 식별자는 DOI 등록정보로 먼저 확인하세요.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{const url=new URL('https://api.crossref.org/works');url.searchParams.set('query.bibliographic',title);url.searchParams.set('rows','5');
  const response=await fetcher(url.href,{credentials:'omit',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});
  if(!response.ok)throw Error('제목 검색 응답 오류: '+response.status);if(!/application\/json/i.test(response.headers.get('content-type') || ''))throw Error('제목 검색 응답이 JSON이 아닙니다.');
  const reader=response.body.getReader(),parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw Error('제목 검색 응답이 너무 큽니다.');}parts.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return titleCandidates(JSON.parse(new TextDecoder().decode(bytes)),record);
 }finally{clearTimeout(timer);}
}
export async function openSourceTab(item,api=globalThis.chrome){
 const source=safePdfRequest(sourceLanding(item.record) || item.record.url || item.record.pdfUrl).href;
 const tabs=await api.tabs.query({}),tab=tabs.find(t=>!t.incognito && !t.pendingUrl && resourceIdentity(t.url)===resourceIdentity(source)) || await api.tabs.create({url:source,active:true});
 if(tab.incognito)throw Error('시크릿 탭은 읽지 않습니다.');
 if(tabs.some(t=>t.id===tab.id))await api.tabs.update(tab.id,{active:true});
 item.recoveryTabId=tab.id;item.preferWeb=true;item.tabIds=[tab.id];item.sourceUrl=source;item.tabUrls=[tab.url || source];
 return tab;
}
