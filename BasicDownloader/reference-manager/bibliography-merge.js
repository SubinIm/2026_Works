import {recordKeys,doi} from './model.js';
import {mergeReferences} from './references.js';
import {resourceIdentity} from './identity.js';
import {paperKinds} from './taxonomy.js';

export function sameBibliographicDOI(a,b){
 if(!a.doi || !b.doi || doi(a.doi)!==doi(b.doi))return false;
 const keys=recordKeys(a).filter(k=>k.startsWith('doi:'));
 return recordKeys(b).some(k=>keys.includes(k));
}
export function sameBibliographicDocument(a,b){
 if(a.doi && b.doi && doi(a.doi)!==doi(b.doi))return false;
 if(a.doi && b.doi)return sameBibliographicDOI(a,b);
 if(!paperKinds.includes(a.kind) || !paperKinds.includes(b.kind))return false;
 const webKeys=r=>[r.url,r.pdfUrl].filter(v=>/^https?:/i.test(v || '')).map(resourceIdentity).filter(Boolean);
 const keys=webKeys(a);return webKeys(b).some(k=>keys.includes(k));
}
export function mergeBibliographyPersonal(target,sources){
 const out={...target};
 for(const source of sources){
  if(source.notes && !out.notes?.includes(source.notes))out.notes=[out.notes,`[연결 자료 메모: ${source.title}]\n${source.notes}`].filter(Boolean).join('\n\n');
  out.attachment ||= source.attachment;
  out.localSource ||= source.localSource;
  out.references=mergeReferences(out.references,source.references);
  out.tags=[...new Set([...(out.tags || '').split(','),...(source.tags || '').split(',')].map(t=>t.trim()).filter(Boolean))].join(', ');
 }
 // Each source retains its own reading state and usage counters in its linked record.
 return out;
}
