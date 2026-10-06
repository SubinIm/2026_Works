import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CSS contract tests, not a replacement for Chrome's real popup layout check.
const css = readFileSync(new URL("../src/popup/popup.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
function declarations(selector: string) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match => match[1].trim() === selector)
    .map(match => match[2]).join("\n");
}

test("action popup explicitly sizes its root within Chrome's 800x600 limit", () => {
  const root = declarations("html:not(.sidepanel)");
  assert.match(root, /width:\s*720px/);
  assert.match(root, /min-width:\s*720px/);
  assert.match(root, /height:\s*600px/);
  assert.doesNotMatch(root, /\b(?:vw|vh)\b/);
  const body = declarations("body:not(.sidepanel)");
  assert.match(body, /max-width:\s*none/);
  assert.match(body, /overflow-y:\s*auto/);
});

test("side panel is not forced to the popup width", () => {
  for (const selector of ["html.sidepanel", "body.sidepanel"]) {
    const rules = declarations(selector);
    assert.match(rules, /width:\s*100%/);
    assert.match(rules, /min-width:\s*0/);
    assert.doesNotMatch(rules, /720px/);
  }
});

test("action labels stay whole while action rows can wrap", () => {
  assert.match(declarations("button"), /white-space:\s*nowrap/);
  assert.match(declarations("button"), /flex-shrink:\s*0/);
  assert.match(declarations(".job-actions"), /flex-wrap:\s*wrap/);
  assert.match(declarations(".job-actions button"), /flex:\s*0 0 auto/);
});

test("option tooltips cannot intercept the actions underneath them", () => {
  assert.match(declarations(".help-tip"), /pointer-events:\s*none/);
  assert.match(declarations(".help-tip"), /max-width:\s*calc\(100vw - 48px\)/);
});
