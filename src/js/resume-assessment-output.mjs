import { SEMANTIC_REVIEW } from './resume-assessment-semantics.mjs';

export const ASSESSMENT_EVIDENCE_POLICY = 'decision-context-v1';
export const ASSESSMENT_EVIDENCE_CONTRACT = 'assessment-semantic-evidence-json-v1';
export const ASSESSMENT_OUTPUT_CONTRACTS = Object.freeze(['assessment-json-v1', 'assessment-semantic-json-v1', 'revision-json-v1', ASSESSMENT_EVIDENCE_CONTRACT]);
const fail = message => { throw Object.assign(new Error('Assessment output contract: ' + message), { status: 400 }); };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const string = { type: 'string' };
const values = entries => ({ enum: entries });
const literal = value => ({ const: value });
const array = items => ({ type: 'array', items });
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
const verdict = values(['agree', 'disagree', 'uncertain']);
function atoms(node, depth = 0) {
  if (depth > 4 || !node || typeof node !== 'object') fail('invalid requirement condition.');
  if (node.kind === 'atom') return [node.id];
  if (!['allOf', 'anyOf'].includes(node.kind) || !Array.isArray(node.children) || node.children.length > 120) fail('invalid requirement group.');
  return node.children.flatMap(child => atoms(child, depth + 1));
}

export function validateAssessmentOutputContract(contract, provider, model) {
  if (!ASSESSMENT_OUTPUT_CONTRACTS.includes(contract) || !['anthropic', 'openai'].includes(provider) ||
      typeof model !== 'string' || !/^[a-zA-Z0-9._:-]{1,160}$/.test(model)) fail('unsupported contract or provider/model.');
  return contract;
}
export function structuredAssessmentPrompt(system, contract, stage) {
  if (contract === ASSESSMENT_EVIDENCE_CONTRACT) system += `
DECISION AND CONTEXT EVIDENCE POLICY ${ASSESSMENT_EVIDENCE_POLICY}:
The evidence arrays contain decision-bearing sources: support, counterevidence and anything whose interpretation could change the judgment.
Read ALL included sources. Do not hide conflicting, negated, missing or ambiguous material evidence as background context.
For each challenged rating and communication judgment, also return contextEvidence:[{"id":"included excerpt ID","reason":"why this additional context cannot change this judgment"}].
Context citations must be additional sources, disjoint from both the draft evidence and your decision-bearing evidence.
Agreement must retain EVERY draft evidence ID in your evidence array; add material sources as needed.
If a draft source is irrelevant, disagree with the judgment rather than moving its source into context.
If you cannot settle whether an additional source is material, include it as decision-bearing and return uncertain.
An uncertain decision-bearing source still blocks the judgment. Uncertain background context stays visible without becoming a decision dependency.
Absence claims still require resolved interpretation of ALL sources. Context labels never exempt a source from the absence check.
In the assessment pass use the existing fields only. contextEvidence is required only on the challenge judgments, including when empty.
These relevance classifications are model judgments, not independent verification.`;
  return system + `
STRUCTURED RESPONSE TRANSPORT v1:
Follow the supplied JSON schema. Earlier examples explain meanings, not the transport shape.
Fixed review lists are objects keyed by the exact IDs in the schema; retain each entry's required ID.
An empty target set is an empty object, not a placeholder review. Never invent a target.
inventoryIssues is keyed by every JD segment. Each entry has segmentId, issue and reason.
Use issue=false with reason="" when no concrete issue is found; otherwise issue=true with its explanation.
Proposed requirements, experience groups, revision claims and evidence citations remain arrays.
Disagreement and uncertainty remain legitimate. Even if no experience group was proposed,
challenge missed or incorrect grouping through the affected excerpt reviews and their reasons.
The schema controls structure only; do not infer agreement or evidence from a required field.
Structured binding: ${contract}/${stage}.`;
}
function context(request) {
  if (!ASSESSMENT_OUTPUT_CONTRACTS.includes(request.responseContract)) fail('unsupported response contract.');
  let data;
  try { data = JSON.parse(request.user); } catch { fail('request data must be JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('request data must be an object.');
  return data;
}
function identifiers(entries) {
  if (!Array.isArray(entries) || entries.length > 2000 ||
      entries.some(entry => typeof entry?.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.id)) ||
      new Set(entries.map(entry => entry.id)).size !== entries.length) fail('invalid or duplicate target identities.');
  return entries.map(entry => entry.id);
}
const keyed = (ids, entry) => object(Object.fromEntries(ids.map(id => [id, entry(id)])));
function fixedTargets(request, data) {
  const semantic = ['assessment-semantic-json-v1', ASSESSMENT_EVIDENCE_CONTRACT].includes(request.responseContract);
  if (request.responseContract === ASSESSMENT_EVIDENCE_CONTRACT && !['assessment', 'challenge'].includes(request.stage)) fail('evidence policy requires an assessment phase.');
  const revision = request.responseContract === 'revision-json-v1';
  const ids = entries => identifiers(entries);
  if (request.stage === 'requirements' && !revision) return [['segments', ids(data.segments)]];
  if (request.stage === 'revision' && revision) return [];
  if (request.stage === 'challenge' && revision) {
    if (!['revision', 'question', 'supported'].includes(data.draft?.kind)) fail('invalid revision draft kind.');
    return [['claims', ids(data.draft.kind === 'revision' ? data.draft.claims : [])]];
  }
  if (!['assessment', 'challenge'].includes(request.stage) || revision) fail('stage differs from the response contract.');
  if (request.stage === 'assessment' && (!Array.isArray(data.manifest?.requirements) || data.manifest.requirements.length > 60)) fail('invalid approved inventory.');
  const targets = [
    ['ratings', request.stage === 'assessment' ? ids(data.manifest.requirements.flatMap(item => atoms(item?.condition)).map(id => ({ id }))) : ids(data.draft?.ratings)],
    ['communication', ['scope', 'outcomes', 'clarity']],
  ];
  if (request.stage === 'challenge') targets.push(['inventoryIssues', ids(data.segments)]);
  if (semantic) {
    targets.push(['semantic.excerpts', ids(data.evidence)]);
    if (request.stage === 'challenge') targets.push(['semantic.groups', ids(data.draft?.semantic?.groups)], ['semantic.segments', ids(data.segments)]);
  }
  return targets;
}
export function assessmentResponseSchema(request) {
  const data = context(request), targets = new Map(fixedTargets(request, data));
  const segmentIds = identifiers(data.segments);
  const evidenceIds = request.stage === 'requirements' ? [] : identifiers(data.evidence);
  const reference = object({ id: values(evidenceIds), quote: string });
  const review = (id, evidence = false) => object({ id: literal(id), verdict, reason: string, ...(evidence ? { evidence: array(values(evidenceIds)),
    ...(request.responseContract === ASSESSMENT_EVIDENCE_CONTRACT ? { contextEvidence: array(object({ id: values(evidenceIds), reason: string })) } : {}),
  } : {}) });
  const fixed = (path, entry) => keyed(targets.get(path), entry);
  if (request.stage === 'requirements') {
    const atom = object({ kind: literal('atom'), id: string, segmentId: values(segmentIds), quote: string });
    const definitions = { condition4: atom };
    for (let depth = 3; depth >= 0; depth--) definitions['condition' + depth] = { anyOf: [atom,
      object({ kind: values(['allOf', 'anyOf']), children: array({ $ref: '#/$defs/condition' + (depth + 1) }) })] };
    return { ...object({ revision: literal(1),
      segments: fixed('segments', id => object({ id: literal(id), disposition: values(['criteria', 'context', 'benefits', 'eligibility', 'unsafe-instruction']), reason: string })),
      requirements: array(object({ id: string, label: string, importance: values(['required', 'responsibility', 'preferred']), condition: { $ref: '#/$defs/condition0' } })),
    }), $defs: definitions };
  }
  if (request.responseContract === 'revision-json-v1') {
    if (request.stage === 'challenge') return object({ verdict, reason: string, claims: fixed('claims', id => review(id)) });
    return { anyOf: [
      object({ kind: literal('supported'), reason: string, evidence: array(reference) }),
      object({ kind: literal('question'), question: string, reason: string }),
      object({ kind: literal('revision'), after: string, reason: string, claims: array(object({ id: string, quote: string, evidence: array(reference) })) }),
    ] };
  }
  const challenge = request.stage === 'challenge';
  const properties = {
    ratings: fixed('ratings', id => challenge ? review(id, true) : object({ id: literal(id),
      state: values(['not-evidenced', 'mentioned', 'partially-supported', 'supported', 'contradicted', 'unknown', 'conflicting-evidence']),
      reason: string, evidence: array(values(evidenceIds)) })),
    communication: fixed('communication', id => challenge ? review(id, true) : object({ id: literal(id), rating: values([0, 1, 2, 3, 4, null]), reason: string, evidence: array(values(evidenceIds)) })),
  };
  if (challenge) properties.inventoryIssues = fixed('inventoryIssues', id => object({ segmentId: literal(id), issue: { type: 'boolean' }, reason: string }));
  if (['assessment-semantic-json-v1', ASSESSMENT_EVIDENCE_CONTRACT].includes(request.responseContract)) properties.semantic = object({
    version: literal(SEMANTIC_REVIEW),
    excerpts: fixed('semantic.excerpts', id => challenge ? review(id) : object({ id: literal(id), kind: values(['experience', 'general', 'uncertain']), reason: string })),
    groups: challenge ? fixed('semantic.groups', id => review(id)) : array(object({ id: string,
      role: nullable(reference), employer: nullable(reference), dates: nullable(reference), achievements: array(reference),
      certainty: values(['explicit', 'uncertain']), reason: string })),
    ...(challenge ? { segments: fixed('semantic.segments', id => review(id)) } : {}),
  });
  return object(properties);
}
export function assessmentRequestIdentity(request) {
  return { system: request.system, user: request.user, ...(request.responseContract === undefined ? {} : {
    responseContract: request.responseContract, outputSchema: assessmentResponseSchema(request),
  }) };
}
export function decodeAssessmentResponse(request, response) {
  if (request.responseContract === undefined) return response;
  const data = context(request), decoded = structuredClone(response);
  for (const [path, ids] of fixedTargets(request, data)) {
    const parts = path.split('.'), name = parts.pop();
    let parent = decoded;
    for (const part of parts) parent = parent?.[part];
    const entries = parent?.[name];
    if (!entries || typeof entries !== 'object' || Array.isArray(entries) ||
        Object.keys(entries).length !== ids.length || ids.some(id => !Object.hasOwn(entries, id))) fail('expected exact keyed targets at ' + path + '.');
    parent[name] = ids.flatMap(id => {
      const entry = entries[id];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry[path === 'inventoryIssues' ? 'segmentId' : 'id'] !== id) fail('target identity differs at ' + path + '.');
      if (path === 'inventoryIssues') {
        if (Object.keys(entry).length !== 3 || !Object.hasOwn(entry, 'reason') || typeof entry.issue !== 'boolean' ||
            typeof entry.reason !== 'string' || entry.issue === false && entry.reason !== '') fail('invalid explicit inventory issue decision.');
        return entry.issue ? [{ segmentId: entry.segmentId, reason: entry.reason }] : [];
      }
      return [entry];
    });
  }
  return decoded;
}
