import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";

const source = readFileSync(new URL("./src/js/admin-studio.js", import.meta.url), "utf8");
const styles = postcss.parse(readFileSync(new URL("./css/admin.css", import.meta.url), "utf8"));
function declarations(selector) {
  const result = {};
  styles.walkRules(rule => {
    if (rule.selector === selector) rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; });
  });
  return result;
}

test("shared Studio shell separates working controls from bottom document status", () => {
  const shell = source.slice(source.indexOf("function buildShell()"));
  const workbar = shell.slice(shell.indexOf('<div class="adm__workbar">'), shell.indexOf('<div class="adm__main">'));
  const footer = shell.slice(shell.indexOf('<footer class="adm__statusbar"'), shell.indexOf("'</footer>'"));
  for (const marker of ["data-hist", "data-prevtoggle", "data-dev-wrap", "data-newtab"]) assert.ok(workbar.includes(marker));
  for (const marker of ["adm__status\"", "data-draftmeter", 'data-act="logs-rec"']) {
    assert.ok(footer.includes(marker));
    assert.ok(!workbar.includes(marker));
  }
  assert.ok(shell.indexOf('<footer class="adm__statusbar"') > shell.indexOf('data-casestage'));
  assert.match(source, /function pubBar\(\) \{ return root && root.querySelector\("\.adm__statusbar"\)/);
  assert.match(source, /s\.title = msg/);
  assert.match(source, /s\.title = s\.textContent/);
  assert.match(source, /s\.title = label/);
});

test("Studio footer is compact and preview controls align right without absolute centering", () => {
  assert.equal(declarations(".adm__statusbar").height, "32px");
  assert.equal(declarations(".adm__statusbar :is(.adm__logs-btn,.adm__dmeter)").height, "24px");
  assert.equal(declarations(".adm__statusbar .adm__status").flex, "1");
  assert.equal(declarations(".adm__statusbar .adm__status").display, "block");
  assert.doesNotMatch(readFileSync(new URL("./css/admin.css", import.meta.url), "utf8"), /\.adm\.is-(?:prevoff|noprev) \.adm__logs-btn/);
  assert.equal(declarations(".adm__statusbar .adm__status")["max-width"], "none");
  assert.equal(declarations(".adm__prevgroup")["margin-left"], "auto");
  assert.equal(declarations(".adm__prevgroup").position, undefined);
  assert.equal(declarations(".adm__prevgroup").transform, undefined);
});