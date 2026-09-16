import { createResume, structureResumeText, resumeFields, resumeSignature } from './resume-workspace.mjs';
import { atsKeywordMatch, atsSemanticFit, atsParseLayout, atsParseScore, atsStructFromChecks, atsBlendScore } from './ats-core.js';

export async function assessAtsResume({ text, jd = '', level = 'staff', company = '', signal }, { readPages, semantic, complete }) {
  signal?.throwIfAborted();
  if (typeof text !== 'string' || text.trim().length < 40) throw new Error('Not enough readable resume text to check.');
  const kw = jd ? atsKeywordMatch(text, jd) : null;
  const neural = jd && semantic ? await semantic(text, jd, signal) : null;
  signal?.throwIfAborted();
  const sem = neural?.ok ? neural.score : jd ? atsSemanticFit(text, jd) : null;
  const pages = await readPages(), layout = pages ? atsParseLayout(pages) : null;
  signal?.throwIfAborted();
  const res = await complete({ text, jd, level, company, kw, sem, flags: (layout?.flags || []).map(flag => ({ ...flag, status: 'fail' })), signal });
  signal?.throwIfAborted();
  if (!res || typeof res !== 'object' || !Number.isFinite(Number(res.score))) throw new Error('The ATS check returned an unreadable result.');
  const blend = atsBlendScore({ keyword: kw?.rate ?? null, semantic: sem, structure: atsStructFromChecks(res), parse: atsParseScore(layout), content: Number(res.score) });
  if (blend.score != null) { res.score = blend.score; res.band = blend.band; res._breakdown = blend.breakdown; }
  return { res, kw, sem, layout, semMode: neural?.ok ? 'neural' : neural?.failed ? 'lexical-fallback' : 'lexical', method: 'ATS blended assessment v2', at: Date.now(), target: { jd, level, company } };
}

export function atsEditorReview(document, assessment, { historical = false } = {}) {
  const fields = resumeFields(document.model).filter(field => field.id !== 'name' && field.group !== 'Contact');
  const fixes = Array.isArray(assessment.res?.fixes) ? assessment.res.fixes : [];
  const findings = fixes.map((fix, index) => {
    const quote = fix.anchor?.quote || '', matches = quote ? fields.filter(field => field.value.includes(quote)) : [];
    return { criterionId: 'ats-finding-' + index, action: String(fix.point || 'Review finding'), reason: String(fix.how || ''), priority: fix.priority === 'high' ? 'high' : fix.priority === 'low' ? 'low' : 'medium', fieldIds: matches.length === 1 ? [matches[0].id] : [], evidence: matches.length === 1 ? [{ fieldId: matches[0].id, quote: matches[0].value }] : [], replacement: fix.anchor?.replacement || '', anchor: structuredClone(fix.anchor || {}) };
  });
  return { kind: 'ats', version: 2, method: assessment.method || 'Legacy ATS blended assessment', documentId: document.id, signature: historical ? '' : resumeSignature(document), contentSignature: historical ? '' : resumeSignature({ ...document, sourceIds: [] }), sourceIds: [...document.sourceIds],
    score: assessment.res?.score ?? null, band: assessment.res?.band || '', summary: assessment.res?.summary || '', at: assessment.at || 0, target: structuredClone(document.target), findings,
    breakdown: findings.map(finding => ({ id: finding.criterionId, label: finding.action, reason: finding.reason, status: finding.fieldIds.length ? 'anchored' : 'unresolved field', evidence: finding.evidence.map((reference, index) => ({ id: finding.criterionId + '-' + index, fieldId: reference.fieldId, text: reference.quote })), weight: 0 })), result: structuredClone(assessment.res || null), signals: structuredClone(assessment) };
}

export function atsMigrationSnapshot(entry) {
  const snapshot = structuredClone(entry);
  if (snapshot?.payload?.resumeDocument) delete snapshot.payload.resumeDocument.data;
  return snapshot;
}

export async function atsMigrationIdentity(entry) {
  if (!entry?.id || entry.tool !== 'ats' || !['review', 'workspace'].includes(entry.kind)) throw new Error('Choose a saved ATS review or workspace.');
  const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return { id: 'ats-' + await digest(entry.kind + ':' + entry.id), fingerprint: await digest(JSON.stringify(atsMigrationSnapshot(entry))) };
}

export async function migrateAtsResume(entry, review = null, sourceIds = []) {
  const identity = await atsMigrationIdentity(entry), payload = entry.payload || {};
  if (entry.kind === 'workspace' && !payload.rb) throw new Error('The saved editable resume is missing. Nothing was replaced.');
  if (entry.kind === 'review') review = entry;
  if (review && (review.kind !== 'review' || review.tool !== 'ats' || (entry.kind === 'workspace' && payload.reviewId !== review.id))) throw new Error('This review does not belong to the saved workspace.');
  const original = review?.payload || {}, warnings = [], savedDesign = payload.design || {};
  const model = payload.rb ? structuredClone(payload.rb) : structureResumeText(original.importText || original.source?.text || original.text || '').model;
  let serial = 0;
  const stableId = () => 'ats-field-' + ++serial;
  model.contact = { ...model.contact, links: (model.contact?.links || []).map(link => ({ ...link, id: stableId() })) };
  model.sections = (model.sections || []).map(section => ({ ...section, id: stableId(), kind: section.kind === 'list' ? 'custom' : section.kind,
    ...(section.groups ? { groups: section.groups.map(group => ({ ...group, id: stableId() })) } : {}),
    ...(section.items ? { items: section.items.map(item => ({ ...item, id: stableId(), ...(item.bullets ? { bullets: item.bullets.map(bullet => ({ id: stableId(), text: typeof bullet === 'string' ? bullet : bullet.text })) } : {}) })) } : {}) }));
  const fonts = { inter: 'inter', serif: 'gelasio', gambetta: 'gambetta', mono: 'mono' };
  const design = { font: fonts[savedDesign.font] || 'inter', size: savedDesign.size || 'a4', margin: savedDesign.margin || 'normal', density: savedDesign.density || 'normal', layout: savedDesign.layout === 'sidebar' ? 'sidebar' : 'single', keepWhole: savedDesign.keepWhole ?? true,
    accent: savedDesign.accent || ({ classic: '#9a6a24', modern: '#2f6d9a', compact: '#585c52' }[savedDesign.tpl] || '#9a6a24') };
  if (savedDesign.font && !fonts[savedDesign.font]) warnings.push('The saved ' + savedDesign.font + ' font is not available in this renderer. Inter is selected for comparison; the original setting is retained.');
  if (savedDesign.layout === 'fullbleed') warnings.push('The full-bleed header needs layout review; its original setting is retained.');
  if (payload.rb) warnings.push('Text and section order are retained. Template decoration, exact spacing and pagination need PDF comparison before accepting the layout.');
  else warnings.push('The original text is retained without rewriting. Confirm imported section and profile fields before export.');
  if (!sourceIds.length) warnings.push('The original file is not available here. Its saved reference is retained; no replacement file was assumed.');
  const document = createResume({ id: identity.id, name: model.name ? model.name + (payload.company ? ' - ' + payload.company : '') : 'ATS resume', model, design, sourceIds,
    target: { company: payload.company ?? original.company ?? '', role: '', level: payload.level || original.level || 'staff', jd: payload.jd ?? original.source?.jd ?? original.state?.jd ?? '', url: original.state?.url || '', mode: original.state?.mode || (payload.jd ? 'job' : 'general'), brief: original.source?.brief || original.state?.preparationBrief || null } });
  document.createdAt = entry.at || 0; document.updatedAt = entry.at || 0;
  document.ats = { schema: 1, entryId: entry.id, workspaceId: entry.kind === 'workspace' ? entry.id : null, reviewId: review?.id || payload.reviewId || null, fingerprint: identity.fingerprint, warnings, layoutAccepted: false,
    legacy: { entry: atsMigrationSnapshot(entry), review: review && review.id !== entry.id ? atsMigrationSnapshot(review) : null },
    historicalReview: { method: 'Legacy ATS blended assessment', result: structuredClone(payload.res || original.res || null), sourceText: payload.text || original.source?.text || original.text || '' } };
  document.aiReview = atsEditorReview(document, { res: payload.res || original.res || null, method: payload.assessmentMethod || original.assessmentMethod || 'Legacy ATS blended assessment', at: entry.at || 0 }, { historical: true });
  return document;
}