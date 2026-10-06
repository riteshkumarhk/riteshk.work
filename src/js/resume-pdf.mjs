import { extractResumePdfText, validatePdfText } from './resume-workspace.mjs';
import { atsParseLayout } from './ats-core.js';
import { recoverResumePdfGlyphs } from './resume-pdf-glyphs.mjs';

export function resumePdfContentItems(document, page, index, count) {
  const margin = (document.design.margin === 'narrow' ? 10 : 15) * 72 / 25.4;
  const footer = page.items.filter(item => item.str && item.y > page.height - margin);
  const counter = footer.map(item => item.str).join('').replace(/\s/g, '') === (index + 1) + '/' + count;
  return counter ? page.items.filter(item => !footer.includes(item)) : page.items;
}

export function verifyResumePdf(document, positions, links = [], expectedPages = null) {
  const fail = message => { throw Object.assign(new Error(message), { status: 422 }); };
  if (!Array.isArray(positions) || !positions.length || positions.length > 50 || (expectedPages !== null && positions.length !== expectedPages)) fail('Preview and PDF page counts differ. Export stopped.');
  if (Number.isInteger(document.design.pageLimit) && document.design.pageLimit > 0 && positions.length > document.design.pageLimit) fail('Layout exceeds the ' + document.design.pageLimit + '-page limit (' + positions.length + ' pages). Adjust the layout or explicitly change the page limit before exporting.');
  let extractedText = '', verificationText = '', items = 0;
  const size = document.design.size === 'letter' ? [612, 792] : [595.28, 841.89];
  for (const [index, page] of positions.entries()) {
    if (!Number.isFinite(page.width) || !Number.isFinite(page.height) || Math.abs(page.width - size[0]) > 2 || Math.abs(page.height - size[1]) > 2 || !Array.isArray(page.items)) fail('PDF page size is incorrect.');
    items += page.items.length; if (items > 50000) fail('PDF text exceeds the verification limit.');
    for (const item of page.items) {
      if (typeof item.str !== 'string' || item.str.length > 120000 || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(item[key])) || item.w < 0 || item.h < 0) fail('PDF text exceeds the physical page bounds.');
      const syntheticSpace = !item.str.trim() && item.h === 0;
      if (!syntheticSpace && (item.x < -2 || item.x + item.w > page.width + 2 || item.y - item.h < -2 || item.y > page.height + 2)) fail('PDF text exceeds the physical page bounds.');
    }
    extractedText += page.items.map(item => item.str).join(' ') + '\n';
    verificationText += resumePdfContentItems(document, page, index, positions.length).map(item => item.str).join(' ') + '\n';
  }
  const verification = validatePdfText(document, verificationText);
  if (!verification.complete) fail('PDF verification found missing text: ' + verification.missing.slice(0, 2).map(field => field.label).join(', ') + '. No file was offered for download.');
  if (!Array.isArray(links) || links.length > 1000 || links.some(link => typeof link !== 'string' || !/^(https?:|mailto:|tel:)/i.test(link))) fail('Invalid PDF links.');
  return { pages: positions.length, extractedText, verification, links, layout: atsParseLayout(positions), layoutBoundsVerified: true };
}
export function mapResumePdfEvidence(pages, document = null) {
  let text = '', unmappedGlyphs = 0, unresolvedMarkers = 0;
  const spans = [];
  for (const [pageIndex, page] of pages.entries()) {
    const positioned = { ...page, items: page.items.map((item, index) => ({ ...item, sourceIndex: index })) };
    const included = document ? resumePdfContentItems(document, positioned, pageIndex, pages.length) : positioned.items;
    const items = included.map(item => ({ str: item.str, width: item.w, height: item.h, transform: [1, 0, 0, 1, item.x, page.height - item.y], hasEOL: item.hasEOL }));
    const result = extractResumePdfText({ items }, { separateDistantRuns: true, capturePositions: true });
    if (pageIndex) text += '\n\n';
    for (const span of result.spans) spans.push({ ...span, start: span.start + text.length, end: span.end + text.length,
      page: pageIndex + 1, item: included[span.item].sourceIndex });
    text += result.text; unmappedGlyphs += result.unmappedGlyphs; unresolvedMarkers += result.unresolvedMarkers;
  }
  return { text, spans, unmappedGlyphs, unresolvedMarkers };
}

export async function readResumePdf(bytes, { signal, document, separateDistantRuns = false, recoverGlyphs = true, loadPdf = () => import('pdfjs-dist/build/pdf.mjs') } = {}) {
  const reference = document ? structuredClone(document) : null;
  signal?.throwIfAborted();
  const pdfjs = await loadPdf();
  signal?.throwIfAborted();
  if (typeof window !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = '/studio/resume-preview/assets/pdf.worker.mjs';
  const task = pdfjs.getDocument({ data: bytes.slice(), fontExtraProperties: true, disableFontFace: true });
  let destruction;
  const abort = () => {
    destruction = task.destroy();
    destruction.catch(error => console.error('PDF cancellation cleanup failed.', error));
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await task.promise;
    if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > 50) throw new Error('PDF exceeds the supported page count.');
    const pages = [], links = [], text = [];
    let items = 0, unmappedGlyphs = 0, unresolvedMarkers = 0, recoveredGlyphs = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      signal?.throwIfAborted();
      const page = await pdf.getPage(number), viewport = page.getViewport({ scale: 1 });
      const rawContent = await page.getTextContent();
      const recovered = recoverGlyphs ? await recoverResumePdfGlyphs(page, rawContent, pdfjs) : { content: rawContent, recoveredGlyphs: 0 }, content = recovered.content;
      recoveredGlyphs += recovered.recoveredGlyphs;
      items += content.items.length;
      if (items > 50000) throw new Error('PDF exceeds the supported text-item count.');
      const originals = content.items.filter(item => item.str);
      const positioned = { width: viewport.width, height: viewport.height, items: originals.map(item => ({
        str: item.str, x: item.transform[4], y: viewport.height - item.transform[5], w: item.width, h: item.height,
        ...(separateDistantRuns ? { rotation: Math.atan2(item.transform[1], item.transform[0]) * 180 / Math.PI, direction: item.dir || 'unknown', hasEOL: item.hasEOL === true } : {}),
      })) };
      pages.push(positioned);
      if (separateDistantRuns) {
        // PDF.js sometimes puts the line boundary on an empty, unpositioned item.
        let last = -1;
        for (const item of content.items) {
          if (item.str) last++;
          else if (item.hasEOL && last >= 0) positioned.items[last].hasEOL = true;
        }
      }
      const included = reference ? new Set(resumePdfContentItems(reference, positioned, number - 1, pdf.numPages)) : null;
      const excluded = new Set(originals.filter((_, index) => included && !included.has(positioned.items[index])));
      if (!separateDistantRuns) {
        const extracted = extractResumePdfText({ ...content, items: content.items.filter(item => !excluded.has(item)) });
        text.push(extracted.text); unmappedGlyphs += extracted.unmappedGlyphs; unresolvedMarkers += extracted.unresolvedMarkers;
      }
      links.push(...(await page.getAnnotations()).filter(item => item.subtype === 'Link').map(item => item.url || item.unsafeUrl));
    }
    signal?.throwIfAborted();
    const mapped = separateDistantRuns ? mapResumePdfEvidence(pages, reference) : null;
    return { text: mapped ? mapped.text : text.join('\n\n'), pages, links, recoveredGlyphs,
      unmappedGlyphs: mapped ? mapped.unmappedGlyphs : unmappedGlyphs, unresolvedMarkers: mapped ? mapped.unresolvedMarkers : unresolvedMarkers,
      ...(mapped ? { evidenceMapVersion: 'pdf-evidence-map-v1' } : {}),
      extractorVersion: 'pdfjs-' + pdfjs.version + '-resume-lines-v1' + (recoverGlyphs ? '-outline-recovery-v1' : '') + (reference ? '-checked-body-v1' : '') + (separateDistantRuns ? '-separated-runs-v1-pdf-evidence-map-v1' : '') };
  } finally {
    signal?.removeEventListener('abort', abort);
    await (destruction || task.destroy());
  }
}
