import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { siteTokenCss } from "./slide-merge-theme.mjs";

test("merger uses authoritative site tokens and ignores later theme overrides", () => {
  const source=readFileSync(new URL("./css/styles.css",import.meta.url),"utf8");
  const css=siteTokenCss(source+"\n:root{--accent:red}");
  assert.match(css,/--accent:#D8A657/i);
  assert.match(css,/--bg:#08080a/i);
  assert.match(css,/--sans:/);
  assert.doesNotMatch(css,/--accent:red/);
});

test("missing site tokens fail the build instead of silently falling back", () => {
  assert.throws(()=>siteTokenCss(":root{--bg:#000}"),/Missing site token --bg-2/);
});