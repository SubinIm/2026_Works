import http from 'node:http';import {readFile} from 'node:fs/promises';import {makePDF} from './pdf-fixture.js';
const root=new URL('../dist/',import.meta.url),port=43879,name='Sun_2016_Meas._Sci._Technol._27_085008.pdf';
const demo=`import {all,save,get} from './db.js';import {normalize} from './model.js';
const file=await(await fetch('/fixture.pdf')).arrayBuffer(),attachment={name:'${name}',data:'data:application/pdf;base64,'+btoa(String.fromCharCode(...new Uint8Array(file)))};
if(!localStorage.getItem('local-v61-seeded')){for(const row of [
 {id:'local-pdf',title:'${name}',kind:'paper',url:'https://example.org/paper',notes:'보존할 연구 메모',status:'done',attachment},
 {id:'figure',title:'Figure 6 | Flight Path Error Estimation and Management Strategy for Four-Dimensional Trajectory',url:'http://127.0.0.1:${port}/figure.html#fig6',kind:'paper',notes:'보존할 대목 메모'},
 {id:'cults',title:'Red Bull Fastest Camera Drone · STEP File for 3D printing · Cults',url:'https://cults3d.com/en/3d-model/gadget/red-bull-fastest-camera-drone/similar-designs',kind:'webtool',collection:'분류 검토',notes:'CAD 참고 메모'}
]){const record=normalize(row);if(row.attachment)record.attachment=row.attachment;await save(record);}localStorage.setItem('local-v61-seeded','yes');}
const nativeFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(url,options)=>{if(!String(url).startsWith('/') && !String(url).startsWith('http://127.0.0.1:${port}'))throw Error('예시 화면은 외부 사이트에 접속하지 않습니다.');return nativeFetch(url,options);};
let requested=0;const page=()=>new DOMParser().parseFromString('<title>Figure 6 | Flight Path Error Estimation and Management Strategy for Four-Dimensional Trajectory</title><meta name="citation_title" content="Flight Path Error Estimation and Management Strategy for Four-Dimensional Trajectory"><meta name="citation_author" content="Example Researcher"><meta name="citation_journal_title" content="Example Research Journal"><meta name="citation_doi" content="10.1234/figure-demo"><figure id="fig6">Figure 6. Example flight path error distribution.</figure>','text/html');
globalThis.chrome={permissions:{request:async()=>{requested++;document.querySelector('#demo-requests').textContent='예시 사이트 권한 요청 '+requested+'회';return true;},contains:async()=>true,getAll:async()=>({origins:[]}),remove:async()=>true,onRemoved:{addListener:()=>{},removeListener:()=>{}}},tabs:{query:async()=>[{id:6,url:'http://127.0.0.1:${port}/figure.html#fig6'}],get:async()=>({id:6,url:'http://127.0.0.1:${port}/figure.html#fig6'}),create:async()=>({})},scripting:{executeScript:async({func})=>[{result:func(page(),'http://127.0.0.1:${port}/figure.html#fig6')}]}};
await import('./library.js');
document.querySelector('#demo-proof').onclick=async()=>{document.querySelector('#demo-result').textContent=JSON.stringify({requested,total:(await all()).length,local:await get('local-pdf'),figure:await get('figure'),product:await get('cults')},(key,value)=>key==='data'?'PDF bytes preserved':value);};`;
http.createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"script-src 'self'; object-src 'self'; worker-src 'self'");
 if(path==='/demo.js'){res.setHeader('Content-Type','text/javascript');res.end(demo);return;}
 if(path==='/fixture.pdf'){res.setHeader('Content-Type','application/pdf');res.end(makePDF({title:'Local PDF bibliography demonstration',embeddedTitle:name,doi:'10.1234/local-demo',authors:'Example Researcher'}));return;}
 if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
 if(!/^\/[a-zA-Z0-9_.\/-]+$/.test(path)||path.split('/').includes('..')){res.writeHead(404);res.end();return;}
 let body=await readFile(new URL(path.slice(1),root));if(path==='/library.html')body=body.toString('utf8').replace('<body>','<body><p class="demo-notice">Paperdesk 0.6.1 개발 예시 · 생성 PDF·예시 서지정보 · 실제 개인 자료 변경 없음 · <span id="demo-requests">예시 사이트 권한 요청 0회</span><button id="demo-proof" type="button">검증 상태 표시</button><output id="demo-result"></output></p>').replace('src="library.js"','src="demo.js"');
 res.setHeader('Content-Type',path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css':/\.(?:m?js)$/.test(path)?'text/javascript':'application/octet-stream');res.end(body);
 }catch{res.writeHead(404);res.end();}}).listen(port,'127.0.0.1',()=>console.log('Local PDF fixture: http://127.0.0.1:'+port+'/library.html'));
