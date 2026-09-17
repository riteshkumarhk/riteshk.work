import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { patchTypography, patchTextFormatting } from "./slide-lab-typography.mjs";
import { textFormat, textFontPrefix, formatTextLines, textListLine, textCase, displayText, TEXT_CASES } from "./src/js/slide-text-format.mjs";
import { publicDeckPayload } from "./src/js/slide-merge-visibility.mjs";

const source = readFileSync(new URL("./node_modules/@excalidraw/excalidraw/dist/dev/index.js", import.meta.url), "utf8");

test("case styles preserve original typing and small caps use native font variants", () => {
  const originalText = "  hELLo NASA\n\u2022 don't STOP: d\u00e9j\u00e0-vu! 42";
  const expected = [originalText, "  HELLO NASA\n\u2022 DON'T STOP: D\u00c9J\u00c0-VU! 42", "  hello nasa\n\u2022 don't stop: d\u00e9j\u00e0-vu! 42", "  HELLo NASA\n\u2022 Don't STOP: D\u00e9j\u00e0-Vu! 42", originalText];
  for (const [index, mode] of TEXT_CASES.entries()) {
    const element = { originalText, customData: { textFormat: { case: mode, bold: true, italic: true } } };
    assert.equal(displayText(element), expected[index]);
    assert.equal(element.originalText, originalText);
    assert.equal(textCase(JSON.parse(JSON.stringify(element))), mode);
    assert.equal(textFontPrefix(element), mode === "small-caps" ? "italic small-caps bold " : "italic bold ");
  }
  assert.equal(displayText({ originalText, customData: { textFormat: { case: "invalid" } } }), originalText);
  assert.equal(textCase({}), "typed");
  assert.equal(displayText({ customData: { textFormat: { case: "upper" } } }, "stra\u00dfe"), "STRASSE");
});

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

test("dot number alphabet and dash list styles preserve content and indentation across conversions", () => {
  const plain = "First\n\n  Second\nThird";
  const expected = { dot: "\u2022 First\n\n  \u2022 Second\n\u2022 Third", number: "1. First\n\n  2. Second\n3. Third", alphabet: "a. First\n\n  b. Second\nc. Third", dash: "- First\n\n  - Second\n- Third" };
  for (const [style, text] of Object.entries(expected)) {
    assert.equal(formatTextLines(plain, "bullet-style", style), text);
    assert.equal(formatTextLines(text, "bullets", false), plain);
    assert.equal(textListLine(text.split("\n")[0]).style, style);
    for (const [nextStyle, nextText] of Object.entries(expected)) assert.equal(formatTextLines(text, "bullet-style", nextStyle), nextText);
  }
  assert.equal(formatTextLines(Array.from({ length: 28 }, () => "Item").join("\n"), "bullet-style", "alphabet").split("\n").slice(-3).join("\n"), "z. Item\naa. Item\nab. Item");
  assert.equal(formatTextLines("Design. Keep this wording\n-1 is negative", "bullets", false), "Design. Keep this wording\n-1 is negative");
  assert.equal(formatTextLines(plain, "bullet-style", "unsupported"), plain);
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
  for (const font of ["28px Inter", "bold 28px Inter", "italic bold 28px Inter", "italic small-caps bold 28px Inter"]) assert.equal(measure("One\nTwo", font, 1.25).height, 70);
  assert.match(rendered, /labDrawTextDecorations\(context, element/);
  assert.match(rendered, /text.setAttribute\("text-decoration", labTextDecoration\(element\)\)/);
  const FontCharacters = runInNewContext("class Fonts {" + rendered.slice(rendered.indexOf("  static getCharsPerFamily("), rendered.indexOf("  static getCharacters(")) + "};Fonts", { isTextElement: element => element.type === "text", labDisplayText: displayText, labTextCase: textCase });
  for (const mode of ["upper", "small-caps", "title"]) {
    const element = { type: "text", fontFamily: 1, originalText: "abc", customData: { textFormat: { case: mode } } };
    const characters = [...FontCharacters.getCharsPerFamily([element])[1]].join("");
    assert.ok(characters.includes("a") && characters.includes("A"), "Font subsets include source and displayed glyphs");
    assert.equal(element.originalText, "abc");
  }
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
  for (const mode of [...TEXT_CASES, "unsupported"]) {
    scene.elements[1].customData.textFormat.case = mode;
    const exported = publicDeckPayload({ slidesPublic: true, slides: [{ id: "slide", scene }] }, { reviewedSources: true }).slides[0].scene.elements.find(element => element.type === "text");
    assert.equal(textCase(exported), TEXT_CASES.includes(mode) ? mode : "typed");
    assert.doesNotMatch(JSON.stringify(exported), /privateNote|unsupported/);
  }
});