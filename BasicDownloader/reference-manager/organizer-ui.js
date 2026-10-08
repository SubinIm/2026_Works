import {bibliographyQuality,savedBibliographyIncluded,bibliographyProblem,technicalPageOnly} from './bibliography-state.js';
import {openSourceTab,scholarURL,registrationPossible,searchCrossref} from './bibliography-recovery.js';
import {readRegistration,registrationOrigins,bibliographyFetch} from './bibliography-registries.js';
import { all, applyMetadata, organize,recordActivity,setBibliographyExcluded } from './db.js';
import { metadataOrigins, readBibliographyWithFallback, metadataPreview,planSavedBibliography,localPDFMetadata } from './bibliography.js';
import { attachmentFromFile } from './pdf-reader.js';
import {renderReferences} from './references.js';
import { safeUrl,metadataText } from './model.js';
import { normalize, fileName,recordKeys } from './model.js';
import { planTabs, planExisting, topics } from './organizer.js';
import {resourceIdentity} from './identity.js';
import { fillKinds,kindGroups,kindLabels } from './taxonomy.js';
import {loadPreferences,updatePreferences,preferenceDefaults} from './preferences.js';

export async function setupOrganizer(onSaved,getVisible=()=>[]) {
  const $=s=>document.querySelector(s), dialog=$('#organizer'), form=$('#organize-form');
  let items=[],mode='',working=false,includeConfirmed=false,includeOther=false,includeExcluded=false,includeTechnicalPages=false,explicit=false,autoOpen=true;
  let selectedKinds=new Set();
  function applySettings(p){selectedKinds=new Set(p.kinds);({autoOpen,includeConfirmed,includeOther,includeExcluded,includeTechnicalPages}=p);}
  applySettings(await loadPreferences('queue'));
  const remember=patch=>updatePreferences('queue',patch).catch(e=>$('#organize-message').textContent='설정 저장 실패: '+e.message);
  const scopeRecord=i=>({...i.queueRecord || i.record,attachment:i.localAttachment || i.record.attachment});
  const visible=i=>mode!=='bibliography' || savedBibliographyIncluded(scopeRecord(i),{includeConfirmed,includeOther,includeExcluded,includeTechnicalPages,kinds:[...selectedKinds]});
  const shown=()=>items.filter(visible);
  const qualityText=item=>{const q=bibliographyQuality(item.record),text=q.confirmed?'서지정보 확인됨 · 저장 후 기본 큐 제외':q.missing.length?'누락 확인 · '+q.missing.join(' · '):'추출 정보 검토 필요';return text+(item.record.bibliography?.doiStatus==='not-listed'?' · 확인한 원문에 DOI 표시 없음':'');};
  const options=nodeOptions();
  function nodeOptions(){const box=document.createElement('div');box.id='bibliography-options';form.insertBefore(box,$('#organize-items'));return box;}
  // Observe only tabs deliberately opened by this dialog, including DOI redirects.
  globalThis.chrome?.tabs?.onUpdated?.addListener((id,change,tab)=>{const item=items.find(i=>i.recoveryTabId===id);if(item && (change.url || tab?.url) && !tab?.incognito){item.tabUrls=[change.url || tab.url];if(change.status==='complete')$('#organize-message').textContent='원문 탭 로딩 완료. 로그인·접근을 확인한 뒤 열린 원문 탭 읽기를 누르세요.';}});
  const node=(tag,text,cls)=>{const e=document.createElement(tag);e.textContent=text || '';if(cls)e.className=cls;return e;};
  function busy(value){working=value;for(const control of form.elements)control.disabled=value;$('#scan-tabs').disabled=value;$('#classify-existing').disabled=value;$('#classify-other').disabled=value;$('#lookup-existing').disabled=value;}
  const eligible=i=>mode==='tabs' || !i.existing || i.metadataReady;
  const canPick=i=>mode==='tabs' || mode==='bibliography' || eligible(i);
  function updateCount(){const selected=shown().filter(i=>i.selected && eligible(i));$('#organize-save').textContent=`선택 ${selected.length}개 ${mode==='existing'?'분류 적용':selected.some(i=>i.mergeSources?.length)?'저장·연결':'저장·보완'}`;}
  function render(){
    $('#organize-items').replaceChildren();options.replaceChildren();options.hidden=mode!=='bibliography';
    if(mode==='bibliography'){
     for(const group of [kindGroups.papers,kindGroups.technical]){const fieldset=node('fieldset','','bibliography-scope');fieldset.append(node('legend',group.label+' 조회 대상'));for(const key of group.kinds){const lab=node('label','','check'),check=node('input');check.type='checkbox';check.name='scope-'+key;check.checked=selectedKinds.has(key);check.onchange=()=>{if(check.checked)selectedKinds.add(key);else selectedKinds.delete(key);remember({kinds:[...selectedKinds]});render();renderDisabled();};lab.append(check,node('span',kindLabels[key]));fieldset.append(lab);}options.append(fieldset);}
     const automatic=node('label','','check'),open=node('input');open.type='checkbox';open.name='auto-open-source';open.checked=autoOpen;open.onchange=()=>{autoOpen=open.checked;remember({autoOpen});};automatic.append(open,node('span','필요하면 일반 원문 탭을 열어 로딩 후 읽기 (성공한 임시 탭만 닫기)'));options.append(automatic);
     const extra=node('fieldset','','bibliography-scope');extra.append(node('legend','기본 제외 항목을 선택적으로 포함'));
     for(const [key,text,value] of [['confirmed','서지정보 확인된 자료 포함 (다시 조회)',includeConfirmed],['technical-pages','PDF·DOI 없는 기술문서 웹페이지 포함 (MOC·ERNIP 안내 페이지 등)',includeTechnicalPages],['excluded','서지 찾기 제외 자료 포함 (제외 목록·재조회)',includeExcluded],['other','논문·기술문서 외 자료 포함',includeOther]]){const label=node('label','','check'),check=node('input');check.type='checkbox';check.name='include-'+key;check.checked=value;check.onchange=()=>{if(key==='confirmed')includeConfirmed=check.checked;else if(key==='technical-pages')includeTechnicalPages=check.checked;else if(key==='excluded')includeExcluded=check.checked;else includeOther=check.checked;remember({[({confirmed:"includeConfirmed","technical-pages":"includeTechnicalPages",excluded:"includeExcluded",other:"includeOther"})[key]]:check.checked});render();renderDisabled();};label.append(check,node('span',text));extra.append(label);}options.append(extra);
     const confirmed=items.filter(i=>bibliographyQuality(scopeRecord(i)).confirmed).length,other=items.filter(i=>!bibliographyQuality(scopeRecord(i)).academic).length,excluded=items.filter(i=>i.record.bibliographyExcluded).length,pages=items.filter(i=>technicalPageOnly(scopeRecord(i))).length;options.append(node('p',`전체 ${items.length}개 · 큐 ${shown().length}개 · 서지정보 확인됨 ${confirmed}개 · 제외 설정 ${excluded}개 · 기술문서 웹페이지 ${pages}개 · 논문·기술문서 외 ${other}개 (수치는 겹칠 수 있습니다.)`,'metadata'));
    }
    const collections=[...new Set([...topics.map(t=>t.name),'기타',...items.map(i=>i.record.collection)])];
    $('#topic-options').replaceChildren(...collections.map(t=>{const o=node('option');o.value=t;return o;}));
    for(const [index,item] of items.entries()){
      if(!visible(item))continue;
      const row=node('fieldset','','organize-item');row.append(node('legend',`${index+1}. ${item.existing?(item.metadataReady?'기존 자료 보완':'이미 저장됨'):item.tabIds.length?`${item.tabIds.length}개 탭`:'기존 자료'}`));
      const pick=node('input');pick.type='checkbox';pick.name=`pick-${index}`;pick.checked=item.selected;pick.disabled=!canPick(item);
      pick.onchange=()=>{item.selected=pick.checked;updateCount();};const pickLabel=node('label','','check');pickLabel.append(pick,node('span','이 자료 선택'));row.append(pickLabel);
      const fields=mode!=='existing'?[['title','제목'],['authors','저자·발명자 (세미콜론으로 구분)'],['date','발행일'],['doi','DOI'],['venue','저널·학술대회명'],['url','원문 URL'],['pdfUrl','PDF URL'],['collection','컬렉션'],['tags','태그 (쉼표로 구분)']]:[['title','제목'],['collection','컬렉션'],['tags','태그 (쉼표로 구분)']];
      for(const [key,label] of fields){
        const lab=node('label',label),input=node('input');input.name=`${key}-${index}`;input.value=['title','authors','date','doi','venue'].includes(key)?metadataText(item.record[key]):item.record[key] || '';input.maxLength=10000;
        if(key==='collection')input.setAttribute('list','topic-options');
        if(key==='url' || key==='pdfUrl'){input.type='url';input.pattern='https?://.*';}
        input.disabled=!eligible(item) || (mode==='existing' && key==='title');
        input.oninput=()=>{item.record[key]=input.value;if(key==='url' || key==='pdfUrl'){delete item.recoveryTabId;item.tabIds=[];item.tabUrls=[];item.sourceUrl=item.record.url || item.record.pdfUrl;}const status=row.querySelector('.bibliography-quality');if(status)status.textContent=qualityText(item);};lab.append(input);row.append(lab);
      }
      const label=node('label','종류'),kind=node('select');kind.name=`kind-${index}`;
      fillKinds(kind);kind.value=item.record.kind;kind.disabled=!eligible(item);kind.onchange=()=>item.record.kind=kind.value;label.append(kind);row.append(label);
      if(mode!=='existing'){
        if(item.targetId){const exclude=node('input');exclude.type='checkbox';exclude.name=`exclude-${index}`;exclude.checked=!!item.record.bibliographyExcluded;exclude.onchange=async()=>{if(working)return;busy(true);try{const current=await setBibliographyExcluded(item.targetId,exclude.checked);if(!current)throw Error('자료가 삭제되었습니다.');item.record.bibliographyExcluded=current.bibliographyExcluded;if(item.beforeVersion===current.previousUpdated)item.beforeVersion=current.updated;if(item.queueRecord)item.queueRecord.bibliographyExcluded=current.bibliographyExcluded;$('#organize-message').textContent=current.bibliographyExcluded?'서지 찾기 제외를 저장했습니다. 상단의 제외 자료 포함에서 다시 확인할 수 있습니다.':'서지 찾기 제외를 해제했습니다.';render();}catch(e){$('#organize-message').textContent=e.message;}finally{busy(false);renderDisabled();}};const lab=node('label','','check');lab.append(exclude,node('span','이 자료 서지 찾기에서 제외 (즉시 저장)'));row.append(lab);}
        if(item.candidates?.length){const box=node('fieldset','','bibliography-candidates');box.append(node('legend','제목 검색 후보 · 같은 논문인지 확인하고 선택'));for(const candidate of item.candidates){box.append(node('p',`${candidate.title} · ${candidate.authors || '저자 미확인'} · ${candidate.date || '발행일 미확인'} · ${candidate.doi}`,'metadata'));const choose=node('button','이 후보로 보완안 만들기','secondary');choose.type='button';choose.onclick=async()=>{if(working)return;busy(true);try{const preview=metadataPreview(item,{...candidate,metadataStatus:'제목 검색 후보 선택 · 검토 필요',url:item.record.url || candidate.canonicalUrl || 'https://doi.org/'+candidate.doi},await all());delete preview.candidates;items[index]=preview;render();$('#organize-message').textContent='선택한 후보의 제목·저자·DOI와 원문을 확인한 뒤 저장하세요.';}catch(e){$('#organize-message').textContent=e.message;}finally{busy(false);renderDisabled();}};box.append(choose);}row.append(box);}
        const read=node('button',mode==='bibliography'?'이 자료 서지정보 찾기':'이 탭 서지정보 읽기','secondary');read.type='button';read.name=`read-${index}`;read.onclick=()=>collect([item]);row.append(read);
        const manual=node('button','수동 입력·누락 보완','secondary');manual.type='button';manual.name=`manual-${index}`;manual.onclick=()=>{item.metadataReady=true;item.bibliographySource='수동 입력';item.reason='직접 확인한 제목·저자·발행일·DOI를 입력하세요. 확인 완료를 표시하지 않으면 누락 자료는 다음 큐에 남습니다.';render();renderDisabled();};row.append(manual);
        if(item.metadataReady){const confirmed=node('input');confirmed.type='checkbox';confirmed.name=`confirmed-${index}`;confirmed.checked=!!item.manuallyConfirmed;confirmed.onchange=()=>item.manuallyConfirmed=confirmed.checked;const lab=node('label','','check');lab.append(confirmed,node('span','서지정보를 수동으로 확인 완료 (해당 없는 빈 항목 포함)'));row.append(lab);}
        const source=node('button','원문 탭 열기','secondary');source.type='button';source.name=`source-${index}`;source.onclick=()=>sourceTab(item);row.append(source);
        if(item.recoveryTabId){const opened=node('button','열린 원문 탭 읽기','secondary');opened.type='button';opened.name=`opened-${index}`;opened.onclick=()=>collect([item]);row.append(opened);}
        const crossref=node('button','DOI로 서지정보 보완 (Crossref·DataCite)','secondary');crossref.type='button';crossref.name=`crossref-${index}`;crossref.onclick=()=>collectDOI([item]);row.append(crossref);
        const scholar=node('button','Google Scholar에서 찾기','secondary');scholar.type='button';scholar.name=`scholar-${index}`;scholar.onclick=()=>{try{chrome.tabs.create({url:scholarURL(item.record),active:true}).catch(e=>$('#organize-message').textContent=e.message);$('#organize-message').textContent='Scholar에서 원문·다른 버전을 선택하세요. 확인한 원문 URL을 수동 입력에 넣고 원문 탭 열기 → 열린 원문 탭 읽기로 연결할 수 있습니다. 검색 결과는 자동 서지정보로 저장하지 않습니다.';}catch(e){$('#organize-message').textContent=e.message;}};row.append(scholar);
        const file=node('input');file.type='file';file.accept='.pdf,application/pdf';file.hidden=true;file.name=`local-file-${index}`;file.onchange=()=>{const chosen=file.files[0];file.value='';if(chosen)collectLocal(item,chosen);};
        const local=node('button','로컬 PDF 선택·서지정보 확인','secondary');local.type='button';local.name=`local-${index}`;local.onclick=()=>file.click();row.append(local,file);
        const attachment=item.attachment || item.localAttachment || item.record.attachment;
        if(attachment)row.append(node('p',`연결 PDF · ${attachment.name} · 로컬 파일을 우선 분석합니다.`,'metadata'));
        else if(item.record.localSource)row.append(node('p','경로만 저장되어 있습니다. 로컬 PDF 선택으로 파일을 연결하면 다음 조회부터 재사용합니다.','metadata'));
        if(item.record.doi){const link=node('a','DOI 원문 ↗');link.href=safeUrl('https://doi.org/'+encodeURIComponent(item.record.doi).replace(/%2F/gi,'/'));link.target='_blank';link.rel='noopener noreferrer';if(item.targetId)link.onclick=()=>recordActivity(item.targetId,'open',{browser:/Edg\//.test(navigator.userAgent)?'Edge':'Chrome'}).catch(e=>$('#organize-message').textContent=e.message);row.append(link);}
      }
      row.append(node('p',qualityText(item),'metadata bibliography-quality'));
      row.append(node('p',item.reason,'metadata'),node('p',item.record.localSource?'로컬 PDF · '+fileName(item.record.localSource):item.record.url,'source-label'));
      $('#organize-items').append(row);
      const references=renderReferences(item.record);if(references)row.append(references);
    }
    if(!shown().length)$('#organize-items').append(node('p','수집하거나 분류할 자료가 없습니다.'));
    updateCount();
  }
  $('#scan-tabs').onclick=async()=>{
    if(working)return;
    if(!globalThis.chrome?.permissions?.request){$('#message').textContent='열린 탭 수집은 Chrome의 Paperdesk 확장 안에서 사용할 수 있습니다.';return;}
    // Request immediately in the click handler, before any await, to retain the gesture.
    try{
      const permission=chrome.permissions.request({permissions:['tabs']});busy(true);
      if(!await permission){$('#message').textContent='탭 접근이 허용되지 않았습니다. 기존 자료 분류는 계속 사용할 수 있습니다.';return;}
      const tabs=await chrome.tabs.query({});const plan=planTabs(tabs.filter(t=>!t.incognito),await all());mode='tabs';items=plan.items;
      $('#organizer-title').textContent='열린 탭 자동 정리';
      $('#organize-summary').textContent=`${plan.total}개 탭 → ${items.length}개 자료 후보 · ${plan.merged}개 중복 탭 묶음 · ${plan.excluded}개 제외. 서지정보 읽기를 누르면 선택한 사이트의 접근 권한을 요청하고 제목·저자·발행일·DOI를 확인합니다. 이미 저장된 자료도 선택하여 수정·저장하거나 서지정보를 읽어 보완할 수 있습니다.`;
      $('#organize-message').textContent='';render();dialog.showModal();
    }catch(e){$('#message').textContent='탭 수집 실패: '+e.message;}finally{busy(false);renderDisabled();}
  };
  function renderDisabled(){for(const [index,item] of items.entries())for(const key of ['pick','exclude','title','collection','tags','kind','authors','date','doi','venue','url','pdfUrl','read','local','local-file','manual','confirmed','source','opened','crossref','scholar']){const input=form.elements.namedItem(`${key}-${index}`);if(input)input.disabled=['exclude','read','local','local-file','manual','source','opened','crossref','scholar'].includes(key)?mode==='existing':key==='pick'?!canPick(item):!eligible(item) || (mode==='existing' && key==='title');}doiAll.hidden=mode==='existing';$('#organize-read').hidden=mode==='existing';$('#organize-read').textContent=mode==='bibliography'?'선택 자료 서지정보 찾기':'선택 탭 서지정보 읽기';}
  async function collectLocal(item,file){
    if(working)return;busy(true);
    try{if(item.targetId)await recordActivity(item.targetId,'lookup',{browser:/Edg\//.test(navigator.userAgent)?'Edge':'Chrome'});
      const parsed=await attachmentFromFile(file),incoming=localPDFMetadata(parsed.metadata,item.record,file.name);
      if(!incoming.metadataFound)throw Error('PDF에서 서지정보를 확인하지 못했습니다. 텍스트가 없는 PDF는 수동 확인이 필요합니다.');
      const preview=metadataPreview(item,incoming,await all());
      if(preview.metadataReady){preview.attachment=parsed.attachment;preview.localAttachment=parsed.attachment;preview.reason+=item.record.attachment?' · 기존 첨부 유지':' · 저장 시 이 PDF 연결';}
      items[items.indexOf(item)]=preview;render();$('#organize-message').textContent='로컬 PDF에서 추출한 논문 제목·저자·DOI를 확인하고 저장·보완하세요. 파일명은 첨부 이름으로 유지합니다.';
    }catch(e){$('#organize-message').textContent='로컬 PDF 분석 실패: '+e.message;}finally{busy(false);renderDisabled();}
  }
  async function collect(candidates){
    if(working || !candidates.length)return;
    const origins=metadataOrigins(candidates);for(const item of candidates)if(bibliographyQuality(item.record).academic && registrationPossible(item.record) && (item.preferWeb || !item.localAttachment && !item.record.attachment))origins.push(...registrationOrigins(item.record));if(!origins.length && !candidates.some(i=>i.localAttachment || i.record.attachment)){$('#organize-message').textContent='원문·PDF 주소, 논문 제목·파일 식별자 또는 연결 PDF가 필요합니다. 수동 입력이나 로컬 PDF 선택으로 추가해주세요.';return;}
    try{
      // User gesture is still synchronous here; request only the reviewed candidate sites.
      const permission=origins.length?chrome.permissions.request({origins:[...new Set(origins)],...(mode==='bibliography'?{permissions:['tabs']}:{})}):Promise.resolve(true);busy(true);
      const allowed=await permission;if(!allowed){candidates=candidates.filter(i=>!i.preferWeb && (i.localAttachment || i.record.attachment));if(!candidates.length){$('#organize-message').textContent='사이트 읽기가 허용되지 않았습니다. 수동 입력·로컬 PDF 선택은 사용할 수 있습니다.';return;}}
      let read=0,failed=0,partial=0;const records=await all(),fetcher=bibliographyFetch();
      const tabs=mode==='bibliography' && globalThis.chrome?.tabs?.query && origins.length && allowed?await chrome.tabs.query({}):[];
      for(const item of candidates)if(mode==='bibliography' && !item.recoveryTabId){const keys=recordKeys(item.record),matching=tabs.filter(t=>!t.incognito && !t.pendingUrl && keys.includes(resourceIdentity(t.url)));item.tabIds=matching.map(t=>t.id);item.sourceUrl=matching[0]?.url || item.record.url;item.tabUrls=matching.map(t=>t.url);}
      for(const item of candidates){item.autoOpen=mode==='bibliography' && autoOpen && allowed;$('#organize-message').textContent=`문서 정보 확인 중 ${read+failed+1}/${candidates.length}`;
        try{if(item.targetId)await recordActivity(item.targetId,'lookup',{browser:/Edg\//.test(navigator.userAgent)?'Edge':'Chrome'});const result=await readBibliographyWithFallback(item,undefined,r=>readRegistration(r,fetcher),r=>searchCrossref(r,fetcher));if(!result.metadataFound && result.candidates?.length){item.candidates=result.candidates;item.reason=result.metadataStatus;item.selected=false;partial++;read++;continue;}const preview=metadataPreview(item,result,records);if(result.candidates?.length)preview.candidates=result.candidates;items[items.indexOf(item)]=preview;if(preview.metadataReady){read++;if(!bibliographyQuality(preview.record).confirmed)partial++;}else failed++;}
        catch(e){item.reason='서지정보 확인 실패: '+bibliographyProblem(e);failed++;}
      }
      render();$('#organize-message').textContent=`${read}개 추출 · ${partial}개 누락·검토 필요 · ${failed}개 읽기 실패. 제목·저자·분류와 DOI를 검토한 뒤 저장·보완하세요.`;
    }catch(e){$('#organize-message').textContent='서지정보 읽기 실패: '+e.message;}finally{busy(false);renderDisabled();}
  }
  const doiAll=node('button','선택 자료 DOI로 보완 (Crossref·DataCite)','secondary');doiAll.type='button';doiAll.onclick=()=>collectDOI(shown().filter(i=>i.selected));form.insertBefore(doiAll,options);
  async function collectDOI(candidates){if(working)return;candidates=candidates.filter(i=>i.record.doi);if(!candidates.length){$('#organize-message').textContent='DOI가 있는 자료를 선택하거나 수동 입력으로 DOI를 추가해주세요.';return;}try{const permission=chrome.permissions.request({origins:[...new Set(candidates.flatMap(i=>registrationOrigins(i.record)))]});busy(true);if(!await permission){$('#organize-message').textContent='DOI 조회 권한이 허용되지 않았습니다.';return;}let read=0,failed=0,partial=0;const records=await all(),fetcher=bibliographyFetch();for(const item of candidates){try{if(item.targetId)await recordActivity(item.targetId,'lookup',{browser:/Edg\//.test(navigator.userAgent)?'Edge':'Chrome'});const incoming=await readRegistration(item.record,fetcher),preview=metadataPreview(item,incoming,records);items[items.indexOf(item)]=preview;if(preview.metadataReady){read++;if(!bibliographyQuality(preview.record).confirmed)partial++;}else failed++;}catch(e){item.reason=bibliographyProblem(e);failed++;}}render();$('#organize-message').textContent=`DOI 조회 ${read}개 추출 · ${failed}개 실패. 등록된 제목·저자·발행일·분류를 검토하고 저장·보완하세요.`;}catch(e){$('#organize-message').textContent=e.message;}finally{busy(false);renderDisabled();}}
  async function sourceTab(item){if(working)return;try{const permission=chrome.permissions.request({permissions:['tabs']});busy(true);if(!await permission){$('#organize-message').textContent='원문 탭 연결에 필요한 탭 접근이 허용되지 않았습니다.';return;}await openSourceTab(item);if(item.targetId)await recordActivity(item.targetId,'open',{browser:/Edg\//.test(navigator.userAgent)?'Edge':'Chrome'});render();$('#organize-message').textContent='원문 탭을 열었습니다. 로딩·로그인·접근 확인 후 열린 원문 탭 읽기를 누르세요. 연결 PDF를 유지하면서 웹 정보로 보완합니다.';}catch(e){$('#organize-message').textContent=bibliographyProblem(e);}finally{busy(false);renderDisabled();}}
  $('#organize-read').onclick=()=>collect(shown().filter(i=>i.selected));
  async function classifyExisting(onlyOther=false){
    if(working)return;busy(true);
    try{mode='existing';items=planExisting((await all()).filter(r=>!r.linkedTo),{onlyOther});$('#organizer-title').textContent=onlyOther?'쇼핑·기타 분류 제안':'기존 자료 자동 분류';$('#organize-summary').textContent=onlyOther?'저장된 제목·주소·서지정보에서 쇼핑·차량 부품 페이지를 찾았습니다. 쇼핑·상품정보 또는 기타로 구분하고 자동 연구 태그를 제거하는 제안입니다. 메모·PDF·읽기 상태는 보존합니다. 선택한 항목만 적용합니다.':'자료 종류와 미분류 컬렉션의 주제를 제안합니다. 쇼핑 항목의 자동 주제 컬렉션은 기타로 제안하며, 직접 만든 컬렉션·메모·PDF·읽기 상태는 보존합니다.';$('#organize-message').textContent='';render();dialog.showModal();}catch(e){$('#message').textContent=e.message;}finally{busy(false);renderDisabled();}
  }
  async function inspectSaved(chosen,settings={}){if(working)return;busy(true);try{const ids=new Set(chosen.map(r=>r.id));mode='bibliography';applySettings(await loadPreferences('queue'));explicit=!!settings.explicit;if(explicit){includeConfirmed=true;includeOther=true;includeExcluded=true;includeTechnicalPages=true;}items=planSavedBibliography(await all(),{includeConfirmed:true,includeOther:true,includeExcluded:true,includeTechnicalPages:true}).filter(i=>ids.has(i.targetId));if(explicit)for(const i of items)selectedKinds.add(i.record.kind);$('#organizer-title').textContent='기존 자료 서지정보 찾기';$('#organize-summary').textContent='로컬 PDF·열린 원문·공개 원문에서 읽고, 부족하면 DOI 등록정보와 논문 제목 검색으로 보완합니다. Nature·Frontiers 파일 식별자도 DOI 등록정보로 검증합니다. 조회를 누르면 DOI는 Crossref·DataCite로, 논문 제목은 Crossref로 보내며 로컬 PDF·경로·메모는 보내지 않습니다. 제목이 정확히 일치하고 저자·발행일이 맞는 단일 결과는 보완안으로, 여러 후보는 선택 목록으로 표시합니다. 결과를 검토한 뒤 저장하세요. 논문·기술문서 종류별로 조회 대상을 고르고, PDF·DOI 없는 기술문서 웹페이지·확인 완료·제외 설정 자료는 필요한 경우만 포함하세요. 각 자료의 제외 설정은 즉시 저장하며 언제든 해제할 수 있습니다. 필요하면 일반 원문 탭을 열어 로딩 후 읽습니다. 성공한 임시 탭만 닫고, 기존 탭과 차단된 탭은 유지합니다. 원문이 차단되면 DOI 조회·Scholar 검색·로컬 PDF로 보완합니다. 기존 메모·첨부·읽기 상태·방문 기록은 유지합니다.';$('#organize-message').textContent='';render();dialog.showModal();}catch(e){$('#message').textContent=e.message;}finally{busy(false);renderDisabled();}}
  $('#lookup-existing').onclick=()=>inspectSaved(getVisible());
  $('#classify-existing').onclick=()=>classifyExisting();
  $('#classify-other').onclick=()=>classifyExisting(true);
  $('#organize-all').onclick=()=>{for(const item of shown())item.selected=canPick(item);render();};
  $('#organize-none').onclick=()=>{for(const item of items)item.selected=false;render();};
  $('#revoke-tabs').onclick=async()=>{try{if(!globalThis.chrome?.permissions?.remove)throw new Error('Chrome 확장 안에서 사용할 수 있습니다.');await chrome.permissions.remove({permissions:['tabs']});items=[];$('#message').textContent='탭 제목·주소 접근을 해제했습니다. 다시 수집할 때 권한을 요청합니다.';}catch(e){$('#message').textContent=e.message;}};
  $('#organize-close').onclick=()=>{if(!working)dialog.close();};dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});
  form.onsubmit=async e=>{
    e.preventDefault();if(working)return;const selected=shown().filter(i=>i.selected && eligible(i));
    if(!selected.length){$('#organize-message').textContent='저장할 자료를 선택해주세요.';return;}
    const empty=selected.find(i=>!i.record.title.trim());if(empty){$('#organize-message').textContent='선택한 자료의 제목을 입력해주세요.';form.elements.namedItem(`title-${items.indexOf(empty)}`).focus();return;}
    busy(true);
    try{
      let result;
      if(mode!=='existing'){const r=await applyMetadata(selected.map(i=>({...i,record:normalize(i.record)})));result=`${r.added}개 저장 · ${r.changed}개 서지정보 보완 · ${r.linked}개 PDF 항목 연결 · ${r.skipped}개 저장 보류.`;
       if(r.skipped){await onSaved();const failed=(r.failures || []);items=items.filter(i=>!selected.includes(i) || failed.some(f=>f.targetId===i.targetId && JSON.stringify(f.sourceIds)===JSON.stringify((i.mergeSources || []).map(s=>s.id))));for(const item of items){const failure=failed.find(f=>f.targetId===item.targetId && JSON.stringify(f.sourceIds)===JSON.stringify((item.mergeSources || []).map(s=>s.id)));if(failure){item.reason='저장 보류: '+failure.reason;item.selected=false;item.metadataReady=false;}}render();$('#organize-message').textContent=result+' 보류한 항목의 안내를 확인하고 다시 조회해주세요.';return;}
      }
      else {const r=await organize(selected.map(i=>({id:i.record.id,before:i.before,collection:i.record.collection.trim(),tags:i.record.tags.trim(),kind:i.record.kind})));result=`${r.changed}개 자료를 분류했습니다. ${r.skipped}개 변경·삭제된 자료는 건너뛰었습니다.`;}
      dialog.close();await onSaved();$('#message').textContent=result;
    }catch(e){$('#organize-message').textContent='저장 실패: '+e.message;}finally{busy(false);renderDisabled();}
  };
  return {inspectSaved,reset:()=>{applySettings(preferenceDefaults('queue'));if(mode==='bibliography'){render();renderDisabled();}}};
}
