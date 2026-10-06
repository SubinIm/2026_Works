import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const SOURCE_CONFIG = [
  { id: 1, key: 'easylist', name: 'EasyList', file: 'easylist.txt',
    url: 'https://easylist.to/easylist/easylist.txt',
    homepage: 'https://easylist.to/', license: 'GPL-3.0-or-later (selected from dual license)',
    licenseUrl: 'https://easylist.to/pages/licence.html', attribution: 'The EasyList authors (https://easylist.to/)' },
  { id: 2, key: 'korean-classic', name: 'filterslists-KO Classic for AdGuard', file: 'korean-classic.txt',
    registryUrl: 'https://registry.npmjs.org/@filteringdev%2ffilterslists-ko/latest',
    homepage: 'https://github.com/FilteringDev/filterslists-KO', license: 'GPL-3.0-only',
    licenseUrl: 'https://github.com/FilteringDev/filterslists-KO/blob/master/LICENSE',
    attribution: 'FilteringDev/filterslists-KO contributors; derived from List-KR' },
];
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export async function fetchText(url, maxBytes = 16 * 1024 * 1024) {
  if (!url.startsWith('https://')) throw new Error('Filter sources must use HTTPS.');
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'BasicBannerBlocker-FilterBuilder/1.0 (personal filter compilation)' } });
  if (!response.ok) throw new Error(`Source download failed (${response.status}): ${url}`);
  if (!response.url.startsWith('https://')) throw new Error('Insecure filter source redirect.');
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > maxBytes) throw new Error(`Source exceeds ${maxBytes} bytes: ${url}`);
    chunks.push(chunk);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

export function validateSource(text, config) {
  if (typeof text !== 'string' || !( /^\s*\[(?:Adblock Plus|AdGuard)/i.test(text) || /^! Title: filterslists-KO classic \(AdGuard\)/.test(text)) || /<html\b/i.test(text.slice(0, 200))) {
    throw new Error(`${config.name}: expected an adblock list, received another document.`);
  }
  const lines = text.split(/\r?\n/);
  const active = lines.filter(line => line.trim() && !line.startsWith('!') && !line.startsWith('['));
  if (active.length < (config.key === 'easylist' ? 10000 : 100)) throw new Error(`${config.name}: unexpectedly small source; refusing replacement.`);
  if (text.includes('!#include')) throw new Error(`${config.name}: unresolved includes must not be silently ignored.`);
  return { lines: lines.length, activeLines: active.length };
}

export async function downloadSources() {
  return Promise.all(SOURCE_CONFIG.map(async config => {
    let url = config.url;
    let packageVersion = null;
    if (config.registryUrl) {
      const metadata = JSON.parse(await fetchText(config.registryUrl, 2 * 1024 * 1024));
      packageVersion = metadata.version;
      if (typeof packageVersion !== 'string' || !/^[a-zA-Z0-9.+-]+$/.test(packageVersion)) throw new Error('Invalid Korean filter package version.');
      url = `https://cdn.jsdelivr.net/npm/@filteringdev/filterslists-ko@${packageVersion}/dist/filterslist-AdGuard-classic.txt`;
    }
    const text = await fetchText(url);
    const stats = validateSource(text, config);
    const sourceVersion = text.match(/^!\s*Version:\s*(.+)$/mi)?.[1]?.trim()
      ?? text.match(/^!\s*Last modified:\s*(.+)$/mi)?.[1]?.trim() ?? packageVersion ?? 'content-addressed';
    return { ...config, url, sourceUrl: url, text, fetchedAt: new Date().toISOString(),
      sha256: sha256(text), sourceVersion, packageVersion, bytes: Buffer.byteLength(text), ...stats };
  }));
}

export async function loadOfflineSources(filtersDirectory) {
  const metadata = JSON.parse(await readFile(new URL('sources/provenance.json', filtersDirectory), 'utf8'));
  return Promise.all(SOURCE_CONFIG.map(async config => {
    const item = metadata.sources.find(source => source.key === config.key);
    if (!item) throw new Error(`Missing source metadata: ${config.key}`);
    const text = await readFile(new URL(`sources/${config.file}`, filtersDirectory), 'utf8');
    if (sha256(text) !== item.sha256) throw new Error(`Offline source checksum mismatch: ${config.file}`);
    validateSource(text, config);
    return { ...config, ...item, sourceUrl: item.url, text };
  }));
}

export function sourceMetadata(sources) {
  return sources.map(({ text, sourceUrl, ...metadata }) => metadata);
}
