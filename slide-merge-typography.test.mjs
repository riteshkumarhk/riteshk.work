import test from "node:test";
import assert from "node:assert/strict";
import { typographySystem, publishedTypography, applyStudioTypography } from "./src/js/slide-merge-typography.mjs";

const bureau = { id:"bureau", display:{family:"Schibsted Grotesk",stack:'"Schibsted Grotesk", sans-serif',weight:400,selfHosted:true}, text:{family:"Hanken Grotesk",stack:'"Hanken Grotesk", sans-serif',selfHosted:true}, mono:{family:"Martian Mono",stack:'"Martian Mono", monospace',selfHosted:true} };
function fakeDocument() {
  const elements = new Map(), properties = new Map();
  return { elements, properties, documentElement:{dataset:{},style:{setProperty:(key,value)=>properties.set(key,value),removeProperty:key=>properties.delete(key)}},
    getElementById:id=>elements.get(id),
    head:{appendChild:element=>elements.set(element.id,element)},
    createElement:tag=>({tag,setAttribute(name,value){this[name]=value;},getAttribute(name){return this[name];},remove(){elements.delete(this.id);}}) };
}

test("runtime selects active or first system with the Studio semantics", () => {
  assert.equal(typographySystem({typography:{active:"bureau",systems:[{id:"other"},bureau]}}),bureau);
  assert.equal(typographySystem({typography:{active:"missing",systems:[bureau]}}),bureau);
  assert.equal(typographySystem({}),null);
});

test("public settings refresh uses R2 then Pages, without draft storage or credentials", async () => {
  const calls = [];
  const result = await publishedTypography(async (url, options) => {
    calls.push({url,options});
    if (calls.length === 1) throw new Error("offline");
    return {ok:true,json:async()=>({typography:{active:"bureau",systems:[bureau]}})};
  });
  assert.equal(result,bureau);
  assert.equal(calls[1].url,"/content.json");
  assert.equal(calls[0].options.credentials,"omit");
  assert.equal(calls[0].options.cache,"no-store");
  const controller = new AbortController(); controller.abort();
  let count = 0;
  await assert.rejects(publishedTypography(async()=>{count++;throw new Error("aborted");},controller.signal));
  assert.equal(count,1);
});

test("UI font application updates roles and font sources without touching scene data", () => {
  const document = fakeDocument();
  applyStudioTypography(bureau,document);
  assert.equal(document.properties.get("--serif"),bureau.display.stack);
  assert.equal(document.properties.get("--sans"),bureau.text.stack);
  assert.equal(document.properties.get("--mono"),bureau.mono.stack);
  assert.equal(document.documentElement.dataset.typographySource,"published");
  assert.equal(document.elements.get("merge-type-builtins").href,"/css/fonts-systems.css?v=1");
  assert.equal(document.elements.has("merge-type-google"),false);
  applyStudioTypography({...bureau,id:"external",text:{stack:"Test",src:"google",css:"Test:wght@400"},faces:[{family:"Custom",url:"https://media.riteshk.work/custom.woff2",weight:"300 700"},{family:"Injected",url:"x');}body{color:red}"}]},document);
  assert.match(document.elements.get("merge-type-google").href,/Test:wght@400/);
  assert.match(document.elements.get("merge-type-faces").textContent,/font-family:'Custom'/);
  assert.doesNotMatch(document.elements.get("merge-type-faces").textContent,/Injected|body/);
  applyStudioTypography(bureau,document);
  assert.equal(document.elements.has("merge-type-google"),false);
  assert.equal(document.elements.has("merge-type-faces"),false);
  assert.equal(document.elements.size,1);
});