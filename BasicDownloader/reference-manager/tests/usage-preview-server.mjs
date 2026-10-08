import http from 'node:http';import {readFile} from 'node:fs/promises';import {makePDF} from './pdf-fixture.js';
const root=new URL('../dist/',import.meta.url),source='http://127.0.0.1:43878/document.html';
const demo=`import {all,save,get} from './db.js';import {normalize} from './model.js';
const fixtures=[
 {id:501,title:'DBpia',url:'https://www.dbpia.co.kr/pdf/pdfView.do?nodeId=NODE11657988',metas:[['citation_title','Reich CRM을 활용한 도심항공교통(UAM) 종적분리기준에 관한 연구'],['citation_author','김주영'],['citation_author','김나현'],['citation_author','이금진'],['citation_publication_date','2023/11'],['citation_journal_title','한국항공우주학회 학술발표회 초록집']]},
 {id:502,title:'SAGE article',url:'https://journals.sagepub.com/doi/10.1177/03611981231185146',metas:[['dc.Title','Comparing Urban Air Mobility Network Airspaces: Experiments and Insights'],['dc.Creator','Christopher Cummings'],['dc.Creator','Hani Mahmassani'],['dc.Date','2024-4'],['dc.Identifier','10.1177/03611981231185146'],['citation_journal_title','Transportation Research Record']]},
 {id:808,title:'Engine controller overview',url:'${source}',active:true,status:'complete',metas:[['citation_title','Engine controller technical report'],['citation_author','Example Researcher'],['citation_publication_date','2026/10/08']]}
];
const pdf=await(await fetch('/fixture.pdf')).arrayBuffer();
if(!localStorage.getItem('usage-v6-seeded')){for(const record of [
 {id:'saved-dbpia',title:'DBpia',url:'https://www.dbpia.co.kr/journal/articleDetail?nodeId=NODE11657988',kind:'conference',collection:'내 연구 과제',notes:'보존할 연구 메모',status:'done',attachment:{name:'existing.pdf',data:'data:application/pdf;base64,'+btoa(String.fromCharCode(...new Uint8Array(pdf)))}},
 {id:'saved-sage',title:'SAGE article',url:fixtures[1].url,kind:'journal',collection:'내 연구 과제'},
 {id:'saved-source',title:'Engine controller overview',url:fixtures[2].url,kind:'document',collection:'추진·모터',notes:'내 제어 메모'},
 {id:'unresolved-paper',title:'미확인 논문',kind:'paper',collection:'분류 검토'},
 {id:'wiki',title:'Control theory - Wikipedia',url:'https://en.wikipedia.org/wiki/Control_theory',kind:'wiki'},
 {id:'other',title:'파츠119 부품',url:'https://www.parts119.com/',kind:'other',collection:'기타'}
]){const normalized=normalize(record);if(record.attachment)normalized.attachment=record.attachment;await save(normalized);}localStorage.setItem('usage-v6-seeded','yes');}
let tabsGranted=false,granted=[];const handlers={},event=name=>({addListener:f=>{if(name==='removed'){const old=handlers[name];handlers[name]=async p=>{await old?.(p);await f(p);};}else handlers[name]=f;}});
const html=fixture=>{const doc=new DOMParser().parseFromString('<title>'+fixture.title+'</title>','text/html');for(const [name,content] of fixture.metas){const m=doc.createElement('meta');m.name=name;m.content=content;doc.head.append(m);}return doc;};
const nativeFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=async(value,options)=>{const fixture=String(value).includes('www.dbpia.co.kr/journal/articleDetail')?fixtures[0]:fixtures.find(f=>f.url===String(value));if(fixture){if(options.credentials!=='omit'||options.redirect!=='error')throw Error('Public request contract failed');document.querySelector('#demo-origins').textContent+=' · 저장 주소 HTML 읽기';return new Response(html(fixture).documentElement.outerHTML,{headers:{'Content-Type':'text/html; charset=utf-8'}});}return nativeFetch(value,options);};
globalThis.chrome={permissions:{request:async p=>{tabsGranted ||= !!p.permissions?.includes('tabs');if(p.origins)granted.push(...p.origins);document.querySelector('#demo-origins').textContent='예시 접근: '+[...new Set(granted)].join(', ');return true;},contains:async p=>p.permissions?tabsGranted:p.origins?.every(o=>granted.includes(o)),getAll:async()=>({origins:granted}),remove:async()=>{tabsGranted=false;await handlers.removed?.({permissions:['tabs']});return true;},onRemoved:event('removed')},tabs:{query:async()=>fixtures.filter(f=>f.id!==501),get:async id=>fixtures.find(f=>f.id===id),create:async()=>({}),onActivated:event('activated'),onUpdated:event('updated')},scripting:{executeScript:async({target,func})=>{const f=fixtures.find(f=>f.id===target.tabId);return [{result:func(html(f),f.url)}];}}};
await import('./background.js');await import('./library.js');
document.querySelector('#demo-visit').onclick=async()=>{await handlers.activated({tabId:808});await handlers.updated(808,{status:'complete'},fixtures[2]);document.querySelector('#demo-visit-result').textContent='예시 활성화·로드 이벤트 완료';};
document.querySelector('#demo-state').onclick=async()=>{const conference=await get('saved-dbpia'),source=await get('saved-source');document.querySelector('#demo-result').textContent=JSON.stringify({total:(await all()).length,conference:{title:conference.title,authors:conference.authors,kind:conference.kind,collection:conference.collection,notes:conference.notes,status:conference.status,pdf:conference.attachment.name,activity:conference.activity},source:{kind:source.kind,notes:source.notes,activity:source.activity}});};`;
http.createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"script-src 'self'; object-src 'self'; worker-src 'self'");
 if(path==='/demo.js'){res.setHeader('Content-Type','text/javascript');res.end(demo);return;}
 if(path==='/fixture.pdf'){res.setHeader('Content-Type','application/pdf');res.end(makePDF());return;}
 if(path==='/document.html'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><title>Paperdesk 예시 문서</title><h1>Engine controller technical report</h1><p>Paperdesk 0.6 개발 검증용 공개 예시 문서입니다.</p></html>');return;}
 if(path==='/favicon.ico'){res.writeHead(204);res.end();return;}
 if(!/^\/[a-zA-Z0-9_.\/-]+$/.test(path)||path.split('/').includes('..')){res.writeHead(404);res.end();return;}
 let content=await readFile(new URL(path.slice(1),root));if(path==='/library.html')content=content.toString('utf8').replace('<body>','<body><div class="demo-notice">Paperdesk 0.6 개발 검증 · 예시 자료·탭 API · 실제 개인 자료는 변경하지 않습니다. <span id="demo-origins"></span><button id="demo-visit" type="button">예시 저장 문서 방문</button><span id="demo-visit-result"></span><button id="demo-state" type="button">보존·기록 확인</button><span id="demo-result"></span></div>').replace('src="library.js"','src="demo.js"');
 res.setHeader('Content-Type',path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css':/\.(?:m?js)$/.test(path)?'text/javascript':'application/octet-stream');res.end(content);
 }catch{res.writeHead(404);res.end();}}).listen(43878,'127.0.0.1',()=>console.log('Paperdesk v6 fixture: http://127.0.0.1:43878/library.html'));
