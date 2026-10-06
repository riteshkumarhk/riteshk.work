import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { historyHash } from './src/js/resume-assessment-history.mjs';
import { QUALITY_GOALS, QUALITY_SLICES, evaluateHeadlineCalibration, evaluateAssessmentQuality } from './tools/resume-assessment-quality.mjs';

const digest = value => String(value).repeat(64);
function calibration() {
  return { version: 1, policySha256: digest(3), developerId: 'developer-fixture', frozenAt: 100,
    minimumDocuments: 2, maximumMeanAbsoluteError: 3, maximumAbsoluteError: 5,
    samples: [0, 1, 2].map(index => ({ documentId: 'calibration-' + index, familyId: 'calibration-family-' + index,
      artifactSha256: digest((index + 10).toString(16)), referenceSha256: digest(5), reviewerId: 'human-fixture', independent: true,
      approvedAt: 50, predictedAt: 200, policySha256: digest(3), expected: index === 2 ? null : 50, predicted: index === 2 ? null : 52 })) };
}
async function fixture() {
  const references = QUALITY_SLICES.map((slice, index) => ({
    documentId: 'document-' + index, familyId: 'family-' + index, artifactSha256: digest(index), slice,
    labelsSha256: digest(1), reviewerId: 'human-fixture', independent: true, approvedAt: 100,
    coverage: index === 0 ? [...QUALITY_GOALS] : [], states: { python: 'contradicted', ambiguous: null }, criticalIds: ['python'],
  }));
  const runs = references.flatMap((reference, index) => [0, 1, 2].map(repeatIndex => ({
    id: reference.documentId + '-run-' + repeatIndex, documentId: reference.documentId, artifactSha256: reference.artifactSha256,
    methodSha256: digest(1), inventorySha256: digest(2), repeatIndex, startedAt: 2000, outcome: 'complete',
    elapsedMs: (index + 1) * 100, reservedUsd: 0.01,
    metrics: { criteria: { tp: 19, fp: 1, fn: 1 }, relevance: { correct: 19, total: 20 },
      association: { correct: 19, total: 20 }, criticism: { false: 1, total: 20 },
      criticalMisses: 0, acceptedRevisions: 1, unsupportedAcceptedRevisions: 0 },
    states: { python: 'contradicted', ambiguous: repeatIndex === 1 ? 'mentioned' : 'unknown' },
    paired: { baselineSha256: digest(2), verdict: index === 0 ? 'candidate-better' : 'tie',
      regressions: 0, reviewerId: 'human-fixture', blinded: true },
  })));
  return { protocol: { version: 1, status: 'frozen', developerId: 'developer-fixture', frozenAt: 1000, methodSha256: digest(1),
    baselineSha256: digest(2), headlinePolicySha256: digest(3), referenceSetSha256: await historyHash(references),
    developmentFamilies: ['development-family'], minimumDocumentsPerSlice: 1,
    samplingApprovedBy: 'sampling-fixture', samplingRationale: 'Scripted protocol only; not genuine sample-adequacy approval.',
    repeatDocumentIds: references.map(reference => reference.documentId), maxP95Ms: 900, maxReservedUsd: 0.27 },
    references, runs, calibration: calibration() };
}
async function refreeze(input) { input.protocol.referenceSetSha256 = await historyHash(input.references); return input; }

test('Calibration measures exact errors and unavailable predictions without generating a score or release approval', async () => {
  const input = calibration(), before = JSON.stringify(input), result = await evaluateHeadlineCalibration(input);
  assert.equal(result.criteriaMet, true); assert.equal(result.numericPairs, 2);
  assert.equal(result.meanAbsoluteError, 2); assert.equal(result.maximumAbsoluteError, 2);
  assert.equal(result.promotionAuthorized, false); assert.equal(JSON.stringify(input), before);
  for (const change of [
    value => { value.samples[2].predicted = 100; },
    value => { value.samples[0].predicted = null; },
    value => { value.samples[0].predicted = 100; },
    value => { value.samples[0].independent = false; },
    value => { value.samples[0].reviewerId = value.developerId; },
    value => { value.samples[0].approvedAt = 201; },
    value => { value.samples[0].policySha256 = digest(6); },
    value => { value.minimumDocuments = 4; },
    value => { value.samples = []; },
  ]) {
    const altered = calibration(); change(altered);
    assert.equal((await evaluateHeadlineCalibration(altered)).criteriaMet, false);
  }
  const invalid = calibration(); invalid.samples[0].predicted = '52';
  await assert.rejects(evaluateHeadlineCalibration(invalid), /invalid nonnegative/);
  const fractional = calibration(); fractional.samples[0].predicted = 52.5;
  await assert.rejects(evaluateHeadlineCalibration(fractional), /invalid integer/);
  const duplicate = calibration(); duplicate.samples[1].artifactSha256 = duplicate.samples[0].artifactSha256;
  await assert.rejects(evaluateHeadlineCalibration(duplicate), /duplicate/);
});
test('Quality measurement uses nine slices, exact thresholds, first-run denominators and all three pairwise repetitions', async () => {
  const input = await fixture(), before = JSON.stringify(input), result = await evaluateAssessmentQuality(input);
  assert.equal(QUALITY_GOALS.length, 26); assert.equal(result.criteriaMet, true);
  assert.deepEqual(result.repeatability, { matches: 27, denominator: 27, flips: 0, documents: 9, agreement: 1 });
  assert.deepEqual(result.bySlice['pdf:senior'].precision, { numerator: 19, denominator: 20, value: 0.95 });
  assert.equal(result.bySlice['pdf:senior'].documents, 1, 'repeated runs cannot inflate independent documents');
  assert.deepEqual(result.latency, { completedRuns: 27, p50Ms: 500, p95Ms: 900 });
  assert.equal(result.reservedUsd, 0.27);
  assert.equal(result.promotionAuthorized, false); assert.equal(result.populationAccuracyEstablished, false);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(await evaluateAssessmentQuality(structuredClone(input)), result);
});
test('Quality measurement blocks unmeasured, failed, insufficient, contaminated or unfrozen evaluation evidence', async () => {
  for (const change of [
    value => { value.runs = []; },
    value => { value.protocol.status = 'draft'; },
    value => { value.protocol.baselineSha256 = null; },
    value => { value.protocol.minimumDocumentsPerSlice = 4; },
    value => { value.protocol.samplingApprovedBy = null; },
    value => { value.protocol.samplingApprovedBy = value.protocol.developerId; },
    value => { value.protocol.maxP95Ms = null; },
    value => { value.protocol.maxReservedUsd = 0.269999; },
    value => { value.protocol.developmentFamilies.push(value.references[0].familyId); },
    value => { value.references[0].independent = false; },
    value => { value.references[0].approvedAt = 2001; },
    value => { value.references[0].coverage = []; },
    value => { value.runs[0].methodSha256 = digest(9); },
    value => { value.runs[0].startedAt = 999; },
    value => { value.runs[0].outcome = 'unknown'; value.runs[0].metrics = null; value.runs[0].states = null; value.runs[0].paired = null; },
    value => { value.calibration = null; },
    value => { value.calibration.samples[0].familyId = value.references[0].familyId; },
    value => { value.calibration.samples[0].artifactSha256 = value.references[0].artifactSha256; },
    value => { value.calibration.samples[0].predictedAt = 2001; },
    value => { value.protocol.headlinePolicySha256 = null; },
  ]) {
    const input = await fixture(); change(input); await refreeze(input);
    const result = await evaluateAssessmentQuality(input);
    assert.equal(result.criteriaMet, false); assert.ok(result.blockers.length);
  }
});
test('Quality gates cannot hide bad slices, zero denominators, critical misses, unsafe revisions or unblinded baseline regressions', async () => {
  for (const change of [
    value => { value.runs[0].metrics.criteria.fp = 2; },
    value => { value.runs[0].metrics.criteria.fn = 2; },
    value => { value.runs[0].metrics.relevance.correct = 18; },
    value => { value.runs[0].metrics.association.correct = 18; },
    value => { value.runs[0].metrics.criticism.false = 2; },
    value => { value.runs[0].metrics.relevance = { correct: 0, total: 0 }; },
    value => { value.runs[0].metrics.criticalMisses = 1; },
    value => { value.runs[0].metrics.unsupportedAcceptedRevisions = 1; },
    value => { value.runs[0].metrics.acceptedRevisions = 0; },
    value => { value.runs[0].paired = null; },
    value => { value.runs[0].paired.blinded = false; },
    value => { value.runs[0].paired.verdict = 'baseline-better'; },
    value => { value.runs[0].paired.regressions = 1; },
    value => { value.runs.forEach(run => { run.paired.verdict = 'tie'; }); },
  ]) {
    const input = await fixture(); change(input);
    assert.equal((await evaluateAssessmentQuality(input)).criteriaMet, false);
  }
});
test('Repeatability requires equivalent frozen inventories and detects pairwise flips and missing runs', async () => {
  for (const change of [
    value => { value.runs[1].states.python = 'supported'; },
    value => { value.runs[0].states.ambiguous = 'supported'; value.runs[1].states.ambiguous = 'contradicted'; },
    value => { value.runs[2].states.python = 'unknown'; },
    value => { value.runs[1].inventorySha256 = digest(7); },
    value => { value.runs.splice(1, 1); },
    value => { value.protocol.repeatDocumentIds = []; },
  ]) {
    const input = await fixture(); change(input);
    assert.equal((await evaluateAssessmentQuality(input)).criteriaMet, false);
  }
});
test('Invalid observations, rewritten references and duplicate document families are rejected rather than silently normalized', async () => {
  for (const change of [
    value => { value.protocol.referenceSetSha256 = digest(9); },
    value => { value.references[1].familyId = value.references[0].familyId; },
    value => { value.references[1].artifactSha256 = value.references[0].artifactSha256; },
    value => { value.runs.push(structuredClone(value.runs[0])); },
    value => { value.runs[0].metrics.relevance.correct = 21; },
    value => { value.runs[0].reservedUsd = 0.0000001; },
    value => { value.runs[0].metrics.criteria.tp = '19'; },
    value => { value.runs[0].metrics.criteria = { tp: Number.MAX_SAFE_INTEGER, fp: 2, fn: 0 }; },
    value => { value.runs[0].metrics.criteria = { tp: Number.MAX_SAFE_INTEGER, fp: 0, fn: 2 }; },
    value => { value.runs[0].states.python = 'invented'; },
    value => { delete value.runs[0].states.python; },
    value => { value.runs[0].outcome = 'failed'; },
    value => { value.runs[0].artifactSha256 = digest(9); },
  ]) {
    const input = await fixture(); change(input);
    await assert.rejects(evaluateAssessmentQuality(input));
  }
});
test('Offline CLI distinguishes measured criteria, blocked readiness and invalid input without inference', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'rk-quality-cli-'));
  try {
    const path = join(directory, 'measurements.json'), cli = fileURLToPath(new URL('./tools/resume-assessment-quality-cli.mjs', import.meta.url));
    const run = args => spawnSync(process.execPath, [cli, '--input', path, '--mode', 'quality', ...args], { encoding: 'utf8' });
    const input = await fixture(); writeFileSync(path, JSON.stringify(input));
    let result = run([]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).promotionAuthorized, false);
    input.runs = []; writeFileSync(path, JSON.stringify(input));
    result = run([]);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).criteriaMet, false);
    writeFileSync(path, '{');
    result = run([]); assert.equal(result.status, 1); assert.match(result.stderr, /not valid JSON/);
    result = run(['--allow-provider']); assert.equal(result.status, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
