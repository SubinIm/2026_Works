import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

let chromium;
try { ({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')); } catch { /* Optional browser tooling. */ }
const content = await readFile(new URL('../content.js', import.meta.url), 'utf8');

// Reproduces the observed rail structure without making its changing names a
// production match criterion. The random custom attribute is deliberately absent.
function rail(id, { position = 'fixed', source = '', width = '   160', height = '   600', status = 'success', extra = '', text = '', frameExtra = '', style = '' } = {}) {
  return `<span id="${id}" class="different-${id}" style="position:${position};margin-left:-200px;top:250px;display:inline-grid !important;${style}">
    <style>#${id} { visibility: visible; }</style>
    <div style="position:relative;align-items:center;display:flex"><iframe src="${source}" width="${width}" height="${height}" status="${status}" frameborder="0" marginwidth="0" marginheight="0" scrolling="no" ${frameExtra}></iframe>${extra}</div>${text}</span>`;
}

async function setup(t, { host = 'www.sportsseoul.com', contents = rail('rail-a') + rail('rail-b') + rail('rail-c') + rail('rail-d'), outside = '' } = {}) {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: route.request().isNavigationRequest() && route.request().frame() === page.mainFrame()
    ? `<!doctype html><main id="container"><section class="contents"><article id="ordinary"><h1>스포츠서울 기사</h1><a href="/news">기사 읽기</a><video></video></article>${contents}</section></main>${outside}`
    : '<!doctype html><p>Embedded content</p>' }));
  await page.addInitScript(host => {
    let listener, storageListener;
    window.testContext = { ok: true, enabled: true, publicFiltersEnabled: false, site: host, frameHost: host, rules: [] };
    window.changeContext = values => { Object.assign(window.testContext, values); storageListener({ adblockState: {} }, 'local'); };
    window.getStatus = () => new Promise(resolve => listener({ type: 'GET_PAGE_STATUS' }, {}, resolve));
    window.chrome = {
      storage: { onChanged: { addListener: callback => { storageListener = callback; } } },
      runtime: {
        onMessage: { addListener: callback => { listener = callback; } },
        sendMessage: async message => message.type === 'GET_CONTEXT' ? structuredClone(window.testContext) : { ok: false },
      },
    };
  }, host);
  await page.goto(`http://${host}/`);
  await page.evaluate(() => {
    window.originalFrameReferences = [...document.querySelectorAll('section.contents iframe')].map(frame => ({ frame, window: frame.contentWindow, document: frame.contentDocument }));
    window.originalScrollWidth = document.documentElement.scrollWidth;
  });
  await page.addScriptTag({ content });
  await page.waitForFunction(async () => (await window.getStatus()).ready);
  return page;
}

async function assertOffscreen(page, selector) {
  const state = await page.locator(selector).evaluate(element => {
    const frame = element.querySelector('iframe');
    const rect = element.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    return {
      display: getComputedStyle(element).display, frameDisplay: getComputedStyle(frame).display,
      right: rect.right, bottom: rect.bottom, width: frameRect.width, height: frameRect.height,
      translate: element.style.getPropertyValue('translate'), priority: element.style.getPropertyPriority('translate'),
      hiddenMarker: [...element.attributes].some(attribute => attribute.name.startsWith('data-basic-block-')),
    };
  });
  assert.notEqual(state.display, 'none');
  assert.notEqual(state.frameDisplay, 'none');
  assert.ok(state.right < 0 && state.bottom < 0, 'The intact banner must be outside the viewport');
  assert.equal(state.width, 160);
  assert.equal(state.height, 600);
  assert.equal(state.translate, '-100000px -100000px');
  assert.equal(state.priority, 'important');
  assert.equal(state.hiddenMarker, false, 'The display:none marker must never be used for relocation');
}

test('Sports Seoul rails move outside the viewport without replacing or collapsing their iframe', { skip: !chromium }, async t => {
  const page = await setup(t);
  assert.equal((await page.evaluate(() => getStatus())).autoHiddenCount, 4);
  assert.equal((await page.evaluate(() => getStatus())).manualHiddenCount, 0);
  assert.equal(await page.locator('#ordinary').isVisible(), true);
  for (const id of ['rail-a', 'rail-b', 'rail-c', 'rail-d']) await assertOffscreen(page, `#${id}`);
  assert.equal(await page.evaluate(() => originalFrameReferences.every(original => original.frame.isConnected && original.frame.contentWindow === original.window && original.document !== null && original.frame.contentDocument === original.document)), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= originalScrollWidth), true, 'Negative relocation must not introduce a horizontal scrollbar');
  await page.evaluate(() => {
    const rail = document.querySelector('#rail-a');
    rail.id = 'a-new-random-name-579384';
    rail.className = 'another-random-class';
    rail.querySelector('iframe').setAttribute('new-random-marker', '');
  });
  await page.waitForFunction(async () => (await getStatus()).autoHiddenCount === 4);
  await assertOffscreen(page, '#a-new-random-name-579384');
  await page.evaluate(html => {
    document.querySelector('#rail-b').remove();
    document.querySelector('section.contents').insertAdjacentHTML('beforeend', html);
  }, rail('replacement-983211'));
  await page.waitForFunction(() => document.querySelector('#replacement-983211').getBoundingClientRect().right < 0 && document.querySelector('#replacement-983211').getBoundingClientRect().bottom < 0);
  await assertOffscreen(page, '#replacement-983211');
  await page.evaluate(() => { document.querySelector('#rail-c').style.setProperty('display', 'flex', 'important'); });
  assert.equal((await page.evaluate(() => getStatus())).autoHiddenCount, 4);
  assert.equal(await page.locator('#rail-c').evaluate(element => getComputedStyle(element).display), 'flex');
  await page.waitForTimeout(150);
  assert.equal((await page.evaluate(() => getStatus())).autoHiddenCount, 4, 'Moved rectangles must not stop matching');
});

test('Sports Seoul relocation restores translate and preserves the original transform and display', { skip: !chromium }, async t => {
  const page = await setup(t, { host: 'sportsseoul.com', contents: rail('rail-a', { style: 'translate:12px 24px !important;transform:rotate(0deg) translateX(7px) !important' }) });
  assert.equal((await page.evaluate(() => getStatus())).autoHiddenCount, 1);
  await assertOffscreen(page, '#rail-a');
  assert.equal(await page.locator('#rail-a').evaluate(el => el.style.getPropertyValue('transform')), 'rotate(0deg) translateX(7px)');
  await page.evaluate(() => changeContext({ enabled: false }));
  await page.waitForFunction(() => document.querySelector('#rail-a').style.translate === '12px 24px');
  assert.equal(await page.locator('#rail-a').evaluate(el => el.style.getPropertyPriority('translate')), 'important');
  assert.equal(await page.locator('#rail-a').evaluate(el => el.style.getPropertyPriority('transform')), 'important');
  assert.equal(await page.locator('#rail-a').evaluate(el => el.style.display), 'inline-grid');
  assert.equal(await page.locator('#rail-a').evaluate(el => el.style.getPropertyPriority('display')), 'important');
  assert.equal((await page.evaluate(() => getStatus())).autoHiddenCount, 0);
  await page.evaluate(() => changeContext({ enabled: true }));
  await page.waitForFunction(() => document.querySelector('#rail-a').style.translate === '-100000px -100000px');
  await assertOffscreen(page, '#rail-a');
  await page.evaluate(() => { document.querySelector('#rail-a').style.setProperty('translate', '30px 40px'); });
  await page.waitForFunction(() => document.querySelector('#rail-a').style.translate === '-100000px -100000px');
  await page.evaluate(() => changeContext({ enabled: false }));
  await page.waitForFunction(() => document.querySelector('#rail-a').style.translate === '30px 40px');
  assert.equal(await page.locator('#rail-a').evaluate(el => el.style.getPropertyPriority('translate')), '');
});

test('Sports Seoul pause preserves a new page translate even before its observer runs', { skip: !chromium }, async t => {
  const page = await setup(t, { contents: rail('rail-a') });
  await page.evaluate(() => {
    document.querySelector('#rail-a').style.setProperty('translate', '21px 35px', 'important');
    changeContext({ enabled: false });
  });
  await page.waitForFunction(async () => !(await getStatus()).enabled);
  assert.equal(await page.locator('#rail-a').evaluate(el => el.style.translate), '21px 35px');
  assert.equal(await page.locator('#rail-a').evaluate(el => el.style.getPropertyPriority('translate')), 'important');
});

test('Sports Seoul matcher preserves content, media, unrelated frames and other page structures', { skip: !chromium }, async t => {
  const variants = [
    rail('normal-position', { position: 'relative' }),
    rail('real-frame', { source: '/embed/widget' }),
    rail('other-width', { width: '300' }),
    rail('other-height', { height: '250' }),
    rail('pending', { status: 'loading' }),
    rail('with-link', { extra: '<a href="/news">기사</a>' }),
    rail('with-article', { extra: '<article>일반 기사</article>' }),
    rail('with-video', { extra: '<video></video>' }),
    rail('with-audio', { extra: '<audio></audio>' }),
    rail('with-main', { extra: '<main>본문</main>' }),
    rail('with-text', { text: '일반 콘텐츠' }),
    rail('with-srcdoc', { frameExtra: 'srcdoc="<p>위젯</p>"' }),
    `<div>${rail('nested-in-div')}</div>`,
  ];
  const page = await setup(t, { contents: variants.join(''), outside: rail('outside-contents') });
  assert.equal((await page.evaluate(() => getStatus())).autoHiddenCount, 0);
  assert.equal(await page.locator('#ordinary').isVisible(), true);
  assert.equal(await page.locator('span').evaluateAll(elements => elements.every(el => getComputedStyle(el).display !== 'none')), true);
  assert.equal(await page.locator('span').evaluateAll(elements => elements.every(el => !el.style.translate)), true);
});

test('Sports Seoul matcher releases a former rail when real content is added', { skip: !chromium }, async t => {
  const page = await setup(t, { contents: rail('rail-a') });
  assert.equal((await page.evaluate(() => getStatus())).autoHiddenCount, 1);
  await page.evaluate(() => { document.querySelector('#rail-a > div').insertAdjacentHTML('beforeend', '<article>새 기사</article>'); });
  await page.waitForFunction(() => !document.querySelector('#rail-a').style.translate);
  assert.equal(await page.locator('#rail-a').evaluate(el => el.style.display), 'inline-grid');
  assert.equal((await page.evaluate(() => getStatus())).autoHiddenCount, 0);
});

test('the same blank-frame layout on another host is preserved', { skip: !chromium }, async t => {
  const page = await setup(t, { host: 'unrelated.test' });
  assert.equal((await page.evaluate(() => getStatus())).autoHiddenCount, 0);
  assert.equal(await page.locator('#rail-a').isVisible(), true);
  assert.equal(await page.locator('#rail-a').evaluate(el => el.style.translate), '');
});

test('unexpectedly broad Sports Seoul rail matches fail closed', { skip: !chromium }, async t => {
  const page = await setup(t, { contents: Array.from({ length: 9 }, (_, index) => rail(`rail-${index}`)).join('') });
  assert.equal((await page.evaluate(() => getStatus())).autoHiddenCount, 0);
});

test('Sports Seoul relocation repairs its marker and page writes without an observer loop', { skip: !chromium }, async t => {
  const page = await setup(t, { contents: rail('rail-a') });
  await page.evaluate(() => {
    const element = document.querySelector('#rail-a');
    element.removeAttribute([...element.attributes].find(attribute => attribute.name.startsWith('data-basic-offscreen-')).name);
  });
  await page.waitForFunction(() => [...document.querySelector('#rail-a').attributes].some(attribute => attribute.name.startsWith('data-basic-offscreen-')));
  await page.evaluate(() => document.querySelector('#rail-a').style.removeProperty('translate'));
  await page.waitForFunction(() => document.querySelector('#rail-a').style.translate === '-100000px -100000px');
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(150);
  await assertOffscreen(page, '#rail-a');
  await page.evaluate(() => {
    window.railMutationCount = 0;
    new MutationObserver(mutations => { window.railMutationCount += mutations.length; }).observe(document.querySelector('#rail-a'), { attributes: true });
  });
  for (let i = 0; i < 3; i++) assert.equal((await page.evaluate(() => getStatus())).autoHiddenCount, 1);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => railMutationCount), 0, 'An unchanged rail should require no further writes');
  await page.evaluate(() => changeContext({ enabled: false }));
  await page.waitForFunction(() => !document.querySelector('#rail-a').style.translate);
});

test('Sports Seoul releases a rail if stylesheet changes its fixed positioning', { skip: !chromium }, async t => {
  const page = await setup(t, { contents: rail('rail-a', { style: 'translate:2px 3px' }) });
  assert.equal((await page.evaluate(() => getStatus())).autoHiddenCount, 1);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '#rail-a { position: relative !important; }';
    document.head.append(style);
  });
  await page.waitForFunction(() => document.querySelector('#rail-a').style.translate === '2px 3px');
  assert.equal((await page.evaluate(() => getStatus())).autoHiddenCount, 0);
});

test('explicit manual hiding takes precedence and does not double-count a Sports Seoul rail', { skip: !chromium }, async t => {
  const page = await setup(t, { contents: rail('rail-a', { style: 'translate:4px 5px' }) });
  await page.evaluate(() => changeContext({ rules: [{ site: 'www.sportsseoul.com', frameHost: 'www.sportsseoul.com', selector: '#rail-a' }] }));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#rail-a')).display === 'none');
  const status = await page.evaluate(() => getStatus());
  assert.equal(status.manualHiddenCount, 1);
  assert.equal(status.autoHiddenCount, 0);
  assert.equal(await page.locator('#rail-a').evaluate(el => el.style.translate), '4px 5px');
  await page.evaluate(() => changeContext({ rules: [] }));
  await page.waitForFunction(() => document.querySelector('#rail-a').style.translate === '-100000px -100000px');
  await assertOffscreen(page, '#rail-a');
  assert.equal((await page.evaluate(() => getStatus())).manualHiddenCount, 0);
  assert.equal((await page.evaluate(() => getStatus())).autoHiddenCount, 1);
});
