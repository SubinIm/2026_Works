import { all, save, remove, merge,get,recordActivity } from './db.js';
import { normalize, bibtex, parseBackup, safeUrl, fileName, duplicate } from './model.js';
import { setupOrganizer } from './organizer-ui.js';
import { setupSavedTabs } from './saved-tabs-ui.js';
import { setupPDFUI } from './pdf-ui.js';
import { kindLabels,kindPath, paperKinds, fillKinds,fillKindGroups,fillKindDetails,kindMatches } from './taxonomy.js';
import { attachmentFromFile } from './pdf-reader.js';
import { pdfProposal, enrichRecord } from './pdf-matching.js';
import { setupFolderUI } from './folder-ui.js';
import {activityText} from './activity.js';
import {setupActivityUI} from './activity-ui.js';
import { isOther } from './relevance.js';
import {renderReferences,referenceText} from './references.js';
import {loadPreferences,updatePreferences,resetPreferences,preferenceDefaults} from './preferences.js';
import {combineLibraryRecords,filterLibraryGroups,appendFolderVariant} from './combined-library.js';
import {setTrackingEnabled} from './tracking-settings.js';
const $=s=>document.querySelector(s), form=$('#edit'), dialog=$('#editor');
let records=[], selected=null, collection='', visible=[], displayed=[], combined={sources:[],clientId:'',parent:null},working=false,pdfUI,folderUI,organizerUI,activityUI;
const browser=/Edg\//.test(navigator.userAgent)?'Edge':'Chrome';
export async function configureFolderUI(options){folderUI?.dispose();folderUI=await setupFolderUI(refresh,{...options,onView:async state=>{combined=state;render();},onHide:()=>{combined={sources:[],clientId:'',parent:null};$('#folder-view-message').textContent='';render();}});}
export function inspectFiles(files,context={}){return pdfUI.inspect(files,context);}
const statuses={unread:'읽기 전',reading:'읽는 중',done:'완료'};
function element(tag,text,cls){const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;}
function notify(text){$('#message').textContent=text;}
function viewSettings(){return {search:$('#search').value,status:$('#status').value,kindGroup:$('#kind-group').value,kind:$('#kind').value,collection,browser:$('#library-browser').value,hideOther:$('#hide-other').checked,showLinked:$('#show-linked').checked};}
function rememberView(){updatePreferences('library',viewSettings()).catch(e=>notify('설정 저장 실패: '+e.message));}
function applyViewSettings(p){collection=p.collection;$('#search').value=p.search;$('#status').value=p.status;$('#kind-group').value=p.kindGroup;fillKindDetails($('#kind'),$('#kind-group').value);$('#kind').value=p.kind;$('#library-browser').value=p.browser;$('#hide-other').checked=p.hideOther;$('#show-linked').checked=p.showLinked;}
function render(){
  const groups=combineLibraryRecords(records,combined.sources,{clientId:combined.clientId,browser}),shownGroups=combineLibraryRecords(records,combined.sources,{clientId:combined.clientId,browser,showLinked:$('#show-linked').checked});
  $('#total').textContent=groups.length;$('#reading').textContent=groups.filter(g=>g.variants.some(v=>v.record.status==='reading')).length;$('#done').textContent=groups.filter(g=>g.variants.some(v=>v.record.status==='done')).length;
  const collections=[...new Set(shownGroups.flatMap(g=>g.variants.map(v=>v.record.collection)).filter(Boolean))].sort();
  $('#all').classList.toggle('active',!collection);$('#collections').replaceChildren();
  for(const name of collections){const btn=element('button',name,'nav'+(collection===name?' active':''));btn.onclick=()=>{collection=name;rememberView();render();};$('#collections').append(btn);}
  const matched=filterLibraryGroups(shownGroups,viewSettings());visible=matched.flatMap(g=>g.variants.filter(v=>v.source.local).map(v=>v.record));displayed=matched.map(g=>(g.variants.find(v=>v.source.local) || g.variants[0]).record);
  $('#count').textContent=`${collection || '전체 자료'} · ${matched.length}개${combined.parent?' · 현재 브라우저·폴더 함께 보기':''}`;$('#records').replaceChildren();
  if(!matched.length){const empty=element('div','','empty');empty.append(element('div','▤','empty-symbol'),element('h2',groups.length?'조건에 맞는 자료가 없습니다':'첫 번째 자료를 모아보세요'),element('p',groups.length?'검색어나 필터를 바꿔보세요.':'웹페이지에서 확장 아이콘을 눌러 저장하거나, 자료 추가로 PDF와 메모를 등록하세요.'));$('#records').append(empty);}
  for(const group of matched){const local=group.variants.find(v=>v.source.local),external=group.variants.filter(v=>!v.source.local);if(!local){const card=element('article','','card combined-card');card.append(element('h3',external[0].record.title,'title-button'));for(const v of external)appendFolderVariant(card,v,combined.parent,notify);$('#records').append(card);continue;}const record=local.record;
    const card=element('article','','card'),icon=element('div',paperKinds.includes(record.kind)?'P':record.kind==='webtool'?'W':'D','document-icon'),body=element('div','','card-body'),title=element('button',record.title,'title-button');title.onclick=()=>edit(record);
    body.append(element('span',`${browser} · 현재 브라우저 · ${kindPath(record.kind)}${record.collection?' / '+record.collection:''}`,'eyebrow'),title,element('p',[record.authors,record.date,record.version,record.venue].filter(Boolean).join(' · ') || '서지정보를 추가해보세요','metadata'));
    const tags=element('div','','tags');for(const tag of record.tags.split(',').map(t=>t.trim()).filter(Boolean))tags.append(element('span',tag,'tag'));body.append(tags);
    if(record.localSource)body.append(element('p','로컬 PDF · '+fileName(record.localSource)+(record.attachment?'':' · 파일 첨부 필요'),'metadata'));
    else if(record.attachment)body.append(element('p','첨부 PDF · '+record.attachment.name,'metadata'));
    body.append(element('p',activityText(record),'metadata'));
    const references=renderReferences(record);if(references){references.addEventListener('click',e=>{if(e.target.closest('a'))recordActivity(record.id,'open',{browser:/Edg\//.test(navigator.userAgent)?'Edge':'Chrome'}).catch(err=>notify(err.message));});body.append(references);}
    const actions=element('div','','card-actions');actions.append(element('span',statuses[record.status],'badge '+record.status));
    for(const [label,url] of [['원문 ↗',record.url],['PDF 링크 ↗',record.pdfUrl]])if(safeUrl(url)){const a=element('a',label);a.href=safeUrl(url);a.target='_blank';a.rel='noopener noreferrer';a.onclick=()=>recordActivity(record.id,'open',{browser:/Edg\//.test(navigator.userAgent)?'Edge':'Chrome'}).catch(e=>notify(e.message));actions.append(a);}
    if(/^10\.\d{4,9}\//i.test(record.doi)){const a=element('a','DOI ↗');a.href='https://doi.org/'+encodeURIComponent(record.doi).replace(/%2F/gi,'/');a.target='_blank';a.rel='noopener noreferrer';a.onclick=()=>recordActivity(record.id,'open',{browser:/Edg\//.test(navigator.userAgent)?'Edge':'Chrome'}).catch(e=>notify(e.message));actions.append(a);}
    const read=element('button','서지정보 찾기','text-button');read.onclick=()=>organizerUI.inspectSaved([record],{explicit:true});actions.append(read);const history=element('button','방문 기록','text-button');history.onclick=()=>activityUI.show(record.id);actions.append(history);
    if(record.pdfUrl){const b=element('button','PDF 정보 찾기','text-button');b.onclick=async()=>{try{await recordActivity(record.id,'lookup',{browser:/Edg\//.test(navigator.userAgent)?'Edge':'Chrome'});await pdfUI.openOnline(record);}catch(e){notify(e.message);}};actions.append(b);}
    if(record.localSource){const b=element('button','로컬 PDF 열기','text-button');b.onclick=async()=>{try{if(!globalThis.chrome?.tabs?.create)throw new Error('Paperdesk 확장 안에서 열어주세요.');await chrome.tabs.create({url:record.localSource});await recordActivity(record.id,'open',{browser:/Edg\//.test(navigator.userAgent)?'Edge':'Chrome'});}catch(e){notify('로컬 PDF 열기 실패: '+e.message);}};actions.append(b);}
    if(record.linkedTo){const target=records.find(r=>r.id===record.linkedTo);body.append(element('p','연결된 PDF 원본 항목','metadata'));if(target){const b=element('button','연결된 자료 보기','text-button');b.onclick=()=>edit(target);actions.append(b);}}
    if(record.attachment){const button=element('button','첨부 PDF 다운로드 ↓','text-button');button.onclick=()=>{openPDF(record);recordActivity(record.id,'open',{browser:/Edg\//.test(navigator.userAgent)?'Edge':'Chrome'}).catch(e=>notify(e.message));};actions.append(button);}
    card.append(icon,body,actions);$('#records').append(card);if(external.length){card.classList.add('has-folder-variants');const box=element('div','','combined-variants');for(const v of external)appendFolderVariant(box,v,combined.parent,notify);card.append(box);}
  }
}
async function refresh(){records=await all();render();}
function edit(record=null){
  if(working)return;selected=record;form.reset();$('#edit-message').textContent='';$('#editor-title').textContent=record?'자료 편집':'자료 추가';$('#delete').hidden=!record;
  $('#attachment-info').textContent=record?.attachment?`첨부: ${record.attachment.name}`:record?.localSource?'파일 첨부 필요: '+fileName(record.localSource):'첨부된 PDF가 없습니다.';
  for(const key of ['title','authors','date','doi','url','pdfUrl','collection','tags','notes','version','accessed','kind','status','venue'])if(record)form.elements.namedItem(key).value=record[key] || '';
  if(!record){form.elements.namedItem('kind').value='paper';form.elements.namedItem('accessed').value=new Date().toISOString().slice(0,10);form.elements.namedItem('collection').value=collection;}
  $('#usage-info').textContent=record?activityText(record):'';dialog.showModal();
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function openPDF(record){try{const b64=record.attachment.data.split(',')[1],bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));download(new Blob([bytes],{type:'application/pdf'}),record.attachment.name);}catch(e){notify('PDF 열기 실패: '+e.message);}}
function busy(value){working=value;for(const el of form.elements)el.disabled=value;}
form.onsubmit=async e=>{e.preventDefault();if(working)return;
  const raw={...selected,...Object.fromEntries(new FormData(form))},file=$('#pdf').files[0],detach=$('#detach').checked;busy(true);
  try{let record=normalize(raw);if(selected?.attachment && !detach)record.attachment=selected.attachment;
    let parsed;
    if(file){parsed=await attachmentFromFile(file);const proposal=pdfProposal(await all(),parsed.metadata,parsed.attachment,{sourceId:selected?.id});record=enrichRecord(record,proposal.record,parsed.attachment);record.attachment=parsed.attachment;}
    const conflict=duplicate(await all(),record);
    if(conflict && parsed){dialog.close();await pdfUI.inspect([file],{sourceId:selected?.id,draft:record});notify('대응 자료를 확인하고 PDF를 연결해주세요.');return;}
    const savedConflict=await save(record);if(savedConflict)throw new Error(`같은 DOI 또는 URL의 자료가 있습니다: ${savedConflict.title}`);dialog.close();await refresh();notify('자료를 저장했습니다.');}catch(e){$('#edit-message').textContent=e.message;}finally{busy(false);}
};
$('#close').onclick=()=>{if(!working)dialog.close();};dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});
$('#delete').onclick=async()=>{if(!selected || working || !confirm('이 자료와 첨부 PDF를 삭제할까요?'))return;busy(true);try{await remove(selected.id);dialog.close();await refresh();notify('자료를 삭제했습니다.');}catch(e){$('#edit-message').textContent=e.message;}finally{busy(false);}};
$('#new').onclick=()=>edit();$('#all').onclick=()=>{collection='';rememberView();render();};for(const id of ['search','status','kind','show-linked','hide-other','library-browser'])$('#'+id).addEventListener('input',()=>{rememberView();render();});
$('#bibtex').onclick=()=>download(new Blob([bibtex(displayed)],{type:'application/x-bibtex;charset=utf-8'}),'paperdesk.bib');
$('#backup').onclick=async()=>{const btn=$('#backup');btn.disabled=true;try{const current=await all();download(new Blob([JSON.stringify({format:'paperdesk',version:1,exported:new Date().toISOString(),records:current})],{type:'application/json'}),`paperdesk-${new Date().toISOString().slice(0,10)}.json`);notify('PDF를 포함한 전체 백업 파일을 만들었습니다.');}catch(e){notify('백업 실패: '+e.message);}finally{btn.disabled=false;}};
$('#restore').onclick=()=>$('#backup-file').click();$('#backup-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;$('#restore').disabled=true;try{if(file.size>250*1024*1024)throw new Error('250 MB 이하의 백업만 가져올 수 있습니다.');const imported=parseBackup(await file.text());for(const r of imported)if(r.attachment){const bytes=atob(r.attachment.data.split(',')[1]);if(!bytes.startsWith('%PDF-') || bytes.length>50*1024*1024)throw new Error('첨부 PDF 형식 또는 크기가 올바르지 않습니다.');}const count=await merge(imported);await refresh();notify(`${count}개를 가져왔습니다. 기존 ID·DOI·URL과 중복된 자료는 건너뛰었습니다.`);}catch(e){notify('가져오기 실패: '+e.message);}finally{e.target.value='';$('#restore').disabled=false;}};
window.addEventListener('focus',()=>{refresh().catch(e=>notify(e.message));});
fillKindGroups($('#kind-group'));fillKindDetails($('#kind'));$('#kind-group').onchange=()=>{fillKindDetails($('#kind'),$('#kind-group').value);rememberView();render();};fillKinds(form.elements.namedItem('kind'));
applyViewSettings(await loadPreferences('library'));
pdfUI=setupPDFUI(refresh);setupSavedTabs(refresh);
await refresh().catch(e=>notify('라이브러리를 열 수 없습니다: '+e.message));
organizerUI=await setupOrganizer(refresh,()=>visible);activityUI=await setupActivityUI();
const changes=new BroadcastChannel('paperdesk-changes');changes.onmessage=()=>refresh().catch(e=>notify(e.message));window.addEventListener('pagehide',()=>changes.close(),{once:true});
await configureFolderUI().catch(e=>notify('폴더 설정을 열 수 없습니다: '+e.message));
$('#reset-settings').onclick=async()=>{const button=$('#reset-settings');button.disabled=true;try{await resetPreferences();await setTrackingEnabled(false);await folderUI?.reset();applyViewSettings(preferenceDefaults('library'));organizerUI.reset();activityUI.reset();render();notify('설정을 초기화했습니다. 저장 자료·메모·PDF·방문 기록은 유지됩니다.');}catch(e){notify('설정 초기화 실패: '+e.message);}finally{button.disabled=false;}};
if(location.hash==='#organize')$('#scan-tabs').focus();
