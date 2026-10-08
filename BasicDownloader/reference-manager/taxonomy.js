import {otherReason,commerceKind} from './relevance.js';
export const kindLabels={journal:'저널 논문',conference:'학회 논문',preprint:'프리프린트',thesis:'학위논문',paper:'논문 (세부 확인)',patent:'기술문서 (특허)',standard:'규정·표준',report:'기술·연구보고서',manual:'매뉴얼·안내',document:'기술문서 (세부 확인)',book:'도서',wiki:'위키',webtool:'웹도구',dataset:'데이터·지도 자료',webpage:'웹페이지·기사',shopping:'쇼핑',product:'상품정보',other:'기타'};
export const paperKinds=['paper','journal','conference','preprint','thesis'];
export const kindGroups={papers:{label:'논문',kinds:paperKinds},technical:{label:'기술문서',kinds:['document','patent','standard','report','manual']},review:{label:'세부확인 항목',kinds:['paper','document']},web:{label:'웹 자료',kinds:['wiki','webtool','dataset','webpage']},books:{label:'도서',kinds:['book']},commerce:{label:'쇼핑·상품정보',kinds:['shopping','product']},other:{label:'기타',kinds:['other']}};
export const kindMatches=(kind,group='',detail='')=>(!group || kindGroups[group]?.kinds.includes(kind)) && (!detail || detail===kind);
export function kindPath(kind){const group=Object.values(kindGroups).find(g=>g!==kindGroups.review && g.kinds.includes(kind));return group && group.label!==kindLabels[kind]?group.label+' › '+kindLabels[kind]:kindLabels[kind] || '자료';}
export function fillKindGroups(select){select.replaceChildren();const all=document.createElement('option');all.value='';all.textContent='전체';select.append(all);for(const [value,{label}] of Object.entries(kindGroups)){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}}
export function fillKindDetails(select,group=''){select.replaceChildren();const all=document.createElement('option');all.value='';all.textContent='모든 세부분류';select.append(all);const groups=group?[kindGroups[group]]:Object.values(kindGroups).filter(g=>g!==kindGroups.review);for(const {label,kinds} of groups){const optgroup=document.createElement('optgroup');optgroup.label=label;for(const kind of kinds){const option=document.createElement('option');option.value=kind;option.textContent=kindLabels[kind];optgroup.append(option);}select.append(optgroup);}}
export function inferKind(r){
 const commerce=commerceKind(r);if(commerce)return commerce;
 if(otherReason(r))return 'other';
 if(r.kind && !['paper','document'].includes(r.kind) && Object.hasOwn(kindLabels,r.kind))return r.kind;
 const text=[r.title,r.venue,r.url,r.localSource].join(' ');let host='';try{host=new URL(r.url).hostname;}catch{}
 if(/(^|\.)(patents\.google\.com|patentimages\.storage\.googleapis\.com|patentscope\.wipo\.int|kipris\.or\.kr)$/i.test(host) || /\b(?:WO|US|EP|KR|JP|CN)\d{6,13}[AB]\d\b/i.test(text))return 'patent';
 if(/(^|\.)(wikipedia\.org|wikibooks\.org|wiktionary\.org|namu\.wiki)$/i.test(host) || /\/wiki\//i.test(r.url || ''))return 'wiki';
 if(/(^|\.)(artechhouse\.com)$/i.test(host) || r.isbn)return 'book';
 if(/(^|\.)(windy\.com|map\.kakao\.com|vworld\.kr|earth\.google\.com)$/i.test(host))return 'webtool';
 if(/dataset|\bwms\b|\bwfs\b|데이터포털|데이터서비스|국토정보플랫폼/i.test(text))return 'dataset';
 if(/arxiv\.org|preprint|프리프린트/i.test(text))return 'preprint';
 if(/dissertation|doctoral thesis|master.?s thesis|학위논문|박사학위|석사학위/i.test(text))return 'thesis';
 if(/conference publication|conference|proceedings|symposium|학술대회|학술발표회|초록집|컨퍼런스/i.test(text))return 'conference';
 if(r.venue || /journal|scientific reports|(^|[\s/])(applsci-|drones-|energies-|s41598-)/i.test(text) || /(^|\.)(mdpi\.com|nature\.com|tandfonline\.com|annualreviews\.org)$/i.test(host) || /sciencedirect\.com\/science\/article\//i.test(r.url || ''))return 'journal';
 if(/pans.?ops|\bdoc.?8168\b|moc.?sc.?vtol|means of compliance|airworthiness|\bdo.?36[56]\b|규정|표준|감항기준/i.test(text))return 'standard';
 if(/manual|handbook|guide|ernip|airspace.design.methodology|매뉴얼|안내서/i.test(text))return 'manual';
 if(/report|technical report|보고서|conops/i.test(text) || /(^|\.)(ntrs\.nasa\.gov|cordis\.europa\.eu)$/i.test(host))return 'report';
 return r.kind==='paper'?'paper':r.kind==='document'?'document':'webpage';
}
export function fillKinds(select,all=false){fillKindDetails(select);if(!all)select.options[0].remove();else select.options[0].textContent='전체';}
