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
export function mergerThemePlugin() {
  return { name: "merger-site-tokens", setup(build) {
    build.onResolve({ filter: /^site-tokens\.css$/ }, () => ({ path: "site-tokens.css", namespace: "merger-tokens" }));
    build.onLoad({ filter: /.*/, namespace: "merger-tokens" }, async () => ({ contents: siteTokenCss(await readFile("css/styles.css","utf8")), loader: "css", watchFiles: ["css/styles.css"] }));
  } };
}