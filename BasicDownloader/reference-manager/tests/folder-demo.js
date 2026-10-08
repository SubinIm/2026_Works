import {all,save} from './db.js';
import {normalize} from './model.js';
import {writeFolder,listFolder} from './folder-store.js';
import {MemoryDirectory} from './memory-folder.js';
const bytes=await(await fetch('/fixture.pdf')).arrayBuffer(),attachment={name:'review.pdf',data:'data:application/pdf;base64,'+btoa(String.fromCharCode(...new Uint8Array(bytes)))};
if(!localStorage.getItem('v4-seeded')){
 await save({...normalize({id:'edge-shared',title:'Urban airspace risk and safety analysis',doi:'10.1234/paperdesk.fixture',kind:'journal',venue:'Example Safety Journal',notes:'Edge 메모: 읽기 완료, 모델 적용 검토',status:'done'}),attachment});
 await save(normalize({id:'edge-conference',title:'UAM Conference 2026',url:'https://example.org/conference',kind:'conference',notes:'Edge에서 수집한 학술대회'}));localStorage.setItem('v4-seeded','yes');
}
const permission={value:'granted'},parent=new MemoryDirectory('예시 공유 폴더',permission);
await writeFolder(parent,[{...normalize({id:'chrome-shared',title:'Urban airspace risk and safety analysis',doi:'10.1234/paperdesk.fixture',kind:'journal',notes:'Chrome 메모: 먼저 방법론을 확인',status:'reading'}),attachment},normalize({id:'chrome-tool',title:'Windy: Wind forecast',url:'https://windy.com/?wind',kind:'webtool',collection:'GIS·환경'})],{clientId:'chrome-ui-fixture',browser:'Chrome',now:new Date('2026-10-07T08:00:00Z')});
let value={clientId:'edge-ui-fixture',handle:null,auto:false};
const library=await import('./library.js');
await library.configureFolderUI({supported:true,picker:async()=>{if(document.querySelector('#demo-cancel').checked)throw new DOMException('Cancelled','AbortError');return parent;},settings:{load:async()=>value,save:async next=>{value=next;}}});
document.querySelector('#demo-folder-permission').onchange=e=>{permission.value=e.target.checked?'granted':'denied';};
document.querySelector('#demo-count-snapshots').onclick=async()=>{document.querySelector('#demo-snapshots').textContent='예시 저장본: '+(await listFolder(parent)).length+'개 브라우저·설치';};
document.querySelector('#demo-verify-state').onclick=async()=>{const records=await all();document.querySelector('#demo-db-state').textContent='Edge 예시 DB: '+records.length+'개 · '+records.find(r=>r.id==='edge-shared')?.notes;};
