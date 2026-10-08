import {get} from './db.js';import {activityText,normalizeActivity,actionLabels} from './activity.js';import {trackingEnabled,setTrackingEnabled} from './tracking-settings.js';
export async function setupActivityUI(){
 const $=s=>document.querySelector(s),toggle=$('#track-visits'),dialog=$('#activity-dialog');
 toggle.checked=await trackingEnabled() && !!await globalThis.chrome?.permissions?.contains({permissions:['tabs']});
 const status=()=>$('#tracking-status').textContent=toggle.checked?'저장 문서가 활성화되거나 로드되면 방문을 기록합니다.':'Paperdesk에서 문서 열기·서지 조회는 기록합니다. 자동 기록을 켜면 브라우저에서 다시 방문한 저장 문서도 기록합니다.';status();
 toggle.onchange=async()=>{const value=toggle.checked;try{const permission=value?globalThis.chrome?.permissions?.request({permissions:['tabs']}):Promise.resolve(true);toggle.disabled=true;if(value && !await permission)throw Error('탭 접근이 필요합니다.');await setTrackingEnabled(value);status();}catch(e){toggle.checked=await trackingEnabled();$('#tracking-status').textContent='기록 설정 실패: '+e.message;}finally{toggle.disabled=false;}};
 const removed=p=>{if(p.permissions?.includes('tabs')){toggle.checked=false;status();}};globalThis.chrome?.permissions?.onRemoved?.addListener(removed);window.addEventListener('pagehide',()=>globalThis.chrome?.permissions?.onRemoved?.removeListener?.(removed),{once:true});
 $('#activity-close').onclick=()=>dialog.close();
 async function show(id){try{const record=await get(id);if(!record)throw Error('자료가 삭제되었습니다.');const a=normalizeActivity(record.activity);$('#activity-title').textContent=record.title+' · 방문 기록';$('#activity-summary').textContent=activityText(record);$('#activity-fingerprint').textContent=a.fingerprint?'문서 지문 SHA-256 · '+a.fingerprint:'기록이 생기면 DOI·주소를 기준으로 문서 지문을 생성합니다.';$('#activity-events').replaceChildren();for(const e of [...a.recent].reverse()){const row=document.createElement('p');row.textContent=`${new Date(e.at).toLocaleString()} · ${e.browser} · ${actionLabels[e.action]}`;$('#activity-events').append(row);}if(!a.recent.length)$('#activity-events').textContent='아직 기록된 동작이 없습니다.';dialog.showModal();}catch(e){$('#message').textContent=e.message;}}
 return {show,reset:()=>{toggle.checked=false;status();}};
}
