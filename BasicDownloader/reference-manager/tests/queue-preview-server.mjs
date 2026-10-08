import http from 'node:http';import {readFile} from 'node:fs/promises';import {makePDF} from './pdf-fixture.js';
const root=new URL('../dist/',import.meta.url),port=43880;
const demo=`import {all,save,get} from './db.js';import {normalize} from './model.js';
const bytes=await(await fetch('/fixture.pdf')).arrayBuffer(),attachment={name:'fixture-paper.pdf',data:'data:application/pdf;base64,'+btoa(String.fromCharCode(...new Uint8Array(bytes)))};
if(!localStorage.getItem('queue-v7-seeded')){for(const input of [
 {id:'complete',title:'Already verified conference paper',kind:'conference',authors:'Verified Researcher',date:'2024',notes:'Keep complete note'},
 {id:'doi',title:'DOI-only incomplete research title',kind:'journal',doi:'10.1234/doi-fixture',url:'http://127.0.0.1:${port}/blocked',notes:'Keep DOI note',status:'done'},
 {id:'blocked',title:'Blocked source research title',kind:'paper',url:'http://127.0.0.1:${port}/blocked-other',notes:'Keep blocked note'},
 {id:'local',title:'fixture-paper.pdf',kind:'paper',attachment,url:'http://127.0.0.1:${port}/local-article',notes:'Keep local note'},
 {id:'shopping',title:'BMW 320d parts shopping',kind:'shopping',url:'https://example.org/shop'},
 {id:'wiki',title:'Control theory wiki',kind:'wiki',url:'https://en.wikipedia.org/wiki/Control_theory'}
]){const record=normalize(input);if(input.attachment)record.attachment=input.attachment;await save(record);}localStorage.setItem('queue-v7-seeded','yes');}
const granted=new Set(),requests=[],opened=[],listeners=[],current=new Map();let deny=false,tabId=50;
const nativeFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=async(url,options)=>{
 if(String(url).startsWith('https://api.crossref.org/works/')){const doi=decodeURIComponent(String(url).split('/works/')[1]);return new Response(JSON.stringify({message:{DOI:doi,title:[doi.includes('local')?'Registered local PDF title':'Registered DOI fixture paper'],author:[{given:'Example',family:'Researcher'}],published:{'date-parts':[[2024,3,4]]},'container-title':['Example Research Journal'],type:'journal-article'}}),{headers:{'content-type':'application/json'}});}
 if(String(url).includes('/blocked'))return new Response('Access denied',{status:403,headers:{'content-type':'text/html'}});
 if(!String(url).startsWith('/') && !String(url).startsWith('http://127.0.0.1:${port}') && !String(url).startsWith('http://localhost:${port}'))throw Error('Fixture blocks external traffic');
 return nativeFetch(url,options);
};
const rendered='<title>Rendered source</title><meta name="citation_title" content="Opened source canonical paper title"><meta name="citation_author" content="Source Researcher"><meta name="citation_publication_date" content="2023"><meta name="citation_doi" content="10.1234/open-source"><meta name="citation_journal_title" content="Example Source Journal">';
globalThis.chrome={permissions:{request:async options=>{requests.push(options);if(deny)return false;for(const o of options.origins || [])granted.add(o);return true;},contains:async({origins})=>origins.every(o=>granted.has(o)),getAll:async()=>({origins:[...granted]}),remove:async()=>true,onRemoved:{addListener:()=>{},removeListener:()=>{}}},tabs:{query:async()=>[...current.values()],create:async options=>{opened.push(options.url);const tab={id:++tabId,url:options.url.includes('/blocked')?'http://localhost:${port}/landing.html':options.url,status:'complete'};current.set(tab.id,tab);return tab;},update:async id=>current.get(id),get:async id=>current.get(id),onUpdated:{addListener:fn=>listeners.push(fn)}},scripting:{executeScript:async({func,target})=>[{result:func(new DOMParser().parseFromString(rendered,'text/html'),current.get(target.tabId).url)}]}};
await import('./library.js');
document.querySelector('#demo-deny').onclick=()=>{deny=!deny;document.querySelector('#demo-deny').textContent=deny?'예시 권한 거절 ON':'예시 권한 거절 OFF';};
document.querySelector('#demo-proof').onclick=async()=>{document.querySelector('#demo-result').textContent=JSON.stringify({requests,opened,records:await all()},(k,v)=>k==='data'?'Fixture PDF bytes retained':v);};`;
http.createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"script-src 'self'; object-src 'self'; worker-src 'self'");
 if(path==='/demo.js'){res.setHeader('Content-Type','text/javascript');res.end(demo);return;}
 if(path==='/fixture.pdf'){res.setHeader('Content-Type','application/pdf');res.end(makePDF({embeddedTitle:'fixture-paper.pdf',doi:'10.1234/local-fixture'}));return;}
 if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
 if(!/^\/[a-zA-Z0-9_.\/-]+$/.test(path)||path.split('/').includes('..')){res.writeHead(404);res.end();return;}
 let body=await readFile(new URL(path.slice(1),root));if(path==='/library.html')body=body.toString().replace('<body>','<body><p class="demo-notice">Paperdesk 0.7.0 개발 검증 · 예시 자료 · 사이트/탭 API 모의 · 실제 개인 자료 변경 없음 <button id="demo-proof" type="button">검증 상태 표시</button><button id="demo-deny" type="button">예시 권한 거절 OFF</button><output id="demo-result"></output></p>').replace('src="library.js"','src="demo.js"');
 res.setHeader('Content-Type',path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css':/\.(?:m?js)$/.test(path)?'text/javascript':'application/octet-stream');res.end(body);
 }catch(e){res.writeHead(404);res.end();}}).listen(port,'127.0.0.1',()=>console.log('Queue fixture: http://127.0.0.1:'+port+'/library.html'));
