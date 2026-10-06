import { all, save, remove, merge } from './db.js';
import { normalize, bibtex, parseBackup, safeUrl } from './model.js';
const $=s=>document.querySelector(s), form=$('#edit'), dialog=$('#editor');
let records=[], selected=null, collection='', visible=[], working=false;
const statuses={unread:'읽기 전',reading:'읽는 중',done:'완료'};
function element(tag,text,cls){const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;}
function notify(text){$('#message').textContent=text;}
function render(){
  $('#total').textContent=records.length;$('#reading').textContent=records.filter(r=>r.status==='reading').length;$('#done').textContent=records.filter(r=>r.status==='done').length;
  const collections=[...new Set(records.map(r=>r.collection).filter(Boolean))].sort();
  if(collection && !collections.includes(collection)) collection='';
  $('#all').classList.toggle('active',!collection);$('#collections').replaceChildren();
  for(const name of collections){const btn=element('button',name,'nav'+(collection===name?' active':''));btn.onclick=()=>{collection=name;render();};$('#collections').append(btn);}
  const query=$('#search').value.toLowerCase().trim();
  visible=records.filter(r=>(!collection || r.collection===collection) && (!$('#status').value || r.status===$('#status').value) && (!$('#kind').value || r.kind===$('#kind').value) && [r.title,r.authors,r.doi,r.tags,r.notes,r.version,r.url,r.collection].join(' ').toLowerCase().includes(query)).sort((a,b)=>b.created-a.created);
  $('#count').textContent=`${collection || '전체 자료'} · ${visible.length}개`;$('#records').replaceChildren();
  if(!visible.length){const empty=element('div','','empty');empty.append(element('div','▤','empty-symbol'),element('h2',records.length?'조건에 맞는 자료가 없습니다':'첫 번째 자료를 모아보세요'),element('p',records.length?'검색어나 필터를 바꿔보세요.':'웹페이지에서 확장 아이콘을 눌러 저장하거나, 자료 추가로 PDF와 메모를 등록하세요.'));$('#records').append(empty);}
  for(const record of visible){
    const card=element('article','','card'),icon=element('div',record.kind==='paper'?'P':'D','document-icon'),body=element('div','','card-body'),title=element('button',record.title,'title-button');title.onclick=()=>edit(record);
    body.append(element('span',`${record.kind==='paper'?'논문':'기술문서'}${record.collection?' / '+record.collection:''}`,'eyebrow'),title,element('p',[record.authors,record.date,record.version].filter(Boolean).join(' · ') || '서지정보를 추가해보세요','metadata'));
    const tags=element('div','','tags');for(const tag of record.tags.split(',').map(t=>t.trim()).filter(Boolean))tags.append(element('span',tag,'tag'));body.append(tags);
    const actions=element('div','','card-actions');actions.append(element('span',statuses[record.status],'badge '+record.status));
    for(const [label,url] of [['원문 ↗',record.url],['PDF 링크 ↗',record.pdfUrl]])if(safeUrl(url)){const a=element('a',label);a.href=safeUrl(url);a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}
    if(record.attachment){const button=element('button','첨부 PDF 다운로드 ↓','text-button');button.onclick=()=>openPDF(record);actions.append(button);}
    card.append(icon,body,actions);$('#records').append(card);
  }
}
async function refresh(){records=await all();render();}
function edit(record=null){
  if(working)return;selected=record;form.reset();$('#edit-message').textContent='';$('#editor-title').textContent=record?'자료 편집':'자료 추가';$('#delete').hidden=!record;
  $('#attachment-info').textContent=record?.attachment?`첨부: ${record.attachment.name}`:'첨부된 PDF가 없습니다.';
  for(const key of ['title','authors','date','doi','url','pdfUrl','collection','tags','notes','version','accessed','kind','status'])if(record)form.elements.namedItem(key).value=record[key] || '';
  if(!record){form.elements.namedItem('accessed').value=new Date().toISOString().slice(0,10);form.elements.namedItem('collection').value=collection;}
  dialog.showModal();
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function toDataURL(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});}
async function pdfFile(file){if(file.size>50*1024*1024)throw new Error('PDF는 50 MB 이하로 첨부해주세요.');if(!(await file.slice(0,5).text()).startsWith('%PDF-'))throw new Error('올바른 PDF 파일이 아닙니다.');return {name:file.name,data:await toDataURL(new Blob([file],{type:'application/pdf'}))};}
function openPDF(record){try{const b64=record.attachment.data.split(',')[1],bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));download(new Blob([bytes],{type:'application/pdf'}),record.attachment.name);}catch(e){notify('PDF 열기 실패: '+e.message);}}
function busy(value){working=value;for(const el of form.elements)el.disabled=value;}
form.onsubmit=async e=>{e.preventDefault();if(working)return;
  const raw={...selected,...Object.fromEntries(new FormData(form))},file=$('#pdf').files[0],detach=$('#detach').checked;busy(true);
  try{const record=normalize(raw);if(selected?.attachment && !detach)record.attachment=selected.attachment;if(file)record.attachment=await pdfFile(file);const conflict=await save(record);if(conflict)throw new Error(`같은 DOI 또는 URL의 자료가 있습니다: ${conflict.title}`);dialog.close();await refresh();notify('자료를 저장했습니다.');}catch(e){$('#edit-message').textContent=e.message;}finally{busy(false);}
};
$('#close').onclick=()=>{if(!working)dialog.close();};dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});
$('#delete').onclick=async()=>{if(!selected || working || !confirm('이 자료와 첨부 PDF를 삭제할까요?'))return;busy(true);try{await remove(selected.id);dialog.close();await refresh();notify('자료를 삭제했습니다.');}catch(e){$('#edit-message').textContent=e.message;}finally{busy(false);}};
$('#new').onclick=()=>edit();$('#all').onclick=()=>{collection='';render();};for(const id of ['search','status','kind'])$('#'+id).addEventListener('input',render);
$('#bibtex').onclick=()=>download(new Blob([bibtex(visible)],{type:'application/x-bibtex;charset=utf-8'}),'paperdesk.bib');
$('#backup').onclick=async()=>{const btn=$('#backup');btn.disabled=true;try{const current=await all();download(new Blob([JSON.stringify({format:'paperdesk',version:1,exported:new Date().toISOString(),records:current})],{type:'application/json'}),`paperdesk-${new Date().toISOString().slice(0,10)}.json`);notify('PDF를 포함한 전체 백업 파일을 만들었습니다.');}catch(e){notify('백업 실패: '+e.message);}finally{btn.disabled=false;}};
$('#restore').onclick=()=>$('#backup-file').click();$('#backup-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;$('#restore').disabled=true;try{if(file.size>250*1024*1024)throw new Error('250 MB 이하의 백업만 가져올 수 있습니다.');const imported=parseBackup(await file.text());for(const r of imported)if(r.attachment){const bytes=atob(r.attachment.data.split(',')[1]);if(!bytes.startsWith('%PDF-') || bytes.length>50*1024*1024)throw new Error('첨부 PDF 형식 또는 크기가 올바르지 않습니다.');}const count=await merge(imported);await refresh();notify(`${count}개를 가져왔습니다. 기존 ID·DOI·URL과 중복된 자료는 건너뛰었습니다.`);}catch(e){notify('가져오기 실패: '+e.message);}finally{e.target.value='';$('#restore').disabled=false;}};
window.addEventListener('focus',()=>{refresh().catch(e=>notify(e.message));});
await refresh().catch(e=>notify('라이브러리를 열 수 없습니다: '+e.message));
