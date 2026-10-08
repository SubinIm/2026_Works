import { normalize, doi, fileName, duplicate } from './model.js';
import { classify } from './organizer.js';
import { inferKind } from './taxonomy.js';
import {mergeReferences,referenceFromTitle} from './references.js';

export function doiCandidates(text){
 const matches=String(text || '').match(/10\.\d{4,9}\/[A-Z\d._;()/:+%-]+/gi) || [];
 return [...new Set(matches.map(x=>{let v=x.replace(/[.,;:]+$/,'');while(v.endsWith(')') && (v.match(/\)/g)||[]).length>(v.match(/\(/g)||[]).length)v=v.slice(0,-1);return doi(v);} ))];
}
export function titleKey(text){return String(text || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');}
export function usefulTitle(text){return text && text.trim().length>=12 && !/\.pdf\s*$/i.test(text) && !/^(microsoft (word|powerpoint)|untitled|document\d*|paper title(?:\s|$)|insert (?:paper )?title|https?:|file:|ieee xplore|s41598-|1-s2\.0-)/i.test(text.trim());}
export function coverCitation(lines){
 const at=lines.slice(0,60).findIndex(s=>/^Citation\s*\(APA\)/i.test(s.trim()));if(at<0)return {};
 const text=lines.slice(at+1,at+10).join(' ').split(/Important note|Copyright|Sharing and reuse|Takedown policy/i)[0].trim();
 const citation=text.match(/^(.{3,500}?)\s*\(((?:19|20)\d{2})\)\.\s*(.{12,1500})$/);if(!citation)return {};
 const authors=[...citation[1].matchAll(/([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)*),\s*((?:[A-Z]\.\s*)+)/gu)].map(m=>m[1]+', '+m[2].trim());
 if(!authors.length)return {};
 const parts=citation[3].split(/(?<=[.?!])\s+In\s+/i);
 if(!usefulTitle(parts[0]))return {};
 return {title:parts[0].trim(),authors:authors.join('; '),date:citation[2],venue:parts[1]?.replace(/\.$/,'').trim() || ''};
}
export function presentationCover(lines,embeddedTitle,titleGuess){
 if(!/^Microsoft PowerPoint\b/i.test(embeddedTitle || '') || !usefulTitle(titleGuess))return {};
 const role=lines.findIndex(s=>/^(?:[\p{L} -]+\s)?(?:specialist|researcher|engineer|director|professor)\s+(?:at|of)\s+\S/iu.test(s));
 const author=role>0?lines[role-1]?.trim():'';
 const dates=lines.join(' ').match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+((?:19|20)\d{2})\b/i);
 const titleAt=lines.findIndex(s=>s.trim()===titleGuess.trim()),event=titleAt>=0 && role>titleAt?lines.slice(titleAt+1,role-1).join(' ').trim():'';
 if(!/^[\p{L} .'-]{5,120}$/u.test(author) || !dates || !/conference|symposium|workshop/i.test(event))return {};
 const month=['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(dates[2].toLowerCase())+1;
 return {title:titleGuess,authors:author,date:dates[3]+'-'+String(month).padStart(2,'0')+'-'+dates[1].padStart(2,'0'),venue:event,kind:'report'};
}
export function metadataFromPDF({info={},xmp={},lines=[],links=[],titleGuess='',firstPageLineCount=40},name){
 const asText=v=>Array.isArray(v)?v.join('; '):typeof v==='string'?v:'';
 const citation=coverCitation(lines);
 const identifiers=[asText(xmp['dc:identifier']),asText(xmp['prism:doi']),asText(xmp['pdfx:doi']),asText(info.Subject),asText(info.Keywords)].join(' ');
 const metadataDOIs=doiCandidates(identifiers);
 const referenceHeading=lines.findIndex(line=>/^\s*(?:(?:\d+\.?|[IVX]+\.?)\s+)?(?:references|bibliography|참고\s*문헌)\s*:?\s*$/i.test(line));
 const beforeReferences=(referenceHeading<0?lines:lines.slice(0,referenceHeading)).join('\n');
 const linkedDOIs=doiCandidates(links.filter(u=>/doi\.org\//i.test(u)).join(' '));
 const textDOIs=doiCandidates(beforeReferences);
 // Unlabelled annotation links may belong to cited papers; accept only those also
 // present before the reference section, never a reference-only DOI.
 const frontLinks=linkedDOIs.filter(d=>textDOIs.includes(d));
 const candidates=metadataDOIs.length?metadataDOIs:frontLinks.length?frontLinks:textDOIs;
 const embeddedTitle=asText(xmp['dc:title']) || asText(info.Title);
 const templateTitle=/^paper title(?:\s|$)|^insert (?:paper )?title/i.test(embeddedTitle || '');
 const presentation=presentationCover(lines.slice(0,firstPageLineCount),embeddedTitle,titleGuess);
 let title=citation.title || presentation.title || (usefulTitle(embeddedTitle)?embeddedTitle:'');
 const journalDOI=metadataDOIs[0] || (candidates.length===1?candidates[0]:'');
 const knownVenue=/^10\.3390\/app\d/i.test(journalDOI)?'Applied Sciences':/^10\.3390\/drones\d/i.test(journalDOI)?'Drones':/^10\.3390\/aerospace\d/i.test(journalDOI)?'Aerospace':/^10\.3390\/en\d/i.test(journalDOI)?'Energies':/^10\.1038\/s41598-/i.test(journalDOI)?'Scientific Reports':'';
 const venue=asText(xmp['prism:publicationname']) || citation.venue || presentation.venue || knownVenue || lines.slice(0,30).find(x=>/conference|proceedings|symposium|journal of|scientific reports|applied sciences|energies/i.test(x))?.trim().slice(0,250) || '';
 const kind=presentation.kind || inferKind({title:title || name,venue,url:'',localSource:name,kind:/eurocontrol|ernip|moc.sc.vtol|pans.ops|conops|manual|handbook/i.test(name+' '+title)?'document':'paper'});
 const published=asText(xmp['prism:publicationdate']);
 const date=/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(published)?published:citation.date || presentation.date || beforeReferences.match(/(?:published|copyright|©)[^\n]{0,50}?\b((?:19|20)\d{2})\b/i)?.[1] || '';
 const rawAuthors=asText(xmp['dc:creator']) || asText(info.Author);
 const authors=citation.authors || presentation.authors || (templateTitle && /^(IEEE|Elsevier|Springer|Wiley)$/i.test(rawAuthors)?'':rawAuthors);
 return {title,authors,doi:candidates.length===1?candidates[0]:'',doiCandidates:candidates,venue,kind,date,needsReview:!title || candidates.length>1 || !authors || !date,doiStatus:candidates.length===1?'found':!candidates.length && (citation.title || presentation.title)?'not-listed':'unknown'};
}
export function matchPDF(records,metadata,name){
 const active=records.filter(r=>!r.linkedTo);
 if(metadata.doi){const exact=active.filter(r=>doi(r.doi)===doi(metadata.doi) || duplicate([r],normalize({title:'PDF match',doi:metadata.doi})));if(exact.length===1)return {target:exact[0],reason:'DOI 일치'};if(exact.length>1)return {reason:'같은 DOI의 기존 항목이 여러 개입니다.'};}
 const key=titleKey(metadata.title);
 if(usefulTitle(metadata.title) && key.length>=20){const exact=active.filter(r=>titleKey(r.title)===key && (!r.doi || !metadata.doi || doi(r.doi)===doi(metadata.doi)));if(exact.length===1)return {target:exact[0],reason:'제목 일치'};if(exact.length>1)return {reason:'같은 제목의 기존 항목이 여러 개입니다.'};}
 const byFile=active.filter(r=>(r.localSource && fileName(r.localSource)===name) || r.attachment?.name===name).filter(r=>!r.doi || !metadata.doi || doi(r.doi)===doi(metadata.doi));
 if(byFile.length===1)return {target:byFile[0],reason:'기존 PDF 파일명 일치 · 검토 필요'};
 return {reason:byFile.length>1?'같은 파일명의 항목이 여러 개입니다.':'대응 자료 없음 · 새 자료 후보'};
}
export function pdfProposal(records,metadata,attachment,{sourceId='',pdfUrl='',localSource=''}={}){
 const match=matchPDF(records,metadata,attachment.name),source=records.find(r=>r.id===sourceId),target=match.target || source;
 const raw=normalize({title:metadata.title || target?.title || attachment.name,authors:metadata.authors,doi:metadata.doi,date:metadata.date,venue:metadata.venue,kind:metadata.kind || 'paper',url:metadata.doi?'https://doi.org/'+encodeURIComponent(metadata.doi).replace(/%2F/gi,'/'):'',pdfUrl,localSource:localSource || source?.localSource || '',accessed:new Date().toISOString().slice(0,10)});
 const classification=classify(raw);raw.collection=classification.collection;raw.tags=classification.tags;
 if(source && target?.id!==source.id)raw.notes=source.notes || '';
 const compatible=records.filter(r=>r.id!==target?.id && (!r.doi || !raw.doi || doi(r.doi)===doi(raw.doi)));
 const byName=compatible.filter(r=>r.localSource && fileName(r.localSource)===attachment.name);
 const sourceIds=sourceId?compatible.filter(r=>r.id===sourceId).map(r=>r.id):byName.length===1?[byName[0].id]:[];
 return {record:raw,attachment,targetId:target?.id || '',before:target?.updated,sourceIds,reason:match.reason,doiCandidates:metadata.doiCandidates || [],selected:true};
}
export function enrichRecord(current,incoming,attachment){
 if(current.doi && incoming.doi && doi(current.doi)!==doi(incoming.doi))throw new Error('기존 자료와 PDF의 DOI가 다릅니다. 연결 대상을 다시 확인해주세요.');
 const out={...current};
 for(const key of ['authors','date','doi','venue','url','pdfUrl','localSource'])if(!out[key] && incoming[key])out[key]=incoming[key];
 const viewed=referenceFromTitle(current.title,current.url);
 if((!usefulTitle(current.title) || current.title===attachment.name || viewed.references.length) && usefulTitle(incoming.title))out.title=incoming.title;
 out.references=mergeReferences(current.references,incoming.references,viewed.references);
 if(['paper','document'].includes(out.kind) && incoming.kind)out.kind=incoming.kind;
 if(!out.collection || out.collection==='분류 검토')out.collection=incoming.collection;
 out.tags=[...new Set([...(out.tags || '').split(','),...(incoming.tags || '').split(',')].map(x=>x.trim()).filter(Boolean))].join(', ');
 out.attachment ||= attachment;
 if(incoming.notes && !out.notes.includes(incoming.notes))out.notes=[out.notes,incoming.notes].filter(Boolean).join('\n\n');
 out.updated=Date.now();return out;
}
