/* ---------------------------------------------------------------------------
   Build — bundles ES-module sources in src/js/ into the js/<name>.js files that
   index.html already loads. Output stays an IIFE and preserves the window.RK
   runtime contract, so nothing about how the site is served changes: GitHub
   Pages keeps serving main/ root, and admin "Publish" (which writes content.json
   via the GitHub API) is untouched.

   Usage:  npm run build     one-off build
           npm run watch     rebuild on change (local dev)

   The ENTRIES list grows one file per migration phase; anything not listed here
   stays as its current hand-written js/ file until it is migrated.
--------------------------------------------------------------------------- */
import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

// Public entries already migrated to ES modules (built → js/<name>.js).
const ENTRIES = ["journey"];

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ENTRIES.map((name) => ({ in: `src/js/${name}.js`, out: name })),
  outdir: "js",
  bundle: true,
  format: "iife",
  target: ["es2020"],
  charset: "utf8",
  legalComments: "none",
  logLevel: "info"
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("esbuild: watching src/js …");
} else {
  await build(options);
  console.log("esbuild: built " + ENTRIES.map((n) => "js/" + n + ".js").join(", "));
}
