import test from 'node:test';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { applyUiCorners, cornerShapeForRadius, auditUiCorners } from './tools/ui-corners.mjs';
import { readFileSync } from 'node:fs';

test('UI corner conversion preserves radius values, circular outlines and authored exclusions', () => {
  const source = '@import "base.css"; .panel{border-radius:14px!important}.dot{border-radius:50%}.pill{border-radius:999px}.half{border-radius:100px 0 0 100px}.child{border-radius:inherit}@media(min-width:900px){.panel{border-radius:8px 8px 0 0}}.art{border-radius:12px}.chosen{border-radius:7px;corner-shape:squircle}';
  const result = applyUiCorners(source, { exclude: selector => selector === '.art' });
  const original = postcss.parse(source);
  const transformed = postcss.parse(result);
  transformed.walkDecls('corner-shape', declaration => {
    if (declaration.parent.selector !== '.chosen') declaration.remove();
  });
  assert.equal(transformed.toString(), original.toString());
  assert.match(result, /corner-shape:squircle!important/);
  assert.match(result, /\.dot\{border-radius:50%;corner-shape:round\}/);
  assert.match(result, /\.pill\{border-radius:999px;corner-shape:round\}/);
  assert.match(result, /\.half\{border-radius:100px 0 0 100px;corner-shape:round\}/);
  assert.match(result, /corner-shape:inherit/);
  assert.equal(applyUiCorners(result, { exclude: selector => selector === '.art' }), result);
});

test('unresolved corner variables require an explicit audit decision', () => {
  assert.equal(cornerShapeForRadius('var(--authored-radius)'), null);
  assert.equal(cornerShapeForRadius('var(--border-radius-md)'), 'squircle');
  assert.equal(cornerShapeForRadius('calc(1rem + 2px)'), null);
  assert.equal(cornerShapeForRadius('0'), 'round');
  assert.equal(cornerShapeForRadius('8px 12px / 6px 10px'), 'squircle');
});

test('longhand corners and authored renderers retain their ownership', () => {
  const result = applyUiCorners('.panel{border-top-left-radius:8px}.wf-step{border-radius:7px}.gs-card{border-radius:10px}.excalidraw__embeddable{border-radius:var(--embeddable-radius)}');
  assert.match(result, /corner-top-left-shape:squircle/);
  assert.equal((result.match(/corner-/g) || []).length, 1);
});

test('all owned styles and standalone pages have an explicit corner policy', async () => {
  assert.deepEqual(await auditUiCorners(), []);
  const source = readFileSync('node_modules/@excalidraw/excalidraw/dist/prod/index.css', 'utf8');
  const root = postcss.parse(applyUiCorners(source));
  root.walkDecls(/^border.*radius$/, declaration => {
    if (declaration.parent.selector.includes('excalidraw__embeddable')) return;
    assert.ok(declaration.next()?.prop.startsWith('corner-'), declaration.parent.selector + ': ' + declaration.value);
  });
});

test('fixed-size pixel and rem capsules retain their round outline', () => {
  for (const source of ['.track{height:3px;border-radius:3px}', '.bar{width:2.5px;border-radius:2px}', '.icon{height:3.5rem;width:3.5rem;border-radius:2.5rem}']) {
    assert.match(applyUiCorners(source), /corner-shape:round/);
  }
  assert.match(applyUiCorners('.tool{width:28px;height:28px;border-radius:7px}'), /corner-shape:squircle/);
});