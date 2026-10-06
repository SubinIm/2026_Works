// Upstream conditional syntax is evaluated only by this development tool.
// Unknown tokens fail the build instead of silently choosing an unsafe branch.
const FLAGS = Object.freeze({
  adguard: true, adguard_ext_chromium: true, adguard_ext_chromium_mv3: true,
  adguard_ext_edge: false, adguard_ext_firefox: false, adguard_ext_safari: false,
  adguard_ext_android_cb: false, adguard_app_android: false, adguard_app_ios: false,
  adguard_app_mac: false, adguard_app_windows: false, adguard_app_cli: false,
  chromium: true, ext_chromium: true, env_chromium: true, env_mv3: true,
  env_firefox: false, env_safari: false, env_mobile: false, cap_html_filtering: false,
});

export function evaluateCondition(expression, flags = FLAGS) {
  const tokens = expression.match(/&&|\|\||!|\(|\)|[a-zA-Z_][a-zA-Z0-9_]*/g) ?? [];
  if (tokens.join('') !== expression.replace(/\s/g, '')) throw new Error(`Unsupported preprocessor expression: ${expression}`);
  let cursor = 0;
  const primary = () => {
    const token = tokens[cursor++];
    if (token === '!') return !primary();
    if (token === '(') {
      const value = or();
      if (tokens[cursor++] !== ')') throw new Error('Unbalanced filter condition.');
      return value;
    }
    if (!Object.hasOwn(flags, token)) throw new Error(`Unknown filter platform token: ${token}`);
    return flags[token];
  };
  const and = () => {
    let value = primary();
    while (tokens[cursor] === '&&') { cursor++; const next = primary(); value = value && next; }
    return value;
  };
  const or = () => {
    let value = and();
    while (tokens[cursor] === '||') { cursor++; const next = and(); value = value || next; }
    return value;
  };
  const result = or();
  if (cursor !== tokens.length) throw new Error(`Trailing preprocessor tokens: ${expression}`);
  return result;
}

export function preprocessSource(source) {
  const stack = [];
  const skipped = [];
  const active = () => stack.every(branch => branch.active);
  const text = source.text.split(/\r?\n/).map((line, index) => {
    const directive = line.trim();
    if (directive.startsWith('!#if ')) {
      stack.push({ active: evaluateCondition(directive.slice(5)), elseSeen: false });
      return '';
    }
    if (directive === '!#else') {
      if (!stack.length || stack.at(-1).elseSeen) throw new Error(`Invalid !#else in ${source.name}:${index + 1}`);
      stack.at(-1).active = !stack.at(-1).active;
      stack.at(-1).elseSeen = true;
      return '';
    }
    if (directive === '!#endif') {
      if (!stack.length) throw new Error(`Unmatched !#endif in ${source.name}:${index + 1}`);
      stack.pop();
      return '';
    }
    if (/^!#safari_cb_affinity(?:\([a-z,]+\))?$/.test(directive)) return '';
    if (directive.startsWith('!#')) throw new Error(`Unsupported source directive in ${source.name}:${index + 1}: ${directive}`);
    if (!active()) {
      if (directive && !directive.startsWith('!')) skipped.push({ line: index + 1, sourceRule: line, reason: 'platform-not-chromium-mv3' });
      return '';
    }
    return line;
  }).join('\n');
  if (stack.length) throw new Error(`Unclosed filter platform condition in ${source.name}`);
  return { ...source, text, platformSkipped: skipped };
}
