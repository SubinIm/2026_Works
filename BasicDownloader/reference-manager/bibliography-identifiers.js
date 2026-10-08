// Candidates only. A registered response with the exact DOI is required before assignment.
// Never read notes, references or PDF bytes here, and never transmit local paths.
import {resourceIdentity} from './identity.js';
export function sourceLanding(record={}){
 for(const value of [record.url,record.pdfUrl]){const key=resourceIdentity(value);
  if(key.startsWith('arxiv:'))return 'https://arxiv.org/abs/'+key.slice(6);
  if(key.startsWith('ieee:'))return 'https://ieeexplore.ieee.org/document/'+key.slice(5);
  if(key.startsWith('pii:'))return 'https://www.sciencedirect.com/science/article/pii/'+key.slice(4);
 }
 for(const value of [record.title,record.attachment?.name,record.localSource]){const id=String(value || '').match(/\b1-s2\.0-(S[A-Z\d]{16})-main\.pdf\b/i)?.[1];if(id)return 'https://www.sciencedirect.com/science/article/pii/'+id.toUpperCase();}
 return '';
}
export function identifierDOIs(record={}){
 const values=[record.title,record.attachment?.name,record.localSource,record.url,record.pdfUrl].filter(v=>typeof v==='string');const keys=new Set();
 for(let text of values){try{text=decodeURIComponent(text);}catch{}text=text.slice(0,10000);
  const identity=resourceIdentity(text);if(identity.startsWith('arxiv:'))keys.add('10.48550/arxiv.'+identity.slice(6).replace(/v\d+$/i,'').toLowerCase());
  for(const m of text.matchAll(/\b(s\d{5}-\d{3}-\d{4,6}-[\dx])\b/gi))keys.add('10.1038/'+m[1].toLowerCase());
  for(const m of text.matchAll(/\b(srep\d{4,7})\b/gi))keys.add('10.1038/'+m[1].toLowerCase());
  for(const m of text.matchAll(/\b(ffutr|frobt|fnbot|fnins|fdata|fpace|fphy|frsc|fenvs|fict|fcomp|fneur|fnhum|fpsyg|feduc|feart)[-.]((?:19|20)\d{2})[-.](\d{4,9})\b/gi))keys.add('10.3389/'+m[1].toLowerCase()+'.'+m[2]+'.'+m[3]);
  if(/^https?:\/\//i.test(text)){try{const u=new URL(text);const m=u.pathname.match(/\/(10\.\d{4,9}\/[^?#]+?)(?:\/(?:full|abstract|pdf|epdf))?$/i);if(m)keys.add(m[1].replace(/\.pdf$/i,'').toLowerCase());}catch{}}
 }
 return [...keys].slice(0,3);
}
