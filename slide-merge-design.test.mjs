import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const studio = postcss.parse(read("./css/admin.css"));
const dialogs = postcss.parse(read("./css/slide-merge-navigator.css"));
const controls = postcss.parse(read("./css/slide-merge-controls.css"));
function declarations(sheet, selector) {
  const rule = sheet.nodes.find(node => node.type === "rule" && node.selector === selector);
  assert.ok(rule, `Missing design rule: ${selector}`);
  return Object.fromEntries(rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value.replace(/\s+/g, "")]));
}
function parity(target, targetSelector, sourceSelector, properties) {
  const expected = declarations(studio, sourceSelector), actual = declarations(target, targetSelector);
  for (const property of properties) assert.equal(actual[property], expected[property], `${targetSelector}: ${property} must match ${sourceSelector}`);
}

test("Slide properties reuse native inspector groups without collapse controls", () => {
  const component = read("./src/js/slide-merge-properties.jsx");
  assert.match(component, /merge-slide-properties Island App-menu__left/);
  assert.match(component, /className="panelColumn"/);
  assert.doesNotMatch(component, /setExpanded|aria-expanded|<details|<summary|mobileOpen|merge-background-media/);
  for (const label of ["Layout", "Background", "Transition in", "Actions"]) assert.ok(component.includes(`<legend>${label}</legend>`));
  const properties = postcss.parse(read("./css/slide-merge-properties.css"));
  assert.equal(declarations(properties, ".merge-slide-properties").width, "200px");
  assert.equal(declarations(properties, ".merge-shell .merge-property-action")["text-transform"], "none");
});

test("mobile modal panels reuse the immersive bottom-sheet surface", () => {
  const sheet = postcss.parse(read("./css/slide-merge-mobile.css"));
  const mobile = sheet.nodes.find(node => node.type === "atrule" && node.params === "(max-width:900px)");
  const header = declarations(mobile, ".merge-shell .merge-sheet-head");
  assert.equal(header["border-radius"], "18px18px00");
  assert.equal(header.background, "var(--bg-elev)");
  assert.equal(header.bottom, "var(--mobile-panel-height)");
  assert.equal(header["justify-content"], "center");
  assert.equal(declarations(mobile, ".merge-sheet-head::before").width, "36px");
  const body = declarations(mobile, ".merge-shell[data-mobile-panel] .excalidraw :is(.merge-slide-properties,.selected-shape-actions,.App-mobile-menu,.default-sidebar,.merge-content-sidebar)");
  assert.equal(body.bottom, "0");
  assert.match(body["padding-bottom"], /safe-area-inset-bottom/);
  const reduced = sheet.nodes.find(node => node.type === "atrule" && node.params === "(prefers-reduced-motion:reduce)");
  assert.ok(reduced.nodes.some(rule => rule.nodes?.some(decl => decl.prop === "animation" && decl.value === "none")));
});

test("desktop insert toolbar uses the full canvas width before wrapping", () => {
  const toolbar = postcss.parse(read("./css/slide-merge-toolbar.css"));
  const desktop = toolbar.nodes.find(node => node.type === "atrule" && node.params === "(min-width:901px)");
  const style = declarations(desktop, ".merge-canvas-tools");
  assert.equal(style.left, "50%");
  assert.equal(style["max-width"], "calc(100%-32px)");
  assert.equal(style.width, "max-content");
  assert.equal(style["flex-wrap"], "wrap");
});

test("layer drag badge counts selected rows rather than bound companions", () => {
  const drag = read("./src/js/slide-merge-layer-drag.jsx");
  assert.ok(drag.includes('`${dragging.sourceIds.length} layers`'));
  assert.ok(!drag.includes('`${dragging.ids.size} layers`'));
});

test("shared dialogs use the actual Studio surface and title contract", () => {
  parity(dialogs, ".merge-deck-dialog", ".pass__box", ["background", "border", "border-radius", "padding", "text-align", "box-shadow"]);
  parity(dialogs, ".merge-deck-dialog h2", ".pass__title", ["font-family", "font-weight", "font-size", "color"]);
  parity(dialogs, ".merge-deck-dialog footer button", ".btn", ["font-family", "font-size", "text-transform", "border-radius", "padding", "border", "transition"]);
  parity(dialogs, ".merge-deck-dialog footer .merge-dialog-primary", ".btn--primary", ["background", "border-color", "color", "font-weight", "box-shadow"]);
  parity(dialogs, ".merge-deck-dialog footer .merge-dialog-primary:hover:not(:disabled)", ".btn--primary:hover", ["background", "border-color", "color", "box-shadow"]);
  parity(dialogs, ".merge-deck-dialog>header>button", ".prep-dialog__x", ["top", "right", "background", "border", "color", "border-radius"]);
  parity(dialogs, ".merge-deck-dialog>header>button:hover", ".prep-dialog__x:hover", ["color", "background"]);
});

test("native engine dialogs are themed, not just recolored", () => {
  parity(controls, "html:has(.merge-shell) .excalidraw .Dialog__title", ".pass__title", ["font-family", "font-weight", "font-size", "color"]);
  parity(controls, "html:has(.merge-shell) .excalidraw .Modal__content", ".pass__box", ["background", "border", "border-radius", "padding", "box-shadow"]);
  parity(controls, "html:has(.merge-shell) .excalidraw .Dialog__close", ".prep-dialog__x", ["top", "right", "background", "border", "color", "border-radius"]);
});

test("labelled commands share Studio button anatomy without converting icon tools", () => {
  const command = controls.nodes.find(node => node.type === "rule").selector;
  parity(controls, command, ".btn", ["font-family", "font-size", "text-transform", "border-radius", "padding", "border", "background", "color", "transition"]);
  assert.doesNotMatch(command, /merge-tool-pop|merge-layer-panel|merge-layout-pick|input|slider/);
});

test("slide delete is direct and keyboard scoped to slide cards", () => {
  const editor = read("./src/js/slide-merge.jsx"), navigator = read("./src/js/slide-merge-navigator.jsx");
  assert.doesNotMatch(editor, /<dialog/);
  assert.doesNotMatch(editor, /Delete this slide\?|setConfirm/);
  assert.match(editor, /remove=\{removeSlide\}/);
  assert.match(editor, /!\["Delete", "Backspace"\]\.includes\(event.key\) \|\| event.repeat/);
  assert.match(editor, /document.activeElement\?\.closest\("\.merge-slide"\)/);
  assert.match(editor, /trigger\?\.isConnected && document.activeElement === document.body/);
  assert.match(editor, /React.useLayoutEffect\(\(\) => \{\s*if \(busy\) return;\s*const trigger = selectedSlideFocus.current;/);
  assert.match(editor, /event.target.closest\("\[data-slide-delete-id\]"\)/);
  assert.match(navigator, /data-slide-delete-id=\{slide.id\}/);
  assert.match(navigator, /input:not\(:disabled\), footer button:not\(:disabled\)/);
});

test("narrow dialogs and wide tools retain their distinct Studio anatomy", () => {
  parity(dialogs, ".merge-deck-dialog", ".pass__box", ["width"]);
  parity(dialogs, ".merge-deck-dialog--wide", ".pass--wide .pass__box", ["width", "max-height", "text-align"]);
  parity(dialogs, ".merge-deck-dialog--wide footer button", ".pass--wide .pass__actions .btn", ["flex", "min-width"]);
  const navigator = read("./src/js/slide-merge-navigator.jsx");
  assert.match(navigator, /wide && <Action icon="close"/);
  assert.match(navigator, /<DeckDialog wide=\{false\} title=\{value/);
});

test("opacity uses the secondary slider token while primary sliders retain gold", () => {
  const tokens = declarations(controls, ".merge-shell");
  assert.equal(tokens["--ui-slider-primary"], "var(--accent)");
  assert.equal(tokens["--ui-slider-secondary"], "var(--text-dim)");
  assert.equal(declarations(controls, ".merge-shell .excalidraw .range-input")["--color-slider-track"], "var(--ui-slider-primary)");
  const secondary = controls.nodes.find(node => node.type === "rule" && node.selector.includes('[data-testid="opacity"]'));
  assert.equal(declarations(controls, secondary.selector)["--color-slider-track"], "var(--ui-slider-secondary)");
});

test("editing and slide-view controls share a stable border-box height", () => {
  const bar = postcss.parse(read("./css/slide-merge-bar.css"));
  const shared = declarations(bar, ".merge-layout-toggle,.merge-slideview");
  assert.equal(shared.height, "34px");
  assert.equal(shared["box-sizing"], "border-box");
  assert.equal(declarations(bar, ".merge-slideview").padding, "0.55rem");
});

test("save status, visibility and recording belong in the bottom status bar", () => {
  const editor = read("./src/js/slide-merge.jsx"), bar = read("./src/js/slide-merge-bar.jsx");
  assert.match(editor, /<footer className="merge-status"[^>]*>\s*<StatusControls\b[^>]*>\s*<VisibilityMenu\b[\s\S]*?<\/StatusControls>/);
  assert.doesNotMatch(bar.slice(bar.indexOf("export function EditorBar"), bar.indexOf("export function StatusControls")), /role="status"|merge-bar-record|merge-bar-actions/);
  assert.match(bar, /className=\{`merge-save-status[\s\S]*?role="status" title=\{status\}/);
  assert.doesNotMatch(editor, /<span>Local draft<\/span>/);
  const styles = postcss.parse(read("./css/slide-merge-bar.css"));
  assert.equal(declarations(styles, ".merge-shell")["grid-template-rows"], "64px48pxminmax(0,1fr)32px");
  assert.equal(declarations(styles, ".merge-shell .merge-status .merge-visibility summary,.merge-shell .merge-status .merge-bar-record").height, "24px");
  assert.equal(declarations(styles, ".merge-save-status")["text-overflow"], "ellipsis");
  const mobile = styles.nodes.find(node => node.type === "atrule" && node.params === "(max-width:900px)");
  assert.equal(declarations(mobile, ".merge-shell .merge-status").display, "flex");
  assert.equal(declarations(mobile, ".merge-shell .merge-status .merge-slide-position").display, "block");
  assert.doesNotMatch(editor.match(/<header className="merge-header">[\s\S]*?<\/header>/)[0], /VisibilityMenu/);
  assert.match(bar, /<div className="merge-bar-actions">\{children\}<button[^>]*merge-bar-record/);
  const visibility = postcss.parse(read("./css/slide-merge-visibility.css"));
  assert.equal(declarations(visibility, ".merge-bar-actions .merge-visibility summary").height, "34px");
  assert.equal(declarations(visibility, ".merge-bar-actions .merge-visibility summary").width, "40px");
  assert.equal(declarations(visibility, ".merge-bar-actions .merge-visibility summary>svg").width, "18px");
  assert.match(read("./src/js/slide-merge-visibility.jsx"), /showChevron=\{false\}/);
  assert.match(read("./src/js/slide-merge-toolbar.jsx"), /showChevron = true/);
});

test("lab sidebars dismiss from canvas clicks, not editor controls", () => {
  assert.ok(read("./slide-lab-engine.mjs").includes('islandRef.current?.closest(".merge-shell") && !event.target.closest(".excalidraw__canvas")'));
});

test("library sync belongs only to the native Library panel", () => {
  const editor = read("./src/js/slide-merge.jsx");
  assert.match(editor, /<DefaultSidebar[\s\S]*?libraryOpen && <div className="merge-library-status">[\s\S]*?onClick=\{library.retry\}[\s\S]*?<\/DefaultSidebar>/);
  const footer = editor.slice(editor.indexOf('<footer className="merge-status"'), editor.indexOf('</footer>', editor.indexOf('<footer className="merge-status"')));
  assert.doesNotMatch(footer, /merge-library-sync|library.status/);
  assert.match(footer, /StatusControls/);
});

test("top working controls align right on desktop and mobile", () => {
  const styles = postcss.parse(read("./css/slide-merge-bar.css"));
  assert.equal(declarations(styles, ".merge-editor-bar")["grid-template-columns"], "minmax(0,1fr)auto");
  const mobile = styles.nodes.find(node => node.type === "atrule" && node.params === "(max-width:900px)");
  assert.equal(declarations(mobile, ".merge-bar-views")["justify-content"], "flex-end");
});

test("footer status fills available space and pushes actions right", () => {
  const styles = postcss.parse(read("./css/slide-merge-bar.css"));
  const status = declarations(styles, ".merge-save-status");
  assert.equal(status.flex, "1");
  assert.equal(status["min-width"], "0");
  assert.equal(status["max-width"], undefined);
  assert.equal(declarations(styles, ".merge-status-controls .merge-bar-actions")["flex-shrink"], "0");
});

test("menu opening rotates only explicit chevrons, never the visibility icon", () => {
  const theme = postcss.parse(read("./css/slide-merge-theme.css"));
  assert.match(read("./src/js/slide-merge-toolbar.jsx"), /data-tool-icon=\{name\}/);
  assert.equal(declarations(theme, '.merge-shell .merge-tool-menu[open] summary [data-tool-icon="chevron"]').transform, "rotate(180deg)");
  theme.walkRules(rule => {
    if (rule.selector.includes("merge-tool-menu")) assert.doesNotMatch(rule.selector, /svg:last-child/);
  });
});

test("empty decks and history shortcuts share existing action surfaces", () => {
  const editor = read("./src/js/slide-merge.jsx"), bar = read("./src/js/slide-merge-bar.jsx"), navigator = read("./src/js/slide-merge-navigator.jsx");
  assert.match(editor, /<section className="merge-empty"/);
  assert.match(editor, /<SlideAddActions add=\{add\}/);
  assert.match(navigator, /label="Add a slide" disabled=\{busy \|\| !deck\?\.slides.length\}/);
  assert.doesNotMatch(editor + navigator + bar, /slides.length < 2|Keep at least one slide/);
  assert.match(bar, /const current = keyboardState.current/);
  assert.match(bar, /document.removeEventListener\("keydown", keyboard, true\);\s*\}, \[\]\)/);
  assert.match(bar, /control.getClientRects\(\).length/);
  assert.match(bar, /button.click\(\)/);
});