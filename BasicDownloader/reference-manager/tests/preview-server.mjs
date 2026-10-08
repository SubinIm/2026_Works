import http from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {makePDF} from './pdf-fixture.js';
const root=new URL('../dist/',import.meta.url);
const fixtures=[
 {id:1,title:'Airspace Geofencing Volume Sizing | IEEE Conference Publication | IEEE Xplore',url:'https://ieeexplore.ieee.org/abstract/document/9925807'},
 {id:2,title:'IEEE Xplore Full-Text PDF:',url:'https://ieeexplore.ieee.org/stamp/stamp.jsp?arnumber=9925807&tag=1'},
 {id:3,title:'Risk-informed UAV operations in urban low-altitude airspace - ScienceDirect',url:'https://www.sciencedirect.com/science/article/pii/S0967070X26002921'},
 {id:4,title:'MOC SC VTOL Issue 2',url:'https://www.easa.europa.eu/sites/default/files/dfu/moc_sc_vtol_issue_2.pdf'},
 {id:5,title:'review.pdf',url:'file:///C:/Example/review.pdf'},
 {id:6,title:'Google 검색',url:'https://www.google.com/search?q=utm'},
 {id:7,title:'연구 채팅',url:'https://uniai.unist.ac.kr/chat/example'},
 {id:8,title:'Windy: Wind forecast',url:'https://www.windy.com/?wind'}
];
await writeFile(new URL('../review.pdf',import.meta.url),makePDF());
const demo=`import {all,save} from './db.js';import {normalize} from './model.js';
if(!localStorage.getItem('v3-seeded')){await save(normalize({id:'seed-primary',title:'Urban airspace risk and safety analysis',doi:'10.1234/paperdesk.fixture',url:'https://example.org/research',notes:'Keep research notes',version:'Issue 2',status:'done',kind:'paper'}));await save(normalize({id:'seed-source',title:'review.pdf',localSource:'file:///C:/Example/review.pdf',collection:'분류 검토',notes:'Keep source note',kind:'paper'}));localStorage.setItem('v3-seeded','yes');}
let fixtureTabs=${JSON.stringify(fixtures)},closed=[];
globalThis.chrome={permissions:{request:async()=>document.querySelector('#demo-permission').checked,remove:async()=>true},tabs:{query:async()=>fixtureTabs,get:async id=>{const t=fixtureTabs.find(t=>t.id===id);if(!t)throw Error('Closed');return t;},remove:async id=>{fixtureTabs=fixtureTabs.filter(t=>t.id!==id);closed.push(id);document.querySelector('#demo-closed').textContent='닫기 API 검증: '+closed.length+'개 예시 탭 닫힘';},create:async()=>({})}};
const library=await import('./library.js');document.querySelector('#demo-pdf').onclick=async()=>{const bytes=await(await fetch('/fixture.pdf')).arrayBuffer();await library.inspectFiles([new File([bytes],'review.pdf',{type:'application/pdf'})]);};`;
const server=http.createServer(async(req,res)=>{
 try{const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"script-src 'self'; object-src 'self'; worker-src 'self'");
  if(path==='/demo.js'){res.setHeader('Content-Type','text/javascript');res.end(demo);return;}
  if(path==='/fixture.pdf'){res.setHeader('Content-Type','application/pdf');res.end(makePDF());return;}
  if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(!/^\/[a-zA-Z0-9_.\/-]+$/.test(path) || path.split('/').includes('..')){res.writeHead(404);res.end();return;}
  let content=await readFile(new URL(path.slice(1),root));
  if(path==='/library.html')content=content.toString('utf8').replace('<body>','<body><div class="demo-notice">개발 검증 화면 · 예시 8개 탭 · 실제 Chrome 탭과 라이브러리는 바꾸지 않습니다. <label class="check"><input id="demo-permission" type="checkbox" checked>테스트: 탭 접근 허용</label><span id="demo-closed">닫기 API 검증: 0개 예시 탭 닫힘</span><button id="demo-pdf" type="button">예시 PDF 분석 검증</button></div>').replace('src="library.js"','src="demo.js"');
  res.setHeader('Content-Type',path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css':['.js','.mjs'].some(ext=>path.endsWith(ext))?'text/javascript':'application/octet-stream');res.end(content);
 }catch{res.writeHead(404);res.end();}
});
server.listen(43874,'127.0.0.1',()=>console.log('Paperdesk 0.3 test UI: http://127.0.0.1:43874/library.html'));
