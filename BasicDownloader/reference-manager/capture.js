// Self-contained: chrome.scripting serializes this function without module imports.
// Also used with a parsed public bibliography document, never with authenticated PDF URLs.
export function capturePage(doc=document, href=location.href){
 const clean=v=>typeof v==='string' && !/^(undefined|null|\[object Object\])$/i.test(v.trim())?v.replace(/\s+/g,' ').trim().slice(0,10000):'';
 const values=name=>[...doc.querySelectorAll('meta')].filter(m=>(m.getAttribute('name')||m.getAttribute('property')||'').toLowerCase()===name.toLowerCase()).map(m=>clean(m.content)).filter(Boolean);
 const first=(...names)=>names.map(n=>values(n)[0]).find(Boolean)||'';
 const url=value=>{if(!value)return '';try{const u=new URL(value,href);if(!/^https?:$/.test(u.protocol)||u.username||u.password||[...u.searchParams.keys()].some(k=>/token|signature|credential|authorization|api.?key|^(auth|session|sid|code|password|secret|key)$/i.test(k)))return '';return u.href;}catch{return '';}};
 const doi=value=>{const s=clean(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'');return /^10\.\d{4,9}\/\S+$/i.test(s)?s.replace(/[.,;]+$/,'').toLowerCase():'';};
 const text=selector=>clean(doc.querySelector(selector)?.textContent);
 const ownURL=url(href), page=new URL(href),nodes=[];
 const walk=(v,depth=0)=>{if(!v||depth>5)return;if(Array.isArray(v)){for(const x of v.slice(0,100))walk(x,depth+1);}else if(typeof v==='object'){nodes.push(v);if(v['@graph'])walk(v['@graph'],depth+1);if(v.mainEntity)walk(v.mainEntity,depth+1);}};
 for(const script of [...doc.querySelectorAll('script[type="application/ld+json"]')].slice(0,20)){if(script.textContent.length>500000)continue;try{walk(JSON.parse(script.textContent));}catch{}}
 const types=v=>[v?.['@type']].flat().filter(x=>typeof x==='string');
 // Ignore Organization, Person, FAQ answers and recommended/reference articles.
 const eligible=nodes.filter(n=>types(n).some(t=>/^(ScholarlyArticle|Article|TechArticle|Book|Thesis|CreativeWork)$/.test(t)));
 const article=eligible.find(n=>n.url && url(n.url)===ownURL) || (eligible.length===1?eligible[0]:{});
 const names=v=>[v].flat().map(a=>clean(typeof a==='string'?a:a?.name)).filter(Boolean);
 const identifiers=[article.identifier].flat().map(v=>typeof v==='string'?v:/doi/i.test(v?.propertyID||'')?v.value:'').filter(Boolean);
 const structuredDOIs=[...new Set([...values('citation_doi'),...values('prism.doi'),...values('dc.identifier'),...identifiers].map(doi).filter(Boolean))];
 const pathDOI=page.pathname.match(/\/(?:doi\/(?:full\/|abs\/|pdf\/|epdf\/)?)?(10\.\d{4,9}\/[^?#]+)$/i);
 let ownDOI=structuredDOIs.length===1?structuredDOIs[0]:structuredDOIs.length>1?'':doi(pathDOI?decodeURI(pathDOI[1]):'');
 if(!ownDOI && !structuredDOIs.length && /(^|\.)arxiv\.org$/i.test(page.hostname))ownDOI=doi(doc.querySelector('#arxiv-doi-link')?.getAttribute('href'));
 let title=first('citation_title','dc.title') || clean(article.headline||article.name);
 let authors=[...new Set(values('citation_author').length?values('citation_author'):values('dc.creator').length?values('dc.creator'):names(article.author))].join('; ');
 let venue=first('citation_conference_title','citation_journal_title','prism.publicationname');
 let part=article.isPartOf;for(let i=0;!venue && part && i<5;i++){venue=clean(part.name);part=part.isPartOf;}
 let date=first('citation_publication_date','citation_date','dc.date','prism.publicationdate')||clean(article.datePublished);
 let metadataUrl='',pdfUrl=url(first('citation_pdf_url'));
 const dbpia=/(^|\.)dbpia\.co\.kr$/i.test(page.hostname);
 if(/(^|\.)sciencedirect\.com$/i.test(page.hostname) && /^\/science\/article\/(?:abs\/)?pii\/S[A-Z\d]{16}(?:\/|$)/i.test(page.pathname)){
  authors ||= [...doc.querySelectorAll('.author-group .react-xocs-alternative-link')].map(n=>clean(n.textContent)).filter(Boolean).filter((s,i,a)=>a.indexOf(s)===i).join('; ');
 }
 let catalog=false;
 if(page.hostname==='library.kaist.ac.kr' && page.pathname==='/search/detail/view.do'){
  const table=[...doc.querySelectorAll('table')].find(t=>/서지주요정보/.test(t.textContent || ''));
  const rows=[...(table?.querySelectorAll('tr') || [])].map(r=>[...r.querySelectorAll('th,td')].map(c=>clean(c.textContent)));
  const field=label=>rows.find(r=>r.length>=2 && r[0].replace(/\s/g,'')===label)?.[1] || '';
  const byline=field('서명/저자'),split=byline.lastIndexOf(' / '),publication=field('발행사항');
  if(split>10){title ||= byline.slice(0,split).trim();authors ||= byline.slice(split+3).replace(/[.\s]+$/,'');date ||= publication.match(/\b(?:19|20)\d{2}\b/)?.[0] || '';venue ||= publication.replace(/^.*?:\s*/,'').replace(/,?\s*(?:19|20)\d{2}.*$/,'').replace(/[\[\].,]+$/,'').trim();catalog=true;}
 }
 const ieee=/(^|\.)ieeexplore\.ieee\.org$/i.test(page.hostname),ieeeId=ieee && (page.pathname.match(/^\/document\/(\d+)(?:\/|$)/)?.[1] || page.searchParams.get('arnumber'));
 let ieeeTitle='';
 if(ieee && /^\d+$/.test(ieeeId || '')){
  // IEEE's rendered Angular page can have no citation meta tags or JSON-LD.
  // Read the document header/abstract facts, not global JS state or references.
  ieeeTitle=text('h1.document-title') || clean(doc.title).replace(/\s*\|\s*IEEE (?:Conference Publication|Journals?[^|]*|Xplore).*$/i,'').trim();
  if(ieeeTitle.length<12 || /^(IEEE Xplore|access denied|request rejected|just a moment|robot check)/i.test(ieeeTitle))ieeeTitle='';
  title ||= ieeeTitle;
  authors ||= [...doc.querySelectorAll('.authors-info-container a[href*="/author/"]')].map(a=>clean(a.textContent)).filter(Boolean).filter((v,i,all)=>all.indexOf(v)===i).join('; ');
  venue ||= text('.stats-document-abstract-publishedIn a');
  const visibleDOI=doi(doc.querySelector('.stats-document-abstract-doi a[href*="doi.org/"]')?.getAttribute('href'));
  if(visibleDOI && structuredDOIs.length<=1){if(ownDOI && ownDOI!==visibleDOI){structuredDOIs.push(visibleDOI);ownDOI='';}else ownDOI=visibleDOI;}
  if(!date){const publication=text('.doc-abstract-pubdate'),conferenceDate=text('.doc-abstract-confdate');
   const months=['january','february','march','april','may','june','july','august','september','october','november','december'],exact=publication.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+((?:19|20)\d{2})\b/),month=exact?months.findIndex(m=>m.startsWith(exact[2].toLowerCase())):-1;
   date=exact && month>=0?exact[3]+'-'+String(month+1).padStart(2,'0')+'-'+exact[1].padStart(2,'0'):(publication || conferenceDate).match(/\b(?:19|20)\d{2}\b/)?.[0] || '';
   // Date Added to IEEE Xplore is an ingestion date, not the publication date.
  }
  metadataUrl='https://ieeexplore.ieee.org/document/'+ieeeId;
  const pdf=url(doc.querySelector('a[href*="/stamp/stamp.jsp"]')?.getAttribute('href'));
  if(pdf && new URL(pdf).searchParams.get('arnumber')===ieeeId)pdfUrl ||= pdf;
 }
 if(dbpia){
  const header=doc.querySelector('#header_title');
  // The live viewer wraps its heading in a span with the AI switch nested inside.
  const direct=header?(header.textContent || '').replace(doc.querySelector('#headerSwitchDiv')?.textContent || '', ''):'';
  title ||= text('.thesisDetail__tit[itemprop="headline"]') || clean(direct);
  authors ||= [...doc.querySelectorAll('#authorWrap .authorName[itemprop="author"]')].map(n=>clean(n.textContent)).filter(Boolean).join('; ');
  const id=page.searchParams.get('nodeId');
  if(id && /^NODE\d+$/.test(id))metadataUrl=`https://www.dbpia.co.kr/journal/articleDetail?nodeId=${id}`;
  if(/\/pdf\/pdfView\.do$/i.test(page.pathname)){pdfUrl=ownURL;
   // Only rendered text in the same-origin PDF iframe; no viewer runtime/session keys.
   try{const frame=doc.querySelector('#pdfIframe')?.contentDocument;
    const spans=[...(frame?.querySelectorAll('.page[data-page-number="1"] .textLayer span')||[])].map(n=>clean(n.textContent)).filter(Boolean);
    venue ||= spans.slice(0,8).find(s=>/학술대회|학술발표회|conference|proceedings/i.test(s))||'';
    if(!authors){const line=spans.slice(0,25).find(s=>/^[가-힣]{2,5}[\d*†,，\s]+[가-힣]{2,5}/.test(s));if(line)authors=[...new Set(line.match(/[가-힣]{2,5}/g)||[])].join('; ');}
   }catch{}
  }
 }
 title ||= first('og:title') || clean(doc.title) || page.hostname;
 const references=[],seen=clean(doc.title) || first('og:title'),viewed=seen.match(/^(?:figure|fig\.?|table|그림|표)\s*[A-Z]?\d+[A-Z]?\s*[|｜]\s*(.{3,})$/i);
 if(viewed){references.push({text:seen,url:ownURL,source:'page-title',at:Date.now()});if(title===seen)title=viewed[1];}
 try{const selection=clean(doc.defaultView?.getSelection()?.toString());if(selection)references.push({text:selection,url:ownURL,source:'selection',at:Date.now()});}catch{}
 try{const hash=decodeURIComponent(page.hash.slice(1).split(':~:')[0]),anchor=hash && doc.getElementById?.(hash);if(anchor){const context=clean(anchor.textContent);if(context)references.push({text:context,url:ownURL,source:'anchor',at:Date.now()});}}catch{}
 authors ||= first('author');
 if(/(^|\.)patents\.google\.com$/i.test(page.hostname)){
  authors=[...doc.querySelectorAll('meta')].filter(m=>(m.getAttribute('name')||'').toLowerCase()==='dc.contributor' && (m.getAttribute('scheme')||'').toLowerCase()==='inventor').map(m=>clean(m.content)).filter(Boolean).join('; ') || authors;
  date=[...doc.querySelectorAll('meta')].find(m=>(m.getAttribute('name')||'').toLowerCase()==='dc.date' && !m.getAttribute('scheme'))?.content || date;
 }
 const conference=first('citation_conference_title') || /학술대회|학술발표회|초록집|conference|proceedings|symposium/i.test(venue);
 const academic=!!(first('citation_title','citation_journal_title','citation_doi','prism.doi') || types(article).includes('ScholarlyArticle') || ownDOI);
 let kind=conference?'conference':first('citation_journal_title','prism.publicationname') || (ieeeTitle && /journal|transactions|magazine|letters/i.test(venue))?'journal':academic || ieeeTitle?'paper':'document';
 if(types(article).includes('Book') || first('citation_isbn'))kind='book';
 if(types(article).includes('Thesis'))kind='thesis';
 if(catalog && page.searchParams.get('flag')==='dissertation')kind='thesis';
 if(/(^|\.)arxiv\.org$/i.test(page.hostname))kind='preprint';
 if(/(^|\.)(patents\.google\.com|patentimages\.storage\.googleapis\.com)$/i.test(page.hostname))kind='patent';
 const abstractURL=url(first('citation_abstract_html_url'));
 date=date.replace(/\//g,'-');if(/^\d{4}-\d{1,2}(?:-\d{1,2})?$/.test(date))date=date.split('-').map((v,i)=>i?v.padStart(2,'0'):v).join('-');
 const metadataFound=!!(catalog || first('citation_title','dc.title') || article.headline || article.name || ieeeTitle || (dbpia && title!=='DBpia' && !/^논문보기/.test(title)));
 const challenge=!metadataFound && /^(?:access denied|request rejected|robot check|just a moment|attention required|verify (?:you|your)|접근 차단|접속 차단)/i.test(clean(doc.title) || text('h1'));
 const version=/^(?:www\.)?arxiv\.org$/i.test(page.hostname)?page.pathname.match(/(?:\d{4}\.\d{4,5}|\d{7})(v\d+)(?:\.pdf)?$/i)?.[1]:undefined;
 if(kind==='preprint'){venue ||= 'arXiv';if(version){const id=page.pathname.replace(/^\/(?:abs|pdf|html)\//,'').replace(/\.pdf$/,'');pdfUrl='https://arxiv.org/pdf/'+id;}}
 return {title,authors,date,doi:ownDOI,url:abstractURL || metadataUrl || ownURL,pdfUrl,venue,kind,references,...(version?{version}:{}),
  doiStatus:ownDOI?'found':metadataFound && authors && date && (catalog || ieeeTitle)?'not-listed':'unknown',metadataUrl,accessed:new Date().toISOString().slice(0,10),metadataStatus:structuredDOIs.length>1?'서로 다른 DOI가 있어 검토 필요':catalog?'KAIST 도서관 서지정보':ieeeTitle?'IEEE 원문 화면 서지정보':challenge?'사이트 접속 차단·확인 화면':'',accessIssue:challenge?'blocked':'',metadataFound};
}
