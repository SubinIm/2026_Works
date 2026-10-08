import { all, get } from './db.js';
import { planSavedTabs, closeSavedTabs } from './saved-tabs.js';
export function setupSavedTabs(onSaved){
 const $=s=>document.querySelector(s),dialog=$('#saved-tabs'),form=$('#saved-tabs-form');let items=[],working=false;
 const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text || '';return e;};
 const count=()=>$('#close-selected-tabs').textContent=`선택 ${items.filter(i=>i.selected).length}개 탭 닫기`;
 function busy(value){working=value;for(const c of form.elements)c.disabled=value;$('#review-saved-tabs').disabled=value;}
 $('#review-saved-tabs').onclick=async()=>{
  if(working)return;if(!globalThis.chrome?.permissions?.request){$('#message').textContent='저장된 탭 닫기는 Chrome 확장 안에서 사용할 수 있습니다.';return;}
  try{const permission=chrome.permissions.request({permissions:['tabs']});busy(true);if(!await permission){$('#message').textContent='탭 접근을 허용해야 저장된 탭을 찾을 수 있습니다.';return;}
   items=planSavedTabs(await chrome.tabs.query({}),await all());$('#saved-tabs-items').replaceChildren();
   for(const item of items){const label=node('label'),check=node('input');label.className='check saved-tab-item';check.type='checkbox';check.checked=item.selected;check.name=`tab-${item.tabId}`;check.onchange=()=>{item.selected=check.checked;count();};label.append(check,node('span',item.title));$('#saved-tabs-items').append(label);}
   $('#saved-tabs-message').textContent=items.length?'닫기 직전 주소와 저장 여부를 다시 확인합니다. 고정·시크릿·재생 중인 탭은 닫지 않습니다. 닫은 탭은 Chrome의 Ctrl+Shift+T로 복원할 수 있습니다.':'저장된 자료에 대응하는 열린 탭이 없습니다.';count();dialog.showModal();
  }catch(e){$('#message').textContent='저장된 탭 확인 실패: '+e.message;}finally{busy(false);}
 };
 $('#saved-tabs-close').onclick=()=>{if(!working)dialog.close();};dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});
 form.onsubmit=async e=>{e.preventDefault();if(working)return;if(!items.some(i=>i.selected)){$('#saved-tabs-message').textContent='닫을 탭을 선택해주세요.';return;}busy(true);
  try{const readRecords=async id=>{const record=await get(id);if(!record)return [];const target=record.linkedTo?await get(record.linkedTo):null;return [record,target].filter(Boolean);};const result=await closeSavedTabs(items,{tabs:chrome.tabs,readRecords});dialog.close();await onSaved();$('#message').textContent=`${result.closed}개 저장된 탭을 닫았습니다. ${result.skipped}개 변경·미저장·보호 탭은 유지했고 ${result.failed}개는 이미 닫혔거나 처리하지 못했습니다.`;}catch(e){$('#saved-tabs-message').textContent=e.message;}finally{busy(false);}
 };
}
