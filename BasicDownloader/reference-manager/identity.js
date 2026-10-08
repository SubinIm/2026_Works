function doi(value=''){return String(value).trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'').toLowerCase();}
function urlKey(value){const u=new URL(value);u.hash='';for(const key of [...u.searchParams.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(key))u.searchParams.delete(key);u.searchParams.sort();return u.href.replace(/\/$/,'');}
export function resourceIdentity(value) {
  try {
    const u=new URL(value); const host=u.hostname;
    if(u.protocol==='file:') { u.hash=''; return /\.pdf$/i.test(u.pathname)?`file:${u.href}`:''; }
    if (!['http:','https:'].includes(u.protocol)) return '';
    if(/(^|\.)dbpia\.co\.kr$/i.test(host)){const id=u.searchParams.get('nodeId');if(/^NODE\d+$/.test(id || ''))return `dbpia:${id}`;}
    if(/(^|\.)arxiv\.org$/i.test(host)){const id=u.pathname.match(/^\/(?:abs|pdf|html)\/((?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?)(?:\.pdf)?$/i)?.[1];if(id)return `arxiv:${id}`;}
    if(/(^|\.)(patents\.google\.com|patentimages\.storage\.googleapis\.com)$/i.test(host)){const id=u.pathname.match(/(?:\/|^)((?:WO|US|EP|KR|JP|CN)\d{6,13}[AB]\d)(?:\/|\.pdf|$)/i)?.[1];if(id)return `patent:${id.toUpperCase()}`;}
    if(/(^|\.)nature\.com$/i.test(host)){const id=u.pathname.match(/^\/articles\/(s\d{5}-\d{3}-\d{4,6}-[\dx]|srep\d{4,7})(?:\.pdf|\/(?:figures|tables)\/\d+)?\/?$/i)?.[1];if(id)return `nature:${id.toLowerCase()}`;}
    const d=u.pathname.match(/\/(10\.\d{4,9}\/[^?#]+)/i);
    if(d) return `doi:${doi(decodeURIComponent(d[1]).replace(/\/(pdf|full|abstract)$/i,''))}`;
    if(/(^|\.)doi\.org$/i.test(host))return `doi:${doi(decodeURIComponent(u.pathname.slice(1)))}`;
    if(/(^|\.)ieeexplore\.ieee\.org$/i.test(host)){
      const id=u.pathname.match(/\/document\/(\d+)/)?.[1] || u.searchParams.get('arnumber');
      if(/^\d+$/.test(id || ''))return `ieee:${id}`;
    }
    if(/(^|\.)(sciencedirect\.com|sciencedirectassets\.com)$/i.test(host)){
      const pii=u.pathname.match(/(?:pii\/|1-s2\.0-)(S[A-Z\d]+)/i)?.[1] || u.searchParams.get('pii');
      if(/^S[A-Z\d]+$/i.test(pii || '')) return `pii:${pii.toUpperCase()}`;
    }
    return `url:${urlKey(u.href)}`;
  } catch {return '';}
}
export function isPDF(value) {return /\.pdf($|[?#])|\/pdf($|[?#])|arxiv\.org\/pdf\/|\/epdf\/|stamp\.jsp|pdfView\.do/i.test(value);}
