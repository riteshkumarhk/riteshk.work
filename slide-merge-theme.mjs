import { readFile } from "node:fs/promises";
import postcss from "postcss";
export function siteTokenCss(source) {
  const root = postcss.parse(source).nodes.find(node => node.type === "rule" && node.selector === ":root");
  const names = ["--bg","--bg-2","--bg-elev","--text","--text-dim","--text-faint","--line","--line-soft","--accent","--accent-2","--sans","--serif","--mono","--ease","--ease-io"];
  const declarations = names.map(name => {
    const declaration = root?.nodes.find(node => node.type === "decl" && node.prop === name);
    if (!declaration) throw new Error(`Missing site token ${name}`);
    return `${name}:${declaration.value}`;
  });
  return `:root{${declarations.join(";")}}`;
}
export function mergerThemePlugin() {
  return { name: "merger-site-tokens", setup(build) {
    build.onResolve({ filter: /^site-tokens\.css$/ }, () => ({ path: "site-tokens.css", namespace: "merger-tokens" }));
    build.onLoad({ filter: /.*/, namespace: "merger-tokens" }, async () => ({ contents: siteTokenCss(await readFile("css/styles.css","utf8")), loader: "css", watchFiles: ["css/styles.css"] }));
  } };
}