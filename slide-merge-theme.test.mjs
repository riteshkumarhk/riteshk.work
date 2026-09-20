import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { siteTokenCss, studioTypographyCss } from "./slide-merge-theme.mjs";
import { runInNewContext } from "node:vm";
import { canvasTheme, coverAppearanceElements, COVER_LIGHT_PALETTE } from "./src/js/slide-merge-appearance.mjs";
import { coverSkeleton, COVER_DEFAULTS } from "./src/js/slide-merge-cover.mjs";

test("cover appearance follows site tokens without changing saved artwork or custom colours", () => {
  const source = readFileSync(new URL("./css/styles.css", import.meta.url), "utf8");
  const css = siteTokenCss(source);
  for (const color of Object.values(COVER_LIGHT_PALETTE)) assert.ok(css.includes(color));
  const elements = coverSkeleton({title:"Original title", team:"Design", image:{fileId:"original",width:1600,height:900}}, 2);
  elements.find(element => element.customData.slideCover === "rail").backgroundColor = "#123456";
  elements.push({type:"rectangle",backgroundColor:COVER_DEFAULTS.background}, {type:"rectangle",backgroundColor:COVER_DEFAULTS.background,isDeleted:true,customData:{slideCover:"background"}});
  const saved = structuredClone(elements), light = coverAppearanceElements(elements, "light");
  assert.equal(light.find(element => element.customData?.slideCover === "background").backgroundColor, COVER_LIGHT_PALETTE.background);
  assert.equal(light.find(element => element.customData?.slideCover === "title").strokeColor, COVER_LIGHT_PALETTE.text);
  assert.equal(light.find(element => element.customData?.slideCover === "rail").backgroundColor, "#123456");
  assert.equal(light.find(element => element.type === "image"), elements.find(element => element.type === "image"));
  assert.equal(light.at(-2), elements.at(-2));
  assert.equal(light.at(-1), elements.at(-1));
  assert.deepEqual(coverAppearanceElements(light, "dark"), saved);
  assert.deepEqual(elements, saved);
  assert.deepEqual(light.map(({strokeColor,backgroundColor,...element}) => element), saved.map(({strokeColor,backgroundColor,...element}) => element));
  const legacy = elements.map(element => { const copy = structuredClone(element); if (copy.customData) delete copy.customData.slideCover; return copy; });
  assert.equal(coverAppearanceElements(legacy, "light")[0].backgroundColor, COVER_LIGHT_PALETTE.background);
  const incomplete = legacy.filter(element => element.width !== 136);
  assert.deepEqual(coverAppearanceElements(incomplete, "light"), incomplete);
});

test("merger uses authoritative site tokens and ignores later theme overrides", () => {
  const source=readFileSync(new URL("./css/styles.css",import.meta.url),"utf8");
  const css=siteTokenCss(source+"\n:root{--accent:red}");
  assert.match(css,/--accent:#D8A657/i);
  assert.match(css,/--bg:#08080a/i);
  assert.match(css,/--sans:/);
  assert.match(css,/html\[data-appearance="light"\]\{--bg:#f2eee6/i);
  assert.match(css,/--accent:#9c6b1a/i);
  assert.doesNotMatch(css,/--accent:red/);
});

test("missing site tokens fail the build instead of silently falling back", () => {
  assert.throws(()=>siteTokenCss(":root{--bg:#000}"),/Missing site token --bg-2/);
});

test("canvas follows appearance without changing explicitly authored backgrounds", () => {
  assert.equal(canvasTheme([], "dark"), "dark");
  assert.equal(canvasTheme([], "light"), "light");
  const background = { customData: { slideBackground: true } };
  assert.equal(canvasTheme([background], "dark"), "light");
  assert.equal(canvasTheme([{ ...background, isDeleted: true }], "dark"), "dark");
});

test("appearance follows system, saved site modes and cross-tab changes", () => {
  let stored = null, hour = 12;
  const attributes = {}, handlers = {}, media = { matches: false, addEventListener: (name, handler) => { handlers.media = handler; } };
  const window = { matchMedia: () => media, addEventListener: (name, handler) => { handlers[name] = handler; }, dispatchEvent() {} };
  runInNewContext(readFileSync(new URL("./studio/slide-merge-lab/appearance.js", import.meta.url), "utf8"), {
    window, document: { documentElement: { setAttribute: (name, value) => { attributes[name] = value; } } },
    localStorage: { getItem: () => stored, setItem: (name, value) => { stored = value; } },
    CustomEvent: class {}, Date: class { getHours() { return hour; } }, setInterval: () => 1, clearInterval() {}
  });
  assert.equal(attributes["data-appearance"], "dark");
  media.matches = true; handlers.media();
  assert.equal(attributes["data-appearance"], "light");
  window.__theme.set("night"); handlers.media();
  assert.equal(attributes["data-appearance"], "dark");
  window.__theme.set("day");
  assert.equal(attributes["data-appearance"], "light");
  window.__theme.set("local");
  assert.equal(attributes["data-appearance"], "light");
  hour = 22; handlers.focus();
  assert.equal(attributes["data-appearance"], "dark");
  stored = "system"; handlers.storage({ key: "rk:theme" });
  assert.equal(attributes["data-appearance"], "light");
});

test("lab UI inherits the selected Studio typography, not the default serif fallback", () => {
  const content = JSON.parse(readFileSync(new URL("./content.json", import.meta.url), "utf8"));
  const fonts = ["./css/fonts.css", "./css/fonts-systems.css"].map(path => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  const active = content.typography.systems.find(system => system.id === content.typography.active);
  const result = studioTypographyCss(content.typography, fonts);
  for (const role of ["display", "text", "mono"]) assert.ok(result.includes(active[role].stack));
  assert.ok(result.includes("@font-face"));
  assert.doesNotMatch(studioTypographyCss(content.typography, ""), /--serif:|--sans:|--mono:/);
  assert.equal(studioTypographyCss(null, fonts), "");
});