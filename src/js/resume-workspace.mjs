import { atsKeywordMatch, atsSemanticFit, atsModelChecks, atsStructFromChecks, atsBlendScore, atsParseScore } from './ats-core.js';

export const RESUME_DESIGN = Object.freeze({ font: 'inter', size: 'a4', accent: '#167d83', density: 'normal', margin: 'normal', layout: 'single', keepWhole: true });
const copy = value => structuredClone(value);
export const resumeSignature = document => JSON.stringify([document.id, document.name, document.target, document.model, document.design, document.sourceIds]);

export function extractResumePdfText(content) {
  const items = content.items.filter(item => typeof item.str === 'string');
  const atBaseline = (first, second) => Math.abs(first.transform[5] - second.transform[5]) <= Math.max(1, Math.min(first.height || 10, second.height || 10) * .2);
  const markers = items.filter(item => /^[\u2022\u25e6\u25aa\u2023]$/.test(item.str) && !items.some(other => other.str.trim() && other !== item && atBaseline(item, other) && other.transform[4] < item.transform[4] - 1));
  const markerSet = new Set(markers), lines = [];
  let current = null, unmappedGlyphs = 0;
  const flush = () => { if (current?.text.trim()) lines.push(current); current = null; };
  for (const item of items) {
    if (markerSet.has(item)) continue;
    if (item.str) {
      const text = item.str.replace(/\u0000/g, () => { unmappedGlyphs++; return '\ufffd'; });
      if (current && (!atBaseline(current, item) || item.transform[4] < current.right - 2)) flush();
      if (!current) current = { text: '', transform: item.transform, height: item.height || 10, right: item.transform[4] };
      if (current.text && !/\s$/.test(current.text) && !/^\s/.test(text) && item.transform[4] - current.right > current.height * .2) current.text += ' ';
      current.text += text; current.right = item.transform[4] + item.width;
    }
    if (item.hasEOL) flush();
  }
  flush();
  for (const marker of markers) {
    const line = lines.find(line => atBaseline(marker, line) && line.transform[4] > marker.transform[4] && line.transform[4] - marker.transform[4] <= marker.height * 2.5);
    if (line) { line.text = marker.str + ' ' + line.text.trimStart(); line.marker = true; }
    else lines.push({ text: marker.str, transform: marker.transform, height: marker.height, unresolvedMarker: true });
  }
  let text = '';
  for (const [index, line] of lines.entries()) {
    const previous = lines[index - 1];
    const gap = previous && previous.transform[5] - line.transform[5];
    const paragraph = previous && (gap > Math.max(previous.height, line.height) * 1.65 || gap < -2);
    text += (text ? paragraph ? '\n\n' : '\n' : '') + line.text.trim();
  }
  return { text, unmappedGlyphs, bullets: markers.length, unresolvedMarkers: lines.filter(line => line.unresolvedMarker).length };
}

export function structureResumeText(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 120000) throw new Error('Choose readable source text within the import limit.');
  const headingKinds = new Map([
    ['experience', 'experience'], ['work experience', 'experience'], ['professional experience', 'experience'], ['employment history', 'experience'],
    ['education', 'education'], ['qualifications', 'education'], ['skills', 'skills'], ['technical skills', 'skills'], ['core competencies', 'skills'],
    ['summary', 'text'], ['professional summary', 'text'], ['profile', 'text'], ['about', 'text'],
    ['projects', 'custom'], ['awards', 'custom'], ['certifications', 'custom'], ['achievements', 'custom'], ['key achievements', 'custom'], ['publications', 'custom'], ['interests', 'text'], ['languages', 'text'], ['contact', 'text'],
  ]);
  const lines = text.replace(/\r\n?/g, '\n').split('\n'), blocks = [], preamble = [];
  let block = null, serial = 0;
  const id = () => 'import-' + ++serial;
  for (const line of lines) {
    const heading = line.trim().replace(/^#{1,6}\s+/, '').replace(/:$/, '');
    const kind = headingKinds.get(heading.toLowerCase());
    if (kind) { block = { id: id(), heading, kind, lines: [] }; blocks.push(block); }
    else (block ? block.lines : preamble).push(line);
  }
  const model = { name: '', title: '', summary: '', contact: { links: [] }, sections: [] }, warnings = [];
  if (!blocks.length) {
    model.sections.push({ id: id(), kind: 'text', heading: 'Imported content', text });
    return { model, warnings: ['No unambiguous section headings found; all text was retained together.'], method: 'Source-preserving section import v1' };
  }
  const header = preamble.join('\n').trim();
  if (header) model.sections.push({ id: id(), kind: 'text', heading: 'Profile', text: header });
  const bulletPattern = /^\s*(?:[\u2022\u25e6\u25aa\u2023*+-]|\d+[.)])\s+(.+)$/;
  const datePattern = /^(?:(?:[A-Za-z]{3,9}\s+)?(?:19|20)\d{2}|\d{1,2}[/.](?:19|20)\d{2})\s*[-\u2013\u2014]\s*(?:(?:[A-Za-z]{3,9}\s+)?(?:19|20)\d{2}|present|current|now)$/i;
  for (const source of blocks) {
    const value = source.lines.join('\n').trim(), section = { id: source.id, heading: source.heading, kind: source.kind };
    if (source.kind === 'skills') {
      section.groups = source.lines.filter(line => line.trim()).map(line => {
        const separator = line.indexOf(':');
        return { id: id(), label: separator > 0 ? line.slice(0, separator).trim() : '', items: (separator > 0 ? line.slice(separator + 1) : line).split(',').map(item => item.trim()).filter(Boolean) };
      });
    } else if (source.kind !== 'text') {
      const entries = []; let entry = null;
      for (const line of source.lines) {
        if (!line.trim()) { if (entry) entry.break = true; continue; }
        const bullet = line.match(bulletPattern);
        if (!entry || (!bullet && entry.bullets.length && entry.break)) { entry = { header: [], bullets: [], break: false }; entries.push(entry); }
        if (bullet) entry.bullets.push({ id: id(), text: bullet[1] });
        else if (entry.bullets.length) entry.bullets.at(-1).text += ' ' + line.trim();
        else entry.header.push(line.trim());
        entry.break = false;
      }
      const clear = entries.length && entries.every(entry => entry.header.length && (source.kind !== 'experience' || entry.bullets.length));
      if (clear) {
        section.items = entries.map(entry => {
          const heading = entry.header[0], detail = entry.header.slice(1), dateIndex = detail.findIndex(line => datePattern.test(line));
          const dates = dateIndex < 0 ? '' : detail.splice(dateIndex, 1)[0];
          const item = { id: id(), dates, bullets: entry.bullets };
          if (source.kind === 'experience') return { ...item, role: heading, org: detail.join('\n'), location: '' };
          if (source.kind === 'education') return { ...item, school: heading, credential: detail.join('\n'), note: '' };
          return { ...item, title: heading, meta: detail.join('\n') };
        });
      } else {
        section.kind = 'text'; section.text = value;
        warnings.push(source.heading + ': entry boundaries need review; original text retained.');
      }
    } else section.text = value;
    model.sections.push(section);
  }
  if (header) warnings.push('Profile text is retained together; confirm name and contact fields before export.');
  return { model, warnings, method: 'Source-preserving section import v1' };
}

export function resumeFields(model) {
  const fields = [];
  const add = (id, label, value, owner, key, group) => fields.push({ id, label, value: String(value || ''), owner, key, group });
  for (const [key, label] of [['name', 'Name'], ['title', 'Professional title'], ['summary', 'Summary']]) add(key, label, model[key], model, key, 'Profile');
  for (const [key, label] of [['email', 'Email'], ['phone', 'Phone'], ['location', 'Location']]) add('contact.' + key, label, model.contact[key], model.contact, key, 'Contact');
  for (const link of model.contact.links) {
    add(link.id + '.label', 'Link label', link.label, link, 'label', 'Contact');
    add(link.id + '.url', 'Link URL', link.url, link, 'url', 'Contact');
  }
  for (const section of model.sections) {
    add(section.id + '.heading', 'Section heading', section.heading, section, 'heading', section.id);
    if (section.kind === 'text') add(section.id + '.text', section.heading, section.text, section, 'text', section.id);
    if (section.kind === 'skills') for (const group of section.groups) {
      add(group.id + '.label', 'Skill group', group.label, group, 'label', section.id);
      add(group.id + '.items', 'Skills', group.items.join(', '), group, 'items', section.id);
    }
    for (const item of section.items || []) {
      for (const [key, label] of section.kind === 'experience' ? [['role', 'Role'], ['org', 'Company'], ['dates', 'Dates'], ['location', 'Location']] : section.kind === 'education' ? [['school', 'School'], ['credential', 'Qualification'], ['dates', 'Dates'], ['note', 'Note']] : [['title', 'Title'], ['dates', 'Dates / duration / time'], ['meta', 'Detail']]) add(item.id + '.' + key, label, item[key], item, key, section.id);
      for (const bullet of item.bullets || []) add(bullet.id, 'Achievement', bullet.text, bullet, 'text', section.id);
    }
  }
  return fields;
}

export function createResume({ id = crypto.randomUUID(), name = 'Untitled resume', target = {}, model, design = {}, sourceIds = [] }) {
  const normalized = copy(model);
  normalized.contact = { email: '', phone: '', location: '', ...normalized.contact, links: (normalized.contact?.links || []).map(link => ({ ...link, id: link.id || crypto.randomUUID() })) };
  normalized.sections = (normalized.sections || []).map(section => ({ ...section, id: section.id || crypto.randomUUID(), ...(section.groups ? { groups: section.groups.map(group => ({ ...group, id: group.id || crypto.randomUUID() })) } : {}), ...(section.items ? { items: section.items.map(item => ({ ...item, id: item.id || crypto.randomUUID(), ...(item.bullets ? { bullets: item.bullets.map(bullet => typeof bullet === 'string' ? { id: crypto.randomUUID(), text: bullet } : { ...bullet, id: bullet.id || crypto.randomUUID() }) } : {}) })) } : {}) }));
  return { schema: 1, id, name, target: { company: '', role: '', level: 'staff', jd: '', ...target }, model: normalized, design: { ...RESUME_DESIGN, ...design }, sourceIds: [...sourceIds], archived: false, assessment: null, createdAt: Date.now(), updatedAt: Date.now() };
}

export function editResumeField(document, fieldId, value) {
  const next = copy(document), field = resumeFields(next.model).find(field => field.id === fieldId);
  if (!field) throw new Error('This field no longer exists. Nothing was changed.');
  if (typeof value !== 'string') throw new Error('Enter text for this field.');
  field.owner[field.key] = field.key === 'items' ? value.split(',').map(item => item.trim()).filter(Boolean) : value;
  return next;
}

export function resumeText(document) {
  return resumeFields(document.model).filter(field => !field.id.endsWith('.url')).map(field => field.value).filter(Boolean).join('\n');
}

export function applyResumeProposal(document, proposal, sources) {
  if (proposal.signature !== resumeSignature(document)) throw new Error('This resume changed. Review a fresh suggestion before applying.');
  const field = resumeFields(document.model).find(field => field.id === proposal.fieldId);
  if (!field || field.value !== proposal.before) throw new Error('The original wording changed. Nothing was replaced.');
  const evidence = proposal.evidence.map(reference => {
    if (reference.fieldId && !reference.sourceId) {
      const original = resumeFields(document.model).find(field => field.id === reference.fieldId && field.id !== 'name' && field.group !== 'Contact');
      if (!original || !reference.quote || original.value !== reference.quote) throw new Error('This suggestion needs verified field evidence.');
      return reference.quote;
    }
    const source = sources.find(source => source.id === reference.sourceId && document.sourceIds.includes(source.id));
    if (!source || !reference.quote || !source.text.includes(reference.quote)) throw new Error('This suggestion needs verified source evidence.');
    return reference.quote;
  }).join('\n');
  if (!evidence) throw new Error('This suggestion needs source evidence.');
  const supported = new Set((field.value + '\n' + evidence).match(/\d+(?:[.,]\d+)*(?:%|\b)/g) || []);
  if ((proposal.after.match(/\d+(?:[.,]\d+)*(?:%|\b)/g) || []).some(number => !supported.has(number))) throw new Error('The suggestion contains a number not supported by its evidence.');
  return editResumeField(document, proposal.fieldId, proposal.after);
}

export function createResumeHistory(document, limit = 60) {
  let past = [copy(document)], future = [];
  const historySignature = value => JSON.stringify([resumeSignature(value), value.archived, value.dismissed, value.proposals, value.aiReview, value.aiQuestion, value.aiResolution, value.reviewManifest, value.reviewManifestOriginal, value.evidenceAnswers, value.reviewDecisions]);
  return {
    get canUndo() { return past.length > 1; },
    get canRedo() { return future.length > 0; },
    refresh(next) { past[past.length - 1] = copy(next); },
    record(next) { if (historySignature(next) === historySignature(past.at(-1))) return; past.push(copy(next)); if (past.length > limit) past.shift(); future = []; },
    undo() { if (past.length < 2) return null; future.push(past.pop()); return copy(past.at(-1)); },
    redo() { if (!future.length) return null; const next = future.pop(); past.push(next); return copy(next); }
  };
}

export function createResumeTask(document) {
  const controller = new AbortController(), snapshot = copy(document), signature = resumeSignature(document);
  return { snapshot, signature, signal: controller.signal, cancel: () => controller.abort(), accept(current, value) { if (controller.signal.aborted || resumeSignature(current) !== signature) return null; return { ...value, signature, documentId: snapshot.id, at: Date.now() }; } };
}

export function assessResume(document, extractedPdf = null) {
  const text = resumeText(document), model = document.model, fields = resumeFields(model);
  const targetText = document.target.jd.trim() || document.target.role.trim();
  const match = targetText ? atsKeywordMatch(text, targetText) : null;
  const experience = model.sections.filter(section => section.kind === 'experience').flatMap(section => section.items || []);
  const bullets = experience.flatMap(item => item.bullets || []);
  const quantified = bullets.filter(bullet => /\d+(?:[.,]\d+)?\s*(?:%|percent|users|customers|hours|days|teams|people|million|thousand)|[$\u00a3\u20ac]\s*\d/i.test(bullet.text));
  const long = bullets.filter(bullet => bullet.text.trim().split(/\s+/).length > 45);
  const checks = [
    { id: 'contact', title: 'Contact details', status: /.+@.+\..+/.test(model.contact.email) ? 'pass' : 'warn', detail: /.+@.+\..+/.test(model.contact.email) ? 'Email is present as real text.' : 'Add an email address.' },
    { id: 'dates', title: 'Employment dates', status: experience.every(item => item.dates?.trim()) ? 'pass' : 'warn', detail: 'Dates are preserved as written; no universal date-format requirement is assumed.' },
    { id: 'length', title: 'Readable achievements', status: long.length ? 'warn' : 'pass', detail: long.length ? long.length + ' long achievements could be shortened with your approval.' : 'No achievement exceeds 45 words.' },
    { id: 'evidence', title: 'Outcome evidence', status: quantified.length ? 'pass' : 'warn', detail: quantified.length + ' of ' + bullets.length + ' achievements mention a measure of impact. Dates alone do not count.' }
  ];
  const coverage = match ? [...match.matched.map(term => ({ ...term, state: 'mentioned', fields: fields.filter(field => atsKeywordMatch(field.value, term.term).matched.length).map(field => field.id) })), ...match.missing.map(term => ({ ...term, state: 'not-evidenced', fields: [] }))] : [];
  const legacyModel = copy(model);
  for (const section of legacyModel.sections) for (const item of section.items || []) if (item.bullets) item.bullets = item.bullets.map(bullet => bullet.text);
  const structure = atsModelChecks(legacyModel, { level: document.target.level, pages: extractedPdf?.pages });
  const measuredChecks = structure.checks.filter(check => !['Quantified achievements', 'Consistent MM/YYYY dates'].includes(check.label));
  measuredChecks.push(...checks.filter(check => ['dates', 'evidence'].includes(check.id)).map(check => ({ label: check.title, status: check.status, note: check.detail })));
  const semantic = targetText ? atsSemanticFit(text, targetText) : null;
  const measured = atsBlendScore({ keyword: match?.rate, semantic, structure: atsStructFromChecks({ checks: measuredChecks }), parse: extractedPdf?.layout ? atsParseScore(extractedPdf.layout) : null });
  return { methodVersion: 1, signature: resumeSignature(document), documentId: document.id, at: Date.now(), method: 'Local measured signals; not a hiring probability or a vendor ATS result', coverage, matchRate: match?.rate ?? null, checks, measuredChecks, measured, semanticMode: 'lexical', targetBasis: document.target.jd.trim() ? 'Job description' : targetText ? 'Role title only' : 'No target selected', pdf: extractedPdf, roleFit: 'Not independently evaluated', layoutRisk: document.design.layout === 'hybrid' ? 'Section columns can mix text in ATS parsers. Inspect the exported reading order.' : document.design.layout === 'sidebar' ? 'Two-column reading order needs inspection in the exported PDF.' : null };
}

export function projectResumeProposal(document, proposal, sources) {
  const next = applyResumeProposal(document, proposal, sources);
  const before = assessResume(document), after = assessResume(next);
  return { before: before.measured.score, after: after.measured.score, delta: after.measured.score - before.measured.score, keywordBefore: before.matchRate, keywordAfter: after.matchRate, wordDelta: proposal.after.trim().split(/\s+/).length - proposal.before.trim().split(/\s+/).length };
}

export function validatePdfText(document, text) {
  const normalize = value => String(value).normalize('NFKC').replace(/[\u2018\u2019\u02bc]/g, "'").replace(/\s+/g, '').toLowerCase();
  const actual = normalize(text);
  const missing = resumeFields(document.model).filter(field => !field.id.endsWith('.url') && field.value.trim() && !actual.includes(normalize(field.value))).map(field => ({ id: field.id, label: field.label, text: field.value }));
  return { complete: !missing.length, missing, fields: resumeFields(document.model).filter(field => !field.id.endsWith('.url') && field.value.trim()).length };
}