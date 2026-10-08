import { all, applyPDFs } from './db.js';
import { normalize } from './model.js';
import { fillKinds } from './taxonomy.js';
import { usefulTitle, pdfProposal } from './pdf-matching.js';
import { attachmentFromFile, fetchPDF, safePdfRequest } from './pdf-reader.js';

export function setupPDFUI(onSaved){
 const $=s=>document.querySelector(s),dialog=$('#pdf-review'),form=$('#pdf-review-form');let items=[],records=[],working=false;
 const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text || '';return el;};
 const count=()=>$('#apply-pdfs').textContent=`선택 ${items.filter(i=>i.selected).length}개 PDF 연결`;
 function busy(value){working=value;for(const c of form.elements)c.disabled=value;$('#match-pdfs').disabled=value;}
 function render(){
  $('#pdf-review-items').replaceChildren();
  for(const [index,item] of items.entries()){
   const row=node('fieldset');row.className='organize-item';row.append(node('legend',item.attachment.name));
   const pick=node('input');pick.type='checkbox';pick.name=`pdf-pick-${index}`;pick.checked=item.selected;pick.onchange=()=>{item.selected=pick.checked;count();};const label=node('label');label.className='check';label.append(pick,node('span','이 PDF 연결'));row.append(label);
   const targetLabel=node('label','연결할 자료'),target=node('select');target.name=`pdf-target-${index}`;const fresh=node('option','새 자료로 저장');fresh.value='';target.append(fresh);
   for(const r of records.filter(r=>!r.linkedTo)){const option=node('option',r.title);option.value=r.id;target.append(option);}target.value=item.targetId;target.onchange=()=>{item.targetId=target.value;item.before=records.find(r=>r.id===target.value)?.updated;};targetLabel.append(target);row.append(targetLabel);
   for(const [key,text] of [['title','추출된 제목'],['doi','DOI'],['authors','저자'],['date','발행일'],['venue','저널·학술대회명'],['collection','컬렉션'],['tags','태그']]){const lab=node('label',text),input=node('input');input.name=`pdf-${key}-${index}`;input.value=item.record[key];input.maxLength=10000;input.oninput=()=>item.record[key]=input.value;lab.append(input);row.append(lab);}
   const kindLabel=node('label','자료 종류'),kind=node('select');kind.name=`pdf-kind-${index}`;fillKinds(kind);kind.value=item.record.kind;kind.onchange=()=>item.record.kind=kind.value;kindLabel.append(kind);row.append(kindLabel);
   const reason=node('p',item.reason+(item.doiCandidates.length>1?' · 여러 DOI가 발견됐습니다: '+item.doiCandidates.join(', '):''));reason.className='metadata';row.append(reason);$('#pdf-review-items').append(row);
  }
  count();$('#pdf-review-message').textContent='기존 메모·읽기 상태·첨부는 유지합니다. 대응 원본 PDF 항목은 연결 표시로 남겨 정보를 보존합니다.';
 }
 async function inspect(files,context={}){
  if(working)return;busy(true);items=[];const errors=[];
  try{records=await all();for(const file of files){$('#message').textContent=`PDF 분석 중: ${file.name}`;try{const parsed=await attachmentFromFile(file),proposal=pdfProposal(records,parsed.metadata,parsed.attachment,context);if(context.draft){for(const key of ['title','authors','date','doi','venue','kind','notes','status'])if(context.draft[key] && (key!=='title' || usefulTitle(context.draft.title) && !/^((?:figure|fig\.?|table|그림|표)\s*\d+)\s*[|｜]/i.test(context.draft.title)))proposal.record[key]=context.draft[key];if(context.draft.collection && context.draft.collection!=='분류 검토')proposal.record.collection=context.draft.collection;proposal.record.tags=[proposal.record.tags,context.draft.tags].filter(Boolean).join(', ');}items.push(proposal);}catch(e){errors.push(file.name+': '+e.message);}}
   if(items.length){render();if(errors.length)$('#pdf-review-message').textContent+=' 분석 실패: '+errors.join(' / ');dialog.showModal();}else $('#message').textContent=errors.join(' / ') || '선택한 PDF가 없습니다.';
  }finally{busy(false);}
 }
 $('#match-pdfs').onclick=()=>{if(!working)$('#pdf-match-files').click();};
 $('#revoke-pdf-sites').onclick=async()=>{if(working)return;try{if(!globalThis.chrome?.permissions?.getAll)throw new Error('Chrome 확장 안에서 사용할 수 있습니다.');const {origins=[]}=await chrome.permissions.getAll();const sites=origins.filter(o=>/^https?:\/\//.test(o));if(sites.length && !await chrome.permissions.remove({origins:sites}))throw new Error('사이트 접근을 해제하지 못했습니다.');$('#message').textContent='문서·PDF 사이트 접근을 해제했습니다. 다시 서지정보를 읽을 때 해당 사이트 권한을 요청합니다.';}catch(e){$('#message').textContent=e.message;}};
 $('#pdf-match-files').onchange=async e=>{const files=[...e.target.files];e.target.value='';await inspect(files);};
 $('#pdf-review-close').onclick=()=>{if(!working)dialog.close();};dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});
 form.onsubmit=async e=>{e.preventDefault();if(working)return;const selected=items.filter(i=>i.selected);if(!selected.length){$('#pdf-review-message').textContent='연결할 PDF를 선택해주세요.';return;}busy(true);
  try{const plans=selected.map(i=>({...i,record:normalize(i.record)}));const result=await applyPDFs(plans);dialog.close();await onSaved();$('#message').textContent=`PDF ${result.linked}개를 기존 자료에 연결하고 ${result.added}개를 새로 저장했습니다. ${result.retained}개 기존 첨부 유지 · ${result.skipped}개 변경된 자료 건너뜀.`;}catch(e){$('#pdf-review-message').textContent=e.message;}finally{busy(false);}
 };
 async function openOnline(record){
  if(working)return;
  if(record.attachment){try{const bytes=Uint8Array.from(atob(record.attachment.data.split(',')[1]),c=>c.charCodeAt(0));await inspect([new File([bytes],record.attachment.name,{type:'application/pdf'})],{sourceId:record.id,pdfUrl:record.pdfUrl,localSource:record.localSource});}catch(e){$('#message').textContent='로컬 PDF 분석 실패: '+e.message;}return;}
  try{const url=safePdfRequest(record.pdfUrl || record.url);if(!globalThis.chrome?.permissions?.request)throw new Error('온라인 PDF 분석은 Chrome 확장 안에서 사용할 수 있습니다.');
   const permission=chrome.permissions.request({origins:[url.origin+'/*']});if(!await permission)throw new Error('해당 사이트 접근을 허용하지 않았습니다. PDF 파일 선택은 계속 사용할 수 있습니다.');
   const file=await fetchPDF(url.href);await inspect([file],{sourceId:record.id,pdfUrl:url.href,localSource:record.localSource});
  }catch(e){$('#message').textContent='PDF 분석 실패: '+e.message;}
 }
 return {openOnline,inspect};
}
