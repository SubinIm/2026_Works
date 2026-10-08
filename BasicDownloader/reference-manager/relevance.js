// Classify only from stored fields. No page access or network requests.
const researchHosts=/(^|\.)(sciencedirect\.com|ieeexplore\.ieee\.org|mdpi\.com|nature\.com|springer\.com|tandfonline\.com|iopscience\.iop\.org|arxiv\.org|kci\.go\.kr|dbpia\.co\.kr|aiaa\.org|annualreviews\.org|sagepub\.com|pure\.tudelft\.nl|library\.kaist\.ac\.kr|patents\.google\.com|patentimages\.storage\.googleapis\.com|patentscope\.wipo\.int|kipris\.or\.kr|easa\.europa\.eu|icao\.int|nasa\.gov|faa\.gov|eurocontrol\.int|cordis\.europa\.eu|wikipedia\.org|namu\.wiki|windy\.com|artechhouse\.com)$/i;
const shops=/(^|\.)(ebay\.(com|co\.uk|de)|amazon\.(com|co\.uk|de|co\.jp)|aliexpress\.com|coupang\.com|gmarket\.co\.kr|11st\.co\.kr|auction\.co\.kr|shopping\.naver\.com|smartstore\.naver\.com|danawa\.com)$/i;
const scholarlyTitle=/\b(?:journal|proceedings|dissertation|thesis|technical report)\b|\b(?:a |an )?study (?:of|on)|학술대회|학술지|학위논문|연구보고서|에 관한 연구/i;
const technicalTitle=/\b(?:manual|handbook|datasheet|specification)\b|매뉴얼|데이터시트|감항기준|규정·표준/i;
function research(record,host,title){return researchHosts.test(host) || /^10\.\d{4,9}\/\S+/i.test(record.doi || '') || /\/doi\/(?:full\/|pdf\/|abs\/)?10\.\d{4,9}\//i.test(record.url || '') || /(^|\.)(doi\.org)$/i.test(host) || record.isbn || (record.authors && record.venue) || scholarlyTitle.test(title);}
export function commerceKind(record={}){
 if(['shopping','product'].includes(record.kind))return record.kind;
 let host='',path='';try{const u=new URL(record.url);host=u.hostname;path=u.pathname;}catch{}
 const title=String(record.title || '');if(research(record,host,title))return '';
 if(/(^|\.)cults3d\.com$/i.test(host) && /\/3d-model\//i.test(path))return 'product';
 if(shops.test(host))return /\/(?:itm|dp|gp\/product|products?|items?)\//i.test(path)?'product':'shopping';
 if(technicalTitle.test(title))return '';
 if(/장바구니|구매하기|\b(?:shopping cart|buy now|add to cart)\b/i.test(title) || /\/(?:cart|checkout)(?:\/|$)/i.test(path))return 'shopping';
 if(/\/(?:shop|shopping|products?|items?)\b/i.test(path) && /가격|판매|할인|배송|구매|\b(?:price|sale|buy|shipping|shop)\b/i.test(title))return /\/(?:products?|items?)\b/i.test(path)?'product':'shopping';
 return '';
}
export function otherReason(record={}){
 const commerce=commerceKind(record);if(commerce)return commerce==='product'?'개별 상품·3D 모델 정보':'쇼핑·구매 페이지 정보';
 if(record.kind==='other')return '기타로 지정된 자료';
 let host='',path='';try{const url=new URL(record.url);host=url.hostname;path=url.pathname;}catch{}
 const title=String(record.title || '');
 // A motor/car name alone is not proof of shopping, and a merchant link in notes
 // does not turn a paper into shopping. Prefer the record's own bibliography.
 if(research(record,host,title))return '';
 if(shops.test(host))return '쇼핑몰 주소';
 if(technicalTitle.test(title))return '';
 if(/(^|\.)(realoem\.com|bimmercat\.com|bmwfans\.info|parts119\.com)$/i.test(host))return '차량 부품 카탈로그 주소';
 if(/(?:수입차|자동차|차량)\s*부품/i.test(title) && /차대번호|내\s*차\s*부품|판매|구매|쇼핑|가격|견적|최저가/i.test(title))return '차량 부품 구매·조회 페이지 제목';
 if(/\bbmw[\s-]*(?:[1-8]\d{2}[a-z]{0,3}|[fxgem]\d{1,3}|[xm][1-8])\b/i.test(title))return 'BMW 차량·부품 페이지 제목';
 if(/장바구니|구매하기|최저가|중고차|\b(?:shopping cart|buy now|add to cart)\b/i.test(title) || /\/(?:shop|shopping|cart|products?|items?)\b/i.test(path) && /가격|판매|할인|배송|구매|\b(?:price|sale|buy|shipping|shop)\b/i.test(title))return '쇼핑·구매 페이지 정보';
 return '';
}
export const isOther=record=>record.kind==='other' || record.collection==='기타' || !!otherReason(record);
