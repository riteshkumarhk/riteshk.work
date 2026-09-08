import test from "node:test";
import assert from "node:assert/strict";
import { fontCatalog } from "./slide-lab-fonts.mjs";

test("hosted font catalogue keeps regular faces, subsets and stable IDs", () => {
  const css = "@font-face{font-family:'Example';font-style:normal;font-weight:300 700;src:url('../fonts/a.woff2');unicode-range:U+0000-00FF}@font-face{font-family:'Example';font-style:italic;font-weight:400;src:url('../fonts/b.woff2')}";
  const fonts = fontCatalog([{ css, base: "https://riteshk.work/css/fonts.css" }]);
  assert.equal(fonts.length, 1);
  assert.equal(fonts[0].faces.length, 1);
  assert.equal(fonts[0].faces[0].uri, "https://riteshk.work/fonts/a.woff2");
  assert.equal(fonts[0].faces[0].descriptors.unicodeRange, "U+0000-00FF");
  assert.equal(fontCatalog([{ css, base: "https://riteshk.work/css/fonts.css" }])[0].id, fonts[0].id);
});

test("catalogue rejects third-party font hosts", () => {
  assert.throws(() => fontCatalog([{ css: "@font-face{font-family:X;font-style:normal;src:url('https://example.com/font.woff2')}", base: "https://riteshk.work/css/fonts.css" }]), /platform hosted/);
});