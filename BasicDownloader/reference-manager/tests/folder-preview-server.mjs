import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {makePDF} from './pdf-fixture.js';
const root=new URL('../dist/',import.meta.url),tests=new URL('./',import.meta.url);
const banner='<div class="demo-notice">Paperdesk 0.4 · Edge 개발 검증 · 폴더 선택·권한은 예시 API이며 실제 파일과 라이브러리를 변경하지 않습니다. <label class="check"><input id="demo-folder-permission" type="checkbox" checked>예시: 폴더 접근 허용</label><label class="check"><input id="demo-cancel" type="checkbox">예시: 폴더 선택 취소</label><button id="demo-count-snapshots" type="button">예시 저장본 수 확인</button><span id="demo-snapshots"></span><button id="demo-verify-state" type="button">예시 DB 보존 확인</button><span id="demo-db-state"></span></div>';
http.createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://localhost').pathname;res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"script-src 'self'; object-src 'self'; worker-src 'self'");
 if(pathname==='/fixture.pdf'){res.setHeader('Content-Type','application/pdf');res.end(makePDF());return;}
 if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
 if(!/^\/[a-zA-Z0-9_.\/-]+$/.test(pathname) || pathname.split('/').includes('..')){res.writeHead(404);res.end();return;}
 const fixture=({'/demo.js':'folder-demo.js','/memory-folder.js':'memory-folder.js'})[pathname];let content=await readFile(fixture?new URL(fixture,tests):new URL(pathname.slice(1),root));
 if(pathname==='/library.html')content=content.toString('utf8').replace('<body>','<body>'+banner).replace('src="library.js"','src="demo.js"');
 res.setHeader('Content-Type',pathname.endsWith('.html')?'text/html; charset=utf-8':pathname.endsWith('.css')?'text/css':['.js','.mjs'].some(ext=>pathname.endsWith(ext))?'text/javascript':'application/octet-stream');res.end(content);
}catch{res.writeHead(404);res.end();}}).listen(43875,'127.0.0.1',()=>console.log('Paperdesk 0.4 Edge UI: http://127.0.0.1:43875/library.html'));
