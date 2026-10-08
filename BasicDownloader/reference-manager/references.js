// Reading contexts belong to a document, separately from its bibliographic title.
export function referenceFromTitle(value,url='',at=Date.now()){
 const text=String(value || '').replace(/\s+/g,' ').trim();
 const match=text.match(/^(?:figure|fig\.?|table|그림|표)\s*[A-Z]?\d+[A-Z]?\s*[|｜]\s*(.{3,})$/i);
 return match?{title:match[1].trim(),references:normalizeReferences([{text,url,at,source:'page-title'}])}:{title:text,references:[]};
}
export function normalizeReferences(value){
 if(!Array.isArray(value))return [];
 const result=[];
 for(const item of value.slice(-100)){
  if(!item || typeof item.text!=='string')continue;
  const text=item.text.trim().slice(0,10000);if(!text)continue;
  let url='';try{const u=new URL(item.url);if(!u.username && !u.password && (/^https?:$/.test(u.protocol) || u.protocol==='file:' && /\.pdf$/i.test(u.pathname)) && ![...u.searchParams.keys()].some(k=>/token|signature|credential|authorization|api.?key|^(auth|session|sid|code|password|secret)$/i.test(k)))url=u.href;}catch{}
  const source=['page-title','selection','anchor','previous-title'].includes(item.source)?item.source:'previous-title';
  const row={text,url,source,at:Number.isFinite(item.at)&&item.at>=0?item.at:0};
  if(!result.some(r=>r.text===text && r.url===url))result.push(row);
 }
 return result;
}
export function mergeReferences(...values){return normalizeReferences(values.flatMap(v=>normalizeReferences(v)));}
export function referenceText(record){return normalizeReferences(record.references).map(r=>r.text).join(' ');}
export function renderReferences(record){
 const entries=normalizeReferences(record.references);if(!entries.length)return null;
 const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`탐색 레퍼런스 ${entries.length}개`;details.append(summary);details.className='reading-references metadata';
 for(const entry of entries){const p=document.createElement('p');p.textContent=entry.text;
  if(entry.url.startsWith('http')){const a=document.createElement('a');a.href=entry.url;a.textContent=' 대목 열기 ↗';a.target='_blank';a.rel='noopener noreferrer';p.append(a);}details.append(p);
 }
 return details;
}
