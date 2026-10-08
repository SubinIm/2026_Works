import { metadataFromPDF, usefulTitle } from './pdf-matching.js';

export async function readPDF(input,name='document.pdf'){
 const bytes=new Uint8Array(input);
 if(bytes.length>50*1024*1024)throw new Error('PDF는 50 MB 이하로 선택해주세요.');
 if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new Error('PDF 파일이 아닙니다. 웹 뷰어 주소라면 파일을 내려받아 선택해주세요.');
 let pdfjs,base;
 try{pdfjs=await import('./vendor/pdf.mjs');base=new URL('./vendor/',import.meta.url);}
 catch{try{pdfjs=await import('./dist/vendor/pdf.mjs');base=new URL('./dist/vendor/',import.meta.url);}catch{throw Error('PDF 해석기 파일이 없습니다. Paperdesk를 빌드한 dist 폴더에서 다시 로드해주세요.');}}
 pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.mjs',base).href;
 const resourceBase=base.protocol==='file:'?decodeURIComponent(base.pathname).replace(/^\/(?=[A-Z]:\/)/i,''):base.href;
 const task=pdfjs.getDocument({data:bytes.slice(),isEvalSupported:false,useWasm:false,cMapUrl:resourceBase+'cmaps/',cMapPacked:true,standardFontDataUrl:resourceBase+'standard_fonts/',useSystemFonts:false});
 let doc;
 try{
  doc=await task.promise;const meta=await doc.getMetadata();const lines=[],links=[];let titleGuess='',firstPageLineCount=0;
  for(let p=1;p<=Math.min(doc.numPages,3);p++){
   const page=await doc.getPage(p),text=await page.getTextContent();const grouped=[];
   for(const item of text.items){if(!('str' in item) || !item.str.trim())continue;const y=Math.round(item.transform[5]/3)*3;let row=grouped.find(r=>Math.abs(r.y-y)<=3);if(!row){row={y,size:Math.abs(item.transform[3]),parts:[]};grouped.push(row);}row.size=Math.max(row.size,Math.abs(item.transform[3]));row.parts.push({x:item.transform[4],text:item.str});}
   grouped.sort((a,b)=>b.y-a.y);for(const row of grouped){row.text=row.parts.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ').trim();lines.push(row.text);}
   if(p<=2 && !titleGuess){const height=page.getViewport({scale:1}).height;const candidates=grouped.filter(r=>r.y>height*.4 && r.size>=12 && usefulTitle(r.text) && !/^(scientific reports|applied sciences|energies|journal of|www\.|https?:|open access)/i.test(r.text));candidates.sort((a,b)=>b.size-a.size || b.text.length-a.text.length);const best=candidates[0];if(best){const segment=grouped.filter(r=>r.size>=best.size*.95 && Math.abs(r.y-best.y)<best.size*5 && r.text.length>=8);titleGuess=segment.map(r=>r.text).join(' ');}}
   if(p===1)firstPageLineCount=lines.length;
   for(const a of await page.getAnnotations())if(a.url)links.push(a.url);
   page.cleanup();
  }
  const info=metadataFromPDF({info:meta.info,xmp:meta.metadata?Object.fromEntries(meta.metadata):{},lines,links,titleGuess,firstPageLineCount},name);
  if(!info.title && usefulTitle(titleGuess)){info.title=titleGuess;info.titleGuessed=true;}
  return info;
 }finally{await task.destroy();}
}
export async function attachmentFromFile(file){
 const bytes=new Uint8Array(await file.arrayBuffer());const metadata=await readPDF(bytes,file.name);
 const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(new Blob([bytes],{type:'application/pdf'}));});
 return {metadata,attachment:{name:file.name,data}};
}
export function safePdfRequest(value){
 const url=new URL(value);if(!['https:','http:'].includes(url.protocol) || url.username || url.password || [...url.searchParams.keys()].some(k=>/token|signature|credential|authorization|api.?key|^(auth|session|sid|code|password|secret)$/i.test(k)))throw new Error('임시 인증 주소는 자동 분석하지 않습니다. PDF 파일을 직접 선택해주세요.');
 return url;
}
export async function fetchPDF(value){
 const url=safePdfRequest(value),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
 try{
  const response=await fetch(url.href,{credentials:'omit',redirect:'error',signal:controller.signal});if(!response.ok)throw new Error('PDF 응답 오류: '+response.status);
  if(Number(response.headers.get('content-length'))>50*1024*1024)throw new Error('PDF는 50 MB 이하로 분석할 수 있습니다.');
  const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value:part}=await reader.read();if(done)break;size+=part.length;if(size>50*1024*1024){await reader.cancel();throw new Error('PDF 크기 제한을 초과했습니다.');}parts.push(part);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return new File([bytes],decodeURIComponent(url.pathname.split('/').pop() || 'document.pdf'),{type:'application/pdf'});
 }finally{clearTimeout(timer);}
}
