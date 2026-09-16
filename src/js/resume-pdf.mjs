import { validatePdfText } from './resume-workspace.mjs';
import { atsParseLayout } from './ats-core.js';

export function verifyResumePdf(document, positions, links = [], expectedPages = null) {
  const fail = message => { throw Object.assign(new Error(message), { status: 422 }); };
  if (!Array.isArray(positions) || !positions.length || positions.length > 50 || (expectedPages !== null && positions.length !== expectedPages)) fail('Preview and PDF page counts differ. Export stopped.');
  if (Number.isInteger(document.design.pageLimit) && document.design.pageLimit > 0 && positions.length > document.design.pageLimit) fail('Layout exceeds the ' + document.design.pageLimit + '-page limit (' + positions.length + ' pages). Adjust the layout or explicitly change the page limit before exporting.');
  let extractedText = '', verificationText = '', items = 0;
  const size = document.design.size === 'letter' ? [612, 792] : [595.28, 841.89];
  const margin = (document.design.margin === 'narrow' ? 10 : 15) * 72 / 25.4;
  for (const [index, page] of positions.entries()) {
    if (!Number.isFinite(page.width) || !Number.isFinite(page.height) || Math.abs(page.width - size[0]) > 2 || Math.abs(page.height - size[1]) > 2 || !Array.isArray(page.items)) fail('PDF page size is incorrect.');
    items += page.items.length; if (items > 50000) fail('PDF text exceeds the verification limit.');
    for (const item of page.items) {
      if (typeof item.str !== 'string' || item.str.length > 120000 || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(item[key])) || item.w < 0 || item.h < 0) fail('PDF text exceeds the physical page bounds.');
      const syntheticSpace = !item.str.trim() && item.h === 0;
      if (!syntheticSpace && (item.x < -2 || item.x + item.w > page.width + 2 || item.y - item.h < -2 || item.y > page.height + 2)) fail('PDF text exceeds the physical page bounds.');
    }
    const footer = page.items.filter(item => item.str && item.y > page.height - margin);
    const counter = footer.map(item => item.str).join('').replace(/\s/g, '') === (index + 1) + '/' + positions.length;
    extractedText += page.items.map(item => item.str).join(' ') + '\n';
    verificationText += page.items.filter(item => !counter || !footer.includes(item)).map(item => item.str).join(' ') + '\n';
  }
  const verification = validatePdfText(document, verificationText);
  if (!verification.complete) fail('PDF verification found missing text: ' + verification.missing.slice(0, 2).map(field => field.label).join(', ') + '. No file was offered for download.');
  if (!Array.isArray(links) || links.length > 1000 || links.some(link => typeof link !== 'string' || !/^(https?:|mailto:|tel:)/i.test(link))) fail('Invalid PDF links.');
  return { pages: positions.length, extractedText, verification, links, layout: atsParseLayout(positions), layoutBoundsVerified: true };
}