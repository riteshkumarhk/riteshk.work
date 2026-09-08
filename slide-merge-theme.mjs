import { readFile } from "node:fs/promises";
import postcss from "postcss";
export function siteTokenCss(source) {
  const rules = postcss.parse(source).nodes;
  const root = rules.find(node => node.type === "rule" && node.selector === ":root");
  const names = ["--bg","--bg-2","--bg-elev","--text","--text-dim","--text-faint","--line","--line-soft","--accent","--accent-2","--sans","--serif","--mono","--ease","--ease-io"];
  const declarations = names.map(name => {
    const declaration = root?.nodes.find(node => node.type === "decl" && node.prop === name);
    if (!declaration) throw new Error(`Missing site token ${name}`);
    return `${name}:${declaration.value}`;
  });
  const light = rules.find(node => node.type === "rule" && node.selector === 'html[data-appearance="light"]');
  const overrides = names.slice(0,10).map(name => {
    const declaration = light?.nodes.find(node => node.type === "decl" && node.prop === name);
    if (!declaration) throw new Error(`Missing light site token ${name}`);
    return `${name}:${declaration.value}`;
  });
  return `:root{${declarations.join(";")}}html[data-appearance="light"]{${overrides.join(";")}}`;
}
export function studioTypographyCss(typography, fontSource) {
  const systems = typography?.systems;
  if (!systems?.length) return "";
  const active = systems.find(system => system.id === typography.active) || systems[0];
  const root = postcss.root(), tokens = postcss.rule({ selector:":root" });
  const faces = postcss.parse(fontSource);
  const added = new Set();
  for (const [role, token] of [["display", "--serif"], ["text", "--sans"], ["mono", "--mono"]]) {
    const font = active[role];
    if (!font?.stack) continue;
    if (/[{};]/.test(font.stack)) throw new Error(`Invalid Studio font stack: ${role}`);
    let found = false;
    faces.walkAtRules("font-face", face => {
      const family = face.nodes.find(node => node.prop === "font-family")?.value.replace(/^['"]|['"]$/g, "");
      if (family !== font.family) return;
      found = true;
      if (!added.has(face.toString())) { root.append(face.clone()); added.add(face.toString()); }
    });
    if (found) tokens.append(postcss.decl({ prop:token, value:font.stack }));
  }
  root.append(tokens);
  return root.toString();
}
export function mergerThemePlugin() {
  return { name: "merger-site-tokens", setup(build) {
    build.onResolve({ filter: /^site-tokens\.css$/ }, () => ({ path: "site-tokens.css", namespace: "merger-tokens" }));
    build.onLoad({ filter: /.*/, namespace: "merger-tokens" }, async () => {
      const [styles, content, fonts, systemFonts] = await Promise.all(["css/styles.css", "content.json", "css/fonts.css", "css/fonts-systems.css"].map(path => readFile(path, "utf8")));
      return { contents:siteTokenCss(styles) + studioTypographyCss(JSON.parse(content).typography, fonts + systemFonts), loader:"css", resolveDir:process.cwd(), watchFiles:["css/styles.css", "content.json", "css/fonts.css", "css/fonts-systems.css"] };
    });
  } };
}