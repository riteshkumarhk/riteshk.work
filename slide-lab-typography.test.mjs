import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { patchTypography, patchTextFormatting } from "./slide-lab-typography.mjs";
import { textFormat, textFontPrefix, formatTextLines } from "./src/js/slide-text-format.mjs";
import { publicDeckPayload } from "./src/js/slide-merge-visibility.mjs";

const source = readFileSync(new URL("./node_modules/@excalidraw/excalidraw/dist/dev/index.js", import.meta.url), "utf8");

test("selected text formatting is explicit, serializable and leaves unrelated metadata intact", () => {
  const element = { customData: { section: "retained", textFormat: { bold: true, italic: true, underline: true, strikethrough: false } } };
  const saved = JSON.stringify(element);
  assert.deepEqual(textFormat(JSON.parse(saved)), { bold: true, italic: true, underline: true, strikethrough: false });
  assert.equal(textFontPrefix(element), "italic bold ");
  assert.equal(textFontPrefix({}), "");
  assert.equal(textFontPrefix({ customData: { textFormat: { bold: "false" } } }), "");
  assert.equal(JSON.stringify(element), saved);
});

test("bullets and indents round trip multiline text without rewriting blank lines or existing bullets", () => {
  const text = "First\n\n  Second\nThird";
  const bulleted = formatTextLines(text, "bullets");
  assert.equal(bulleted, "\u2022 First\n\n  \u2022 Second\n\u2022 Third");
  assert.equal(formatTextLines(bulleted, "bullets"), text);
  assert.equal(formatTextLines("\u2022 First\nSecond", "bullets"), "\u2022 First\n\u2022 Second");
  assert.equal(formatTextLines("\u2022 First", "bullets", true), "\u2022 First");
  assert.equal(formatTextLines("Second", "bullets", true), "\u2022 Second");
  assert.equal(formatTextLines(formatTextLines(bulleted, "indent"), "outdent"), bulleted);
  assert.equal(formatTextLines("Plain\n One\n\tTwo", "outdent"), "Plain\nOne\nTwo");
  assert.equal(formatTextLines("\n  ", "bullets"), "\n  ");
});

test("typography adapter preserves native mutation, bound-text and mixed-selection resolution", () => {
  const patched = patchTypography(source);
  const action = patched.slice(patched.indexOf("var actionChangeFontSize"), patched.indexOf("var actionDecreaseFontSize"));
  assert.ok(action.includes("return changeFontSize(elements, appState, app, () => value, value);"));
  assert.ok(action.includes("jsx34(LabFontSizePicker"));
  assert.ok(action.includes("useContainer: useExcalidrawContainer"));
  assert.ok(action.includes("const boundTextElement = getBoundTextElement("));
  assert.ok(action.includes("(hasSelection) => hasSelection ? null"));
  assert.ok(patched.includes("icon: jsx31(LabFontLibraryIcon, {})"));
  assert.ok(patched.includes('className: "lab-type-value"'));
});

test("typography adapter fails closed when native boundaries or triggers change", () => {
  assert.throws(() => patchTypography(source.replace("var actionChangeFontSize =", "var renamedAction =")), /boundary/);
  assert.throws(() => patchTypography(source.replace('title: t("labels.showFonts"),', 'title: "Changed",')), /anchor/);
});

test("formatting adapter updates native actions, live editing, canvas and SVG together", () => {
  const patched = patchTextFormatting(source, "renderer");
  assert.match(patched, /renderAction\("labTextFormat"\)/);
  assert.match(patched, /textDecoration: labTextDecoration\(updatedTextElement\)/);
  assert.match(patched, /redrawTextBoundingBox\(updated/);
  const core = readFileSync(new URL("./node_modules/@excalidraw/excalidraw/dist/dev/chunk-4FTI6OG3.js", import.meta.url), "utf8");
  const rendered = patchTextFormatting(core, "core");
  assert.match(rendered, /labTextFontPrefix\(element\)/);
  const measure = runInNewContext(rendered.slice(rendered.indexOf("var measureText ="), rendered.indexOf("var DUMMY_TEXT =")) + ";measureText", { getTextHeight: (text, size, height) => text.split("\n").length * size * height, getTextWidth: () => 120 });
  for (const font of ["28px Inter", "bold 28px Inter", "italic bold 28px Inter"]) assert.equal(measure("One\nTwo", font, 1.25).height, 70);
  assert.match(rendered, /labDrawTextDecorations\(context, element/);
  assert.match(rendered, /text.setAttribute\("text-decoration", labTextDecoration\(element\)\)/);
  assert.throws(() => patchTextFormatting(source.replace('renderAction("changeFontSize"),', ""), "renderer"), /anchor changed/);
  assert.throws(() => patchTextFormatting(core.replace('var getFontString =', 'var changedFont ='), "core"), /anchor changed/);
});

test("public text preserves only approved style flags and ordinary bullet content", () => {
  const scene = { elements: [{ id: "lab-slide", type: "frame", x: 0, y: 0, width: 1280, height: 720 }, { id: "styled", type: "text", frameId: "lab-slide", text: "\u2022 Visible", customData: { textFormat: { bold: true, italic: true, underline: true, strikethrough: true, privateNote: "not public" } } }], files: {}, appState: {} };
  const payload = publicDeckPayload({ slidesPublic: true, slides: [{ id: "slide", scene }] }, { reviewedSources: true });
  const result = payload.slides[0].scene.elements.find(element => element.type === "text");
  assert.deepEqual(result.customData.textFormat, { bold: true, italic: true, underline: true, strikethrough: true });
  assert.equal(result.text, "\u2022 Visible");
  assert.doesNotMatch(JSON.stringify(payload), /privateNote|not public/);
});