import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverResumePdfGlyphs, repairResumeGlyphsFromSource } from './src/js/resume-pdf-glyphs.mjs';
import { createResume, structureResumeText } from './src/js/resume-workspace.mjs';
import { matchesResumeSource } from './src/js/prepare-resume.mjs';

const plus = [0,.2763671875,.11077880859375,1,.2763671875,.61376953125,1,.4033203125,.61376953125,1,.4033203125,.11077880859375,1,.2763671875,.11077880859375,1,.2763671875,.11077880859375,0,.08843994140625,.298583984375,1,.08843994140625,.42578125,1,.59130859375,.42578125,1,.59130859375,.298583984375,1,.08843994140625,.298583984375,4];
function fixture({ path = plus, font = 'ABCDEF+Inter-Bold', text = '175K\u0000 users', operatorText = text, direction = 'ltr' } = {}) {
  const fontId = 'font-1', fontChar = '\ue001';
  const objects = new Map([[fontId, { name: font, loadedName: fontId }], [fontId + '_path_' + fontChar, { path: new Float32Array(path) }]]);
  const content = { items: [{ str: text, fontName: fontId, dir: direction, width: 100, transform: [1,0,0,1,10,20] }] };
  const page = { commonObjs: objects, getOperatorList: async () => ({
    fnArray: [1, 2], argsArray: [[fontId, 10], [[...operatorText].map(unicode => ({ unicode, fontChar }))]],
  }) };
  return { content, page, pdfjs: { OPS: { setFont: 1, showText: 2, save: 3, restore: 4 } } };
}

test('Missing symbols recover only from the exact verified outline and matching LTR extraction order', async () => {
  const sample = fixture(), before = structuredClone(sample.content);
  const result = await recoverResumePdfGlyphs(sample.page, sample.content, sample.pdfjs);
  assert.equal(result.recoveredGlyphs, 1);
  assert.equal(result.content.items[0].str, '175K+ users');
  assert.deepEqual(sample.content, before);
  for (const options of [
    { path: [0, 1, 2, 4] }, { font: 'DifferentFont' }, { operatorText: '200K\u0000 users' },
    { direction: 'rtl' }, { operatorText: '175K\u0000\u0000 users' },
  ]) {
    const sample = fixture(options);
    const result = await recoverResumePdfGlyphs(sample.page, sample.content, sample.pdfjs);
    assert.equal(result.recoveredGlyphs, 0);
    assert.deepEqual(result.content, sample.content);
  }
});

test('Known plus symbols and literal question marks never become recovery candidates', async () => {
  const sample = fixture({ text: 'Is 175K+ supported?' });
  sample.page.getOperatorList = () => { throw new Error('No recovery should run'); };
  assert.equal((await recoverResumePdfGlyphs(sample.page, sample.content, sample.pdfjs)).content, sample.content);
});

test('Existing structured copies repair only uniquely matching source excerpts without discarding edits', () => {
  const document = createResume({ model: { name: 'Alex Example', summary: 'Custom opening.\nReached 175K\ufffd verified users in 10 days.\nKeep this custom ending.', sections: [] } });
  const source = 'Reached 175K+ verified users in 10 days.';
  const result = repairResumeGlyphsFromSource(document, source);
  assert.equal(result.recoveredGlyphs, 1);
  assert.equal(result.document.model.summary, document.model.summary.replace('\ufffd', '+'));
  assert.ok(document.model.summary.includes('\ufffd'));
  assert.deepEqual(repairResumeGlyphsFromSource(document, source + '\nReached 175K- verified users in 10 days.').document, document);
  assert.deepEqual(repairResumeGlyphsFromSource(document, 'Unrelated source.').document, document);
});

test('Legacy ligature normalization remains part of source reconstruction', () => {
  const result = structureResumeText('SUMMARY\nLed \ufb01rst-run \ufb02ows.');
  assert.equal(result.model.summary, 'Led first-run flows.');
});

test('Skills use their own item boundaries when repairing an existing structured copy', () => {
  const document = createResume({ model: { name: 'Alex Example', sections: [{ id: 'skills', kind: 'skills', heading: 'Skills', groups: [
    { id: 'group', label: '', items: ['Product Strategy', '0\ufffd1 Product Design', 'Complex Workflows'] },
  ] }] } });
  const result = repairResumeGlyphsFromSource(document, 'SKILLS\nProduct Strategy\n0\u21921 Product Design\nComplex Workflows');
  assert.equal(result.recoveredGlyphs, 1);
  assert.deepEqual(result.document.model.sections[0].groups[0].items, ['Product Strategy', '0\u21921 Product Design', 'Complex Workflows']);
});

test('Original byte identity remains authoritative after extraction improves', async () => {
  const file = new Blob(['immutable original']);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const reference = { version: 1, sha256: hash, size: file.size, name: 'original.pdf', type: 'application/pdf' };
  assert.equal(await matchesResumeSource(file, reference), true);
  assert.equal(await matchesResumeSource(new Blob(['changed original!!']), reference), false);
  await assert.rejects(matchesResumeSource(file, { ...reference, sha256: 'invalid' }), /reference is invalid/);
});
