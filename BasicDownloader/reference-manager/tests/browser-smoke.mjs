import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname.slice(1)||'library.html';if(name.includes('..'))throw new Error();const body=await readFile(path.join(root,name));res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(body);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const profile=path.join(root,'.test-profile',String(Date.now()));await mkdir(profile,{recursive:true});
const browser=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{stdio:['ignore','ignore','pipe'],windowsHide:true});
let socket;
try{
 const endpoint=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Browser startup timed out')),20000);browser.stderr.on('data',d=>{output+=d;const match=output.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearTimeout(timer);resolve(match[1]);}});browser.on('error',reject);});
 console.log('Browser started. Connecting to DevTools.');
 socket=new WebSocket(endpoint);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('WebSocket open timed out')),10000);socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('WebSocket connection failed'));},{once:true});});let next=0;const pending=new Map();
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}});
 function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timed out: '+method));},15000);pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id,method,params,sessionId}));});}
 const {targetId}=await call('Target.createTarget',{url:'about:blank'});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
 await call('Page.enable',{},sessionId);await call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/library.html`},sessionId);
 async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
 for(let i=0;i<100;i++){if(await evaluate("document.querySelector('#new')?.onclick != null"))break;await new Promise(r=>setTimeout(r,50));}
 const result=await evaluate(`(async()=>{
 const {normalize}=await import('./model.js'),db=await import('./db.js');
 const original=normalize({title:'Battery model study',doi:'10.1000/test',authors:'Kim; Lee',collection:'Energy',tags:'MATLAB, simulation'});
 await db.save(original); const conflict=await db.save(normalize({title:'Duplicate',doi:'10.1000/TEST'}));
 window.dispatchEvent(new Event('focus'));await new Promise(r=>setTimeout(r,100));
 const count=document.querySelectorAll('.card').length;
 document.querySelector('.title-button').click();const form=document.querySelector('#edit');form.elements.notes.value='검증된 메모';form.elements.status.value='reading';form.requestSubmit();
 await new Promise(r=>setTimeout(r,150));const updated=(await db.all())[0];
 const imported=await db.merge([normalize({title:'Technical manual',url:'https://example.com/manual'})]);
 const {capturePage}=await import('./capture.js');const meta=document.createElement('meta');meta.name='citation_title';meta.content='A scientific paper';document.head.append(meta);const captured=capturePage();meta.remove();
 await db.remove(original.id);const afterDelete=(await db.all()).length;
 for(const record of await db.all())await db.remove(record.id);
 window.dispatchEvent(new Event('focus'));
 return {duplicate:conflict?.id===original.id,count,notes:updated.notes,status:updated.status,imported,afterDelete,capture:captured.title};
 })()`);
 assert.deepEqual(result,{duplicate:true,count:1,notes:'검증된 메모',status:'reading',imported:1,afterDelete:1,capture:'A scientific paper'});
 await new Promise(r=>setTimeout(r,150));await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false},sessionId);
 const shot=await call('Page.captureScreenshot',{format:'png'},sessionId);const {writeFile}=await import('node:fs/promises');await writeFile(path.join(root,'preview.png'),Buffer.from(shot.data,'base64'));
 console.log('PASS: browser IndexedDB, duplicate checks, editor save, import, delete, metadata extraction; preview.png saved.');
 await call('Browser.close');
}finally{socket?.close();browser.kill();server.close();}
