// Self-contained: Chrome serializes this function into the selected tab.
export function capturePage() {
  const values = name => [...document.querySelectorAll('meta')].filter(m => (m.getAttribute('name') || m.getAttribute('property') || '').toLowerCase() === name.toLowerCase()).map(m=>m.content.trim()).filter(Boolean);
  const first = (...names) => names.map(n=>values(n)[0]).find(Boolean) || '';
  const doi = first('citation_doi','dc.identifier','prism.doi');
  const academic = Boolean(first('citation_title','citation_journal_title','citation_doi'));
  let pdfUrl = first('citation_pdf_url');
  try { pdfUrl = pdfUrl ? new URL(pdfUrl, location.href).href : ''; } catch { pdfUrl=''; }
  return {title:first('citation_title','og:title','dc.title') || document.title, authors:values('citation_author').join('; ') || first('author','dc.creator'), date:first('citation_publication_date','citation_date','dc.date','article:published_time'), doi:/10\.\d{4,9}\//.test(doi)?doi:'', url:location.href, pdfUrl, kind:academic?'paper':'document', accessed:new Date().toISOString().slice(0,10)};
}
