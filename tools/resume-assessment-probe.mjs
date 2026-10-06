import { createResume, resumeSignature, editResumeField } from '../src/js/resume-workspace.mjs';
import { captureAssessmentInput, extractAssessmentArtifact } from '../src/js/resume-assessment-input.mjs';
import { canonicalHistory, historyHash, historyInput, createAssessmentHistory } from '../src/js/resume-assessment-history.mjs';
import { approveAssessmentInventory, approveAssessmentEvidence, inventoryCandidateAssessment, evaluateCandidateAssessment, validateAssessmentInventory, validateEvaluatedAssessment } from '../src/js/resume-assessment-evaluator.mjs';
import { captureAssessmentRevisionContext, proposeAssessmentRevision, validateAssessmentRevision, commitAssessmentRevision } from '../src/js/resume-assessment-revisions.mjs';
import { createAssessmentPresentation, assessmentFieldLocations } from '../src/js/resume-assessment-presentation.mjs';
import { compareCandidateAssessments, validateAssessmentComparison } from '../src/js/resume-assessment-comparison.mjs';
import { validateAssessmentJson } from '../src/js/resume-assessment.mjs';
import { validateAssessmentPlan } from '../src/js/resume-assessment-pilot.mjs';
import { createAssessmentHistoryStore } from '../worker/resume-assessment-history.mjs';
import { validateAssessmentBudget } from '../worker/resume-assessment-budget.mjs';
import { RESUME_COMPLETION_LIMITS } from '../src/js/resume-review.mjs';
import { assessmentRequestIdentity } from '../src/js/resume-assessment-output.mjs';

export const PROBE_KEY = 'system/fictional-assessment-probe-v1.json';
export const CONTINUATION_KEY = 'system/fictional-assessment-continuation-v1.json';
export const CONTINUATION_CLAIM_KEY = 'system/fictional-assessment-continuation-claim-v1.json';
export const SMOKE_KEY = 'system/fictional-assessment-smoke-v1.json';
export const SMOKE_CLAIM_KEY = 'system/fictional-assessment-smoke-approval-v1.json';
export const STRUCTURED_SMOKE_KEY = 'system/fictional-assessment-structured-smoke-v1.json';
export const STRUCTURED_SMOKE_CLAIM_KEY = 'system/fictional-assessment-structured-smoke-approval-v1.json';
const BUDGET_KEY = 'system/resume-assessment-budget-v1.json';
export const CONTINUATION_PHASES = Object.freeze(['negation.assessment', 'pdf.inventory', 'pdf.assessment']);
export const PROBE_PHASES = Object.freeze([
  'negation.inventory', 'negation.assessment', 'pdf.inventory', 'pdf.assessment', 'pdf.revision', 'pdf.apply', 'pdf.recheck',
]);
export const SMOKE_PHASES = Object.freeze(PROBE_PHASES.slice(1));
const fail = message => { throw new Error('Fictional probe: ' + message); };
const stagesFor = phase => phase.endsWith('.inventory') ? ['requirements'] : phase === 'pdf.revision' ? ['revision', 'challenge']
  : phase === 'pdf.apply' ? [] : ['assessment', 'challenge'];
const same = (a, b) => canonicalHistory(a) === canonicalHistory(b);
export function probePolicy(checkedAt, smoke = false) {
  if (typeof smoke !== 'boolean') fail('invalid smoke policy selection.');
  if (!Number.isSafeInteger(checkedAt) || checkedAt > Date.now() || Date.now() - checkedAt > 86400000) fail('explicitly verify current published prices before this phase; timestamps are not refreshed automatically.');
  return { version: 1, provider: 'anthropic', checkedAt, maxCost: smoke ? 6 : 4, models: [{
    id: 'claude-sonnet-5-5', pricing: { input: 2, output: 10 }, maxInputTokens: 110000, maxOutputTokens: 12000,
    contextWindow: 1000000, reasoning: false,
  }] };
}
export function fictionalProbeDocument() {
  return createResume({ id: 'fictional-four-dollar-probe', name: 'Fictional probe - not owner data',
    target: { company: 'Fictional Example', role: 'Product Designer', level: 'staff', jd: 'Python or Java' },
    model: { name: 'Avery Example', title: 'Product Designer', summary: '', contact: { email: 'avery@example.test', links: [] },
      sections: [{ id: 'experience', heading: 'Experience', kind: 'experience', items: [
        { id: 'north', org: 'Northstar Example', role: 'Lead Designer', dates: '2021 - Present', location: '', bullets: [
          { id: 'north-work', text: 'With the team, built Python prototypes to clarify customer handoffs.' },
        ] },
        { id: 'atlas', org: 'Atlas Example', role: 'Designer', dates: '2018 - 2021', location: '', bullets: [
          { id: 'atlas-work', text: 'Supported customer interviews and documented usability findings.' },
        ] },
      ] }] } });
}

export function createAssessmentProbe({ bucket, renderExport, request, continuation = false, smoke = false, structured = false, codeSha256 = null }) {
  if (!bucket || typeof renderExport !== 'function' || typeof request !== 'function') fail('persistent storage, isolated rendering and an explicit transport are required.');
  if (typeof continuation !== 'boolean') fail('choose the original probe or its one registered continuation.');
  if (typeof smoke !== 'boolean' || typeof structured !== 'boolean' || [smoke, continuation, structured].filter(Boolean).length > 1) fail('select exactly one workflow.');
  const fixed = smoke || structured;
  const phases = fixed ? SMOKE_PHASES : continuation ? CONTINUATION_PHASES : PROBE_PHASES;
  let smokePhaseApproval = null;
  const history = createAssessmentHistoryStore(bucket);
  async function loadState(key, phases, maxCalls, maxCost = 4) {
    const object = await bucket.get(key);
    if (!object) fail('prepare the fixed fictional inputs first; no state is created by a paid command.');
    const state = await object.json(); validateAssessmentJson(state);
    if (!object.etag || state.version !== 1 || state.maxCost !== maxCost || state.maxCalls !== maxCalls || !state.inputs?.negation || !state.inputs?.pdf ||
        !Array.isArray(state.operations) || state.operations.length > phases.length || !Array.isArray(state.versions) ||
        typeof state.stopped !== 'boolean') fail('stored probe state is invalid; do not reset it.');
    for (const [index, operation] of state.operations.entries()) {
      if (operation.transport !== undefined && !['environment', 'studio'].includes(operation.transport)) fail('stored provider transport changed.');
      if (operation.phase !== phases[index] || !['started', 'complete', 'failed'].includes(operation.status) ||
          !/^[a-f0-9]{64}$/.test(operation.approvalSha256) || index && state.operations[index - 1].status !== 'complete') fail('stored phase order is invalid; no replay is allowed.');
      if (operation.plan) {
        validateAssessmentPlan(operation.plan);
        if (operation.plan.provider !== 'anthropic' || operation.plan.model !== 'claude-sonnet-5-5' ||
            !same(operation.plan.stages.map(item => item.stage), stagesFor(operation.phase)) ||
            operation.plan.pricing.input !== 2 || operation.plan.pricing.output !== 10) fail('stored phase reservation changed.');
      }
      if (operation.status === 'complete' && stagesFor(operation.phase).length && !operation.plan) fail('a completed paid phase lost its reservation plan.');
      if (operation.status === 'complete' && await historyHash(operation.output) !== operation.outputSha256) fail('a saved phase output changed.');
      if (operation.responses !== undefined) {
        if (!Array.isArray(operation.responses) || operation.responses.length > stagesFor(operation.phase).length ||
            operation.status === 'complete' && operation.responses.length !== stagesFor(operation.phase).length) fail('invalid retained response count.');
        for (const [responseIndex, response] of operation.responses.entries()) {
          if (!response || !same(Object.keys(response).sort(), ['receipt', 'requestSha256', 'reservationId', 'sha256', 'stage']) ||
              response.reservationId !== operation.plan?.id || response.stage !== stagesFor(operation.phase)[responseIndex] ||
              !/^[a-f0-9]{64}$/.test(response.requestSha256) || !/^[a-f0-9]{64}$/.test(response.sha256) ||
              !response.receipt || typeof response.receipt.text !== 'string' || response.receipt.text.length > 60000 ||
              await historyHash(response.receipt) !== response.sha256) fail('a retained diagnostic response changed.');
        }
      }
    }
    return { state, etag: object.etag, key };
  }
  function eligibleParent(state) {
    if (!state.stopped || state.operations.length !== 2 || state.operations[0].status !== 'complete' ||
        state.operations[1].status !== 'failed' || !/^Semantic review: invalid record fields/.test(state.operations[1].error) ||
        state.operations[1].output !== null || state.operations[1].attempt?.status !== 'failed' ||
        state.documentVersion !== 1 || state.versions.length || state.inputs.edited ||
        state.operations.some(operation => !operation.plan)) fail('only the stopped, acknowledged negation semantic failure can have this one continuation.');
  }
  async function continuationPacket(parent, ledger, pricesCheckedAt) {
    eligibleParent(parent);
    const entries = parent.operations.map(operation => ledger.reservations.find(entry => entry.plan.id === operation.plan.id));
    if (entries.some(entry => !entry || entry.attempts.some(attempt => attempt.status !== 'received')) ||
        entries.reduce((sum, entry) => sum + Math.round(entry.plan.amount * 1e6), 0) !== 1078002 ||
        entries.reduce((sum, entry) => sum + entry.attempts.length, 0) !== 3) fail('parent provider outcomes or reservations are not fully acknowledged; never repeat an unknown outcome.');
    for (const [index, entry] of entries.entries()) {
      const execution = index ? parent.operations[index].attempt.execution : parent.operations[index].output.execution;
      if (!Array.isArray(execution) || execution.length !== entry.attempts.length || execution.some((receipt, stage) => {
        const attempt = entry.attempts[stage];
        return receipt.status !== 'parsed' || receipt.stage !== attempt.stage || receipt.requestId !== attempt.requestId ||
          receipt.requestSha256 !== attempt.binding?.request || !same(receipt.usage, attempt.usage);
      })) fail('the parent execution receipts changed.');
    }
    return { version: 1, kind: 'one-fictional-continuation', parentSha256: await historyHash(parent),
      parentLedgerSha256: await historyHash({ ...ledger, reservations: entries }),
      originals: Object.fromEntries(['negation', 'pdf'].map(name => [name, parent.inputs[name].sha256])),
      transport: 'studio', repeatAuthorization: 'one-new-negation-assessment-only',
      phases: [...CONTINUATION_PHASES], maxCost: 4, maxCalls: 8, maximumReserved: 2.904006,
      existingCalls: 3, existingReserved: 1.078002, additionalCalls: 5, additionalReserved: 1.826004,
      pricesCheckedAt, pricing: { input: 2, output: 10 }, requestPolicy: 'anthropic-sonnet-5-5-medium-v1' };
  }
  async function smokePacket(parent, child, ledger, pricesCheckedAt, sourceCodeSha256) {
    eligibleParent(parent);
    if (!child?.stopped || child.operations.length !== 1 || child.operations[0].phase !== 'negation.assessment' ||
        child.operations[0].status !== 'failed' || child.operations[0].output !== null ||
        !/^Semantic review: invalid record fields/.test(child.operations[0].error) ||
        child.documentVersion !== 1 || child.versions.length || child.inputs.edited ||
        !/^[a-f0-9]{64}$/.test(sourceCodeSha256)) fail('the fixed smoke requires both acknowledged stopped workflows and a code fingerprint.');
    validateAssessmentBudget(ledger, 4);
    const operations = [...parent.operations, ...child.operations];
    if (ledger.maxCost !== 4 || ledger.reservations.length !== 3 ||
        ledger.reservations.reduce((sum, entry) => sum + Math.round(entry.plan.amount * 1e6), 0) !== 1826004 ||
        ledger.reservations.reduce((sum, entry) => sum + entry.attempts.length, 0) !== 5 ||
        operations.some(operation => !operation.plan)) fail('the fixed five-call budget prefix changed.');
    for (const [index, entry] of ledger.reservations.entries()) {
      const operation = operations[index], execution = operation.status === 'complete' ? operation.output.execution : operation.attempt?.execution;
      if (!same(entry.plan, operation.plan) || !Array.isArray(execution) || execution.length !== entry.attempts.length ||
          entry.attempts.some((attempt, at) => attempt.status !== 'received' || execution[at].status !== 'parsed' ||
            attempt.binding?.request !== execution[at].requestSha256 || attempt.requestId !== execution[at].requestId ||
            !same(attempt.usage, execution[at].usage))) fail('the prior outcomes are not fully acknowledged; no repeat is allowed.');
    }
    return { version: 1, kind: 'fixed-fictional-smoke', parentSha256: await historyHash(parent), continuationSha256: await historyHash(child),
      priorBudgetSha256: await historyHash(ledger), codeSha256: sourceCodeSha256, promptRevision: 2,
      originals: Object.fromEntries(['negation', 'pdf'].map(name => [name, parent.inputs[name].sha256])),
      transport: 'studio', authorization: 'whole-fixed-workflow-only', phases: [...SMOKE_PHASES], revisionFieldId: 'north-work',
      maxCost: 6, maxCalls: 14, maximumReserved: 5.060011, existingCalls: 5, existingReserved: 1.826004,
      additionalCalls: 9, additionalReserved: 3.234007, pricesCheckedAt, pricing: { input: 2, output: 10 },
      requestPolicy: 'anthropic-sonnet-5-5-medium-v1' };
  }
  async function structuredPacket(parent, child, previous, ledger, pricesCheckedAt, sourceCodeSha256) {
    const base = await smokePacket(parent, child, { ...ledger, maxCost: 4, reservations: ledger.reservations.slice(0, 3) }, pricesCheckedAt, sourceCodeSha256);
    const operation = previous?.operations?.[0], entry = ledger.reservations[3], execution = operation?.attempt?.execution;
    if (!previous?.stopped || previous.operations.length !== 1 || operation.phase !== 'negation.assessment' ||
        operation.status !== 'failed' || operation.output !== null || operation.error !== 'Semantic review: list exceeds the semantic review contract.' ||
        previous.documentVersion !== 1 || previous.versions.length || previous.inputs.edited ||
        ledger.maxCost !== 6 || ledger.reservations.length !== 4 ||
        ledger.reservations.reduce((sum, item) => sum + Math.round(item.plan.amount * 1e6), 0) !== 2574006 ||
        ledger.reservations.reduce((sum, item) => sum + item.attempts.length, 0) !== 7 ||
        !same(entry?.plan, operation.plan) || !Array.isArray(execution) || execution.length !== 2 ||
        entry.attempts.some((attempt, index) => attempt.status !== 'received' || execution[index].status !== 'parsed' ||
          attempt.binding?.request !== execution[index].requestSha256 || attempt.requestId !== execution[index].requestId ||
          !same(attempt.usage, execution[index].usage))) fail('the structured smoke requires the exact acknowledged seven-call stopped prefix.');
    const responses = operation.responses?.map(item => JSON.parse(item.receipt.text));
    if (responses?.length !== 2 || responses[0].semantic?.version !== 'source-attribution-v1' ||
        responses[1].semantic?.version !== 'source-attribution-v1' || responses[0].semantic.groups.length !== 0 ||
        responses[1].semantic.groups.length !== 1 || responses[1].semantic.groups[0].id !== 'job-0') fail('the preserved empty-group failure changed.');
    return { ...base, kind: 'structured-fictional-smoke', previousSmokeSha256: await historyHash(previous),
      priorBudgetSha256: await historyHash(ledger), maxCalls: 16, maximumReserved: 5.808013,
      existingCalls: 7, existingReserved: 2.574006, responseContracts: ['assessment-semantic-json-v1', 'revision-json-v1'] };
  }
  async function load(useContinuation = continuation, useSmoke = smoke, useStructured = structured) {
    const parent = await loadState(PROBE_KEY, PROBE_PHASES, 10);
    const smokeApproval = await bucket.get(SMOKE_CLAIM_KEY), smokeObject = await bucket.get(SMOKE_KEY);
    if (Boolean(smokeApproval) !== Boolean(smokeObject)) fail('smoke registration is incomplete or disappeared; never recreate it.');
    const claimObject = await bucket.get(CONTINUATION_CLAIM_KEY), childObject = await bucket.get(CONTINUATION_KEY);
    if (Boolean(claimObject) !== Boolean(childObject)) fail('continuation registration is incomplete or disappeared; audit it, never recreate it.');
    let child = null, claim = null;
    if (claimObject) {
      claim = await claimObject.json(); validateAssessmentJson(claim);
      if (!same(Object.keys(claim).sort(), ['approvalSha256', 'packet', 'registeredAt']) ||
          !Number.isSafeInteger(claim.registeredAt) || !Number.isSafeInteger(claim.packet?.pricesCheckedAt) ||
          claim.packet.pricesCheckedAt > claim.registeredAt || claim.registeredAt - claim.packet.pricesCheckedAt > 86400000 ||
          claim.approvalSha256 !== await historyHash(claim.packet)) fail('the continuation registration changed.');
      const ledgerObject = await bucket.get(BUDGET_KEY);
      if (!ledgerObject) fail('the continuation lost its original budget; never recreate it.');
      const ledger = await ledgerObject.json(); validateAssessmentBudget(ledger, smokeApproval ? 6 : 4);
      if (!same(claim.packet, await continuationPacket(parent.state, smokeApproval ? { ...ledger, maxCost: 4 } : ledger, claim.packet.pricesCheckedAt))) fail('the immutable parent or original budget prefix changed.');
      child = await loadState(CONTINUATION_KEY, CONTINUATION_PHASES, 8);
      if (child.state.registrationSha256 !== claim.approvalSha256 || child.state.createdAt !== claim.registeredAt ||
          !same(child.state.inputs, parent.state.inputs) || !same(child.state.document, parent.state.document) ||
          child.state.documentVersion !== 1 || child.state.versions.length ||
          !same(child.state.inheritedInventory, parent.state.operations[0].output) ||
          child.state.operations.some(operation => operation.transport !== 'studio')) fail('the registered continuation or its inherited originals changed.');
    }
    let smokeRun = null, smokeClaim = null;
    if (smokeApproval) {
      smokeClaim = await smokeApproval.json(); validateAssessmentJson(smokeClaim);
      const ledger = await (await bucket.get(BUDGET_KEY)).json();
      if (!same(Object.keys(smokeClaim).sort(), ['approvalSha256', 'packet', 'registeredAt']) ||
          !Number.isSafeInteger(smokeClaim.registeredAt) || !Number.isSafeInteger(smokeClaim.packet?.pricesCheckedAt) ||
          smokeClaim.registeredAt < smokeClaim.packet.pricesCheckedAt || smokeClaim.registeredAt - smokeClaim.packet.pricesCheckedAt > 86400000 ||
          smokeClaim.approvalSha256 !== await historyHash(smokeClaim.packet) || ledger.maxCost !== 6 ||
          !same(smokeClaim.packet, await smokePacket(parent.state, child?.state,
            { ...ledger, maxCost: 4, reservations: ledger.reservations.slice(0, 3) }, smokeClaim.packet.pricesCheckedAt, smokeClaim.packet.codeSha256))) fail('the smoke authorization or immutable prior budget changed.');
      smokeRun = await loadState(SMOKE_KEY, SMOKE_PHASES, 14, 6);
      if (smokeRun.state.registrationSha256 !== smokeClaim.approvalSha256 || smokeRun.state.createdAt !== smokeClaim.registeredAt ||
          !same(smokeRun.state.inheritedInventory, parent.state.operations[0].output) ||
          ['negation', 'pdf'].some(name => !same(smokeRun.state.inputs[name], parent.state.inputs[name])) ||
          smokeRun.state.operations.some(operation => operation.transport !== 'studio')) fail('the fixed smoke state changed.');
    }
    const structuredApproval = await bucket.get(STRUCTURED_SMOKE_CLAIM_KEY), structuredObject = await bucket.get(STRUCTURED_SMOKE_KEY);
    if (Boolean(structuredApproval) !== Boolean(structuredObject)) fail('structured smoke registration is incomplete or disappeared; never recreate it.');
    let structuredRun = null, structuredClaim = null;
    if (structuredApproval) {
      structuredClaim = await structuredApproval.json(); validateAssessmentJson(structuredClaim);
      const ledgerObject = await bucket.get(BUDGET_KEY), ledger = ledgerObject && await ledgerObject.json();
      if (!smokeRun || !ledger || !same(Object.keys(structuredClaim).sort(), ['approvalSha256', 'packet', 'registeredAt']) ||
          !Number.isSafeInteger(structuredClaim.registeredAt) || !Number.isSafeInteger(structuredClaim.packet?.pricesCheckedAt) ||
          structuredClaim.registeredAt < structuredClaim.packet.pricesCheckedAt || structuredClaim.registeredAt - structuredClaim.packet.pricesCheckedAt > 86400000 ||
          structuredClaim.approvalSha256 !== await historyHash(structuredClaim.packet) ||
          !same(structuredClaim.packet, await structuredPacket(parent.state, child?.state, smokeRun.state,
            { ...ledger, reservations: ledger.reservations.slice(0, 4) }, structuredClaim.packet.pricesCheckedAt, structuredClaim.packet.codeSha256))) {
        fail('the structured smoke authorization or immutable seven-call prefix changed.');
      }
      structuredRun = await loadState(STRUCTURED_SMOKE_KEY, SMOKE_PHASES, 16, 6);
      if (structuredRun.state.registrationSha256 !== structuredClaim.approvalSha256 || structuredRun.state.createdAt !== structuredClaim.registeredAt ||
          !same(structuredRun.state.inheritedInventory, parent.state.operations[0].output) ||
          ['negation', 'pdf'].some(name => !same(structuredRun.state.inputs[name], parent.state.inputs[name])) ||
          structuredRun.state.operations.some(operation => operation.transport !== 'studio')) fail('the structured smoke state changed.');
    }
    if (useContinuation && !child) fail('review and explicitly register the one continuation first; no state was created.');
    if (useSmoke && !smokeRun) fail('register the explicitly approved fixed smoke first.');
    if (useStructured && !structuredRun) fail('register the explicitly approved structured smoke first.');
    return { ...(useStructured ? structuredRun : useSmoke ? smokeRun : useContinuation ? child : parent), parent, child, claim, smokeRun, smokeClaim, structuredRun, structuredClaim };
  }
  async function write(loaded) {
    if (loaded.key !== PROBE_KEY) await load();
    const body = JSON.stringify(loaded.state);
    const parentBytes = loaded.key !== PROBE_KEY ? JSON.stringify(loaded.parent.state) + JSON.stringify(loaded.claim) +
      ([SMOKE_KEY, STRUCTURED_SMOKE_KEY].includes(loaded.key) ? JSON.stringify(loaded.child.state) + JSON.stringify(loaded.smokeClaim) : '') +
      (loaded.key === STRUCTURED_SMOKE_KEY ? JSON.stringify(loaded.smokeRun.state) + JSON.stringify(loaded.structuredClaim) : '') : '';
    if (new TextEncoder().encode(body + parentBytes).length > 8 * 1024 * 1024) fail('probe history is full; nothing was discarded.');
    const saved = await bucket.put(loaded.key, body, { onlyIf: { etagMatches: loaded.etag }, httpMetadata: { contentType: 'application/json' } });
    if (!saved?.etag) fail('state changed or its save was not acknowledged. No retry is permitted.');
    loaded.etag = saved.etag;
  }
  async function retain(input) {
    const snapshot = await captureAssessmentInput(input);
    await history.putArtifact(snapshot.binding.artifactSha256, input.bytes, input.mediaType);
    return { metadata: historyInput(input), sha256: snapshot.binding.artifactSha256, fingerprint: snapshot.fingerprint };
  }
  async function source(state, name) {
    const saved = state.inputs[name];
    if (!saved) fail('the required original input is missing.');
    const { bytes } = await history.artifact(saved.sha256), input = { ...saved.metadata, bytes };
    const snapshot = await captureAssessmentInput(input);
    if (snapshot.fingerprint !== saved.fingerprint) fail('the captured input changed.');
    return { input, snapshot };
  }
  const output = (state, phase) => {
    if (state.registrationSha256 && phase === 'negation.inventory') return state.inheritedInventory;
    const operation = state.operations.find(item => item.phase === phase && item.status === 'complete');
    if (!operation) fail('a prerequisite phase is missing.');
    return operation.output;
  };
  function selection(snapshot) {
    // The PDF styles first and last names separately; TXT retains a single excerpt.
    const names = snapshot.evidence[0]?.text === 'Avery Example' ? snapshot.evidence.slice(0, 1)
      : snapshot.evidence[0]?.text === 'Avery' && snapshot.evidence[1]?.text === 'Example' ? snapshot.evidence.slice(0, 2) : [];
    const contacts = snapshot.evidence.filter(item => item.text === 'avery@example.test');
    if (!names.length || contacts.length !== 1) fail('fictional name/contact boundaries need review; no exclusion was guessed.');
    const excluded = [...names.map(item => ({ id: item.id, reason: 'name' })), { id: contacts[0].id, reason: 'contact' }];
    return approveAssessmentEvidence(snapshot, { confirmed: true, excluded });
  }
  async function audit(state) {
    const sources = {};
    for (const name of Object.keys(state.inputs)) sources[name] = await source(state, name);
    for (const operation of state.operations.filter(item => item.status === 'complete')) {
      const name = operation.phase.split('.')[0], own = sources[name];
      if (operation.phase.endsWith('.inventory')) await validateAssessmentInventory(operation.output, own.snapshot);
      else if (operation.phase.endsWith('.assessment')) await validateEvaluatedAssessment(operation.output, own.snapshot);
      else if (operation.phase === 'pdf.revision') {
        const revision = operation.output;
        await validateAssessmentRevision(revision, own.snapshot, output(state, 'pdf.assessment'), {
          document: own.input.document, version: own.input.version, findingId: revision.context.findingId, fieldId: revision.context.fieldId,
        });
      } else if (operation.phase === 'pdf.recheck') {
        await validateEvaluatedAssessment(operation.output.result, sources.edited.snapshot);
        await validateAssessmentComparison(operation.output.comparison, output(state, 'pdf.assessment'), sources.pdf.snapshot,
          operation.output.result, sources.edited.snapshot);
      }
    }
    const base = sources.pdf.input.document, applied = state.operations.find(item => item.phase === 'pdf.apply');
    if (state.versions.length > 2 || state.documentVersion !== state.versions.length + 1 ||
        state.versions.length && !applied || sources.edited && !applied) fail('the document/checkpoint history changed.');
    if (state.versions.length) {
      const revision = output(state, 'pdf.revision');
      if (revision.interpretation.status !== 'review-required') fail('an unapproved revision changed the document.');
      for (const [index, checkpoint] of state.versions.entries()) {
        const label = (index === 0 ? 'Before candidate revision: ' : 'Applied candidate revision: ') + revision.id;
        if (checkpoint.version !== index + 1 || checkpoint.label !== label || !same(checkpoint.document, base)) fail('a named checkpoint changed.');
      }
      if (state.versions.length === 2) {
        const expected = editResumeField(base, revision.context.fieldId, revision.draft.after), edits = state.document.candidateEdits;
        const last = edits?.at(-1);
        if (resumeSignature(expected) !== resumeSignature(state.document) || !Array.isArray(edits) ||
            !same(edits.slice(0, -1), base.candidateEdits ?? []) || !same(last?.revision, revision) || last.checkpointVersion !== 2 ||
            !Number.isSafeInteger(last.authorConfirmedAt) || last.authorConfirmedAt < revision.createdAt) fail('the saved exact edit or its receipt changed.');
      } else if (!same(state.document, base)) fail('the checkpoint changed document content.');
    } else if (!same(state.document, base)) fail('the original fictional document changed.');
    if (sources.edited && (sources.edited.input.version !== state.documentVersion || !same(sources.edited.input.document, state.document))) fail('the edited export no longer matches the saved document.');
    if (applied?.status === 'complete' && (state.documentVersion !== 3 || !sources.edited ||
        !same(applied.output, { document: state.document, version: state.documentVersion }))) fail('the completed Apply receipt changed.');
    return sources;
  }
  async function budget(loaded) {
    const operations = [...loaded.parent.state.operations, ...(loaded.child?.state.operations ?? []), ...(loaded.smokeRun?.state.operations ?? []),
      ...(loaded.structuredRun?.state.operations ?? [])];
    const object = await bucket.get(BUDGET_KEY);
    if (!object) {
      if (operations.some(item => item.plan)) fail('a planned phase has no spending ledger; outcome requires audit, not budget recreation.');
      return { maxCost: 4, reserved: 0, attempts: 0, initialized: false };
    }
    const value = await object.json();
    const maxCost = loaded.smokeClaim ? 6 : 4;
    validateAssessmentBudget(value, maxCost);
    if (value.maxCost !== maxCost) fail('the spending ledger changed.');
    let reserved = 0, attempts = 0;
    for (const entry of value.reservations) {
      validateAssessmentPlan(entry.plan);
      const matches = operations.filter(item => item.plan?.id === entry.plan.id), operation = matches[0];
      if (matches.length !== 1 || !same(operation.plan, entry.plan) || entry.requestPolicy !== 'anthropic-sonnet-5-5-medium-v1') fail('an unrecognized paid reservation exists; stop for an audit.');
      for (const response of operation.responses ?? []) {
        const attempt = entry.attempts.find(item => item.stage === response.stage);
        if (!attempt || !['received', 'failed', 'started'].includes(attempt.status) || attempt.binding?.request !== response.requestSha256 ||
            (attempt.status !== 'started' && attempt.rawResponseSha256 !== response.sha256)) fail('a retained response lost its budget binding.');
      }
      reserved += Math.round(entry.plan.amount * 1e6);
      attempts += entry.attempts.filter(item => item.status !== 'reserved').length;
    }
    for (const operation of operations.filter(item => item.status === 'complete' && item.plan)) {
      const reservation = value.reservations.find(item => item.plan.id === operation.plan.id);
      if (!reservation || reservation.attempts.some(item => item.status !== 'received')) fail('a completed phase lost its provider receipts.');
    }
    if (reserved > (loaded.structuredClaim ? 5808013 : loaded.smokeClaim ? 5060011 : loaded.child ? 2904006 : 4000000) ||
        attempts > (loaded.structuredClaim ? 16 : loaded.smokeClaim ? 14 : loaded.child ? 8 : 10)) fail('the approved spending or call ceiling was exceeded.');
    return { maxCost, reserved: reserved / 1e6, attempts, initialized: true };
  }
  async function review(options = {}) {
    const loaded = await load(), { state } = loaded;
    if (state.stopped || state.operations.some(item => item.status !== 'complete')) fail('the probe stopped or has an unfinished/failed operation. Inspect status; do not replay.');
    const phase = phases[state.operations.length];
    if (!phase) fail('the approved probe is complete. Additional calls are not authorized.');
    const sources = await audit(state), name = phase === 'pdf.recheck' ? 'edited' : phase.split('.')[0], own = sources[name];
    const paid = phase !== 'pdf.apply';
    const transport = options.transport ?? 'environment';
    if (!['environment', 'studio'].includes(transport)) fail('unknown provider transport.');
    if ((continuation || fixed) && transport !== 'studio') fail('the registered workflow requires Studio; no environment fallback is authorized.');
    if (fixed && (structured ? loaded.structuredClaim : loaded.smokeClaim).packet.codeSha256 !== codeSha256) fail('the approved smoke code changed; no automatic execution.');
    const spending = await budget(loaded);
    if (paid) probePolicy(options.pricesCheckedAt);
    const evidence = selection(own.snapshot);
    const packet = { version: 1, phase, transport, maxCost: 4, maxCalls: 10, pricesCheckedAt: paid ? options.pricesCheckedAt : null,
      pricing: { input: 2, output: 10 }, requestPolicy: 'anthropic-sonnet-5-5-medium-v1',
      inputFingerprint: own.snapshot.fingerprint, artifactSha256: own.snapshot.binding.artifactSha256,
      jobDescription: own.snapshot.target.jd, originalText: own.snapshot.artifact.text, selection: evidence,
      inventory: phase.endsWith('.assessment') ? output(state, name + '.inventory') : null, revisionContext: null, revision: null };
    if (continuation) Object.assign(packet, { maxCalls: 8, continuation: loaded.claim, spending,
      previousAssessment: phase === 'pdf.inventory' ? output(state, 'negation.assessment') : null,
      ledgerSha256: await historyHash(await (await bucket.get(BUDGET_KEY)).json()) });
    if (smoke) Object.assign(packet, { maxCost: 6, maxCalls: 14, smoke: loaded.smokeClaim, spending,
      ledgerSha256: await historyHash(await (await bucket.get(BUDGET_KEY)).json()) });
    if (structured) Object.assign(packet, { maxCost: 6, maxCalls: 16, structured: loaded.structuredClaim, spending,
      responseContract: phase === 'pdf.revision' ? 'revision-json-v1' : 'assessment-semantic-json-v1',
      ledgerSha256: await historyHash(await (await bucket.get(BUDGET_KEY)).json()) });
    if (phase === 'pdf.revision') {
      packet.revisionContext = await captureAssessmentRevisionContext(own.snapshot, output(state, 'pdf.assessment'), {
        document: own.input.document, version: own.input.version, findingId: options.findingId, fieldId: options.fieldId,
      });
    } else if (phase === 'pdf.apply') {
      packet.revision = output(state, 'pdf.revision');
      if (packet.revision.interpretation.status !== 'review-required') fail('this revision is blocked, a question or no-change. Finish the probe; do not force an edit.');
    } else if (phase === 'pdf.recheck') {
      packet.inventory = output(state, 'pdf.assessment').approval;
    }
    return { packet, approvalSha256: await historyHash(packet), loaded, sources };
  }
  return {
    async reviewStructured({ pricesCheckedAt } = {}) {
      const loaded = await load(false, false, false);
      if (loaded.structuredClaim) fail('the one structured smoke is already registered; no replacement workflow.');
      probePolicy(pricesCheckedAt, true);
      if (!loaded.smokeRun) fail('the stopped previous smoke is required.');
      for (const run of [loaded.parent, loaded.child, loaded.smokeRun]) await audit(run.state);
      await budget(loaded);
      const packet = await structuredPacket(loaded.parent.state, loaded.child.state, loaded.smokeRun.state,
        await (await bucket.get(BUDGET_KEY)).json(), pricesCheckedAt, codeSha256);
      return { packet, approvalSha256: await historyHash(packet) };
    },
    async registerStructured({ confirmed, approvalSha256, pricesCheckedAt, onClaim } = {}) {
      if (confirmed !== true || onClaim !== undefined && typeof onClaim !== 'function') fail('explicit approval and a valid structured registration anchor are required.');
      const reviewed = await this.reviewStructured({ pricesCheckedAt });
      if (reviewed.approvalSha256 !== approvalSha256) fail('the structured workflow approval changed.');
      const loaded = await load(false, false, false);
      if (await historyHash(await (await bucket.get(BUDGET_KEY)).json()) !== reviewed.packet.priorBudgetSha256 ||
          await historyHash(loaded.parent.state) !== reviewed.packet.parentSha256 ||
          await historyHash(loaded.child.state) !== reviewed.packet.continuationSha256 ||
          await historyHash(loaded.smokeRun.state) !== reviewed.packet.previousSmokeSha256) fail('the approved structured inputs changed.');
      const claim = { ...reviewed, registeredAt: Date.now() };
      const state = { ...structuredClone(loaded.parent.state), maxCost: 6, maxCalls: 16, createdAt: claim.registeredAt,
        stopped: false, stopReason: null, operations: [], registrationSha256: approvalSha256,
        inheritedInventory: loaded.parent.state.operations[0].output };
      if (onClaim) await onClaim(approvalSha256);
      const claimed = await bucket.put(STRUCTURED_SMOKE_CLAIM_KEY, JSON.stringify(claim), { onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json' } });
      if (!claimed?.etag) fail('structured smoke was already claimed or its acknowledgement was lost.');
      const saved = await bucket.put(STRUCTURED_SMOKE_KEY, JSON.stringify(state), { onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json' } });
      if (!saved?.etag) fail('structured smoke registration was not acknowledged; never recreate it.');
      return this.status();
    },
    async reviewSmoke({ pricesCheckedAt } = {}) {
      const loaded = await load(false, false, false);
      if (loaded.smokeClaim) fail('the one fixed smoke is already registered; no replacement workflow.');
      probePolicy(pricesCheckedAt);
      await audit(loaded.parent.state);
      if (!loaded.child) fail('the stopped continuation is required.');
      await audit(loaded.child.state); await budget(loaded);
      const ledger = await (await bucket.get(BUDGET_KEY)).json();
      const packet = await smokePacket(loaded.parent.state, loaded.child.state, ledger, pricesCheckedAt, codeSha256);
      return { packet, approvalSha256: await historyHash(packet) };
    },
    async registerSmoke({ confirmed, approvalSha256, pricesCheckedAt, onClaim } = {}) {
      if (confirmed !== true) fail('explicit approval of the fixed nine-call workflow and six-dollar cumulative ceiling is required.');
      if (onClaim !== undefined && typeof onClaim !== 'function') fail('the durable smoke anchor callback is invalid.');
      const reviewed = await this.reviewSmoke({ pricesCheckedAt });
      if (reviewed.approvalSha256 !== approvalSha256) fail('the fixed workflow approval changed.');
      const loaded = await load(false, false), ledgerObject = await bucket.get(BUDGET_KEY), ledger = await ledgerObject.json();
      if (await historyHash(ledger) !== reviewed.packet.priorBudgetSha256 ||
          await historyHash(loaded.parent.state) !== reviewed.packet.parentSha256 ||
          await historyHash(loaded.child.state) !== reviewed.packet.continuationSha256) fail('the approved smoke inputs changed.');
      const claim = { ...reviewed, registeredAt: Date.now() };
      const state = { ...structuredClone(loaded.parent.state), maxCost: 6, maxCalls: 14, createdAt: claim.registeredAt,
        stopped: false, stopReason: null, operations: [], registrationSha256: approvalSha256,
        inheritedInventory: loaded.parent.state.operations[0].output };
      if (onClaim) await onClaim(approvalSha256);
      const claimed = await bucket.put(SMOKE_CLAIM_KEY, JSON.stringify(claim), { onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json' } });
      if (!claimed?.etag) fail('smoke approval was already claimed or its acknowledgement was lost.');
      // The only ceiling amendment is anchored to the exact unchanged five-call prefix.
      const amended = await bucket.put(BUDGET_KEY, JSON.stringify({ ...ledger, maxCost: 6 }), { onlyIf: { etagMatches: ledgerObject.etag },
        httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' } });
      if (!amended?.etag) fail('the budget amendment was not acknowledged; audit partial registration, never retry.');
      const saved = await bucket.put(SMOKE_KEY, JSON.stringify(state), { onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json' } });
      if (!saved?.etag) fail('smoke registration was not acknowledged; never recreate it.');
      return this.status();
    },
    async runSmoke({ approvalSha256, allowProvider, preflight, signal, pricesCheckedAt } = {}) {
      if (!fixed || allowProvider !== true || typeof preflight !== 'function') fail('select the approved smoke and explicit provider access.');
      const loaded = await load();
      const claim = structured ? loaded.structuredClaim : loaded.smokeClaim;
      if (claim.approvalSha256 !== approvalSha256 || claim.packet.pricesCheckedAt !== pricesCheckedAt) fail('use the exact whole-workflow approval and price check.');
      for (let count = 0; count < SMOKE_PHASES.length; count++) {
        const status = await this.status();
        if (status.stopped) fail('the smoke stopped; no automatic retry.');
        if (!status.next) return status;
        const end = reason => this.finish({ confirmed: true, reason });
        if (status.next === 'pdf.inventory') {
          const negative = status.operations.find(operation => operation.phase === 'negation.assessment').output;
          if (negative.report.dimensions.roleEvidence.ratings.length !== 1 ||
              negative.report.dimensions.roleEvidence.ratings[0].state !== 'contradicted') return end('The negative-text assessment did not preserve the explicit contradiction. No PDF call was authorized.');
        }
        if (status.next === 'pdf.assessment') {
          const manifest = status.operations.find(operation => operation.phase === 'pdf.inventory').output.manifest;
          const requirement = manifest.requirements[0], condition = requirement?.condition;
          if (manifest.requirements.length !== 1 || requirement.importance !== 'required' || condition?.kind !== 'anyOf' ||
              condition.children.length !== 2 || condition.children.some(child => child.kind !== 'atom') ||
              !same(condition.children.map(child => child.quote).sort(), ['Java', 'Python'])) return end('The fictional PDF inventory did not preserve the Python-or-Java requirement. No assessment was sent.');
        }
        const options = { pricesCheckedAt, transport: 'studio' };
        if (status.next === 'pdf.revision') {
          const finding = status.revisionChoices.findings.find(item => item.affectedFieldIds.includes('north-work'));
          if (!finding) return end('No eligible finding maps to the approved fictional north-work field. No forced revision.');
          Object.assign(options, { findingId: finding.id, fieldId: 'north-work' });
        }
        if (status.next === 'pdf.apply') {
          const revision = status.operations.find(operation => operation.phase === 'pdf.revision').output;
          if (revision.draft.kind !== 'revision' || revision.interpretation.status !== 'review-required') return end('The proposed revision was uncertain, blocked, a question or no-change. No Apply or recheck.');
        }
        const reviewed = await this.review(options);
        smokePhaseApproval = reviewed.approvalSha256;
        try { await this.run({ ...options, approvalSha256: reviewed.approvalSha256, allowProvider: true, preflight, signal }); }
        finally { smokePhaseApproval = null; }
      }
      return this.status();
    },
    async reviewContinuation({ pricesCheckedAt } = {}) {
      const loaded = await load(false);
      if (loaded.claim) fail('the one continuation is already registered; no second registration is allowed.');
      probePolicy(pricesCheckedAt);
      await audit(loaded.state); await budget(loaded);
      const ledgerObject = await bucket.get(BUDGET_KEY);
      if (!ledgerObject) fail('the original budget is missing; no continuation can initialize it.');
      const packet = await continuationPacket(loaded.state, await ledgerObject.json(), pricesCheckedAt);
      return { packet, approvalSha256: await historyHash(packet) };
    },
    async registerContinuation({ confirmed, approvalSha256, pricesCheckedAt, onClaim } = {}) {
      if (confirmed !== true) fail('explicitly approve the one repeated negation assessment and fixed continuation plan.');
      if (onClaim !== undefined && typeof onClaim !== 'function') fail('the durable registration anchor callback is invalid.');
      const review = await this.reviewContinuation({ pricesCheckedAt });
      if (approvalSha256 !== review.approvalSha256) fail('approve the exact continuation registration packet first.');
      const parent = await loadState(PROBE_KEY, PROBE_PHASES, 10);
      if (await historyHash(parent.state) !== review.packet.parentSha256) fail('the parent changed before registration.');
      const claim = { ...review, registeredAt: Date.now() };
      const state = { ...structuredClone(parent.state), maxCalls: 8, createdAt: claim.registeredAt, stopped: false, stopReason: null,
        operations: [], registrationSha256: approvalSha256, inheritedInventory: parent.state.operations[0].output };
      if (new TextEncoder().encode(JSON.stringify(parent.state) + JSON.stringify(state) + JSON.stringify(claim)).length > 8 * 1024 * 1024) fail('probe history is full; nothing was discarded.');
      if (onClaim) await onClaim(approvalSha256);
      const saved = await bucket.put(CONTINUATION_CLAIM_KEY, JSON.stringify(claim), { onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json' } });
      if (!saved?.etag) fail('continuation was already claimed or its acknowledgement was lost; no replay.');
      const child = await bucket.put(CONTINUATION_KEY, JSON.stringify(state), { onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: 'application/json' } });
      if (!child?.etag) fail('continuation registration was not acknowledged; audit it, never recreate it.');
      return this.status();
    },
    async prepare() {
      if (continuation || fixed) fail('a registered workflow never prepares inputs or initializes a budget.');
      if (await bucket.get(PROBE_KEY)) return this.status();
      if (await bucket.get(BUDGET_KEY)) fail('a spending ledger exists without probe state. Never initialize another budget.');
      const bytes = new TextEncoder().encode('Avery Example\navery@example.test\nNo experience with Python.\nUsed customer interviews to clarify a fictional handoff process.');
      const negation = { kind: 'upload', mediaType: 'text/plain', bytes,
        target: { company: 'Fictional Example', role: 'Product Designer', level: 'staff', jd: 'Python' },
        extraction: await extractAssessmentArtifact(bytes, 'text/plain') };
      const document = fictionalProbeDocument(), pdf = await renderExport(document, 1);
      if (pdf.kind !== 'export' || pdf.version !== 1 || resumeSignature(pdf.document) !== resumeSignature(document)) fail('isolated rendering changed the fictional document.');
      const state = { version: 1, maxCost: 4, maxCalls: 10, stopped: false, stopReason: null, createdAt: Date.now(),
        inputs: { negation: await retain(negation), pdf: await retain(pdf) }, operations: [], document, documentVersion: 1, versions: [] };
      const saved = await bucket.put(PROBE_KEY, JSON.stringify(state), { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/json' } });
      if (!saved?.etag) fail('initialization was not acknowledged. Inspect existing state; do not overwrite it.');
      return this.status();
    },
    async status() {
      const loaded = await load(), { state } = loaded, sources = await audit(state), spending = await budget(loaded);
      if (loaded.child) await audit(continuation ? loaded.parent.state : loaded.child.state);
      if (loaded.smokeRun) {
        await audit(loaded.parent.state);
        if (!smoke) await audit(loaded.smokeRun.state);
      }
      if (loaded.structuredRun && !structured) await audit(loaded.structuredRun.state);
      const next = state.stopped || state.operations.some(item => item.status !== 'complete') ? null : phases[state.operations.length] ?? null;
      let revisionChoices = null;
      if (next === 'pdf.revision') {
        const result = output(state, 'pdf.assessment'), presentation = await createAssessmentPresentation(result, sources.pdf.snapshot);
        revisionChoices = { findings: presentation.findings.filter(item => ['role', 'communication'].includes(item.category) && item.action.kind !== 'no-change-needed'),
          fieldIds: assessmentFieldLocations(sources.pdf.snapshot, result.selection.includedIds) };
      }
      return { next, spending, stopped: state.stopped, stopReason: state.stopReason, operations: state.operations,
        inputs: state.inputs, document: state.document, documentVersion: state.documentVersion, versions: state.versions, revisionChoices,
        ...(loaded.claim ? { continuation: { registration: loaded.claim, selected: continuation,
          next: loaded.child.state.stopped || loaded.child.state.operations.some(operation => operation.status !== 'complete') ? null
            : CONTINUATION_PHASES[loaded.child.state.operations.length] ?? null } } : {}),
        ...(loaded.smokeClaim ? { smoke: { registration: loaded.smokeClaim, selected: smoke,
          next: loaded.smokeRun.state.stopped || loaded.smokeRun.state.operations.some(operation => operation.status !== 'complete') ? null
            : SMOKE_PHASES[loaded.smokeRun.state.operations.length] ?? null } } : {}),
        ...(loaded.structuredClaim ? { structured: { registration: loaded.structuredClaim, selected: structured,
          next: loaded.structuredRun.state.stopped || loaded.structuredRun.state.operations.some(operation => operation.status !== 'complete') ? null
            : SMOKE_PHASES[loaded.structuredRun.state.operations.length] ?? null } } : {}),
        limitation: 'Fictional development probe only. No independent quality, paired baseline, settled bill or held-out acceptance.' };
    },
    async review(options) {
      const value = await review(options);
      return { packet: value.packet, approvalSha256: value.approvalSha256 };
    },
    async original(name) {
      const { state } = await load();
      if (!['negation', 'pdf', 'edited'].includes(name)) fail('unknown fictional input.');
      return (await source(state, name)).input;
    },
    async finish({ confirmed, reason }) {
      if (confirmed !== true || typeof reason !== 'string' || !reason.trim() || reason.length > 1000) fail('explicitly record why the probe is ending.');
      const loaded = await load();
      if (loaded.state.operations.some(item => item.status === 'started')) fail('an operation is unfinished; audit it before closing.');
      if (loaded.state.stopped) fail('the probe is already stopped; its closing reason is immutable.');
      loaded.state.stopped = true; loaded.state.stopReason = reason; await write(loaded);
      return this.status();
    },
    async run({ approvalSha256, allowProvider = false, preflight, signal, previousAssessmentApproved = false, ...options }) {
      if (fixed && (!smokePhaseApproval || approvalSha256 !== smokePhaseApproval)) fail('the smoke can run only through its fixed workflow guards.');
      const current = await review(options), { loaded, sources, packet } = current, { state } = loaded, phase = packet.phase;
      if (approvalSha256 !== current.approvalSha256) fail('approve the exact reviewed input/inventory/evidence/revision packet first.');
      if (packet.previousAssessment && previousAssessmentApproved !== true) fail('explicitly review the prior negation result before any PDF call; stop if it is unsafe or inconclusive.');
      const paid = phase !== 'pdf.apply';
      if (paid && (allowProvider !== true || typeof preflight !== 'function')) fail('explicit provider permission and secure preflight are required.');
      signal?.throwIfAborted();
      if (paid) await preflight();
      signal?.throwIfAborted();
      await budget(loaded);
      const operation = { phase, transport: packet.transport, status: 'started', approvalSha256, startedAt: Date.now(), plan: null, output: null, outputSha256: null, error: null, attempt: null, responses: [] };
      state.operations.push(operation); await write(loaded);
      let result = null;
      try {
        let activePlan = null;
        // Only the separately registered structured workflow opts into the new wire contract.
        const requestOptions = { provider: 'anthropic', model: 'claude-sonnet-5-5', structuredOutput: structured, pricing: { input: 2, output: 10, checkedAt: options.pricesCheckedAt },
          consent: true, signal, getCurrent: async () => {
            const latest = await load(), active = latest.state.operations.at(-1);
            if (active?.phase !== phase || active.status !== 'started' || active.approvalSha256 !== approvalSha256 || latest.state.stopped) fail('the active phase changed.');
            return (await source(latest.state, phase === 'pdf.recheck' ? 'edited' : phase.split('.')[0])).snapshot;
          },
          reserve: async plan => {
            validateAssessmentPlan(plan);
            if (operation.plan || !same(plan.stages.map(item => item.stage), stagesFor(phase))) fail('unplanned or repeated phase reservation.');
            operation.plan = structuredClone(plan); await write(loaded); activePlan = plan;
            signal?.throwIfAborted();
            await request('approve', { confirmed: true, maxCost: fixed ? 6 : 4 }, options.pricesCheckedAt, signal);
            signal?.throwIfAborted();
            const receipt = await request('reserve', plan, options.pricesCheckedAt, signal);
            if (receipt.id !== plan.id || receipt.amount !== plan.amount) fail('reservation was not acknowledged exactly.');
            return { id: receipt.id, amount: receipt.amount };
          },
          invoke: async input => {
            if (!activePlan) fail('no complete phase was reserved.');
            const { provider, model, stage, system, user, maxTokens, responseContract } = input;
            if (maxTokens !== RESUME_COMPLETION_LIMITS[stage]) fail('unapproved output cap.');
            const value = await request('execute', { reservationId: activePlan.id, provider, model, stage, system, user, maxTokens,
              ...(responseContract === undefined ? {} : { responseContract }) }, options.pricesCheckedAt, input.signal, async response => {
              if (response.reservationId !== activePlan.id || response.stage !== stagesFor(phase)[operation.responses.length] ||
                  response.requestSha256 !== await historyHash(assessmentRequestIdentity(input)) || await historyHash(response.receipt) !== response.sha256) fail('response retention does not match the approved attempt.');
              operation.responses.push(structuredClone(response));
              await write(loaded);
            });
            if (!operation.responses.some(response => response.stage === stage)) fail('the transport did not acknowledge private response retention.');
            return value.receipt;
          } };
        const name = phase.split('.')[0], own = sources[name];
        if (phase.endsWith('.inventory')) result = await inventoryCandidateAssessment(own.snapshot, requestOptions);
        else if (phase.endsWith('.assessment')) {
          const approval = await approveAssessmentInventory(own.snapshot, packet.inventory, { confirmed: true });
          result = await evaluateCandidateAssessment(own.snapshot, { ...requestOptions, approval, selection: selection(own.snapshot) });
          await history.save(await createAssessmentHistory({ input: own.input, result, label: 'Fictional probe: ' + name, inventory: packet.inventory }), '*');
        } else if (phase === 'pdf.revision') {
          result = await proposeAssessmentRevision(own.snapshot, output(state, 'pdf.assessment'), {
            document: own.input.document, version: own.input.version, findingId: options.findingId, fieldId: options.fieldId,
          }, requestOptions);
          const saved = await history.get(output(state, 'pdf.assessment').report.id);
          await history.save({ ...saved.record, revisions: [result] }, saved.etag);
        } else if (phase === 'pdf.apply') {
          const getRecord = () => ({ document: structuredClone(state.document), version: state.documentVersion });
          result = await commitAssessmentRevision({ revision: packet.revision, snapshot: own.snapshot, assessment: output(state, 'pdf.assessment'), confirmed: true, signal, getRecord,
            checkpoint: async label => {
              state.versions.push({ label, ...getRecord() }); state.documentVersion++; await write(loaded); return getRecord();
            },
            save: async (document, { expectedVersion, expectedSignature, label }) => {
              if (state.documentVersion !== expectedVersion || resumeSignature(state.document) !== expectedSignature) fail('the fictional document changed.');
              state.versions.push({ label, ...getRecord() }); state.document = document; state.documentVersion++; await write(loaded); return getRecord();
            } });
          const edited = await renderExport(state.document, state.documentVersion);
          if (edited.version !== state.documentVersion || resumeSignature(edited.document) !== resumeSignature(state.document)) fail('edited export changed during rendering.');
          state.inputs.edited = await retain(edited);
        } else {
          const edited = sources.edited, before = output(state, 'pdf.assessment');
          const inventory = { version: 1, targetSha256: before.approval.targetSha256, manifest: before.approval.manifest,
            execution: [], reservations: [], approvalRequired: true, reusedFrom: before.report.id };
          const approval = await approveAssessmentInventory(edited.snapshot, inventory, { confirmed: true });
          const after = await evaluateCandidateAssessment(edited.snapshot, { ...requestOptions, approval, selection: selection(edited.snapshot) });
          const comparison = await compareCandidateAssessments(before, own.snapshot, after, edited.snapshot);
          await history.save(await createAssessmentHistory({ input: edited.input, result: after, label: 'Fictional probe: edited PDF', inventory,
            baselineId: before.report.id, comparison }), '*');
          result = { result: after, comparison };
        }
        operation.output = result; operation.outputSha256 = await historyHash(result); operation.status = 'complete'; operation.completedAt = Date.now();
        await write(loaded); return this.status();
      } catch (error) {
        operation.status = 'failed'; operation.error = error.message; operation.attempt = error.assessmentAttempt ?? null;
        if (result) { operation.output = result; operation.outputSha256 = await historyHash(result); }
        state.stopped = true; state.stopReason = 'Operation failed or was not acknowledged. No automatic retry.';
        try { await write(loaded); }
        catch (storageError) { throw new AggregateError([error, storageError], 'Probe outcome was not acknowledged; spending may be retained. Do not replay.'); }
        throw error;
      }
    },
  };
}
