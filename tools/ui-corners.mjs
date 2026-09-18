import postcss from 'postcss';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const uiTokens = /var\(--(?:ui-radius|border-radius-(?:md|lg)|radius|space-factor)\)/g;
const authoredSelectors = /(?:\.gs[-_]|\.pjps__|\.slidepv__|\.wf-step|\.react-flow__node-step|\.react-flow__node-(?:input|default|output|group)|\.excalidraw__embeddable)/;

export function preserveAuthoredCorners(selector) {
  return authoredSelectors.test(selector);
}

export function isCapsuleRadius(declaration) {
  const radius = /^(\d*\.?\d+)(px|rem|em)$/.exec(declaration.value);
  if (!radius) return false;
  return declaration.parent.nodes.some(node => {
    if (!['width','height'].includes(node.prop)) return false;
    const size = /^(\d*\.?\d+)(px|rem|em)$/.exec(node.value);
    return size && size[2] === radius[2] && Number(size[1]) > 0 && Number(size[1]) <= 2 * Number(radius[1]);
  });
}

export function cornerShapeForRadius(value) {
  const radius = value.trim();
  if (/^(inherit|initial|unset|revert|revert-layer)$/.test(radius)) return radius;
  const parts = postcss.list.space(radius.replaceAll('/', ' '));
  if (/^calc\(var\(--radius\) \+ 1px\)$/.test(radius)) return 'squircle';
  if (radius.includes('var(') && !radius.replace(uiTokens, '8px').includes('var(')) return 'squircle';
  if (parts.some(part => /^(?:var|calc|min|max|clamp)\(/.test(part))) return null;
  const nonzero = parts.filter(part => parseFloat(part) !== 0);
  if (!nonzero.length) return 'round';
  if (nonzero.every(part => /^(\d*\.?\d+)(px|%)$/.test(part) && parseFloat(part) >= 50)) return 'round';
  return 'squircle';
}

export function applyUiCorners(css, { from, exclude = preserveAuthoredCorners } = {}) {
  const root = postcss.parse(css, { from });
  root.walkRules(rule => {
    if (exclude(rule.selector)) return;
    const declarations = rule.nodes.filter(node => node.type === 'decl');
    const explicit = new Set(declarations.filter(declaration => declaration.prop.startsWith('corner-')).map(declaration => declaration.prop));
    for (const declaration of declarations) {
      if (!/^border(?:-(?:top-left|top-right|bottom-left|bottom-right|start-start|start-end|end-start|end-end))?-radius$/.test(declaration.prop)) continue;
      const property = declaration.prop.replace('border', 'corner').replace('radius', 'shape');
      if (explicit.has(property)) continue;
      const shape = isCapsuleRadius(declaration) ? 'round' : cornerShapeForRadius(declaration.value);
      if (shape) declaration.cloneAfter({ prop: property, value: shape });
    }
  });
  return root.toString();
}

export function uiCornersPlugin() {
  return { name: 'ui-corners', setup(build) {
    build.onLoad({ filter: /node_modules[\\/]@(?:excalidraw|xyflow)[\\/].*\.css$/ }, async args => ({
      contents: applyUiCorners(await readFile(args.path, 'utf8'), { from: args.path }),
      loader: 'css', resolveDir: dirname(args.path)
    }));
  } };
}

export async function auditUiCorners({ write = false } = {}) {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n');
  const changes = [];
  for (const file of files) {
    const stylesheet = /^(?:css|extension)\/.*\.css$/.test(file) && file !== 'css/gensection.css';
    const page = file.endsWith('.html') && !file.startsWith('tools/');
    const presenter = file === 'src/js/presenter-panel.mjs';
    if (!stylesheet && !page && !presenter) continue;
    const source = await readFile(file, 'utf8');
    const result = stylesheet ? applyUiCorners(source, { from: file }) : presenter
      ? source.replace(/(export const presenterPanelStyles = `)([\s\S]*?)(`;)/, (_, open, css, close) => open + applyUiCorners(css, { from: file }) + close)
      : source.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_, open, css, close) => open + applyUiCorners(css, { from: file }) + close);
    if (result !== source) {
      changes.push(file);
      if (write) await writeFile(file, result);
    }
  }
  return changes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const write = process.argv.includes('--write');
  const changes = await auditUiCorners({ write });
  console.log(JSON.stringify({ mode: write ? 'updated' : 'missing corner policies', files: changes }, null, 2));
  if (!write && changes.length) process.exitCode = 1;
}