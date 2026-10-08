import {groupFolderRecords} from './folder-view.js';
import {kindMatches,kindPath} from './taxonomy.js';
import {isOther} from './relevance.js';
import {referenceText,renderReferences} from './references.js';
import {activityText} from './activity.js';
import {safeUrl} from './model.js';
import {readFolderPDF} from './folder-store.js';
export function combineLibraryRecords(records,sources=[],{clientId='',browser='Chrome',showLinked=false}={}){
 const local={entry:{browser,clientId},records,local:true},external=sources.filter(s=>!clientId || s.entry.clientId!==clientId || s.entry.browser!==browser);
 const groups=groupFolderRecords([local,...external]);
 if(showLinked)for(const record of records)if(record.linkedTo && records.some(r=>r.id===record.linkedTo))groups.push({variants:[{record,source:local}]});
 return groups.sort((a,b)=>Math.max(...b.variants.map(v=>v.record.created))-Math.max(...a.variants.map(v=>v.record.created)));
}
export function filterLibraryGroups(groups,p){const query=p.search.trim().toLowerCase();return groups.map(g=>({variants:g.variants.filter(({record:r,source:s})=>(!p.browser || p.browser==='local'? !p.browser || s.local:s.entry.browser===p.browser) && (!p.hideOther || !isOther(r)) && (!p.collection || r.collection===p.collection) && (!p.status || r.status===p.status) && kindMatches(r.kind,p.kindGroup,p.kind) && [r.title,r.authors,r.doi,r.tags,r.notes,r.version,r.url,r.collection,r.venue,referenceText(r)].join(' ').toLowerCase().includes(query))})).filter(g=>g.variants.length);}
export function appendFolderVariant(card,{record:r,source},parent,onError){
 const el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text || '';if(cls)n.className=cls;return n;};
 const body=el('section','','folder-variant');body.append(el('h4',`${source.entry.browser} · ${source.entry.clientId.slice(-8)} · 폴더 저장본`),el('p',`${kindPath(r.kind)} · ${({unread:'읽기 전',reading:'읽는 중',done:'완료'})[r.status]} · ${new Date(source.entry.exported).toLocaleString()}`,'metadata'));
 body.append(el('p',[r.authors,r.date,r.venue,r.collection,r.tags].filter(Boolean).join(' · '),'metadata'),el('p',activityText(r),'metadata'));const refs=renderReferences(r);if(refs)body.append(refs);if(r.notes)body.append(el('p',r.notes,'folder-notes'));
 const actions=el('div','','tags');for(const [label,url] of [['원문 ↗',r.url],['PDF 링크 ↗',r.pdfUrl],['DOI ↗',/^10\.\d{4,9}\//i.test(r.doi)?'https://doi.org/'+encodeURIComponent(r.doi).replace(/%2F/gi,'/'):'']])if(safeUrl(url)){const a=el('a',label);a.href=safeUrl(url);a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}
 if(r.folderAttachment){const b=el('button','첨부 PDF 다운로드 ↓','text-button');b.type='button';b.onclick=async()=>{b.disabled=true;try{const bytes=await readFolderPDF(parent,r.folderAttachment),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),a=el('a','');a.href=url;a.download=r.folderAttachment.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){onError('PDF 열기 실패: '+e.message);}finally{b.disabled=false;}};actions.append(b);}body.append(actions);card.append(body);
}
