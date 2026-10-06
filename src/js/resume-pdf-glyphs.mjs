import { editResumeField, resumeFields } from './resume-workspace.mjs';

// Exact PDF.js 5 outline fingerprints, visually verified from embedded Inter
// glyphs. Never infer a missing symbol from its surrounding words or numbers.
const outlines = new Map([
  ['ebdd9f5e4f1a2d1edb67320ec9d34e028f75e2bbf7f73fc4584c5a8ff889ff60', '+'],
  ['411672701e67a7268a6f16b0c1325af877be8c8a2e1eea5660cf9b0b14d73985', '+'],
  ['90b0dbf901abf828ce864f8a1fbf0e5382515c1f581dd5a89202dac5276ae020', '\u2192'],
  ['3245e4eaa0729838b7d357ce9527d87774a2864f4839a4f4f7881993fbdf2f8e', '\u2013'],
  ['4dea69d72c11f7467e9a09cc1f5f575ed1ae1d0601e98429eacf2044dbd4e100', '\u2192'],
  ['0e4d95e502dc180de859548a6051038e58580862bb982e5ab27666b6debf259c', '('],
  ['aed404d2ede5c68c8f97f67b5eab654cfddffad5a588dee3c135250bcb3063d5', ')'],
  ['0e8204f245c5fc247f63bc137587e4cb9cb906b6e5f2fefb235bee8519c7ef79', '\u2022'],
]);
const unreadable = /[\u0000\ufffd]/;
const comparable = value => value.normalize('NFKC').replace(/\s/g, '');

export function repairResumeGlyphsFromSource(document, sourceText) {
  const normalized = value => value.normalize('NFKC').replace(/\s+/g, ' ');
  const source = normalized(sourceText);
  let next = document, recoveredGlyphs = 0;
  for (const field of resumeFields(document.model)) {
    if (!unreadable.test(field.value)) continue;
    const text = field.value.replace(/[\u0000\ufffd]/g, (character, originalOffset) => {
      const separators = field.key === 'items' ? ['\n', ','] : ['\n'];
      const lineStart = Math.max(...separators.map(separator => field.value.lastIndexOf(separator, originalOffset))) + 1;
      const ends = separators.map(separator => field.value.indexOf(separator, originalOffset)).filter(index => index >= 0);
      const value = normalized(field.value.slice(lineStart, ends.length ? Math.min(...ends) : undefined));
      const offset = normalized(field.value.slice(lineStart, originalOffset)).length;
      const start = Math.max(0, offset - 24), end = Math.min(value.length, offset + 25), excerpt = value.slice(start, end);
      if (excerpt.replace(/[\u0000\ufffd]/g, '').trim().length < 8) return character;
      let capture = 0, target;
      const pattern = excerpt.split('').map((item, index) => {
        if (unreadable.test(item)) { capture++; if (index === offset - start) target = capture; return '([^\\s\\u0000\\ufffd])'; }
        return item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      const candidates = new Set([...source.matchAll(new RegExp('(?=' + pattern + ')', 'g'))].map(match => match[target]));
      if (candidates.size !== 1) return character;
      recoveredGlyphs++;
      return [...candidates][0];
    });
    if (text !== field.value) next = editResumeField(next, field.id, text);
  }
  return { document: next, recoveredGlyphs };
}

export async function recoverResumePdfGlyphs(page, content, pdfjs) {
  const fonts = new Set(content.items.filter(item => unreadable.test(item.str || '')).map(item => item.fontName));
  if (!fonts.size) return { content, recoveredGlyphs: 0 };
  const operators = await page.getOperatorList(), streams = new Map(), cache = new Map(), stack = [];
  if (operators.fnArray.length > 200000) throw new Error('PDF glyph recovery exceeds the supported operator count.');
  let fontId;
  for (let index = 0; index < operators.fnArray.length; index++) {
    const operation = operators.fnArray[index], args = operators.argsArray[index];
    if (operation === pdfjs.OPS.save) stack.push(fontId);
    else if (operation === pdfjs.OPS.restore) fontId = stack.pop();
    else if (operation === pdfjs.OPS.setFont) fontId = args[0];
    else if (operation === pdfjs.OPS.showText && fonts.has(fontId)) {
      let stream = streams.get(fontId);
      if (!stream) streams.set(fontId, stream = { text: '', replacements: [] });
      for (const glyph of args[0]) {
        if (!glyph || typeof glyph !== 'object') continue;
        stream.text += glyph.unicode || '';
        if (!unreadable.test(glyph.unicode || '')) continue;
        let replacement = null;
        if (glyph.unicode.length === 1 && page.commonObjs.has(fontId)) {
          const font = page.commonObjs.get(fontId), pathId = font.loadedName + '_path_' + glyph.fontChar;
          if (/^(?:[A-Z]{6}\+)?Inter(?:-|$)/.test(font.name || '') && page.commonObjs.has(pathId)) {
            if (!cache.has(pathId)) {
              const path = page.commonObjs.get(pathId)?.path;
              if (path?.length && path.length <= 10000) {
                const bytes = new TextEncoder().encode(JSON.stringify(Array.from(path)));
                const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
                cache.set(pathId, outlines.get(digest) || null);
              } else cache.set(pathId, null);
            }
            replacement = cache.get(pathId);
          }
        }
        stream.replacements.push(...[...glyph.unicode].filter(character => unreadable.test(character)).map(() => replacement));
      }
    }
  }
  const offsets = new Map();
  for (const font of fonts) {
    const items = content.items.filter(item => item.fontName === font && typeof item.str === 'string'), stream = streams.get(font);
    // Do not associate glyphs with text when bidi, clipping or extraction changed
    // its order. Unmatched characters stay marked for explicit source review.
    if (stream && items.every(item => item.dir !== 'rtl') && comparable(items.map(item => item.str).join('')) === comparable(stream.text)) offsets.set(font, 0);
  }
  let recoveredGlyphs = 0;
  const items = content.items.map(item => {
    if (!offsets.has(item.fontName) || !unreadable.test(item.str || '')) return item;
    const str = item.str.replace(/[\u0000\ufffd]/g, character => {
      const offset = offsets.get(item.fontName);
      offsets.set(item.fontName, offset + 1);
      const replacement = streams.get(item.fontName).replacements[offset];
      if (replacement) recoveredGlyphs++;
      return replacement || character;
    });
    return { ...item, str };
  });
  return { content: { ...content, items }, recoveredGlyphs };
}
