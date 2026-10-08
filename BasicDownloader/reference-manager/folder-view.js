import {recordKeys,safeUrl} from './model.js';
import {renderReferences,referenceText} from './references.js';
import {activityText} from './activity.js';
import {kindLabels,kindPath,fillKindGroups,fillKindDetails,kindMatches} from './taxonomy.js';
import {readFolderPDF} from './folder-store.js';
import {isOther} from './relevance.js';

export function groupFolderRecords(sources){
 const variants=[];
 for(const source of sources){const ids=new Set(source.records.map(r=>r.id));for(const record of source.records)if(!record.linkedTo || !ids.has(record.linkedTo))variants.push({record,source});}
 const parents=variants.map((_,i)=>i),keys=new Map();
 const root=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
 variants.forEach(({record},i)=>{for(const key of ['id:'+record.id,...recordKeys(record)]){if(keys.has(key))parents[root(i)]=root(keys.get(key));else keys.set(key,i);}});
 const grouped=new Map();variants.forEach((v,i)=>{const key=root(i);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(v);});
 return [...grouped.values()].map(variants=>({variants}));
}
export function renderFolderView(groups,parent){
 const $=s=>document.querySelector(s),filter=$('#folder-browser'),list=$('#folder-view-items'),search=$('#folder-view-search');
 const el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
 const browsers=[...new Set(groups.flatMap(g=>g.variants.map(v=>v.source.entry.browser)))].sort();filter.replaceChildren(el('option','모든 브라우저'));filter.options[0].value='';
 for(const name of browsers){const option=el('option',name);option.value=name;filter.append(option);}search.value='';
 fillKindGroups($('#folder-kind-group'));fillKindDetails($('#folder-kind'));
 function render(){
  list.replaceChildren();let count=0,variants=0;const query=search.value.trim().toLowerCase();
  for(const group of groups){const shown=group.variants.filter(v=>(!$('#folder-hide-other').checked || !isOther(v.record)) && (!filter.value || v.source.entry.browser===filter.value) && kindMatches(v.record.kind,$('#folder-kind-group').value,$('#folder-kind').value) && [v.record.title,v.record.authors,v.record.doi,v.record.collection,v.record.tags,v.record.notes,v.record.venue,referenceText(v.record)].join(' ').toLowerCase().includes(query));if(!shown.length)continue;count++;variants+=shown.length;
   const card=el('article','','folder-card');card.append(el('h3',shown[0].record.title));
   for(const {record:r,source} of shown){const body=el('section','','folder-variant');body.append(el('h4',`${source.entry.browser} · ${source.entry.clientId.slice(-8)}`),el('p',`${kindPath(r.kind)} · ${({unread:'읽기 전',reading:'읽는 중',done:'완료'})[r.status]} · ${new Date(source.entry.exported).toLocaleString()}`,'metadata'));
    body.append(el('p',[r.authors,r.date,r.venue,r.collection,r.tags].filter(Boolean).join(' · '),'metadata'));body.append(el('p',activityText(r),'metadata'));const references=renderReferences(r);if(references)body.append(references);if(r.notes)body.append(el('p',r.notes,'folder-notes'));
    const actions=el('div','','tags');for(const [label,url] of [['원문 ↗',r.url],['PDF 링크 ↗',r.pdfUrl],['DOI ↗',/^10\.\d{4,9}\//i.test(r.doi)?'https://doi.org/'+encodeURIComponent(r.doi).replace(/%2F/gi,'/'):'']])if(safeUrl(url)){const a=el('a',label);a.href=safeUrl(url);a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}
    if(r.folderAttachment){const button=el('button','첨부 PDF 다운로드 ↓','text-button');button.type='button';button.onclick=async()=>{button.disabled=true;try{const bytes=await readFolderPDF(parent,r.folderAttachment),url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})),a=el('a','');a.href=url;a.download=r.folderAttachment.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch(e){$('#folder-view-message').textContent='PDF 열기 실패: '+e.message;}finally{button.disabled=false;}};actions.append(button);}body.append(actions);card.append(body);
   }list.append(card);
  }
  $('#folder-view-count').textContent=`자료 ${count}개 · 브라우저별 저장 항목 ${variants}개`;if(!count)list.append(el('p','조건에 맞는 자료가 없습니다.'));
 }
 search.oninput=render;filter.onchange=render;$('#folder-kind').onchange=render;$('#folder-kind-group').onchange=()=>{fillKindDetails($('#folder-kind'),$('#folder-kind-group').value);render();};$('#folder-hide-other').onchange=render;render();
}
