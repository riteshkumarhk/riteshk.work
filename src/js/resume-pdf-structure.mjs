import { normalizeResumePdfText, resumePdfTextPattern, resumeFields, resumePdfRunGap } from './resume-workspace.mjs';
import { resumePdfContentItems } from './resume-pdf.mjs';

const version = 'authored-pdf-order-v1';
const unknown = reason => ({ version, status: 'unknown', reason, native: null, rows: null });

function pdfRows(items) {
  const lines = [];
  for (const item of [...items].sort((a, b) => a.y - b.y || a.x - b.x || a.item - b.item)) {
    const last = lines.at(-1), tolerance = Math.max(1, Math.min(item.h, last?.height ?? item.h) * .2);
    if (last && Math.abs(last.y - item.y) <= tolerance) last.items.push(item);
    else lines.push({ y: item.y, height: item.h, items: [item] });
  }
  return lines.map(line => ({ ...line, items: line.items.sort((a, b) => a.x - b.x || a.item - b.item) }));
}

export function inspectPdfReadingOrder(pages) {
  const version = 'pdf-order-probes-v1';
  const unresolved = reason => ({ version, status: 'unknown', reason, pages: [] });
  if (!Array.isArray(pages) || !pages.length || pages.length > 50) return unresolved('No supported positional PDF extraction is available.');
  let count = 0, characters = 0;
  for (const page of pages) {
    if (!page || !Array.isArray(page.items) || ![page.width, page.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('PDF order: invalid page geometry.');
    for (const item of page.items) {
      if (!item || typeof item.str !== 'string' || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(item[key])) || item.w < 0 || item.h < 0) throw new Error('PDF order: invalid text geometry.');
      count++; characters += item.str.length;
      if (count > 2000 || characters > 120000) return unresolved('The 2,000-item or 120,000-character order-probe budget was exceeded; no pages were partially graded.');
    }
  }
  const results = pages.map((page, index) => {
    const items = page.items.map((item, position) => ({ ...item, item: position })).filter(item => item.str.trim());
    const rows = pdfRows(items), gaps = [], runs = [];
    let overlap = false;
    for (const [row, line] of rows.entries()) {
      let run = null;
      for (const item of line.items) {
        if (run && item.x < run.right - 2) overlap = true;
        if (!run || item.x - run.right > resumePdfRunGap(run.height, item.h)) {
          if (run) gaps.push({ left: run.right, right: item.x, row });
          run = { row, left: item.x, right: item.x + item.w, height: item.h, items: [] }; runs.push(run);
        }
        run.right = Math.max(run.right, item.x + item.w); run.items.push(item.item);
      }
    }
    const native = items.map(item => item.item), rowOrder = rows.flatMap(row => row.items.map(item => item.item));
    const reasons = [], candidates = new Map();
    const unsupported = items.some(item => !Number.isFinite(item.rotation) || Math.abs(item.rotation) > .5 || item.direction !== 'ltr' ||
      item.w <= 0 || item.h <= 0 || item.x < -2 || item.x + item.w > page.width + 2 || item.y - item.h < -2 || item.y > page.height + 2);
    if (!items.length) reasons.push('No visible positioned text; image-only pages need OCR.');
    if (unsupported) reasons.push('Rotation, writing direction, visible-text dimensions or physical bounds are missing or unsupported.');
    if (overlap) reasons.push('Text boxes overlap within a row; duplicated or layered text is not resolved.');
    if (native.some((item, position) => item !== rowOrder[position])) reasons.push('PDF content order differs from the geometric row probe.');
    if (gaps.length > 512) return { page: index + 1, status: 'unknown', reasons: ['More than 512 horizontal gaps exceed the column-hypothesis budget.'], gutter: null, orders: { native, rows: rowOrder, columns: null } };
    for (const gap of gaps) {
      const x = (gap.left + gap.right) / 2;
      const supportRows = new Set(gaps.filter(other => other.left < x && other.right > x).map(other => other.row)).size;
      if (supportRows < 3) continue;
      const signature = runs.map(run => run.left < x && run.right > x ? 'span' : run.right <= x ? 'left' : 'right').join(',');
      if (!candidates.has(signature)) candidates.set(signature, { x, supportRows });
    }
    let gutter = null, columns = null;
    if (candidates.size === 1 && !unsupported && !overlap) {
      gutter = [...candidates.values()][0];
      columns = []; let band = [];
      const flush = () => {
        columns.push(...band.filter(run => run.right <= gutter.x).flatMap(run => run.items),
          ...band.filter(run => run.left >= gutter.x).flatMap(run => run.items));
        band = [];
      };
      for (const [row] of rows.entries()) {
        const values = runs.filter(run => run.row === row);
        if (values.some(run => run.left < gutter.x && run.right > gutter.x)) {
          flush(); columns.push(...values.flatMap(run => run.items));
        } else band.push(...values);
      }
      flush();
      reasons.push('A repeated whitespace gutter supports a possible two-region order. It may instead be aligned dates or a table; no column order was selected.');
    } else if (candidates.size > 1) reasons.push('Multiple incompatible gutter hypotheses exist; no column order was selected.');
    else if (gaps.length) reasons.push('Distant horizontal runs exist without one supported two-region order.');
    return { page: index + 1, status: !items.length || unsupported || overlap ? 'unknown' : reasons.length ? 'ambiguous' : 'agreement',
      reasons: reasons.length ? reasons : ['Content-stream and row-probe item order agree; semantic reading order and employer attribution are still unverified.'],
      gutter, orders: { native, rows: rowOrder, columns } };
  });
  const status = results.some(page => page.status === 'unknown') ? 'unknown' : results.some(page => page.status === 'ambiguous') ? 'ambiguous' : 'agreement';
  return { version, status, reason: 'Reference-free horizontal PDF probes only. Agreement is not a vendor ATS pass or a verified role/employer/date/achievement association.', pages: results };
}

function textStream(items) {
  let text = '';
  const map = [], source = new Map(items.map(item => [item.page + ':' + item.item, item]));
  for (const item of items) {
    for (const part of item.str.matchAll(/.\p{M}*/gu)) {
      const normalized = normalizeResumePdfText(part[0]);
      text += normalized;
      for (let index = 0; index < normalized.length; index++) map.push({
        page: item.page, item: item.item, start: part.index, end: part.index + part[0].length,
      });
    }
  }
  return { text, map, source };
}

function candidates(field, stream) {
  const pattern = resumePdfTextPattern(field.value);
  if (!pattern) return [];
  const matches = [];
  for (const match of stream.text.matchAll(new RegExp(pattern, 'g'))) {
    const first = stream.map[match.index], last = stream.map[match.index + match[0].length - 1];
    const startItem = stream.source.get(first.page + ':' + first.item), endItem = stream.source.get(last.page + ':' + last.item);
    const continues = (previous, next) => previous && next && previous.page === next.page &&
      Math.abs(previous.y - next.y) <= Math.max(1, Math.min(previous.h, next.h) * .2) &&
      next.x - (previous.x + previous.w) <= Math.min(previous.h, next.h) * .2 && next.x >= previous.x &&
      /[\p{L}\p{N}\p{M}]$/u.test(previous.str) && /^[\p{L}\p{N}\p{M}]/u.test(next.str);
    const before = stream.map[match.index - 1], after = stream.map[match.index + match[0].length];
    const previous = before && stream.source.get(before.page + ':' + before.item), next = after && stream.source.get(after.page + ':' + after.item);
    if (/^[\p{L}\p{N}]/u.test(match[0]) && (/[\p{L}\p{N}\p{M}]$/u.test(startItem.str.slice(0, first.start).replace(/[\u00ad\u200b]/g, '')) ||
        (first.start === 0 && previous !== startItem && continues(previous, startItem)))) continue;
    if (/[\p{L}\p{N}]$/u.test(match[0]) && (/^[\p{L}\p{N}\p{M}]/u.test(endItem.str.slice(last.end).replace(/[\u00ad\u200b]/g, '')) ||
        (last.end === endItem.str.length && next !== endItem && continues(endItem, next)))) continue;
    matches.push({ start: match.index, end: match.index + match[0].length });
    if (matches.length === 65) break;
  }
  return matches;
}

function locate(field, stream, matches, shared) {
  if (matches.length !== 1) return { id: field.id, label: field.label, state: 'unknown',
    reason: matches.length ? 'Repeated text cannot be assigned to one authored field without additional evidence.' : 'No contiguous normalized occurrence was located in this order.', spans: [] };
  const { start, end } = matches[0], spans = [];
  if (shared.get(start + ':' + end) > 1) return { id: field.id, label: field.label, state: 'unknown', reason: 'Multiple authored fields claim the same text occurrence.', spans: [] };
  for (const position of stream.map.slice(start, end)) {
    const last = spans.at(-1);
    if (last?.page === position.page && last.item === position.item) last.end = position.end;
    else spans.push({ ...position });
  }
  return { id: field.id, label: field.label, state: 'located', start, end, spans };
}

function inspectOrder(items, fields, groups, headings) {
  const stream = textStream(items), possibilities = fields.map(field => candidates(field, stream));
  const ordered = possibilities.flat().sort((a, b) => a.start - b.start || b.end - a.end);
  let outer = null;
  for (const match of ordered) {
    if (outer && match.end <= outer.end && (match.start > outer.start || match.end < outer.end)) match.contained = true;
    if (!outer || match.end > outer.end) outer = match;
  }
  const matches = possibilities.map(values => values.length === 65 ? values : values.filter(value => !value.contained));
  const shared = new Map();
  for (const values of matches) if (values.length === 1) {
    const key = values[0].start + ':' + values[0].end; shared.set(key, (shared.get(key) || 0) + 1);
  }
  const located = fields.map((field, index) => locate(field, stream, matches[index], shared));
  const byId = new Map(located.map(field => [field.id, field]));
  const anchors = groups.map(group => {
    const values = group.anchors.map(id => byId.get(id));
    return group.hasCore && values.length >= 2 && values.every(value => value?.state === 'located')
      ? { id: group.id, start: Math.min(...values.map(value => value.start)), end: Math.max(...values.map(value => value.end)) } : null;
  });
  const allAnchors = anchors.every(Boolean);
  const entries = groups.map((group, index) => {
    const anchor = anchors[index], bullets = group.bullets.map(id => byId.get(id));
    if (!anchor || !allAnchors || !bullets.length || bullets.some(value => value?.state !== 'located') ||
        headings.some(id => byId.get(id)?.state !== 'located')) return {
      id: group.id, label: group.label, state: 'unknown', reason: 'Metadata, achievements or section boundaries are absent or could not be uniquely localized.',
    };
    const boundaries = [...anchors.filter(value => value.id !== group.id).map(value => value.start),
      ...headings.map(id => byId.get(id).start)].filter(start => start > anchor.start);
    const end = boundaries.length ? Math.min(...boundaries) : stream.text.length;
    const crossed = anchor.end > end || bullets.some(value => value.start < anchor.end || value.end > end);
    return { id: group.id, label: group.label, state: crossed ? 'mismatch' : 'consistent',
      reason: crossed ? 'Authored metadata or an achievement crosses another entry/section boundary in this order.'
        : 'Uniquely located metadata precedes its achievements within the same entry interval.' };
  });
  const association = !groups.length || entries.some(entry => entry.state === 'unknown') ? 'unknown'
    : entries.some(entry => entry.state === 'mismatch') ? 'mismatch' : 'consistent';
  const order = !groups.length || !allAnchors ? 'unknown'
    : anchors.some((anchor, index) => index && anchor.start <= anchors[index - 1].start) ? 'mismatch' : 'consistent';
  return { association, order, entries, fields: located, locatedFields: located.filter(field => field.state === 'located').length, totalFields: fields.length };
}

export function inspectAuthoredPdf(document, pages) {
  if (!Array.isArray(pages) || !pages.length || pages.length > 50) return unknown('No supported positional PDF extraction is available.');
  const fields = resumeFields(document.model).filter(field => !field.id.endsWith('.url') && normalizeResumePdfText(field.value));
  if (fields.length > 500 || new Set(fields.map(field => field.id)).size !== fields.length) return unknown('Authored field count or duplicate identities exceed this inspection contract.');
  const groups = document.model.sections.filter(section => section.kind === 'experience').flatMap(section => section.items.map(item => ({
    id: item.id,
    label: item.role + ' / ' + item.org,
    hasCore: !!normalizeResumePdfText(item.role || '') && !!normalizeResumePdfText(item.org || ''),
    anchors: ['role', 'org', 'dates'].filter(key => normalizeResumePdfText(item[key] || '')).map(key => item.id + '.' + key),
    bullets: item.bullets.filter(bullet => normalizeResumePdfText(bullet.text)).map(bullet => bullet.id),
  })));
  if (!groups.length) return unknown('No authored experience entries are available for association comparison.');
  const headings = document.model.sections.filter(section => normalizeResumePdfText(section.heading)).map(section => section.id + '.heading');
  let characters = 0, count = 0;
  const native = [], rows = [];
  for (const [pageIndex, page] of pages.entries()) {
    if (!Array.isArray(page.items) || !Number.isFinite(page.width) || !Number.isFinite(page.height)) throw new Error('PDF structure: invalid page geometry.');
    const included = new Set(resumePdfContentItems(document, page, pageIndex, pages.length));
    const items = [];
    for (const [index, item] of page.items.entries()) {
      if (typeof item.str !== 'string' || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(item[key])) || item.w < 0 || item.h < 0) throw new Error('PDF structure: invalid text geometry.');
      count++; characters += item.str.length;
      if (count > 50000 || characters > 120000) return unknown('Positional text exceeds the bounded structure-inspection budget; nothing was partially graded.');
      if (included.has(item) && normalizeResumePdfText(item.str)) items.push({ ...item, page: pageIndex + 1, item: index });
    }
    native.push(...items);
    rows.push(...pdfRows(items).flatMap(line => line.items));
  }
  const source = inspectOrder(native, fields, groups, headings), geometric = inspectOrder(rows, fields, groups, headings);
  if ([source, geometric].reduce((sum, order) => sum + order.fields.reduce((count, field) => count + field.spans.length, 0), 0) > 4000) return unknown('Exact positional references exceed the bounded inspection budget; no partial association grade was produced.');
  const states = [source.association, source.order, geometric.association, geometric.order];
  const status = states.every(state => state === 'consistent') ? 'consistent'
    : source.association === 'mismatch' && geometric.association === 'mismatch' ? 'mismatch' : 'unknown';
  return { version, status, reason: status === 'consistent'
    ? 'Both the PDF content stream and geometric row-order probe agree with the authored experience boundaries and entry order.'
    : status === 'mismatch' ? 'Both order probes place authored experience content across the expected entry/section boundaries.'
      : 'At least one localization/order is ambiguous or disagrees. Do not infer employer attribution from text presence.',
  native: source, rows: geometric };
}
