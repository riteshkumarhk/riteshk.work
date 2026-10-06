import { ASSESSMENT_EVIDENCE_STATES, validateAssessmentJson } from '../src/js/resume-assessment.mjs';
import { historyHash } from '../src/js/resume-assessment-history.mjs';

export const QUALITY_SLICES = Object.freeze(['pdf', 'docx', 'txt'].flatMap(format => ['senior', 'staff', 'leader'].map(level => format + ':' + level)));
export const QUALITY_GOALS = Object.freeze([['A', 5], ['R', 9], ['C', 3], ['S', 4], ['L', 5]].flatMap(([prefix, count]) =>
  Array.from({ length: count }, (_, index) => prefix + String(index + 1).padStart(2, '0'))));
const fail = message => { throw new Error('Assessment quality: ' + message); };
function shape(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some(key => !Object.hasOwn(value, key))) fail('invalid record fields.');
}
function text(value) { if (typeof value !== 'string' || !value.trim() || value.length > 4000) fail('a bounded identity or explanation is required.'); }
function hash(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('an exact SHA-256 binding is required.'); }
function number(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isFinite(value) || value < 0 || value > maximum) fail('invalid nonnegative measurement.');
}
function integer(value, minimum = 0) { number(value); if (!Number.isSafeInteger(value) || value < minimum) fail('invalid integer count or time.'); }
function money(value) {
  number(value);
  const units = Math.round(value * 1e6);
  if (!Number.isSafeInteger(units) || units / 1e6 !== value) fail('reservations require exact whole millionths of a dollar.');
  return units;
}
function list(value) { if (!Array.isArray(value) || value.length > 10000) fail('invalid or oversized evaluation collection.'); }
function unique(values) { if (new Set(values).size !== values.length) fail('duplicate identity or source family.'); }
function states(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 120) fail('invalid state map.');
  for (const [id, state] of Object.entries(value)) {
    text(id);
    if (state !== null && !ASSESSMENT_EVIDENCE_STATES.includes(state)) fail('unknown assessment state.');
  }
}
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
const percentile = (values, probability) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(probability * values.length) - 1] : null;
const sameKeys = (a, b) => JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort());

export async function evaluateHeadlineCalibration(input) {
  validateAssessmentJson(input);
  shape(input, ['version', 'policySha256', 'developerId', 'frozenAt', 'minimumDocuments', 'maximumMeanAbsoluteError', 'maximumAbsoluteError', 'samples']);
  if (input.version !== 1) fail('unsupported calibration version.');
  hash(input.policySha256); text(input.developerId); integer(input.frozenAt); integer(input.minimumDocuments, 1);
  number(input.maximumMeanAbsoluteError, 100); number(input.maximumAbsoluteError, 100); list(input.samples);
  const blockers = [], errors = [];
  for (const sample of input.samples) {
    shape(sample, ['documentId', 'familyId', 'artifactSha256', 'referenceSha256', 'reviewerId', 'independent', 'approvedAt', 'predictedAt', 'policySha256', 'expected', 'predicted']);
    text(sample.documentId); text(sample.familyId); hash(sample.artifactSha256); hash(sample.referenceSha256); hash(sample.policySha256);
    text(sample.reviewerId); integer(sample.approvedAt); integer(sample.predictedAt);
    if (typeof sample.independent !== 'boolean') fail('invalid reference independence declaration.');
    if (sample.expected !== null) number(sample.expected, 100);
    if (sample.predicted !== null) { integer(sample.predicted); number(sample.predicted, 100); }
    if (!sample.independent || sample.reviewerId === input.developerId) blockers.push('Calibration references are not independently reviewed.');
    if (sample.approvedAt > input.frozenAt || input.frozenAt >= sample.predictedAt) blockers.push('Calibration references and policy must precede predictions.');
    if (sample.policySha256 !== input.policySha256) blockers.push('Calibration mixed scoring policies.');
    if (sample.expected === null && sample.predicted !== null) blockers.push('An unassessable reference was assigned a numeric headline.');
    if (sample.expected !== null && sample.predicted === null) blockers.push('A required calibration prediction is missing.');
    if (sample.expected !== null && sample.predicted !== null) errors.push(Math.abs(sample.expected - sample.predicted));
  }
  unique(input.samples.map(sample => sample.documentId)); unique(input.samples.map(sample => sample.familyId));
  unique(input.samples.map(sample => sample.artifactSha256));
  if (input.samples.length < input.minimumDocuments) blockers.push('Insufficient independent calibration documents.');
  if (!errors.length) blockers.push('No comparable numeric calibration observations.');
  const meanAbsoluteError = errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null;
  const maximumAbsoluteError = errors.length ? Math.max(...errors) : null;
  if (meanAbsoluteError !== null && meanAbsoluteError > input.maximumMeanAbsoluteError) blockers.push('Mean absolute headline error exceeds the frozen limit.');
  if (maximumAbsoluteError !== null && maximumAbsoluteError > input.maximumAbsoluteError) blockers.push('Maximum headline error exceeds the frozen limit.');
  return { version: 1, kind: 'headline-calibration-measurement', inputSha256: await historyHash(input), policySha256: input.policySha256,
    documents: input.samples.length, numericPairs: errors.length, meanAbsoluteError, maximumAbsoluteError,
    criteriaMet: blockers.length === 0, blockers: [...new Set(blockers)], promotionAuthorized: false,
    limitation: 'Measures supplied observations; does not invent a score formula, authenticate reviewer declarations or authorize a headline.' };
}

function validateMetrics(value) {
  shape(value, ['criteria', 'relevance', 'association', 'criticism', 'criticalMisses', 'acceptedRevisions', 'unsupportedAcceptedRevisions']);
  shape(value.criteria, ['tp', 'fp', 'fn']);
  for (const count of Object.values(value.criteria)) integer(count);
  for (const key of ['relevance', 'association', 'criticism']) {
    const numerator = key === 'criticism' ? 'false' : 'correct';
    shape(value[key], [numerator, 'total']);
    integer(value[key][numerator]); integer(value[key].total);
    if (value[key][numerator] > value[key].total) fail('a numerator exceeds its denominator.');
  }
  for (const key of ['criticalMisses', 'acceptedRevisions', 'unsupportedAcceptedRevisions']) integer(value[key]);
  if (value.unsupportedAcceptedRevisions > value.acceptedRevisions) fail('unsupported revisions exceed accepted revisions.');
}
function aggregate(runs) {
  const sum = select => runs.reduce((total, run) => { const next = total + select(run.metrics); integer(next); return next; }, 0);
  const tp = sum(value => value.criteria.tp), fp = sum(value => value.criteria.fp), fn = sum(value => value.criteria.fn);
  integer(tp + fp); integer(tp + fn);
  return {
    documents: runs.length,
    precision: { numerator: tp, denominator: tp + fp, value: ratio(tp, tp + fp) },
    recall: { numerator: tp, denominator: tp + fn, value: ratio(tp, tp + fn) },
    ...Object.fromEntries(['relevance', 'association', 'criticism'].map(key => {
      const numerator = sum(value => value[key][key === 'criticism' ? 'false' : 'correct']), denominator = sum(value => value[key].total);
      return [key, { numerator, denominator, value: ratio(numerator, denominator) }];
    })),
    criticalMisses: sum(value => value.criticalMisses), acceptedRevisions: sum(value => value.acceptedRevisions),
    unsupportedAcceptedRevisions: sum(value => value.unsupportedAcceptedRevisions),
  };
}

export async function evaluateAssessmentQuality(input) {
  validateAssessmentJson(input);
  shape(input, ['protocol', 'references', 'runs', 'calibration']);
  const { protocol, references, runs, calibration } = input;
  shape(protocol, ['version', 'status', 'developerId', 'frozenAt', 'methodSha256', 'baselineSha256', 'headlinePolicySha256',
    'referenceSetSha256', 'developmentFamilies', 'minimumDocumentsPerSlice', 'samplingApprovedBy', 'samplingRationale',
    'repeatDocumentIds', 'maxP95Ms', 'maxReservedUsd']);
  if (protocol.version !== 1 || !['draft', 'frozen'].includes(protocol.status)) fail('unsupported evaluation protocol or status.');
  text(protocol.developerId); integer(protocol.frozenAt); hash(protocol.methodSha256); hash(protocol.referenceSetSha256);
  if (protocol.baselineSha256 !== null) hash(protocol.baselineSha256);
  if (protocol.headlinePolicySha256 !== null) hash(protocol.headlinePolicySha256);
  integer(protocol.minimumDocumentsPerSlice, 1); text(protocol.samplingRationale);
  if (protocol.samplingApprovedBy !== null) text(protocol.samplingApprovedBy);
  for (const key of ['developmentFamilies', 'repeatDocumentIds']) { list(protocol[key]); protocol[key].forEach(text); unique(protocol[key]); }
  for (const key of ['maxP95Ms', 'maxReservedUsd']) if (protocol[key] !== null) number(protocol[key]);
  if (protocol.maxReservedUsd !== null) money(protocol.maxReservedUsd);
  list(references); list(runs);
  const blockers = [], referenceMap = new Map();
  if (protocol.status !== 'frozen') blockers.push('The acceptance protocol is still a draft.');
  if (protocol.baselineSha256 === null) blockers.push('The paired baseline method is not frozen.');
  for (const reference of references) {
    shape(reference, ['documentId', 'familyId', 'artifactSha256', 'slice', 'labelsSha256', 'reviewerId', 'independent', 'approvedAt', 'coverage', 'states', 'criticalIds']);
    text(reference.documentId); text(reference.familyId); hash(reference.artifactSha256); hash(reference.labelsSha256);
    text(reference.reviewerId); integer(reference.approvedAt); list(reference.coverage); unique(reference.coverage); list(reference.criticalIds); unique(reference.criticalIds);
    states(reference.states);
    if (!QUALITY_SLICES.includes(reference.slice) || reference.coverage.some(id => !QUALITY_GOALS.includes(id)) ||
        reference.criticalIds.some(id => !Object.hasOwn(reference.states, id) || reference.states[id] === null)) fail('invalid slice, coverage or critical reference.');
    if (typeof reference.independent !== 'boolean') fail('invalid reference independence declaration.');
    if (!reference.independent || reference.reviewerId === protocol.developerId || reference.approvedAt > protocol.frozenAt) blockers.push('Held-out reference independence or pre-freeze approval is missing.');
    if (protocol.developmentFamilies.includes(reference.familyId)) blockers.push('Development and held-out source families overlap.');
    referenceMap.set(reference.documentId, reference);
  }
  unique(references.map(reference => reference.documentId)); unique(references.map(reference => reference.familyId));
  unique(references.map(reference => reference.artifactSha256));
  if (await historyHash(references) !== protocol.referenceSetSha256) fail('the frozen reference set changed.');
  for (const run of runs) {
    shape(run, ['id', 'documentId', 'artifactSha256', 'methodSha256', 'inventorySha256', 'repeatIndex', 'startedAt', 'outcome', 'elapsedMs', 'reservedUsd', 'metrics', 'states', 'paired']);
    text(run.id); hash(run.artifactSha256); hash(run.methodSha256); hash(run.inventorySha256); integer(run.repeatIndex); integer(run.startedAt);
    number(run.elapsedMs); money(run.reservedUsd);
    if (run.repeatIndex > 2 || !['complete', 'failed', 'unknown'].includes(run.outcome)) fail('invalid run index or outcome.');
    const reference = referenceMap.get(run.documentId);
    if (!reference || run.artifactSha256 !== reference.artifactSha256) fail('run differs from its frozen document.');
    if (run.methodSha256 !== protocol.methodSha256 || run.startedAt <= protocol.frozenAt) blockers.push('Run method changed or preceded the protocol freeze.');
    if (run.outcome !== 'complete') {
      if (run.metrics !== null || run.states !== null || run.paired !== null) fail('failed or unknown runs cannot claim completed quality measurements.');
      blockers.push('A provider run failed or has an unknown outcome.');
      continue;
    }
    unique(runs.map(run => run.id)); unique(runs.map(run => run.documentId + ':' + run.repeatIndex));
    validateMetrics(run.metrics); states(run.states);
    if (Object.values(run.states).includes(null) || !sameKeys(run.states, reference.states)) fail('complete run needs every reference state, including explicit unknowns.');
    if (reference.criticalIds.some(id => run.states[id] !== reference.states[id])) blockers.push('A critical reference state was not preserved.');
    if (run.metrics.criticalMisses || run.metrics.unsupportedAcceptedRevisions) blockers.push('Critical omission or unsupported accepted revision.');
    if (run.paired !== null) {
      shape(run.paired, ['baselineSha256', 'verdict', 'regressions', 'reviewerId', 'blinded']);
      hash(run.paired.baselineSha256); integer(run.paired.regressions); text(run.paired.reviewerId);
      if (typeof run.paired.blinded !== 'boolean' || !['candidate-better', 'tie', 'baseline-better', 'unresolved'].includes(run.paired.verdict)) fail('invalid paired review.');
    }
  }
  const first = runs.filter(run => run.repeatIndex === 0 && run.outcome === 'complete');
  if (references.some(reference => !first.some(run => run.documentId === reference.documentId))) blockers.push('Not every frozen document has a completed first run.');
  const bySlice = Object.fromEntries(QUALITY_SLICES.map(slice => [slice, aggregate(first.filter(run => referenceMap.get(run.documentId).slice === slice))]));
  for (const [slice, metrics] of Object.entries(bySlice)) {
    if (metrics.documents < protocol.minimumDocumentsPerSlice) blockers.push('Insufficient independent documents in ' + slice + '.');
    if (!metrics.acceptedRevisions) blockers.push('No accepted revision fidelity observations in ' + slice + '.');
    for (const key of ['precision', 'recall', 'relevance', 'association', 'criticism']) {
      const value = metrics[key].value;
      if (value === null || (key === 'criticism' ? value > 0.05 : value < 0.95)) blockers.push('Missing or failing ' + key + ' measurement in ' + slice + '.');
    }
  }
  if (QUALITY_GOALS.some(id => !references.some(reference => reference.coverage.includes(id)))) blockers.push('The 26-goal acceptance coverage is incomplete.');
  if (!protocol.samplingApprovedBy || protocol.samplingApprovedBy === protocol.developerId) blockers.push('Sample-size and clustering adequacy have not been independently approved.');
  const repeats = { matches: 0, denominator: 0, flips: 0, documents: 0 };
  const repeatabilityBySlice = Object.fromEntries(QUALITY_SLICES.map(slice => [slice, { matches: 0, denominator: 0, flips: 0, documents: 0 }]));
  if (protocol.repeatDocumentIds.length !== QUALITY_SLICES.length ||
      new Set(protocol.repeatDocumentIds.map(id => referenceMap.get(id)?.slice)).size !== QUALITY_SLICES.length ||
      protocol.repeatDocumentIds.some(id => !referenceMap.has(id))) blockers.push('Repeatability needs one preselected document per supported slice.');
  for (const documentId of protocol.repeatDocumentIds) {
    const reference = referenceMap.get(documentId);
    const observed = runs.filter(run => run.documentId === documentId).sort((a, b) => a.repeatIndex - b.repeatIndex);
    if (!reference || observed.length !== 3 || observed.some((run, index) => run.repeatIndex !== index || run.outcome !== 'complete') ||
        new Set(observed.map(run => run.inventorySha256)).size !== 1) {
      blockers.push('Missing or non-equivalent three-run repeatability observations.'); continue;
    }
    repeats.documents++;
    const slice = repeatabilityBySlice[reference.slice];
    slice.documents++;
    for (const [id, expected] of Object.entries(reference.states)) {
      const values = observed.map(run => run.states[id]);
      if (values.includes('supported') && values.includes('contradicted')) { repeats.flips++; slice.flips++; }
      if (expected === null) continue;
      for (const [left, right] of [[0, 1], [0, 2], [1, 2]]) {
        repeats.denominator++; slice.denominator++;
        if (values[left] === values[right]) { repeats.matches++; slice.matches++; }
      }
    }
  }
  const agreement = ratio(repeats.matches, repeats.denominator);
  if (agreement === null || agreement < 0.95 || repeats.flips) blockers.push('Repeatability agreement or supported/contradicted flip gate failed.');
  if (!first.length || first.some(run => !run.paired || run.paired.baselineSha256 !== protocol.baselineSha256 ||
      !run.paired.blinded || run.paired.reviewerId === protocol.developerId || run.paired.regressions ||
      ['baseline-better', 'unresolved'].includes(run.paired.verdict)) || !first.some(run => run.paired?.verdict === 'candidate-better')) blockers.push('Independent paired improvement and non-regression are not established.');
  const calibrationReport = calibration === null ? null : await evaluateHeadlineCalibration(calibration);
  if (!protocol.headlinePolicySha256 || !calibrationReport?.criteriaMet || calibrationReport.policySha256 !== protocol.headlinePolicySha256 ||
      calibration.developerId !== protocol.developerId ||
      calibration.samples.some(sample => sample.predictedAt > protocol.frozenAt || references.some(reference =>
        reference.familyId === sample.familyId || reference.artifactSha256 === sample.artifactSha256))) blockers.push('Frozen headline policy and disjoint independent calibration are not established.');
  const latency = { completedRuns: runs.filter(run => run.outcome === 'complete').length,
    p50Ms: percentile(runs.filter(run => run.outcome === 'complete').map(run => run.elapsedMs), 0.5),
    p95Ms: percentile(runs.filter(run => run.outcome === 'complete').map(run => run.elapsedMs), 0.95) };
  const reservedUsd = runs.reduce((sum, run) => { const next = sum + money(run.reservedUsd); integer(next); return next; }, 0) / 1e6;
  if (protocol.maxP95Ms === null || latency.p95Ms === null || latency.p95Ms > protocol.maxP95Ms ||
      protocol.maxReservedUsd === null || reservedUsd > protocol.maxReservedUsd) blockers.push('Approved latency/reservation limits are missing or exceeded.');
  return { version: 1, kind: 'assessment-quality-measurement', inputSha256: await historyHash(input), documents: references.length, runs: runs.length,
    bySlice, repeatability: { ...repeats, agreement }, repeatabilityBySlice, calibration: calibrationReport, latency, reservedUsd,
    failedOrUnknownRuns: runs.filter(run => run.outcome !== 'complete').length, criteriaMet: blockers.length === 0,
    blockers: [...new Set(blockers)], promotionAuthorized: false, populationAccuracyEstablished: false,
    limitations: ['Only supplied, source-bound review measurements are scored; no provider is called and no labels are generated.',
      'Reviewer identities, independence and blind review are declarations requiring external audit, not authenticated by this calculator.',
      'Ratios retain their denominators. Repeated runs and alternate formats are not independent documents.',
      'Pooled item ratios are not population confidence bounds; sample-size approval and uncertainty analysis remain external prerequisites.',
      'Latency covers completed runs only; failures remain counted separately. Reservations are not settled provider invoices.'] };
}
