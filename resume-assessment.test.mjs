import test from 'node:test';
import assert from 'node:assert/strict';
import { createResume, editResumeField } from './src/js/resume-workspace.mjs';
import { createAssessmentSnapshot, assertAssessmentCurrent, validateAssessmentManifest, createCandidateAssessment, validateCandidateAssessment } from './src/js/resume-assessment.mjs';

const encode = text => new TextEncoder().encode(text);
function fixture(jd = 'Python or Java', text = 'Built Python services.\nSupported accessible workflows.') {
  return { artifact: { bytes: encode(text), mediaType: 'text/plain', text, extractorVersion: 'synthetic-text-v1' },
    target: { company: 'Fictional employer', role: 'Designer', level: 'staff', jd } };
}
function atom(snapshot, quote, id) {
  const start = snapshot.target.jd.indexOf(quote), end = start + quote.length;
  return { kind: 'atom', id, segmentId: snapshot.jobSegments.find(segment => start >= segment.start && end <= segment.end).id, start, end, quote };
}
function inventory(snapshot, conditions = [atom(snapshot, snapshot.jobSegments[0].text, 'atom-0')]) {
  return { revision: 1, segments: snapshot.jobSegments.map(segment => ({ id: segment.id, disposition: 'criteria', reason: 'Synthetic explicit requirement.' })),
    requirements: conditions.map((condition, index) => ({ id: 'req-' + index, label: 'Requirement ' + index, importance: 'required', condition })) };
}
const rating = (id, state, evidence = ['artifact-0']) => ({ id, state, evidence, reason: 'Synthetic judgment for contract testing, not AI output.' });
const assessed = async (snapshot, input = {}) => createCandidateAssessment(snapshot, { id: 'assessment-1', createdAt: 1, ...input });
const pdf = items => [{ width: 600, height: 800, items }];
const item = (str, x = 20, y = 100) => ({ str, x, y, w: 180, h: 10 });

test('Candidate snapshot binds exact bytes, extraction, target and document without mutating caller data', async () => {
  const input = fixture(), original = structuredClone(input);
  const snapshot = await createAssessmentSnapshot(input);
  assert.deepEqual(input, original);
  assert.match(snapshot.binding.artifactSha256, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.binding.documentId, null);
  assert.ok(Object.isFrozen(snapshot.evidence[0]));
  assert.deepEqual(await createAssessmentSnapshot(input), snapshot);
  assert.equal(snapshot.evidence[0].text, 'Built Python services.');
  for (const field of ['bytes', 'text', 'extractorVersion']) {
    const changed = structuredClone(input);
    changed.artifact[field] = field === 'bytes' ? encode('different original') : changed.artifact[field] + ' changed';
    assert.throws(() => assertAssessmentCurrent(snapshot, changed), /changed/);
    const next = await createAssessmentSnapshot(changed);
    assert.throws(() => assertAssessmentCurrent(snapshot, next), /changed/);
    await assert.rejects(validateCandidateAssessment(await assessed(snapshot), next), /bound inputs/);
  }
  const differentTarget = await createAssessmentSnapshot({ ...input, target: { ...input.target, company: 'Another employer' } });
  assert.throws(() => assertAssessmentCurrent(snapshot, differentTarget), /changed/);
  await assert.rejects(createAssessmentSnapshot({ ...input, artifact: { ...input.artifact, expectedSha256: 'a'.repeat(64) } }), /expected hash/);
  const document = createResume({ id: 'document-1', target: input.target, model: { title: 'Designer', summary: input.artifact.text, sections: [] } });
  const bound = await createAssessmentSnapshot({ ...input, document, documentVersion: 4 });
  assert.equal(bound.binding.documentId, document.id);
  const edited = await createAssessmentSnapshot({ ...input, document: editResumeField(document, 'summary', 'New wording'), documentVersion: 5 });
  assert.throws(() => assertAssessmentCurrent(bound, edited), /changed/);
  await assert.rejects(createAssessmentSnapshot({ ...input, document, target: { ...input.target, jd: 'Different job' } }), /targets differ/);
});

test('Candidate snapshot captures mutable caller data before hashing yields', async () => {
  const input = fixture(), pending = createAssessmentSnapshot(input);
  input.artifact.bytes.fill(0);
  input.artifact.text = 'Changed during hashing.';
  input.target.jd = 'Changed target.';
  const snapshot = await pending;
  assert.equal(snapshot.artifact.text, fixture().artifact.text);
  assert.equal(snapshot.target.jd, fixture().target.jd);
  assert.deepEqual(snapshot, await createAssessmentSnapshot(fixture()));
});

test('Candidate validation requires a freshly captured authoritative snapshot, not copied binding metadata', async () => {
  const snapshot = await createAssessmentSnapshot(fixture());
  const forged = structuredClone(snapshot); forged.artifact.text = 'Unbound new text';
  await assert.rejects(assessed(forged), /original bytes/);
  assert.throws(() => validateAssessmentManifest(inventory(snapshot), forged), /original bytes/);
  assert.throws(() => assertAssessmentCurrent(snapshot, forged), /original bytes/);
  const saved = JSON.parse(JSON.stringify(await assessed(snapshot)));
  assert.deepEqual(await validateCandidateAssessment(saved, await createAssessmentSnapshot(fixture())), saved);
});

test('Candidate source spans retain exact CRLF, Unicode and whitespace offsets', async () => {
  const input = fixture('  Python\r\n\r\n  Accessibility  ', '  Built caf\u00e9 tools.\r\n\r\n  Accessible UI  ');
  const snapshot = await createAssessmentSnapshot(input);
  for (const span of snapshot.jobSegments) assert.equal(input.target.jd.slice(span.start, span.end), span.text);
  for (const span of snapshot.evidence) assert.equal(input.artifact.text.slice(span.start, span.end), span.text);
  assert.equal(snapshot.jobSegments.length, 2);
  assert.equal(snapshot.evidence[1].text, 'Accessible UI');
  assert.equal(snapshot.evidence[0].text, 'Built caf\u00e9 tools.');
});

test('L03 candidate rejects incomplete job mode, unsupported formats and exceeded input budgets before evaluation', async () => {
  const input = fixture();
  for (const jd of ['', ' '.repeat(20)]) await assert.rejects(createAssessmentSnapshot({ ...input, target: { ...input.target, mode: 'job', jd } }), /job description/);
  await assert.rejects(createAssessmentSnapshot({ ...input, target: { ...input.target, jd: 'x'.repeat(20001) } }), /truncated/);
  await assert.rejects(createAssessmentSnapshot({ ...input, target: { ...input.target, jd: Array(301).fill('requirement').join('\n') } }), /dropped/);
  await assert.rejects(createAssessmentSnapshot({ ...input, artifact: { ...input.artifact, text: 'x'.repeat(60001) } }), /truncated/);
  await assert.rejects(createAssessmentSnapshot({ ...input, artifact: { ...input.artifact, mediaType: 'image/png' } }), /unsupported/);
  await assert.rejects(createAssessmentSnapshot({ ...input, artifact: { ...input.artifact, bytes: new Uint8Array() } }), /bytes/);
  await assert.rejects(createAssessmentSnapshot({ ...input, documentVersion: 2 }), /requires a document/);
});

test('A01 A02 candidate never turns empty or missing PDF geometry into parse success or a better score', async () => {
  const input = fixture(), pdfInput = { ...input, artifact: { ...input.artifact, mediaType: 'application/pdf', pages: [] } };
  const empty = await assessed(await createAssessmentSnapshot(pdfInput));
  assert.equal(empty.status, 'blocked');
  assert.equal(empty.dimensions.artifact.observations.find(observation => observation.id === 'positions').status, 'fail');
  assert.equal(empty.headline.value, null);
  const unavailable = await assessed(await createAssessmentSnapshot({ ...pdfInput, artifact: { ...pdfInput.artifact, pages: null } }));
  assert.equal(unavailable.status, 'partial');
  assert.equal(unavailable.dimensions.artifact.observations.find(observation => observation.id === 'positions').status, 'unknown');
  assert.equal(unavailable.headline.value, null);
  const blank = await assessed(await createAssessmentSnapshot({ ...pdfInput, artifact: { ...pdfInput.artifact, pages: pdf([]) } }));
  assert.equal(blank.status, 'blocked');
  const plain = await assessed(await createAssessmentSnapshot(input));
  assert.equal(plain.dimensions.artifact.observations.find(observation => observation.id === 'positions').status, 'not-applicable');
  const noText = await assessed(await createAssessmentSnapshot({ ...pdfInput, artifact: { ...pdfInput.artifact, text: '', pages: pdf([]) } }));
  assert.equal(noText.dimensions.artifact.observations.find(observation => observation.id === 'recovered-text').status, 'fail');
});

test('A03 A04 candidate bounds are measured but text presence never proves reading order or association', async () => {
  const input = fixture(), artifact = { ...input.artifact, mediaType: 'application/pdf', pages: pdf([item('Built Python services.')]) };
  const snapshot = await createAssessmentSnapshot({ ...input, artifact }), result = await assessed(snapshot);
  assert.equal(result.status, 'partial');
  assert.equal(result.dimensions.artifact.observations.find(observation => observation.id === 'physical-bounds').status, 'pass');
  for (const id of ['reading-order', 'field-association']) assert.equal(result.dimensions.artifact.observations.find(observation => observation.id === id).status, 'unknown');
  const outside = await assessed(await createAssessmentSnapshot({ ...input, artifact: { ...artifact, pages: pdf([item('Outside', 590)]) } }));
  assert.equal(outside.status, 'blocked');
  const moved = await createAssessmentSnapshot({ ...input, artifact: { ...artifact, pages: pdf([item('Built Python services.', 40)]) } });
  assert.throws(() => assertAssessmentCurrent(snapshot, moved), /changed/);
  for (const invalid of [NaN, Infinity, '20']) {
    await assert.rejects(createAssessmentSnapshot({ ...input, artifact: { ...artifact, pages: pdf([{ ...item('Invalid'), x: invalid }]) } }), /positional/);
  }
});

test('A05 candidate layout risks describe observations rather than universal ATS failures', async () => {
  const input = fixture(), items = Array.from({ length: 12 }, (_, index) => item('Column ' + index, index % 2 ? 360 : 20, 100 + Math.floor(index / 2) * 20));
  items.push(item('person@example.test', 20, 20));
  const result = await assessed(await createAssessmentSnapshot({ ...input, artifact: { ...input.artifact, mediaType: 'application/pdf', pages: pdf(items) } }));
  const columns = result.dimensions.artifact.observations.find(observation => observation.id === 'column-risk');
  assert.equal(columns.status, 'warn'); assert.match(columns.reason, /not a universal/);
  assert.equal(result.dimensions.artifact.observations.find(observation => observation.id === 'contact-region').status, 'warn');
  assert.equal(result.status, 'partial');
});

test('R03 candidate preserves OR alternatives and independently required AND conditions', async () => {
  const snapshot = await createAssessmentSnapshot(fixture());
  const children = [atom(snapshot, 'Python', 'python'), atom(snapshot, 'Java', 'java')];
  const ratings = [rating('python', 'supported'), rating('java', 'not-evidenced', [])];
  const or = await assessed(snapshot, { manifest: inventory(snapshot, [{ kind: 'anyOf', children }]), ratings });
  assert.equal(or.dimensions.roleEvidence.requirements[0].state, 'supported');
  assert.deepEqual(or.dimensions.roleEvidence.requiredGaps, []);
  const and = await assessed(snapshot, { manifest: inventory(snapshot, [{ kind: 'allOf', children }]), ratings });
  assert.equal(and.dimensions.roleEvidence.requirements[0].state, 'partially-supported');
  assert.deepEqual(and.dimensions.roleEvidence.requiredGaps, ['req-0']);
  assert.notEqual(or.binding.manifestSha256, and.binding.manifestSha256);
  assert.equal(or.headline.value, null);
});

test('R04 R05 candidate retains forty supplied requirements and evidence beyond old truncation points', async () => {
  const skills = Array.from({ length: 40 }, (_, index) => 'skill-' + index);
  const snapshot = await createAssessmentSnapshot(fixture(skills.join('\n'), 'x'.repeat(12500) + '\nEvidence at the end.'));
  const manifest = inventory(snapshot, skills.map((skill, index) => atom(snapshot, skill, 'atom-' + index)));
  const ratings = skills.map((_, index) => rating('atom-' + index, index < 28 ? 'supported' : 'not-evidenced', index < 28 ? ['artifact-0'] : []));
  const result = await assessed(snapshot, { manifest, ratings });
  assert.equal(result.coverage.totalRequirements, 40);
  assert.equal(result.coverage.assessedRequirements, 40);
  assert.equal(result.dimensions.roleEvidence.requiredGaps.length, 12);
  assert.equal(result.evidence.at(-1).text, 'Evidence at the end.');
  assert.equal(result.headline.value, null);
  const longJd = 'Context '.repeat(1100) + '\nRequired final skill.';
  const long = await createAssessmentSnapshot(fixture(longJd));
  assert.equal(long.jobSegments.at(-1).text, 'Required final skill.');
  assert.equal(long.target.jd, longJd);
});

test('Candidate manifest rejects missing, forged, duplicate and oversized criteria without dropping any', async () => {
  const snapshot = await createAssessmentSnapshot(fixture('Python\nAccessibility'));
  const manifest = inventory(snapshot, [atom(snapshot, 'Python', 'python'), atom(snapshot, 'Accessibility', 'accessibility')]);
  const original = structuredClone(manifest);
  assert.deepEqual(validateAssessmentManifest(manifest, snapshot), manifest);
  assert.deepEqual(manifest, original);
  for (const mutate of [
    value => value.segments.pop(),
    value => value.requirements.pop(),
    value => { value.requirements[0].condition.quote = 'Java'; },
    value => { value.requirements[1].id = value.requirements[0].id; },
    value => { value.requirements[1].condition.id = value.requirements[0].condition.id; },
    value => { value.segments[0].disposition = 'context'; },
    value => { value.requirements[0].condition = { kind: 'anyOf', children: [] }; },
    value => { value.requirements = Array(61).fill(value.requirements[0]); },
    value => { value.extra = true; }
  ]) {
    const bad = structuredClone(manifest); mutate(bad);
    assert.throws(() => validateAssessmentManifest(bad, snapshot), /Candidate assessment/);
  }
});

test('R06 candidate distinguishes valid citations from semantically verified evidence and never invents a headline', async () => {
  const snapshot = await createAssessmentSnapshot(fixture('Leadership', 'Designer'));
  const result = await assessed(snapshot, { manifest: inventory(snapshot), ratings: [rating('atom-0', 'supported')] });
  assert.equal(result.dimensions.roleEvidence.verification, 'reference-checked-only');
  assert.equal(result.coverage.inventoryVerification, 'structural-only');
  assert.equal(result.status, 'partial');
  assert.equal(result.headline.value, null);
  assert.match(result.limitations.join(' '), /not semantic correctness/);
  const forged = structuredClone(result); forged.dimensions.roleEvidence.verification = 'verified';
  await assert.rejects(validateCandidateAssessment(forged, snapshot), /bound inputs/);
  await assert.rejects(assessed(snapshot, { manifest: inventory(snapshot), ratings: [rating('atom-0', 'supported', ['missing'])] }), /evidence reference/);
});

test('R09 candidate retains unknown, contradiction and conflicting evidence without averaging them away', async () => {
  const snapshot = await createAssessmentSnapshot(fixture('Python\nLeadership'));
  const manifest = inventory(snapshot, [atom(snapshot, 'Python', 'python'), atom(snapshot, 'Leadership', 'leadership')]);
  const result = await assessed(snapshot, { manifest, ratings: [rating('python', 'unknown', []), rating('leadership', 'contradicted')] });
  assert.deepEqual(result.dimensions.roleEvidence.requirements.map(requirement => requirement.state), ['unknown', 'contradicted']);
  assert.equal(result.coverage.unresolvedRequirements, 1);
  assert.deepEqual(result.dimensions.roleEvidence.requiredGaps, ['req-0', 'req-1']);
  await assert.rejects(assessed(snapshot, { manifest, ratings: [rating('python', 'conflicting-evidence'), rating('leadership', 'supported')] }), /both sources/);
  const conflict = await assessed(snapshot, { manifest, ratings: [rating('python', 'conflicting-evidence', ['artifact-0', 'artifact-1']), rating('leadership', 'supported')] });
  assert.equal(conflict.coverage.unresolvedRequirements, 1);
  const empty = await createAssessmentSnapshot(fixture('Python', ' '));
  await assert.rejects(assessed(empty, { manifest: inventory(empty), ratings: [rating('atom-0', 'not-evidenced', [])] }), /empty extraction/);
});

test('Candidate nested compound state propagation preserves meaningful distinctions', async () => {
  const snapshot = await createAssessmentSnapshot(fixture('Python or Java\nLeadership'));
  const alternatives = { kind: 'anyOf', children: [atom(snapshot, 'Python', 'python'), atom(snapshot, 'Java', 'java')] };
  const condition = { kind: 'allOf', children: [alternatives, atom(snapshot, 'Leadership', 'leadership')] };
  const manifest = inventory(snapshot, [condition]);
  for (const [python, java, leadership, expected] of [
    ['supported', 'unknown', 'supported', 'supported'],
    ['supported', 'not-evidenced', 'contradicted', 'contradicted'],
    ['unknown', 'not-evidenced', 'supported', 'unknown'],
    ['mentioned', 'not-evidenced', 'mentioned', 'mentioned'],
    ['not-evidenced', 'not-evidenced', 'not-evidenced', 'not-evidenced'],
    ['contradicted', 'contradicted', 'supported', 'contradicted'],
    ['conflicting-evidence', 'not-evidenced', 'supported', 'conflicting-evidence']
  ]) {
    const ratings = [python, java, leadership].map((state, index) => rating(['python', 'java', 'leadership'][index], state,
      state === 'not-evidenced' || state === 'unknown' ? [] : state === 'conflicting-evidence' ? ['artifact-0', 'artifact-1'] : ['artifact-0']));
    const result = await assessed(snapshot, { manifest, ratings });
    assert.equal(result.dimensions.roleEvidence.requirements[0].state, expected);
  }
});

test('L05 candidate strictly validates communication judgments and derived report fields', async () => {
  const snapshot = await createAssessmentSnapshot(fixture());
  const communication = ['scope', 'outcomes', 'clarity'].map(id => ({ id, rating: 4, reason: 'Synthetic anchored judgment.', evidence: ['artifact-0'] }));
  const result = await assessed(snapshot, { communication });
  assert.equal(result.dimensions.communication.verification, 'reference-checked-only');
  assert.equal(result.headline.value, null);
  assert.deepEqual(await validateCandidateAssessment(JSON.parse(JSON.stringify(result)), snapshot), result);
  for (const invalid of ['4', NaN, Infinity, -1, 5]) {
    const bad = structuredClone(communication); bad[0].rating = invalid;
    await assert.rejects(assessed(snapshot, { communication: bad }), /integer/);
  }
  for (const mutate of [
    value => { value.headline.value = 100; },
    value => { value.headline.value = ''; },
    value => { value.score = null; },
    value => { value.status = 'complete'; },
    value => { value.coverage.assessedRequirements = 999; },
    value => { value.binding.artifactSha256 = 'a'.repeat(64); },
    value => { value.evidence[0].text = 'Invented'; },
    value => { value.findings = [{ action: 'Invented finding' }]; },
    value => { value.execution = [{ model: 'Unrecorded AI model' }]; },
    value => { value.method.version = 99; }
  ]) {
    const bad = structuredClone(result); mutate(bad);
    await assert.rejects(validateCandidateAssessment(bad, snapshot), /Candidate assessment/);
  }
  for (const invalid of [NaN, Infinity, undefined, new Date(), () => 1]) {
    const bad = structuredClone(result); bad.headline.value = invalid;
    await assert.rejects(validateCandidateAssessment(bad, snapshot), /JSON/);
  }
  const circular = structuredClone(result); circular.extra = circular;
  await assert.rejects(validateCandidateAssessment(circular, snapshot), /JSON/);
  const undefinedExtra = structuredClone(result); undefinedExtra.headline.extra = undefined;
  await assert.rejects(validateCandidateAssessment(undefinedExtra, snapshot), /JSON/);
  const arrayExtra = structuredClone(result); arrayExtra.execution.extra = true;
  await assert.rejects(validateCandidateAssessment(arrayExtra, snapshot), /JSON/);
  await assert.rejects(assessed(snapshot, { id: null }), /identity/);
  await assert.rejects(assessed(snapshot, { createdAt: null }), /integer/);
});

test('Candidate general and pre-inventory reports explicitly remain unassessed rather than assuming success', async () => {
  const general = await assessed(await createAssessmentSnapshot(fixture('')));
  assert.equal(general.dimensions.roleEvidence.status, 'not-applicable');
  assert.equal(general.dimensions.communication.status, 'not-assessed');
  assert.equal(general.coverage.totalRequirements, null);
  assert.equal(general.headline.value, null);
  const snapshot = await createAssessmentSnapshot(fixture()), result = await assessed(snapshot);
  assert.equal(result.coverage.accountedSegments, 0);
  assert.equal(result.coverage.totalSegments, 1);
  assert.equal(result.dimensions.roleEvidence.verification, 'not-performed');
  const inventoried = await assessed(snapshot, { manifest: inventory(snapshot) });
  assert.equal(inventoried.dimensions.roleEvidence.requirements[0].state, 'not-assessed');
  assert.equal(inventoried.coverage.unresolvedRequirements, 1);
  assert.deepEqual(inventoried.findings, []);
  assert.match(inventoried.limitations.at(-1), /not a clean bill/);
});
