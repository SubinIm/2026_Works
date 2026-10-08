import http from 'node:http';import {readFile} from 'node:fs/promises';
const root=new URL('../dist/',import.meta.url);
const demo=`import {all,save} from './db.js';import {normalize} from './model.js';
if(!localStorage.getItem('misc-052-seeded')){
const fixtures=[
 {id:'parts119',title:'파츠119 - 수입차부품 74만개 | 차대번호로 내차 부품 바로 확인',url:'https://www.parts119.com/?go=pncar&v=fixture',kind:'document',collection:'분류 검토',notes:'보존할 정비 메모',status:'reading'},
 {id:'bmw',title:'BMW 320d F30 motor parts',url:'https://www.realoem.com/bmw/enUS/select',collection:'추진·모터',tags:'추진·모터, 개인정비',notes:'보존할 개인 메모',status:'done',version:'F30',attachment:{name:'parts.pdf',data:'data:application/pdf;base64,JVBERi0='}},
 {id:'shopping',title:'Windshield motor for BMW 320d — eBay',url:'https://www.ebay.com/itm/123',collection:'GIS·환경',tags:'GIS·환경'},
 {id:'paper',title:'A study of BMW 320d engine emissions',url:'https://example.org/paper',doi:'10.1234/example',authors:'Example Author',venue:'Engine Research',kind:'journal',collection:'추진·모터'},
 {id:'safety',title:'Reachability and safety filters for UAM',url:'https://arxiv.org/abs/2507.07805',kind:'preprint',collection:'안전제어·도달가능성'},
 {id:'windy',title:'Windy weather',url:'https://www.windy.com',kind:'webtool',collection:'GIS·환경'}
];for(const record of fixtures){const normalized=normalize(record);if(record.attachment)normalized.attachment=record.attachment;await save(normalized);}localStorage.setItem('misc-052-seeded','yes');}
const library=await import('./library.js');
const {MemoryDirectory}=await import('./memory-folder.js'),{writeFolder}=await import('./folder-store.js');
const parent=new MemoryDirectory('예시 공유 폴더'),rows=(await all()).map(({attachment,...r})=>r);
await writeFolder(parent,rows,{clientId:'edge-misc-fixture',browser:'Edge'});
await writeFolder(parent,rows.filter(r=>['bmw','paper'].includes(r.id)).map(r=>({...r,notes:'Chrome 예시 메모'})),{clientId:'chrome-misc-fixture',browser:'Chrome'});
let settings={clientId:'edge-misc-fixture',handle:parent,auto:false};
await library.configureFolderUI({supported:true,settings:{load:async()=>settings,save:async next=>{settings=next;}}});
document.querySelector('#demo-state').onclick=async()=>{const rows=await all(),r=rows.find(x=>x.id==='bmw');document.querySelector('#demo-result').textContent=JSON.stringify({count:rows.length,kind:r.kind,collection:r.collection,tags:r.tags,notes:r.notes,status:r.status,version:r.version,pdf:r.attachment.name});};`;
const server=http.createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"script-src 'self'; object-src 'self'; worker-src 'self'");
 if(path==='/demo.js'){res.setHeader('Content-Type','text/javascript');res.end(demo);return;}
 if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
 if(!/^\/[a-zA-Z0-9_.\/-]+$/.test(path)||path.split('/').includes('..')){res.writeHead(404);res.end();return;}
 let content=await readFile(path==='/memory-folder.js'?new URL('./memory-folder.js',import.meta.url):new URL(path.slice(1),root));
 if(path==='/library.html')content=content.toString('utf8').replace('<body>','<body><div class="demo-notice">Paperdesk 0.5.2 개발 검증 · 예시 자료 · 실제 개인 라이브러리는 변경하지 않습니다. <button id="demo-state" type="button">보존 상태 확인</button><span id="demo-result"></span></div>').replace('src="library.js"','src="demo.js"');
 res.setHeader('Content-Type',path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css':/\.(?:m?js)$/.test(path)?'text/javascript':'application/octet-stream');res.end(content);
 }catch{res.writeHead(404);res.end();}});
server.listen(43877,'127.0.0.1',()=>console.log('Paperdesk misc fixture: http://127.0.0.1:43877/library.html'));
