(() => {
  'use strict';
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const within = (host, parent) => host === parent || host.endsWith(`.${parent}`);
  const protectedSelector = ':not(html,body,head,main,article,video,audio,source,track,script,style,link,meta,title,[data-basic-blocker-ui],[role="main"],[role="article"],[contenteditable="true"],[id="root" i],[id="app" i],[id="__next" i],[id="__nuxt" i],[id="main" i],[id="content" i],[id="main-content" i]):not(:has(main,article,[role="main"],[role="article"],video,audio))';
  const compiled = new WeakMap();

  function validHost(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 253 && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  }

  function applicable(group, host) {
    const records = [...(Array.isArray(group?.generic) ? group.generic : [])];
    const labels = host.split('.');
    for (let offset = 0; offset < labels.length; offset++) {
      const suffix = labels.slice(offset).join('.');
      if (own(group?.hosts, suffix) && Array.isArray(group.hosts[suffix])) records.push(...group.hosts[suffix]);
    }
    return records.filter(record => record && Array.isArray(record.exclude) && !record.exclude.some(domain => validHost(domain) && within(host, domain)));
  }

  function select(data, host) {
    const disabled = { all: false, generic: false, specific: false };
    const counts = { generic: 0, specific: 0, total: 0, exceptions: 0 };
    if (data?.version !== 1 || !validHost(host)) return { selectors: [], counts, disabled: { all: true, generic: true, specific: true } };
    const prefixExceptions = (Array.isArray(data.exemptions?.patterns) ? data.exemptions.patterns : []).filter(record => {
      const prefix = record?.hostPrefix;
      if (typeof prefix !== 'string' || !validHost(prefix.replace(/\.$/, '')) || !Array.isArray(record.exclude)) return false;
      if (record.exclude.some(domain => validHost(domain) && within(host, domain))) return false;
      return host.startsWith(prefix) || (prefix.endsWith('.') && host === prefix.slice(0, -1)) ||
        (record.subdomains === true && host.includes(`.${prefix}`));
    });
    for (const exemption of [...applicable(data.exemptions, host), ...prefixExceptions]) {
      if (own(disabled, exemption.kind)) disabled[exemption.kind] = true;
    }
    if (disabled.all) { disabled.generic = true; disabled.specific = true; }
    const except = new Set(applicable(data.exceptions, host).map(record => record.selector).filter(selector => typeof selector === 'string'));
    counts.exceptions = except.size;
    const selectors = new Set();
    for (const [kind, group] of [
      ['generic', { generic: data.generic }],
      ['specific', { hosts: data.hosts }],
    ]) {
      if (disabled[kind]) continue;
      for (const record of applicable(group, host)) {
        if (typeof record.selector !== 'string' || except.has(record.selector) || selectors.has(record.selector)) continue;
        selectors.add(record.selector);
        counts[kind]++;
      }
    }
    counts.total = selectors.size;
    return { selectors: [...selectors], counts, disabled };
  }

  function compileSelection(selection) {
    const previous = selection && typeof selection === 'object' ? compiled.get(selection) : null;
    if (previous) return previous;
    const selected = selection && Array.isArray(selection.selectors) ? selection : select(null, '');
    const result = { ...selected, selectors: [], matchSelectors: [], cssText: '', rejected: { unsafe: 0, invalid: 0, nativeUnavailable: 0 } };
    let sheet;
    try {
      sheet = new CSSStyleSheet();
      sheet.insertRule(`div:where(${protectedSelector}){display:none!important}`, 0);
      sheet.deleteRule(0);
    } catch {
      result.rejected.nativeUnavailable = selected.selectors.length;
      return result;
    }
    for (const selector of selected.selectors) {
      // Recheck declarative-only text even when a bundled JSON file is damaged.
      if (typeof selector !== 'string' || !selector || selector.length > 4096 || /[{};\u0000-\u001f\u007f]|\/\*|\*\/|::/.test(selector) || /^\s*(?:\+js\(|\^)/.test(selector)) {
        result.rejected.unsafe++;
        continue;
      }
      try {
        sheet.insertRule(`${selector}{display:none!important}`, 0);
        sheet.deleteRule(0);
        result.selectors.push(selector);
      } catch { result.rejected.invalid++; }
    }
    // CSS handles newly inserted matching elements itself. Build at most 80
    // validated selectors per rule; content mutations need no selector scan.
    for (let offset = 0; offset < result.selectors.length; offset += 80) {
      const selector = `:is(${result.selectors.slice(offset, offset + 80).join(',')}):where(${protectedSelector})`;
      result.matchSelectors.push(selector);
    }
    result.cssText = result.matchSelectors.map(selector => `${selector}{display:none!important}`).join('\n');
    if (selection && typeof selection === 'object') compiled.set(selection, result);
    return result;
  }

  function compile(data, host) { return compileSelection(select(data, host)); }

  globalThis.BasicPublicCosmetics = Object.freeze({ select, compile, compileSelection });
})();
