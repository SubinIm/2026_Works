import { parseBackup } from './model.js';

const MAX_PDF=50*1024*1024,MAX_IMPORT=250*1024*1024,MAX_INDEX=25*1024*1024;
const validId=s=>typeof s==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(s);
const validSnapshot=s=>/^\d{8}T\d{9}Z-[a-f0-9-]{36}\.json$/.test(s);
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
function checkPDF(bytes){if(bytes.length>MAX_PDF || new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new Error('첨부 PDF 형식 또는 50 MB 제한을 확인해주세요.');}
function decodePDF(data){if(typeof data!=='string' || !/^data:application\/pdf;base64,[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length>Math.ceil(MAX_PDF/3)*4+100)throw new Error('첨부 PDF 데이터가 올바르지 않습니다.');const bytes=Uint8Array.from(atob(data.split(',')[1]),c=>c.charCodeAt(0));checkPDF(bytes);return bytes;}
function encodePDF(bytes){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return 'data:application/pdf;base64,'+btoa(binary);}
async function readText(file,max=MAX_INDEX){if(file.size>max)throw new Error('폴더 서지정보 파일이 너무 큽니다.');return file.text();}
async function write(handle,data){const stream=await handle.createWritable();try{await stream.write(data);await stream.close();}catch(e){try{await stream.abort();}catch{}throw e;}}
async function findFile(dir,name){try{return await dir.getFileHandle(name);}catch(e){if(e.name==='NotFoundError')return null;throw e;}}

export async function writeFolder(parent,records,{clientId,browser='Browser',now=new Date()}={}){
 if(!validId(clientId))throw new Error('폴더 저장 식별자가 올바르지 않습니다.');
 if(!Array.isArray(records) || records.length>10000)throw new Error('폴더 저장은 한 저장본당 10,000개 자료까지 지원합니다.');
 const root=await parent.getDirectoryHandle('Paperdesk',{create:true}),pdfs=await root.getDirectoryHandle('pdfs',{create:true});
 const copies=[];let attached=0,reused=0;
 for(const record of records){
  const copy={...record};delete copy.attachment;
  if(record.attachment){if(typeof record.attachment.name!=='string')throw new Error('PDF 파일명이 올바르지 않습니다.');const bytes=decodePDF(record.attachment.data),hash=await digest(bytes),name=hash+'.pdf',existing=await findFile(pdfs,name);
   if(existing){const file=await existing.getFile();if(file.size!==bytes.length || await digest(await file.arrayBuffer())!==hash)throw new Error('기존 PDF 파일이 변경되거나 저장 중입니다. 기존 파일을 보존했습니다. 다시 저장해주세요.');reused++;}
   else await write(await pdfs.getFileHandle(name,{create:true}),bytes);
   copy.attachment={name:record.attachment.name,path:'pdfs/'+name,sha256:hash,size:bytes.length};attached++;
  }
  copies.push(copy);
 }
 const snapshots=await root.getDirectoryHandle('snapshots',{create:true}),client=await snapshots.getDirectoryHandle(clientId,{create:true});
 const name=now.toISOString().replace(/[-:.]/g,'')+'-'+crypto.randomUUID()+'.json';
 const snapshot={format:'paperdesk-folder',version:1,exported:now.toISOString(),clientId,browser,records:copies};
 const json=JSON.stringify(snapshot,null,2);if(new TextEncoder().encode(json).length>MAX_INDEX)throw new Error('서지정보 저장본이 25 MB를 초과했습니다.');
 // Publish the index only after every referenced PDF has been committed.
 await write(await client.getFileHandle(name,{create:true}),json);
 return {records:copies.length,pdfs:attached,reused,file:'Paperdesk/snapshots/'+clientId+'/'+name};
}

export async function listFolder(parent){
 let snapshots;try{const root=await parent.getDirectoryHandle('Paperdesk');snapshots=await root.getDirectoryHandle('snapshots');}catch(e){if(e.name==='NotFoundError')return [];throw e;}
 const out=[];let scanned=0;
 for await(const [clientId,client] of snapshots.entries()){
  if(client.kind!=='directory' || !validId(clientId))continue;
  const names=[];for await(const [name,entry] of client.entries()){if(++scanned>20000)throw new Error('저장본이 많습니다. 오래된 저장본을 별도 폴더로 보관해주세요.');if(entry.kind==='file' && validSnapshot(name))names.push(name);}
  names.sort().reverse();
  // An interrupted latest write cannot hide the previous complete snapshot.
  for(const name of names){try{const data=JSON.parse(await readText(await(await client.getFileHandle(name)).getFile()));validateSnapshot(data);if(data.clientId!==clientId)throw new Error('저장본 식별자가 다릅니다.');out.push({clientId,name,browser:String(data.browser || 'Browser').slice(0,50),exported:data.exported,count:data.records.length});break;}catch(e){if(e.name==='NotAllowedError')throw e;}}
 }
 return out.sort((a,b)=>b.exported.localeCompare(a.exported));
}
function validateSnapshot(data){if(data?.format!=='paperdesk-folder' || data.version!==1 || !validId(data.clientId) || typeof data.exported!=='string' || !Number.isFinite(Date.parse(data.exported)) || !Array.isArray(data.records) || data.records.length>10000)throw new Error('Paperdesk 폴더 저장본이 아닙니다.');}
function checkReference(a){if(!a || !/^[a-f0-9]{64}$/.test(a.sha256) || a.path!=='pdfs/'+a.sha256+'.pdf' || typeof a.name!=='string' || !Number.isSafeInteger(a.size) || a.size<5 || a.size>MAX_PDF)throw new Error('PDF 참조가 올바르지 않습니다.');}
export async function readFolderPDF(parent,a){
 checkReference(a);const root=await parent.getDirectoryHandle('Paperdesk'),pdfs=await root.getDirectoryHandle('pdfs'),file=await(await pdfs.getFileHandle(a.sha256+'.pdf')).getFile();
 if(file.size!==a.size)throw new Error('PDF 크기가 저장본과 다릅니다.');const bytes=new Uint8Array(await file.arrayBuffer());checkPDF(bytes);if(await digest(bytes)!==a.sha256)throw new Error('PDF 파일이 저장 이후 변경되었습니다.');return bytes;
}
export async function readFolder(parent,entry,{includePDFs=true}={}){
 if(!validId(entry.clientId) || !validSnapshot(entry.name))throw new Error('폴더 저장본 경로가 올바르지 않습니다.');
 const root=await parent.getDirectoryHandle('Paperdesk'),snapshots=await root.getDirectoryHandle('snapshots'),client=await snapshots.getDirectoryHandle(entry.clientId);
 const data=JSON.parse(await readText(await(await client.getFileHandle(entry.name)).getFile()));validateSnapshot(data);if(data.clientId!==entry.clientId)throw new Error('저장본 식별자가 다릅니다.');
 let total=0;const copies=[];
 for(const record of data.records){const copy={...record};if(record.attachment){const a=record.attachment;checkReference(a);
   if(includePDFs){total+=a.size;if(total>MAX_IMPORT)throw new Error('전체 가져오기 250 MB 제한을 확인해주세요.');const bytes=await readFolderPDF(parent,a);copy.attachment={name:a.name,data:encodePDF(bytes)};}
   else delete copy.attachment;
  }copies.push(copy);
 }
 const normalized=parseBackup(JSON.stringify({format:'paperdesk',version:1,records:copies}));
 if(!includePDFs)normalized.forEach((r,i)=>{if(data.records[i].attachment)r.folderAttachment=data.records[i].attachment;if(Number.isFinite(data.records[i].updated))r.updated=data.records[i].updated;});
 return normalized;
}
