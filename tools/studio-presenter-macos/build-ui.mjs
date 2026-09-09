import { build } from 'esbuild';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { presenterPanelMarkup, presenterPanelStyles } from '../../src/js/presenter-panel.mjs';
const bundle=await build({entryPoints:[fileURLToPath(new URL('./companion-entry.mjs',import.meta.url))],bundle:true,format:'iife',minify:true,write:false});
await mkdir(new URL('./generated/',import.meta.url),{recursive:true});
await writeFile(new URL('./generated/companion.html',import.meta.url),'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Presenter DJ pad</title><link rel="stylesheet" href="https://riteshk.work/css/styles.css"><style>'+presenterPanelStyles+'.pp__btn[hidden]{display:none}</style></head><body class="pp-body">'+presenterPanelMarkup()+'<script>'+bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')+'</script></body></html>');