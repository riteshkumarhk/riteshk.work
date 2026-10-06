export const SEMANTIC_REVIEW = 'source-attribution-v1';
const fail = message => { throw new Error('Semantic review: ' + message); };
const kinds = ['experience', 'general', 'uncertain'];
function shape(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value, key))) {
    const received = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value !== 'object' ? typeof value
      : 'keys ' + JSON.stringify(Object.keys(value).slice(0, 20).map(key => key.slice(0, 80)));
    fail(`invalid record fields at ${path}; expected keys ${JSON.stringify(keys)}; received ${received}.`);
  }
}
function reason(value) { if (typeof value !== 'string' || !value.trim() || value.length > 4000) fail('a bounded explanation is required.'); }
function list(value, maximum) { if (!Array.isArray(value) || value.length > maximum) fail('list exceeds the semantic review contract.'); }
function complete(values, ids) {
  list(values, ids.length);
  if (values.some(value => !value || typeof value.id !== 'string')) fail('invalid review identity.');
  if (values.length !== ids.length || new Set(values.map(value => value.id)).size !== ids.length || values.some(value => !ids.includes(value.id))) fail('every expected source needs exactly one review.');
}
export function resolveSemanticQuote(reference, snapshot, selection, path = 'semantic.reference') {
  shape(reference, ['id', 'quote'], path); reason(reference.quote);
  const excerpt = snapshot.evidence.find(item => item.id === reference.id);
  if (!excerpt || !selection.includedIds.includes(reference.id)) fail('source quote uses excluded or unknown evidence.');
  const offset = excerpt.text.indexOf(reference.quote);
  if (offset < 0 || excerpt.text.indexOf(reference.quote, offset + 1) !== -1) fail('source quote must identify exactly one occurrence within its excerpt.');
  return { ...reference, start: excerpt.start + offset, end: excerpt.start + offset + reference.quote.length };
}
const references = group => [group.role, group.employer, group.dates, ...group.achievements].filter(Boolean);

export function validateSemanticDraft(value, snapshot, selection) {
  shape(value, ['version', 'excerpts', 'groups'], 'draft.semantic');
  if (value.version !== SEMANTIC_REVIEW) fail('unsupported attribution version.');
  list(value.excerpts, selection.includedIds.length);
  for (const [index, excerpt] of value.excerpts.entries()) {
    shape(excerpt, ['id', 'kind', 'reason'], `draft.semantic.excerpts[${index}]`); reason(excerpt.reason);
    if (!kinds.includes(excerpt.kind)) fail('unknown excerpt classification.');
  }
  complete(value.excerpts, selection.includedIds);
  list(value.groups, 60);
  const ids = new Set(), achievements = []; let count = 0;
  for (const [index, group] of value.groups.entries()) {
    const path = `draft.semantic.groups[${index}]`;
    shape(group, ['id', 'role', 'employer', 'dates', 'achievements', 'certainty', 'reason'], path); reason(group.reason);
    if (typeof group.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(group.id) || ids.has(group.id)) fail('invalid or duplicate experience group.');
    ids.add(group.id);
    if (!['explicit', 'uncertain'].includes(group.certainty)) fail('unknown association certainty.');
    list(group.achievements, 40);
    for (const field of ['role', 'employer', 'dates']) if (group[field] !== null) resolveSemanticQuote(group[field], snapshot, selection, `${path}.${field}`);
    for (const [achievement, reference] of group.achievements.entries()) resolveSemanticQuote(reference, snapshot, selection, `${path}.achievements[${achievement}]`);
    for (const reference of references(group)) {
      resolveSemanticQuote(reference, snapshot, selection);
      if (value.excerpts.find(excerpt => excerpt.id === reference.id).kind === 'general') fail('a general excerpt cannot silently become an experience association.');
      if (++count > 300) fail('too many association references.');
    }
    for (const reference of group.achievements) {
      const resolved = resolveSemanticQuote(reference, snapshot, selection);
      if (achievements.some(previous => previous.id === resolved.id && previous.start < resolved.end && previous.end > resolved.start)) fail('achievement occurrences cannot overlap or be assigned more than once.');
      achievements.push(resolved);
    }
  }
  return value;
}
export function validateSemanticChallenge(value, draft, snapshot, selection) {
  shape(value, ['version', 'excerpts', 'groups', 'segments'], 'challenge.semantic');
  if (value.version !== SEMANTIC_REVIEW) fail('unsupported challenge version.');
  for (const [field, ids] of [
    ['excerpts', selection.includedIds], ['groups', draft.groups.map(group => group.id)], ['segments', snapshot.jobSegments.map(segment => segment.id)],
  ]) {
    list(value[field], ids.length);
    for (const [index, entry] of value[field].entries()) {
      shape(entry, ['id', 'verdict', 'reason'], `challenge.semantic.${field}[${index}]`); reason(entry.reason);
      if (!['agree', 'disagree', 'uncertain'].includes(entry.verdict)) fail('unknown semantic challenge verdict.');
    }
    complete(value[field], ids);
  }
  return value;
}

export function resolveSemanticReview(draft, challenge, snapshot, selection) {
  validateSemanticDraft(draft, snapshot, selection); validateSemanticChallenge(challenge, draft, snapshot, selection);
  const groups = draft.groups.map(group => {
    const review = challenge.groups.find(item => item.id === group.id);
    const sourcesAgree = references(group).every(reference => challenge.excerpts.find(item => item.id === reference.id).verdict === 'agree' &&
      draft.excerpts.find(item => item.id === reference.id).kind === 'experience');
    return { ...group, role: group.role && resolveSemanticQuote(group.role, snapshot, selection),
      employer: group.employer && resolveSemanticQuote(group.employer, snapshot, selection),
      dates: group.dates && resolveSemanticQuote(group.dates, snapshot, selection),
      achievements: group.achievements.map(reference => resolveSemanticQuote(reference, snapshot, selection)),
      state: group.certainty === 'explicit' && group.role && group.employer && group.achievements.length && sourcesAgree && review.verdict === 'agree' ? 'model-agreed' : 'unknown',
      challengeReason: review.reason };
  });
  const excerpts = draft.excerpts.map(excerpt => {
    const review = challenge.excerpts.find(item => item.id === excerpt.id);
    const related = groups.filter(group => references(group).some(reference => reference.id === excerpt.id));
    const source = snapshot.evidence.find(item => item.id === excerpt.id);
    const covered = new Uint8Array(source.text.length);
    for (const reference of related.flatMap(references).filter(reference => reference.id === excerpt.id)) covered.fill(1, reference.start - source.start, reference.end - source.start);
    const unmappedText = excerpt.kind === 'experience' ? source.text.split('').map((character, index) => covered[index] ? ' ' : character).join('').trim() : '';
    return { ...excerpt, groupIds: related.map(group => group.id), state: review.verdict !== 'agree' || excerpt.kind === 'uncertain' ||
      (excerpt.kind === 'experience' && (!related.length || related.some(group => group.state !== 'model-agreed') || /[\p{L}\p{N}]/u.test(unmappedText))) ? 'unknown' : 'model-agreed',
    unmappedText, challengeReason: review.reason };
  });
  return { version: SEMANTIC_REVIEW, verification: 'model-challenged-not-independent', groups, excerpts,
    segments: challenge.segments.map(segment => ({ ...segment, state: segment.verdict === 'agree' ? 'model-agreed' : 'unknown' })) };
}

export function semanticJudgmentBlock(interpretation, original, check, field, inventoryIssues, snapshot) {
  if (field === 'ratings' && (inventoryIssues.length || interpretation.segments.some(segment => segment.state === 'unknown'))) return 'The full job inventory has an unresolved semantic challenge. Review it before treating role judgments as settled.';
  const ids = new Set([...original.evidence, ...check.evidence]);
  if (interpretation.excerpts.some(excerpt => ids.has(excerpt.id) && excerpt.state === 'unknown')) return 'A cited excerpt has unresolved classification or role/employer/date/achievement attribution.';
  if (field === 'ratings' && original.state === 'not-evidenced' && interpretation.excerpts.some(excerpt => excerpt.state === 'unknown')) return 'Unresolved source interpretation prevents a reliable absence claim.';
  if (field === 'ratings' && original.state === 'not-evidenced' && snapshot.artifact.mediaType === 'application/pdf' &&
      (!snapshot.artifact.pages?.length || snapshot.artifact.pages.some(page => !page.items.some(item => item.str.trim())))) return 'An unreadable PDF page prevents a reliable absence claim.';
  return null;
}

export const SEMANTIC_RESPONSE_EXAMPLES = Object.freeze({
  assessment: '{"version":"source-attribution-v1","excerpts":[{"id":"artifact-0","kind":"experience|general|uncertain","reason":"why"}],"groups":[{"id":"job-0","role":{"id":"artifact-2","quote":"exact role"},"employer":{"id":"artifact-3","quote":"exact employer"},"dates":null,"achievements":[{"id":"artifact-4","quote":"exact achievement"}],"certainty":"explicit|uncertain","reason":"what establishes the relationship"}]}',
  challenge: '{"version":"source-attribution-v1","excerpts":[{"id":"artifact-0","verdict":"agree|disagree|uncertain","reason":"source-specific explanation"}],"groups":[{"id":"job-0","verdict":"agree|disagree|uncertain","reason":"whether all metadata and achievements truly belong together"}],"segments":[{"id":"jd-0","verdict":"agree|disagree|uncertain","reason":"complete clause-by-clause check"}]}',
});

export const SEMANTIC_PROMPTS = {
  assessment: `
SOURCE ATTRIBUTION CONTRACT source-attribution-v1:
Add "semantic":${SEMANTIC_RESPONSE_EXAMPLES.assessment}.
Classify EVERY included excerpt exactly once. General means unscoped summary/skills/education or other non-job-specific material, not a shortcut around ambiguous experience.
Build experience groups ONLY from included source quotations, never an edited canvas or inferred employer. Each quote must be unique within its named excerpt; code resolves offsets.
Use null for absent role/employer/dates; never invent metadata. Achievements may be empty when absent. Incomplete or uncertain groups cannot establish settled attribution.
Account for all experience passages. A mixed/ambiguous excerpt must remain uncertain if its relationships cannot be established. Do not attach a skill or achievement to a role merely because it is nearby in extraction order.
Quotes must cover the meaningful text of every experience excerpt; include labels/context where needed. Unmapped words keep that excerpt unresolved.
One achievement occurrence cannot belong to multiple roles. Preserve older roles, overlapping dates and promotions without inventing chronology. Max60 groups,40 achievements/group,300 source references total.
The usual ratings/communication fields are still required. Source interpretation is a model judgment, not verified truth.`,
  challenge: `
SOURCE AND JD COMPLETENESS CHALLENGE source-attribution-v1:
Add "semantic":${SEMANTIC_RESPONSE_EXAMPLES.challenge}.
Review EVERY included excerpt classification, EVERY proposed experience group and EVERY original JD segment exactly once, including segments labelled context/benefits/eligibility.
For each JD segment check omitted clauses, invented qualifications, required vs preferred, scope, alternatives/conjunctions, examples vs exhaustive requirements, proficiency, duration and negation. Accounting for a segment is not semantic completeness.
For each group check exact role/employer/date/achievement relationships against ALL included evidence. Detect swapped employers, repeated wording, unrelated metrics, skill-list attribution and incorrect experience/general classification.
Do not agree just because citations exist. If the evidence cannot settle a relationship, return uncertain. Missing groups and hidden mixed passages require excerpt uncertainty.
Do not silently repair the first pass. Disagreement remains unknown; original claims and reasons are preserved. Existing ratings/communication/inventoryIssues are also required.`,
};
