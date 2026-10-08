import { normalize, duplicate, fileName } from './model.js';
import { resourceIdentity, isPDF } from './identity.js';
import { inferKind } from './taxonomy.js';
import { otherReason,commerceKind } from './relevance.js';
import {referenceFromTitle,mergeReferences} from './references.js';
export { resourceIdentity, isPDF } from './identity.js';

// Local topic rules; bibliography reading is a separate, user-triggered step.
export const topics = [
  { name:'안전제어·도달가능성', pattern:/reachability|hamilton.?jacobi|\bcbf\b|barrier function|pursu|evad|safety filter|도달가능|안전제어/i },
  { name:'인증·규정', pattern:/certific|airworthiness|compliance|\bmoc\b|sc.?vtol|do.?36[56]|감항|인증|적합성/i },
  { name:'비행절차·공항', pattern:/pans.?ops|8168|\bpbn\b|\brnp\b|rkpu|aerodrome|airport|vertiport|flight procedure|비행절차|울산공항/i },
  { name:'추진·모터', pattern:/motor|axial.?flux|propell|\besc\b|electri.*propulsion|모터|추진|전기엔진|자속/i },
  { name:'탐지·추적', pattern:/tracking system|target tracking|radar|sensor fusion|object detection|탐지|표적추적|센서융합|레이더/i },
  { name:'공역·UTM·위험도', pattern:/airspace|\butm\b|u.space|\buam\b|\buav\b|\buas\b|urban air mobility|low.altitude|low.attitude|geofenc|collision|ground risk|flight risk|공역|저고도/i },
  { name:'GIS·환경', pattern:/\bgis\b|geospatial|terrain|\bdem\b|wind|weather|flood|reservoir|브이월드|국토정보|기상|저수지|홍수/i },
];
const scholarly = /(^|\.)(sciencedirect\.com|ieeexplore\.ieee\.org|mdpi\.com|nature\.com|springer\.com|tandfonline\.com|iopscience\.iop\.org|arxiv\.org|kci\.go\.kr|dbpia\.co\.kr|aiaa\.org|annualreviews\.org|sagepub\.com|pure\.tudelft\.nl|library\.kaist\.ac\.kr)$/i;
const institutions = /(^|\.)(easa\.europa\.eu|icao\.int|nasa\.gov|faa\.gov|eurocontrol\.int|sesarju\.eu|kiast\.or\.kr|aim\.koca\.go\.kr|cordis\.europa\.eu)$/i;
export function classify(record) {
  const other=otherReason(record);
  if(other){const commerce=commerceKind(record);return {collection:commerce?'쇼핑·상품정보':'기타',tags:commerce==='product'?'상품정보':commerce==='shopping'?'쇼핑':'쇼핑·생활',reason:other+' → '+(commerce?'쇼핑·상품정보':'기타')};}
  const text = [record.title,record.url,record.doi,record.notes].join(' ');
  const matches = topics.filter(t=>t.pattern.test(text));
  let host=''; try { host=new URL(record.url).hostname; } catch {}
  const tags = matches.map(t=>t.name);
  if (institutions.test(host)) tags.push('기관자료');
  if (record.pdfUrl || record.localSource) tags.push('PDF');
  return {collection:matches[0]?.name || '분류 검토', tags:[...new Set(tags)].join(', '), reason:matches.length?'제목·주소의 주제 키워드':'주제 정보가 부족해 검토 필요'};
}
export function fromTab(tab) {
  if(tab.incognito)return {excluded:'시크릿 탭'};
  const identity=resourceIdentity(tab.url); if(!identity)return {excluded:'브라우저 내부·지원하지 않는 파일'};
  const u=new URL(tab.url), local=u.protocol==='file:';
  if(!local && (/\/(login|signin|settings|account|chat)(\.|\/|$)/i.test(u.pathname) || /(^|\.)(chatgpt\.com|chat\.openai\.com|claude\.ai|copilot\.microsoft\.com|notebooklm\.google\.com|mail\.google\.com|outlook\.live\.com|outlook\.office\.com|gemini\.google\.com|uniai\.unist\.ac\.kr|portal\.unist\.ac\.kr|engage\.cloud\.microsoft)$/i.test(u.hostname)))return {excluded:'로그인·설정·채팅'};
  if(!local && /(^|\.)(google\.[a-z.]+|bing\.com|search\.naver\.com)$/i.test(u.hostname) && /search|scholar/i.test(u.pathname)) return {excluded:'검색 결과'};
  let title=String(tab.title || '').replace(/\s*(?:- ScienceDirect|\| IEEE.*|\| Springer Nature Link|\| EASA)\s*$/i,'').replace(/^Full article:\s*/i,'').trim();
  if(!title || /^(access denied|잠시만 기다리|ieee xplore (full-text|.*unavailable)|https?:|file:)/i.test(title))title=local?fileName(u.href):u.hostname+u.pathname;
  const viewed=referenceFromTitle(title,u.href);title=viewed.title;
  let url=local?'':u.href, pdfUrl=!local && isPDF(u.href)?u.href:'';
  if(identity.startsWith('pii:')) {url=`https://www.sciencedirect.com/science/article/pii/${identity.slice(4)}`; if(/sciencedirectassets/.test(u.hostname))pdfUrl='';}
  if(identity.startsWith('ieee:')) {url=`https://ieeexplore.ieee.org/document/${identity.slice(5)}`; if(pdfUrl)pdfUrl=`https://ieeexplore.ieee.org/stamp/stamp.jsp?arnumber=${identity.slice(5)}`;}
  if(identity.startsWith('doi:')){url=`https://doi.org/${identity.slice(4)}`;if(pdfUrl && [...u.searchParams.keys()].some(k=>/token|signature|credential|authorization|api.?key/i.test(k)))pdfUrl='';}
  if(identity.startsWith('dbpia:'))url=`https://www.dbpia.co.kr/journal/articleDetail?nodeId=${identity.slice(6)}`;
  if(identity.startsWith('arxiv:'))url=`https://arxiv.org/abs/${identity.slice(6)}`;
  if(identity.startsWith('patent:'))url=`https://patents.google.com/patent/${identity.slice(7)}/en`;
  // Never persist credentials or signed download tokens in the library/backup.
  if(!local) { for(const link of [url,pdfUrl]) if(link) {const v=new URL(link); if(v.username || v.password || [...v.searchParams.keys()].some(k=>/token|signature|credential|authorization|api.?key|^(auth|session|sid|code|password|secret)$/i.test(k)))return {excluded:'인증정보가 포함된 임시 주소'};} }
  const academic=(!local && scholarly.test(u.hostname)) || (local && /^(applsci-|applsci\.pdf|drones-|aerospace-|energies-|s41598-|1-s2\.0-)/i.test(fileName(u.href)));
  const record=normalize({title,references:viewed.references,url,pdfUrl,doi:identity.startsWith('doi:')?identity.slice(4):'',kind:inferKind({title:tab.title || title,url,localSource:local?u.href:'',kind:academic?'paper':'document'}),accessed:new Date().toISOString().slice(0,10),localSource:local?u.href:''});
  const proposal=classify(record);record.collection=proposal.collection;record.tags=proposal.tags;
  const research=!['other','shopping','product'].includes(record.kind) && (local || academic || ['patent','book'].includes(record.kind) || institutions.test(u.hostname) || proposal.collection!=='분류 검토');
  return {record, identity, selected:research, reason:local?'로컬 PDF: 파일 내용은 읽지 않음 · 저장 후 직접 첨부':proposal.reason, tabIds:[tab.id],tabUrls:[tab.url]};
}
export function planTabs(tabs, existing=[]) {
  const items=[],excluded=[];
  for(const tab of tabs){
    const item=fromTab(tab); if(item.excluded){excluded.push(item.excluded);continue;}
    const same=items.find(i=>i.identity===item.identity);
    if(same){same.tabIds.push(tab.id);same.tabUrls.push(tab.url);same.record.references=mergeReferences(same.record.references,item.record.references);same.record.pdfUrl ||= item.record.pdfUrl;if(isPDF(same.sourceUrl) && !isPDF(tab.url))same.record.title=item.record.title;continue;}
    item.sourceUrl=tab.url;items.push(item);
  }
  for(const item of items){
    const conflict=duplicate(existing,item.record);if(conflict){item.selected=false;item.existing=true;item.targetId=conflict.id;item.beforeVersion=conflict.updated;item.localAttachment=conflict.attachment || existing.find(r=>r.linkedTo===conflict.id && r.attachment)?.attachment;item.record={...conflict,references:mergeReferences(conflict.references,item.record.references),pdfUrl:conflict.pdfUrl || item.record.pdfUrl};item.reason=`이미 저장됨: ${conflict.title} · 선택 후 수정·저장 또는 서지정보 읽기로 보완 가능`;}
    else item.record={...item.record,...classify(item.record)};
  }
  return {total:tabs.length,items,excluded:excluded.length,merged:tabs.length-excluded.length-items.length};
}
export function planExisting(records,{onlyOther=false}={}) {
  if(onlyOther)records=records.filter(record=>otherReason(record));
  return records.map(record=>{
    const proposal=classify(record);
    const other=!!otherReason(record),autoCollection=!record.collection || record.collection==='분류 검토' || topics.some(t=>t.name===record.collection);
    const tags=[...new Set([...(record.tags || '').split(',').map(x=>x.trim()).filter(x=>x && (!other || !topics.some(t=>t.name===x))),...proposal.tags.split(', ').filter(Boolean)])].join(', ');
    const kind=inferKind(record), needs=other?(onlyOther || autoCollection || ['기타','쇼핑·상품정보'].includes(record.collection)) && record.collection!==proposal.collection:(!record.collection || record.collection==='분류 검토') && proposal.collection!=='분류 검토';
    return {record:{...record,kind,collection:needs?proposal.collection:record.collection || proposal.collection,tags},before:{collection:record.collection,tags:record.tags,kind:record.kind},selected:needs || kind!==record.kind || other && tags!==record.tags,reason:other?proposal.reason+(needs?` · ${record.collection || '미분류'} → ${proposal.collection}`:' · 기존 컬렉션 유지'):record.collection && !needs?'기존 컬렉션 유지 · 종류·태그 제안':proposal.reason,tabIds:[]};
  });
}
