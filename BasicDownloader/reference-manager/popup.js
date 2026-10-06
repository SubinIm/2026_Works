import { capturePage } from './capture.js';
import { normalize, safeUrl } from './model.js';
import { save } from './db.js';
const form=document.querySelector('form'), message=document.querySelector('#message'), button=document.querySelector('#save'); let captured={};
document.querySelector('#library').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('library.html')});
try {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if (!safeUrl(tab?.url)) throw new Error('일반 웹페이지에서 실행해주세요. PDF는 라이브러리에서 직접 첨부할 수 있습니다.');
  captured={title:tab.title || tab.url,url:tab.url,kind:'document',accessed:new Date().toISOString().slice(0,10)};
  try { const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:capturePage}); captured={...captured,...result[0].result}; message.textContent='내용을 확인하고 저장하세요.'; }
  catch { message.textContent='이 페이지는 자동 추출이 제한됩니다. 제목·URL을 저장하고 나머지는 직접 입력하세요.'; }
  for (const [k,v] of Object.entries(captured)) if (form.elements.namedItem(k)) form.elements.namedItem(k).value=v;
  button.disabled=false;
} catch(e) { message.textContent=e.message; }
form.onsubmit=async e=>{
  e.preventDefault(); button.disabled=true;
  try { const conflict=await save(normalize({...captured,...Object.fromEntries(new FormData(form))})); message.textContent=conflict?`이미 저장된 자료입니다: ${conflict.title}`:'저장했습니다. 라이브러리에서 PDF와 메모를 추가하세요.'; if(!conflict) form.reset(); }
  catch(e){message.textContent=`저장 실패: ${e.message}`;}
  finally {button.disabled=false;}
};
