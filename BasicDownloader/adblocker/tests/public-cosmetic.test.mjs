import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseCosmeticSources } from '../tools/filter-builder/cosmetic.mjs';
import '../cosmetic-filters.js';

const runtime = globalThis.BasicPublicCosmetics;
const parse = text => parseCosmeticSources([{ id: 'fixture', name: 'Fixture list', sourceUrl: 'https://example.test/filters.txt', text }]);

test('public cosmetics preserve domain suffix scope, exclusions and selector exceptions', () => {
  const { data } = parse(`
##.generic-ad
~private.test##.excluded-generic
news.test,second.test,~safe.news.test##.host-ad
news.test#@#.generic-ad
second.test,~special.second.test#@#.host-ad
`);
  assert.deepEqual(runtime.select(data, 'www.news.test').selectors, ['.excluded-generic', '.host-ad']);
  assert.deepEqual(runtime.select(data, 'safe.news.test').selectors, ['.excluded-generic']);
  assert.deepEqual(runtime.select(data, 'second.test').selectors, ['.generic-ad', '.excluded-generic']);
  assert.deepEqual(runtime.select(data, 'special.second.test').selectors, ['.generic-ad', '.excluded-generic', '.host-ad']);
  assert.deepEqual(runtime.select(data, 'private.test').selectors, ['.generic-ad']);
  assert.deepEqual(runtime.select(data, 'notnews.test').selectors, ['.generic-ad', '.excluded-generic']);
  assert.deepEqual(runtime.select(data, 'news.test.evil.test').selectors, ['.generic-ad', '.excluded-generic']);
  assert.deepEqual(runtime.select(data, 'https://news.test').selectors, []);
  assert.deepEqual(runtime.select(data, '__proto__').selectors, []);
});

test('host lookup does not traverse unrelated host rules and duplicate selectors appear once', () => {
  const { data } = parse('##.same\nnews.test##.same\nnews.test##.same\nnews.test##.specific');
  Object.defineProperty(data.hosts, 'other.test', { get() { throw new Error('Unrelated host index was scanned'); } });
  const selected = runtime.select(data, 'sub.news.test');
  assert.deepEqual(selected.selectors, ['.same', '.specific']);
  assert.deepEqual(selected.counts, { generic: 1, specific: 1, total: 2, exceptions: 0 });
});

test('native :has is retained but scriptlets, procedural selectors and style injection are rejected', () => {
  const { data, report } = parse(`
news.test##div:has(> .ad-marker)
news.test##+js(set, value, true)
news.test##div:has-text(Advertisement)
news.test#?#div:-abp-contains(Advertisement)
news.test#$#div { display: none; }
news.test##div:style(background:url(https://invalid.test))
news.test##div{color:red}
news.*##.unsupported-wildcard
##body
##*
`);
  assert.deepEqual(runtime.select(data, 'news.test').selectors, ['div:has(> .ad-marker)']);
  assert.equal(report.accepted.hiding, 1);
  assert.equal(report.unsupported['extended-or-procedural-selector'], 3);
  assert.equal(report.unsupported['unsupported-cosmetic-separator'], 2);
  assert.equal(report.unsupported['unsafe-selector-text'], 1);
  assert.equal(report.unsupported['unsupported-domain-pattern'], 1);
  assert.equal(report.unsupported['unsafe-root-or-media-selector'], 2);
});

test('unrepresentable selector exceptions are widened rather than discarded', () => {
  const { data, report } = parse('##.ad\nsite.*#@#.ad\nnews.test##.local');
  assert.deepEqual(runtime.select(data, 'news.test').selectors, ['.local']);
  assert.deepEqual(runtime.select(data, 'other.test').selectors, []);
  assert.equal(report.conservativeExceptions, 1);
  assert.equal(report.unsupported['widened-selector-exception'], 1);
});

test('elemhide, generichide, specifichide and document exceptions disable the appropriate groups', () => {
  const { data } = parse(`
##.generic
all.test,generic.test,specific.test,document.test,other.test##.specific
@@||all.test^$elemhide
@@||generic.test^$generichide
@@||specific.test^$specifichide
@@||document.test^$document
`);
  assert.deepEqual(runtime.select(data, 'sub.all.test').selectors, []);
  assert.deepEqual(runtime.select(data, 'generic.test').selectors, ['.specific']);
  assert.deepEqual(runtime.select(data, 'specific.test').selectors, ['.generic']);
  assert.deepEqual(runtime.select(data, 'document.test').selectors, []);
  assert.deepEqual(runtime.select(data, 'other.test').selectors, ['.generic', '.specific']);
  assert.deepEqual(runtime.select(data, 'all.test.evil.test').selectors, ['.generic']);
});

test('path exceptions widen only to their literal host and wildcard-domain exceptions fail conservatively', () => {
  const { data, report } = parse(`
##.generic
path.test,scoped.test,other.test##.specific
@@||path.test/some/path$ehide
@@*$ghide,domain=scoped.test|~safe.scoped.test
`);
  assert.deepEqual(runtime.select(data, 'path.test').selectors, []);
  assert.deepEqual(runtime.select(data, 'scoped.test').selectors, ['.specific']);
  assert.deepEqual(runtime.select(data, 'safe.scoped.test').selectors, ['.generic', '.specific']);
  assert.deepEqual(runtime.select(data, 'other.test').selectors, ['.generic', '.specific']);
  assert.equal(report.conservativeExceptions, 1);
  const regex = parse('##.generic\nnews.test##.specific\n@@/unknown[0-9]+/$ghide');
  assert.deepEqual(runtime.select(regex.data, 'news.test').selectors, ['.specific']);
  assert.equal(regex.report.conservativeExceptions, 1);
});

test('unknown conditional branches cannot add hiding but retain possible exceptions', () => {
  const { data, report } = parse(`
##.generic
!#if unknown_platform
news.test##.conditional-hide
news.test#@#.generic
!#else
@@||other.test^$elemhide
!#endif
news.test##.unconditional
`);
  assert.deepEqual(runtime.select(data, 'news.test').selectors, ['.unconditional']);
  assert.deepEqual(runtime.select(data, 'other.test').selectors, []);
  assert.equal(report.unsupported['conditional-section'], 1);
});

test('EasyList private-address and partial-domain hide exceptions stay scoped instead of disabling generic CSS globally', () => {
  const { data } = parse(`
##.a-ad
@@://10.0.0.$generichide
@@://10.1.1.$generichide
@@://127.0.0.1$generichide
@@://192.168.$generichide
@@://localhost/$generichide
@@://localhost:$generichide
@@||music.amazon.$generichide
@@||www.google.*/search?$generichide
@@||meeco.kr^$generichide
`);
  assert.deepEqual(data.exemptions.generic, []);
  for (const host of ['10.0.0.9', '10.1.1.12', '127.0.0.1', '192.168.1.100', 'localhost', 'music.amazon.com', 'sub.music.amazon.co.uk', 'www.google.co.kr', 'meeco.kr']) {
    assert.deepEqual(runtime.select(data, host).selectors, [], host);
  }
  for (const host of ['news.test', '110.0.0.9', '10.2.1.1', 'notlocalhost.test', 'notmusic.amazon.com', 'amazon.com', 'notwww.google.com', 'google.com']) {
    assert.deepEqual(runtime.select(data, host).selectors, ['.a-ad'], host);
  }
});

let chromium;
try {
  ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'));
} catch { /* CSS parser checks below run when native browser tooling is present. */ }

test('native CSS validation isolates invalid selectors, guards main/media and hides dynamic ads without scanning DOM', { skip: !chromium }, async t => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><head></head><body>
    <main class="public-ad"><p>Normal main article</p></main>
    <article class="public-ad">Normal semantic article</article>
    <div class="public-ad" id="root">Application root</div>
    <div class="public-ad" id="video-wrapper"><video></video></div>
    <div class="public-ad" id="article-wrapper"><article>Normal nested article</article></div>
    <div class="public-ad" id="picker-ui" data-basic-blocker-ui>Extension controls</div>
    <div class="public-ad" id="banner">Advertisement</div>
    <div id="related-banner"><span class="ad-marker">Ad marker</span></div>
    <p id="ordinary">Ordinary content</p>
  </body></html>`);
  await page.addScriptTag({ content: await readFile(new URL('../cosmetic-filters.js', import.meta.url), 'utf8') });
  const { data } = parse('##.public-ad\n##div:has(> .ad-marker)\n##div:unsupported-pseudo\n##div[\n');
  const result = await page.evaluate(data => {
    const query = document.querySelectorAll.bind(document);
    window.publicQueryCalls = 0;
    document.querySelectorAll = (...args) => { window.publicQueryCalls++; return query(...args); };
    const selection = BasicPublicCosmetics.select(data, 'news.test');
    const compiled = BasicPublicCosmetics.compileSelection(selection);
    window.publicStyle = document.createElement('style');
    window.publicStyle.textContent = compiled.cssText;
    document.head.append(window.publicStyle);
    return { selectors: compiled.selectors, rejected: compiled.rejected, queries: window.publicQueryCalls,
      cached: BasicPublicCosmetics.compileSelection(selection) === compiled };
  }, data);
  assert.deepEqual(result.selectors, ['.public-ad', 'div:has(> .ad-marker)']);
  assert.equal(result.rejected.invalid, 2);
  assert.equal(result.queries, 0);
  assert.equal(result.cached, true);
  assert.equal(await page.locator('#banner').isHidden(), true);
  assert.equal(await page.locator('#related-banner').isHidden(), true);
  for (const selector of ['main', 'body > article', '#root', '#video-wrapper', '#article-wrapper', '#picker-ui', '#ordinary']) {
    assert.equal(await page.locator(selector).isVisible(), true, selector);
  }
  await page.evaluate(() => {
    const added = document.createElement('div');
    added.id = 'dynamic-ad'; added.className = 'public-ad'; added.textContent = 'Dynamically inserted ad';
    document.body.append(added);
  });
  assert.equal(await page.locator('#dynamic-ad').isHidden(), true);
  assert.equal(await page.evaluate(() => window.publicQueryCalls), 0, 'Native CSS handles new ads without document selector scans');
  await page.evaluate(() => window.publicStyle.remove());
  assert.equal(await page.locator('#banner').isVisible(), true);
  assert.equal(await page.locator('#dynamic-ad').isVisible(), true);
});
