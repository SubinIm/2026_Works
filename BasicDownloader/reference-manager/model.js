import {normalizeBibliography} from './bibliography-state.js';
import { resourceIdentity } from './identity.js';
import { kindLabels } from './taxonomy.js';
import {normalizeActivity} from './activity.js';
import {normalizeReferences} from './references.js';
export function fileName(value) {try {const name=new URL(value).pathname.split('/').pop();try{return decodeURIComponent(name);}catch{return name;}}catch{return '';}}
export function safeUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
}
export function doi(value = '') { return String(value).trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').toLowerCase(); }
export function metadataText(value){return typeof value==='string' && !/^(undefined|null|\[object Object\])$/i.test(value.trim())?value.trim():'';}
export function urlKey(value) {
  const clean = safeUrl(value); if (!clean) return '';
  const u = new URL(clean); u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
  u.searchParams.sort(); return u.href.replace(/\/$/, '');
}
export function duplicate(records, record) {
  if(record.linkedTo)return undefined;
  const candidate=recordKeys(record);
  const direct=records.find(r => !r.linkedTo && r.id !== record.id && recordKeys(r).some(key=>candidate.includes(key)));
  if(direct)return direct;
  // A linked PDF's original file URL still belongs to its active library record.
  const linked=records.find(r=>r.linkedTo && r.linkedTo!==record.id && r.id!==record.id && recordKeys(r).some(key=>candidate.includes(key)));
  return linked?records.find(r=>r.id===linked.linkedTo && !r.linkedTo):undefined;
}
export function recordKeys(r){const version=[r.url,r.pdfUrl].map(resourceIdentity).map(k=>k.match(/^arxiv:.*(v\d+)$/i)?.[1]).find(Boolean);return [r.doi?`doi:${doi(r.doi)}${doi(r.doi).startsWith('10.48550/arxiv.') && version?':'+version:''}`:'',resourceIdentity(r.url),resourceIdentity(r.pdfUrl),resourceIdentity(r.localSource)].filter(Boolean);}
export function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('자료 형식이 올바르지 않습니다.');
  const out = {};
  for (const key of ['title','authors','date','doi','url','pdfUrl','collection','tags','notes','version','accessed','localSource','venue','linkedTo']) out[key] = typeof input[key] === 'string' ? input[key].slice(0, key === 'notes' ? 100000 : 10000).trim() : '';
  for(const key of ['title','authors','date','doi','venue','version'])out[key]=metadataText(out[key]);
  if (!out.title) throw new Error('제목을 입력해주세요.');
  out.url = safeUrl(out.url); out.pdfUrl = safeUrl(out.pdfUrl); out.doi = doi(out.doi);
  try {const local=new URL(out.localSource);local.hash='';local.search='';out.localSource=local.protocol==='file:' && /\.pdf$/i.test(local.pathname)?local.href:'';} catch {out.localSource='';}
  out.kind = Object.hasOwn(kindLabels,input.kind) ? input.kind : 'document';
  if(!/^[a-zA-Z0-9_-]{1,100}$/.test(out.linkedTo))out.linkedTo='';
  out.status = ['unread','reading','done'].includes(input.status) ? input.status : 'unread';
  out.id = typeof input.id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(input.id) ? input.id : crypto.randomUUID();
  out.created = Number.isFinite(input.created) ? input.created : Date.now();
  out.updated = Date.now();
  out.activity=normalizeActivity(input.activity);
  out.references=normalizeReferences(input.references);
  out.bibliographyExcluded=input.bibliographyExcluded===true;
  const checked=normalizeBibliography(input.bibliography);if(checked)out.bibliography=checked;
  return out;
}
export function bibtex(records) {
  const escape = value => String(value).replace(/[\\{}%&#_$~^]/g, c => ({'\\':'\\textbackslash{}','~':'\\textasciitilde{}','^':'\\textasciicircum{}'}[c] || '\\' + c)).replace(/[\r\n]+/g, ' ');
  return records.map((r,i) => {
    const type=({journal:'article',conference:'inproceedings',thesis:'phdthesis',report:'techreport',manual:'manual',book:'book'})[r.kind] || 'misc';
    const fields = {title:r.title, author:r.authors.split(';').map(a=>a.trim()).filter(Boolean).join(' and '), year:r.date.match(/\d{4}/)?.[0], doi:r.doi, url:r.url, ...(r.venue?{[r.kind==='conference'?'booktitle':r.kind==='book'?'publisher':'journal']:r.venue}:{}), note:r.version ? `Version ${r.version}` : ''};
    return `@${type}{paperdesk${i+1},\n${Object.entries(fields).filter(([,v])=>v).map(([k,v])=>`  ${k} = {${escape(v)}}`).join(',\n')}\n}`;
  }).join('\n\n');
}
export function parseBackup(text) {
  const data = JSON.parse(text);
  if (data.format !== 'paperdesk' || data.version !== 1 || !Array.isArray(data.records)) throw new Error('Paperdesk v1 백업 파일이 아닙니다.');
  return data.records.map(item => {
    const record = normalize(item);
    if (item.attachment) {
      if (typeof item.attachment.name !== 'string' || !/^data:application\/pdf;base64,[A-Za-z0-9+/]*={0,2}$/.test(item.attachment.data)) throw new Error('PDF 백업 데이터가 올바르지 않습니다.');
      record.attachment = item.attachment;
    }
    return record;
  });
}
