// Convert declarative element-hiding syntax only. No source text is executed.
const own = (object, key) => Object.hasOwn(object, key);
const validHost = value => typeof value === 'string' && value.length <= 253 && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
const index = () => ({ generic: [], hosts: Object.create(null) });
const hideKinds = new Map([['elemhide', 'all'], ['ehide', 'all'], ['document', 'all'], ['generichide', 'generic'], ['ghide', 'generic'], ['specifichide', 'specific'], ['shide', 'specific']]);

function domains(value, delimiter = ',') {
  const include = new Set();
  const exclude = new Set();
  if (!value) return { include: [], exclude: [] };
  for (const raw of value.split(delimiter)) {
    const negated = raw.startsWith('~');
    const host = (negated ? raw.slice(1) : raw).toLowerCase();
    if (!validHost(host)) return null;
    (negated ? exclude : include).add(host);
  }
  return { include: [...include].sort(), exclude: [...exclude].sort() };
}

function selectorIssue(selector) {
  if (!selector || selector.length > 4096 || /[{};\u0000-\u001f\u007f]/.test(selector) || /\/\*|\*\//.test(selector)) return 'unsafe-selector-text';
  if (/^\s*(?:\+js\(|\^)|::|:(?:-abp-|contains\b|has-text\b|matches-(?:css|attr|prop|path|media)\b|xpath\b|upward\b|remove\b|remove-attr\b|remove-class\b|style\b|watch-attr\b|min-text-length\b|shadow\b)/i.test(selector)) return 'extended-or-procedural-selector';
  if (/^(?:\*|html|body|head|main|video|audio|script|style|:root)(?:\s*,\s*(?:\*|html|body|head|main|video|audio|script|style|:root))*$/i.test(selector.trim())) return 'unsafe-root-or-media-selector';
  return null;
}

function add(target, scope, value) {
  const record = { ...value, exclude: scope.exclude };
  if (!scope.include.length) target.generic.push(record);
  else for (const host of scope.include) {
    if (!own(target.hosts, host)) target.hosts[host] = [];
    target.hosts[host].push(record);
  }
}

function deduplicate(target) {
  const unique = values => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
  target.generic = unique(target.generic);
  for (const host of Object.keys(target.hosts)) target.hosts[host] = unique(target.hosts[host]);
  if (target.patterns) target.patterns = unique(target.patterns);
}

// Path/port/options-sensitive exceptions are deliberately widened to a whole
// literal host. An unrepresentable hostname is widened globally, never dropped.
function networkException(line) {
  if (!line.startsWith('@@')) return null;
  const split = line.lastIndexOf('$');
  if (split < 2) return null;
  const pattern = line.slice(2, split);
  const options = line.slice(split + 1).split(',');
  const kinds = [...new Set(options.map(option => hideKinds.get(option.toLowerCase())).filter(Boolean))];
  if (!kinds.length) return null;
  if (options.some(option => option.toLowerCase() === 'badfilter')) return { kinds: [], scope: { include: [], exclude: [] }, conservative: false };
  const domainPrefix = pattern.match(/^\|\|([a-z0-9-]+(?:\.[a-z0-9-]+)*\.)(?:\*?(?:[/:^|].*)?)?$/i);
  if (domainPrefix && validHost(domainPrefix[1].slice(0, -1).toLowerCase())) {
    return { kinds, scope: { hostPrefix: domainPrefix[1].toLowerCase(), subdomains: true, exclude: [] }, conservative: true };
  }
  const schemePrefix = pattern.match(/^(?:\|?https?)?:\/\/([a-z0-9.-]+)(.*)$/i);
  if (schemePrefix && validHost(schemePrefix[1].replace(/\.$/, '').toLowerCase())) {
    const host = schemePrefix[1].toLowerCase();
    if (/^[/:^|]/.test(schemePrefix[2]) && !host.endsWith('.')) {
      return { kinds, scope: { include: [host], exclude: [] }, conservative: true };
    }
    if (!schemePrefix[2]) return { kinds, scope: { hostPrefix: host, subdomains: false, exclude: [] }, conservative: true };
  }
  const literal = pattern.match(/^\|\|([a-z0-9.-]+)(?:\^|\/|:|\||$)/i) || pattern.match(/^\|?https?:\/\/([a-z0-9.-]+)(?:\^|\/|:|\||$)/i);
  if (literal && validHost(literal[1].toLowerCase())) {
    return { kinds, scope: { include: [literal[1].toLowerCase()], exclude: [] }, conservative: pattern !== `||${literal[1]}^` || options.some(option => !hideKinds.has(option.toLowerCase())) };
  }
  const domainOption = options.find(option => /^(?:domain|from)=/i.test(option));
  if (['*', ''].includes(pattern) && domainOption) {
    const scope = domains(domainOption.slice(domainOption.indexOf('=') + 1), '|');
    if (scope) return { kinds, scope, conservative: options.some(option => !hideKinds.has(option.toLowerCase()) && option !== domainOption) };
  }
  return { kinds, scope: { include: [], exclude: [] }, conservative: pattern !== '*' && pattern !== '' || options.some(option => !hideKinds.has(option.toLowerCase())) };
}

export function parseCosmeticSources(sources, _options = {}) {
  const hiding = index();
  const exceptions = index();
  const exemptions = index();
  exemptions.patterns = [];
  const report = { sources: [], accepted: { hiding: 0, exceptions: 0, exemptions: 0 }, unsupported: Object.create(null), conservativeExceptions: 0, examples: [] };
  const issue = (source, line, reason, text) => {
    report.unsupported[reason] = (report.unsupported[reason] || 0) + 1;
    if (report.examples.length < 80) report.examples.push({ source: source.id, line, reason, text: text.slice(0, 240) });
  };
  for (const source of sources) {
    const lines = String(source.text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    const sourceReport = { id: source.id, name: source.name, sourceUrl: source.sourceUrl, lines: lines.length, hiding: 0, exceptions: 0, exemptions: 0 };
    report.sources.push(sourceReport);
    let conditionalDepth = 0;
    for (const [offset, raw] of lines.entries()) {
      const line = raw.trim();
      const number = offset + 1;
      if (/^!#if\b/.test(line)) { conditionalDepth++; issue(source, number, 'conditional-section', line); continue; }
      if (/^!#endif\b/.test(line)) { conditionalDepth = Math.max(0, conditionalDepth - 1); continue; }
      // Unknown conditions cannot authorize new hiding rules. Still retain
      // every possible exception, including those in either branch.
      if (!line || line.startsWith('!') || line.startsWith('[')) continue;
      const exemption = networkException(line);
      if (exemption) {
        for (const kind of exemption.kinds) {
          if (exemption.scope.hostPrefix) exemptions.patterns.push({ kind, ...exemption.scope });
          else add(exemptions, exemption.scope, { kind });
        }
        sourceReport.exemptions += exemption.kinds.length;
        report.accepted.exemptions += exemption.kinds.length;
        if (exemption.conservative) { report.conservativeExceptions++; issue(source, number, 'widened-network-hide-exception', line); }
        continue;
      }
      const extended = line.match(/#@?(?:\$\?|\$|\?|%|\^)#/);
      if (extended) { issue(source, number, 'unsupported-cosmetic-separator', line); continue; }
      const match = line.match(/^(.*?)\s*(#@#|##)(.*)$/);
      if (!match) continue;
      const exception = match[2] === '#@#';
      if (conditionalDepth && !exception) continue;
      const selector = match[3].trim();
      const unsafe = selectorIssue(selector);
      if (unsafe) { issue(source, number, unsafe, line); continue; }
      let scope = domains(match[1].trim());
      if (!scope) {
        if (!exception) { issue(source, number, 'unsupported-domain-pattern', line); continue; }
        scope = { include: [], exclude: [] };
        report.conservativeExceptions++;
        issue(source, number, 'widened-selector-exception', line);
      }
      add(exception ? exceptions : hiding, scope, { selector });
      const kind = exception ? 'exceptions' : 'hiding';
      sourceReport[kind]++;
      report.accepted[kind]++;
    }
  }
  for (const target of [hiding, exceptions, exemptions]) deduplicate(target);
  return { data: { version: 1, generic: hiding.generic, hosts: hiding.hosts, exceptions, exemptions }, report };
}
