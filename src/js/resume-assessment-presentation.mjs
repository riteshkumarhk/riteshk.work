import { validateEvaluatedAssessment } from './resume-assessment-evaluator.mjs';

export const ASSESSMENT_PRESENTATION_VERSION = 1;
const unique = values => [...new Set(values)];
const atoms = node => node.kind === 'atom' ? [node] : node.children.flatMap(atoms);
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const unresolved = state => ['unknown', 'conflicting-evidence', 'not-assessed'].includes(state);

export function assessmentFieldLocations(snapshot, evidenceIds) {
  const structure = snapshot.artifact.structure;
  if (!structure?.native || !structure.rows) return [];
  const spans = snapshot.evidence.filter(item => evidenceIds.includes(item.id)).flatMap(item => item.pdfSpans || []);
  const overlaps = (a, b) => a.page === b.page && a.item === b.item && a.start < b.end && a.end > b.start;
  return structure.native.fields.filter(field => field.state === 'located' && field.spans.some(span => spans.some(other => overlaps(span, other))) &&
    structure.rows.fields.some(other => other.id === field.id && other.state === 'located' &&
      field.spans.every(span => other.spans.some(match => match.page === span.page && match.item === span.item && match.start === span.start && match.end === span.end)) &&
      other.spans.length === field.spans.length)).map(field => field.id);
}

export async function createAssessmentPresentation(input, snapshot) {
  const assessment = await validateEvaluatedAssessment(input, snapshot);
  const { report, interpretation } = assessment, role = report.dimensions.roleEvidence;
  const findings = [], included = new Set(assessment.selection.includedIds);
  const add = ({ id, category, priority, priorityReason, title, gap, evidence = [], action, references = {} }) => {
    let finding = findings.find(item => item.id === id);
    if (!finding) {
      finding = { id, category, priority, priorityReason, title, gaps: [], evidenceIds: [], affectedFieldIds: [],
        fieldMapping: 'not-established', references: { requirements: [], atoms: [], observations: [], groups: [], segments: [], communication: [] }, action,
        expectedBenefit: action.kind === 'no-change-needed' ? 'Preserve evidence that already meets this criterion; no rewrite or score gain is implied.'
          : action.kind === 'inspect-artifact' ? 'Resolve a measured artifact risk before relying on its interpretation; no vendor acceptance is promised.'
            : 'Resolve this specific evidence or interpretation gap before considering wording changes; no score gain is predicted.' };
      findings.push(finding);
    }
    finding.gaps = unique([...finding.gaps, ...gap]);
    finding.evidenceIds = unique([...finding.evidenceIds, ...evidence.filter(id => included.has(id))]);
    for (const [key, values] of Object.entries(references)) finding.references[key] = unique([...finding.references[key], ...values]);
    return finding;
  };
  for (const observation of report.dimensions.artifact.observations.filter(item => ['fail', 'warn'].includes(item.status) || (item.id === 'positions' && item.status === 'unknown'))) {
    const order = ['column-risk', 'pdf-order-probes'].includes(observation.id);
    add({ id: order ? 'artifact-order' : 'artifact-' + observation.id, category: 'artifact', priority: observation.status === 'fail' ? 1 : 2,
      priorityReason: 'Inspect observed file risks before interpreting content. A risk is not proof of vendor rejection.',
      title: order ? 'Inspect the PDF reading order' : 'Inspect ' + observation.id.replaceAll('-', ' '), gap: [observation.reason],
      references: { observations: [observation.id] }, action: { kind: 'inspect-artifact', label: 'Compare the original file with recovered text and PDF locations.' } });
  }
  const targetProblems = [
    ...assessment.challenge.inventoryIssues.map(item => item.reason),
    ...(interpretation?.segments.filter(item => item.state === 'unknown').map(item => item.reason) || []),
  ];
  const targetFinding = targetProblems.length ? add({ id: 'target-inventory', category: 'target', priority: 1,
    priorityReason: 'An unresolved target interpretation can affect every role conclusion.',
    title: 'Resolve the job inventory challenge', gap: targetProblems,
    references: { requirements: role.requirements.map(item => item.id), segments: unique([...assessment.challenge.inventoryIssues.map(item => item.segmentId),
      ...(interpretation?.segments.filter(item => item.state === 'unknown').map(item => item.id) || [])]) },
    action: { kind: 'ask', label: 'Review the flagged JD clauses and confirm their requirements before reassessing.' } }) : null;

  for (const excerpt of interpretation?.excerpts.filter(item => item.state === 'unknown') || []) {
    const groups = interpretation.groups.filter(group => excerpt.groupIds.includes(group.id) && group.state === 'unknown');
    add({ id: groups.length ? 'source-group-' + groups.map(group => group.id).sort().join('|') : 'source-excerpt-' + excerpt.id, category: 'source', priority: 1,
      priorityReason: 'Unresolved source attribution must not become a confident content gap or ownership claim.',
      title: groups.length ? 'Resolve the proposed experience relationship' : 'Clarify the source excerpt',
      gap: unique([excerpt.challengeReason, ...groups.map(group => group.challengeReason), ...(excerpt.unmappedText ? ['Unmapped experience text: ' + excerpt.unmappedText] : [])]),
      evidence: [excerpt.id, ...groups.flatMap(group => [group.role, group.employer, group.dates, ...group.achievements].filter(Boolean).map(reference => reference.id))],
      references: { groups: groups.map(group => group.id) },
      action: { kind: 'ask', label: 'Confirm the role, employer and contribution shown by these exact source passages; do not strengthen the wording yet.' } });
  }
  const sourceCauses = evidence => findings.filter(item => item.category === 'source' && item.evidenceIds.some(id => evidence.includes(id)));
  for (const item of role.requirements) {
    const requirement = report.requirements.requirements.find(entry => entry.id === item.id);
    const ids = atoms(requirement.condition).map(atom => atom.id), ratings = role.ratings.filter(rating => ids.includes(rating.id));
    const evidence = unique(ratings.flatMap(rating => rating.evidence));
    const absenceBlocked = !evidence.length && assessment.draft.ratings.some(rating => ids.includes(rating.id) && rating.state === 'not-evidenced');
    const causes = item.state === 'unknown' ? (targetFinding ? [targetFinding] : absenceBlocked ? findings.filter(finding => finding.category === 'source') : sourceCauses(evidence)) : [];
    if (causes.length) {
      for (const cause of causes) {
        cause.references.requirements = unique([...cause.references.requirements, item.id]);
        cause.references.atoms = unique([...cause.references.atoms, ...ids]);
      }
      continue;
    }
    const supported = item.state === 'supported';
    add({ id: 'role-' + item.id, category: 'role', priority: supported ? 4 : item.importance === 'required' ? 2 : 3,
      priorityReason: supported ? 'This compound criterion is already supported under the challenged judgment; do not invent another requirement.'
        : item.importance === 'required' ? 'A required criterion takes priority over optional wording polish.' : 'Address this preference after material required gaps and source uncertainty.',
      title: (supported ? 'Keep: ' : unresolved(item.state) ? 'Clarify: ' : 'Review: ') + requirement.label,
      gap: supported ? ['The approved ' + requirement.condition.kind + ' condition is supported. Alternatives that were not needed are not additional gaps.']
        : [item.state === 'not-evidenced' ? 'The included submitted evidence does not document this criterion. This is not proof of inability.' : 'Current judgment: ' + item.state.replaceAll('-', ' '),
          ...ratings.map(rating => rating.id + ': ' + rating.reason)],
      evidence, references: { requirements: [item.id], atoms: ids },
      action: supported ? { kind: 'no-change-needed', label: 'Keep the supported evidence unless you independently want to edit it.' }
        : { kind: 'ask', label: 'Review the cited passages and exact JD condition. Is there relevant evidence that resolves the stated gap without adding an unsupported claim?' } });
  }
  for (const rating of report.dimensions.communication.ratings) {
    if (rating.rating === 4) continue;
    const causes = rating.rating === null ? sourceCauses(rating.evidence) : [];
    if (causes.length) {
      for (const cause of causes) cause.references.communication = unique([...cause.references.communication, rating.id]);
      continue;
    }
    const duplicate = findings.find(item => item.category === 'communication' && item.gaps.length === 1 && item.gaps[0] === rating.reason &&
      item.evidenceIds.length === rating.evidence.length && item.evidenceIds.every(id => rating.evidence.includes(id)));
    if (duplicate) {
      duplicate.references.communication.push(rating.id);
      duplicate.title = 'Clarify ' + duplicate.references.communication.join(' / ');
      continue;
    }
    add({ id: 'communication-' + rating.id, category: 'communication', priority: 3,
      priorityReason: 'Resolve the cited communication issue after source interpretation and material required gaps.',
      title: 'Clarify ' + rating.id, gap: [rating.reason], evidence: rating.evidence, references: { communication: [rating.id] },
      action: { kind: 'ask', label: 'Review this passage and judgment. What supported detail would resolve the stated ambiguity without overstating your contribution?' } });
  }
  for (const finding of findings) {
    finding.affectedFieldIds = assessmentFieldLocations(snapshot, finding.evidenceIds);
    if (finding.affectedFieldIds.length) finding.fieldMapping = 'checked-pdf-location-overlap';
  }
  findings.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id, 'en'));
  return freeze({ version: ASSESSMENT_PRESENTATION_VERSION, assessment, snapshotFingerprint: snapshot.fingerprint,
    summary: { status: report.status, headline: report.headline,
      artifact: { failed: report.dimensions.artifact.observations.filter(item => item.status === 'fail').length,
        risks: report.dimensions.artifact.observations.filter(item => item.status === 'warn').length,
        unresolved: report.dimensions.artifact.observations.filter(item => item.status === 'unknown').length },
      role: { applicable: role.status !== 'not-applicable', total: role.requirements.length, supported: role.requirements.filter(item => item.state === 'supported').length,
        unresolved: role.requirements.filter(item => unresolved(item.state)).length, requiredGaps: [...role.requiredGaps] },
      communication: { unresolved: report.dimensions.communication.ratings.filter(item => item.rating === null).length },
      coverage: { includedExcerpts: assessment.selection.includedIds.length, excludedExcerpts: assessment.selection.excluded.length,
        accountedSegments: report.coverage.accountedSegments, totalSegments: report.coverage.totalSegments },
      nextFindingId: findings.find(item => item.action.kind !== 'no-change-needed')?.id ?? null },
    findings, limitations: ['These actions are derived from the validated assessment, not a new AI judgment or an independent factual check.',
      'No claim-safe revisions are generated here. An empty action list is not proof that the resume needs no improvements.',
      'Checked PDF field locations identify overlapping authored fields, not an approved edit target. Originals and ambiguous mappings never borrow an editor field.'] });
}
