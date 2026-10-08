import {kindGroups,paperKinds,inferKind} from './taxonomy.js';
import {isPDF} from './identity.js';
import {identifierDOIs} from './bibliography-identifiers.js';
const metadataValue=v=>typeof v==='string' && !/^(undefined|null|\[object Object\])$/i.test(v.trim())?v.trim():'';
const fields=['title','authors','date','doi','venue','kind','version'];
export const bibliographySignature=r=>JSON.stringify(fields.map(k=>String(r[k] || '').trim()));
export function normalizeBibliography(value){
 if(!value || typeof value!=='object')return undefined;
 return {status:['confirmed','partial'].includes(value.status)?value.status:'partial',signature:typeof value.signature==='string'?value.signature.slice(0,75000):'',source:String(value.source || '').slice(0,400),checkedAt:Number.isFinite(value.checkedAt)?value.checkedAt:0,...(value.doiStatus?{doiStatus:['found','not-listed','unknown'].includes(value.doiStatus)?value.doiStatus:'unknown'}:{})};
}
export function bibliographyQuality(record){
 const kind=inferKind(record),academic=[...kindGroups.papers.kinds,...kindGroups.technical.kinds].includes(kind),missing=[];
 const title=metadataValue(record.title);
 if(!title || /\.pdf\s*$|^(?:dbpia|sage|untitled|document|논문보기|paper title)$/i.test(title) || /^(?:figure|table|그림|표)\s*\d+\s*[|:]/i.test(title))missing.push('논문·문서 제목');
 if(paperKinds.includes(kind)){
  if(!metadataValue(record.authors))missing.push('저자');
  if(!/\b(?:19|20)\d{2}\b/.test(record.date || ''))missing.push('발행일');
 }else if(kindGroups.technical.kinds.includes(kind)){
  if(!metadataValue(record.authors) && !metadataValue(record.venue))missing.push('저자·발행기관');
  if(!/\b(?:19|20)\d{2}\b/.test(record.date || '') && !metadataValue(record.version))missing.push('발행일·버전');
 }
 const checked=normalizeBibliography(record.bibliography),explicit=checked?.status==='confirmed' && checked.signature===bibliographySignature(record);
 // Existing complete records are also excluded; DOI absence alone is not a defect.
 return {academic,missing,confirmed:checked?explicit:academic && !missing.length};
}
export function checkedBibliography(record,source='',manual=false){const quality=bibliographyQuality({...record,bibliography:undefined});return {status:manual || !quality.missing.length?'confirmed':'partial',signature:bibliographySignature(record),source,checkedAt:Date.now()};}
export function technicalPageOnly(record){return kindGroups.technical.kinds.includes(inferKind(record)) && !record.attachment && !record.localSource && !record.pdfUrl && !isPDF(record.url || record.title || '') && !record.doi && !identifierDOIs(record).length;}
export function savedBibliographyIncluded(record,{includeConfirmed=false,includeOther=false,includeExcluded=false,includeTechnicalPages=false,kinds}={}){const q=bibliographyQuality(record);return (includeExcluded || !record.bibliographyExcluded) && (includeOther || q.academic) && (includeConfirmed || !q.confirmed) && (includeTechnicalPages || !technicalPageOnly(record)) && (!kinds || !q.academic || kinds.includes(inferKind(record)));}
export function bibliographyProblem(error){
 const message=String(error?.message || error || '정보를 확인하지 못했습니다.').replace(/https?:\/\/[^\s<>]+/gi,value=>{try{const u=new URL(value);return u.origin+u.pathname;}catch{return '[주소]';}}).slice(0,1600);
 if(/PDF 해석기|dynamically imported module/.test(message))return 'PDF 해석기 파일 로딩 실패: 확장의 빌드 폴더(dist)를 다시 로드해주세요. 상세: '+message;
 if(/403|429|captcha|접속.?차단|blocked|forbidden/i.test(message))return '접속 차단·요청 제한: 원문 탭에서 정상 접근을 확인하거나 DOI 조회·Scholar 검색을 사용하세요. 상세: '+message;
 if(/401|로그인/i.test(message))return '로그인 필요: 원문 탭에서 로그인한 뒤 열린 탭 읽기를 사용하세요. 상세: '+message;
 if(/redirect|fetch|network|네트워크|timeout|abort/i.test(message))return '주소 이동·네트워크 오류: 원문 탭 로딩 후 다시 읽거나 DOI 조회를 사용하세요. 상세: '+message;
 return message;
}
