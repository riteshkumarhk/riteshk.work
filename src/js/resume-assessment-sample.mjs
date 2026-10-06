import { createAssessmentSnapshot } from './resume-assessment.mjs';
import { createAssessmentPilot } from './resume-assessment-pilot.mjs';

export const ASSESSMENT_DEVELOPMENT_CASES = [
  { id: 'dev-alternatives', version: 1, purpose: 'OR alternatives and an unresolved ownership claim', acceptance: ['R03', 'R09', 'C01'],
    jd: 'Python or Java\nLead cross-team work',
    text: 'Avery Example\navery@example.test\nBuilt Python prototypes for an internal reporting workflow.\nSupported discovery across two product teams.\nImproved clarity of handoffs through qualitative customer feedback.',
    atoms: [{ id: 'python', quote: 'Python', expected: 'supported', evidence: ['artifact-2'] },
      { id: 'java', quote: 'Java', expected: 'not-evidenced', evidence: [] },
      { id: 'leadership', quote: 'Lead cross-team work', expected: 'unknown', evidence: ['artifact-3'] }] },
  { id: 'dev-negation', version: 1, purpose: 'Explicit negation is not positive skill evidence', acceptance: ['R01'],
    jd: 'Python', text: 'Avery Example\navery@example.test\nNo experience with Python.\nDesigned a clearer handoff process using customer feedback.',
    atoms: [{ id: 'python', quote: 'Python', expected: 'contradicted', evidence: ['artifact-2'] }] },
  { id: 'dev-irrelevant-citation', version: 1, purpose: 'A valid title citation cannot prove tool proficiency', acceptance: ['R06'],
    jd: 'Figma proficiency', text: 'Avery Example\navery@example.test\nProduct Designer\nExplored customer problems through interviews.',
    atoms: [{ id: 'figma', quote: 'Figma proficiency', expected: 'unknown', evidence: ['artifact-2'] }] },
  { id: 'dev-attribution', version: 1, purpose: 'Disputed employer despite agreeing evidence ratings', acceptance: ['R06', 'R09'], sourceChallenge: true,
    jd: 'Python', text: 'Avery Example\navery@example.test\nNorthstar\nLead Designer\n2021 - Present\nBuilt Python services.\nAtlas\nDesigner\n2018 - 2021\nBuilt Java services.',
    atoms: [{ id: 'python', quote: 'Python', expected: 'unknown', evidence: ['artifact-5'] }] },
];

export async function createSampleAssessmentPilot(id = 'dev-alternatives') {
  const selected = ASSESSMENT_DEVELOPMENT_CASES.find(item => item.id === id);
  if (!selected) throw new Error('Unknown fictional assessment example.');
  const sample = structuredClone(selected);
  const snapshot = await createAssessmentSnapshot({ target: { company: 'Fictional example', role: 'Product Designer', level: 'staff', jd: sample.jd },
    artifact: { bytes: new TextEncoder().encode(sample.text), text: sample.text, mediaType: 'text/plain', extractorVersion: 'scripted-example-v1', semanticReview: 'source-attribution-v1' } });
  const atom = item => ({ kind: 'atom', id: item.id, quote: item.quote, segmentId: snapshot.jobSegments.find(segment => segment.text.includes(item.quote)).id });
  const requirements = sample.id === 'dev-alternatives'
    ? [{ id: 'tools', label: 'Python or Java', importance: 'required', condition: { kind: 'anyOf', children: sample.atoms.slice(0, 2).map(atom) } },
      { id: 'leadership', label: 'Cross-team leadership', importance: 'required', condition: atom(sample.atoms[2]) }]
    : [{ id: 'criterion', label: sample.jd, importance: 'required', condition: atom(sample.atoms[0]) }];
  const inventory = { revision: 1, requirements, segments: snapshot.jobSegments.map(segment => ({ id: segment.id, disposition: 'criteria', reason: 'Explicit fictional job criterion.' })) };
  const communication = ['scope', 'outcomes', 'clarity'].map(id => ({ id, rating: 3, reason: 'Scripted example judgment; not an AI assessment or a quality measurement.', evidence: ['artifact-3'] }));
  const draft = { ratings: sample.atoms.map(item => ({ id: item.id, state: item.expected === 'unknown' ? 'supported' : item.expected,
    reason: item.expected === 'unknown' ? 'The fictional first pass overstates this passage; the challenge will question it.' : 'Scripted reference response for this explicit example.', evidence: item.evidence })), communication };
  const challenge = { ratings: sample.atoms.map(item => ({ id: item.id, verdict: item.expected === 'unknown' && !sample.sourceChallenge ? 'disagree' : 'agree',
    reason: sample.sourceChallenge ? 'Scripted rating agreement; source attribution is challenged separately.' : item.expected === 'unknown' ? 'This passage does not establish the claimed proficiency or ownership. Keep this unresolved.' : 'Scripted challenge, not independent verification.', evidence: item.evidence })),
    communication: communication.map(item => ({ id: item.id, verdict: 'agree', reason: 'Scripted challenge only.', evidence: item.evidence })), inventoryIssues: [] };
  const values = new Map(); let queue = Promise.resolve(), request = 0;
  const pilot = await createAssessmentPilot({ snapshot, getCurrent: () => snapshot, provider: 'anthropic', model: 'scripted-offline-example',
    pricing: { input: 1, output: 2, checkedAt: Date.now() }, budget: { id: 'fictional-example', maxCost: 2, approved: true, scope: 'browser-origin' },
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    locks: { request(key, action) { const next = queue.then(action); queue = next.catch(() => {}); return next; } },
    invoke: async input => {
      const value = structuredClone({ requirements: inventory, assessment: draft, challenge }[input.stage]);
      if (input.stage !== 'requirements') {
        const data = JSON.parse(input.user);
        const entries = values => values.map(item => ({ id: item.id, verdict: 'agree', reason: 'Scripted source review, not independent truth.' }));
        value.semantic = input.stage === 'assessment'
          ? { version: 'source-attribution-v1', excerpts: data.evidence.map(item => ({ id: item.id, kind: 'general', reason: 'This scripted example contains unscoped statements, not an employer history.' })), groups: [] }
          : { version: 'source-attribution-v1', excerpts: entries(data.evidence), groups: [], segments: entries(data.segments) };
        if (sample.sourceChallenge) {
          const ref = index => ({ id: 'artifact-' + index, quote: snapshot.evidence[index].text });
          if (input.stage === 'assessment') {
            value.semantic.excerpts = data.evidence.map(item => ({ id: item.id, kind: Number(item.id.slice(9)) >= 2 ? 'experience' : 'general', reason: 'Scripted source classification.' }));
            value.semantic.groups = [
              { id: 'north', role: ref(3), employer: ref(6), dates: ref(4), achievements: [ref(5)], certainty: 'explicit', reason: 'The scripted first pass attaches this achievement to the wrong employer.' },
              { id: 'atlas', role: ref(7), employer: ref(6), dates: ref(8), achievements: [ref(9)], certainty: 'explicit', reason: 'Scripted second entry.' },
            ];
          } else value.semantic.groups = [
            { id: 'north', verdict: 'disagree', reason: 'The source says Northstar, not Atlas. Valid quotations alone do not establish this relationship.' },
            { id: 'atlas', verdict: 'agree', reason: 'Scripted agreement for the second entry, not independent truth.' },
          ];
        }
      }
      return { text: JSON.stringify(value), provider: input.provider, model: input.model, requestId: 'scripted-response-' + ++request, usage: null };
    } });
  return { pilot, snapshot, sample };
}
