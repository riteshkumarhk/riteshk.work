import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { cornerEnginePlugin } from "./slide-lab-engine.mjs";
import { checkLabAssets } from "./slide-lab-security.mjs";

await rm("studio/slide-lab/assets", { recursive: true, force: true });
await build({
  entryPoints: { app: "src/js/slide-lab.jsx", native: "src/js/slide-lab-native.js" },
  outdir: "studio/slide-lab/assets",
  entryNames: "[name]",
  chunkNames: "chunk-[hash]",
  assetNames: "[name]-[hash]",
  bundle: true,
  splitting: true,
  format: "esm",
  conditions: ["production"],
  plugins: [cornerEnginePlugin()],
  loader: { ".woff2": "file" },
  minify: true,
  target: ["es2020"],
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "linked",
  logLevel: "info"
});
await mkdir("studio/slide-lab/assets/fonts", { recursive: true });
await cp("node_modules/@excalidraw/excalidraw/dist/prod/fonts", "studio/slide-lab/assets/fonts", { recursive: true });
await checkLabAssets("studio/slide-lab/assets");