import React, { useEffect, useRef, useState } from 'react';
import { assessmentFileType, captureAssessmentInput, extractAssessmentArtifact } from './resume-assessment-input.mjs';
import { validateAssessmentManifest } from './resume-assessment.mjs';
import { resumeSignature, resumeFields } from './resume-workspace.mjs';
import { RESUME_COMPLETION_LIMITS, resumeCompletionReservation } from './resume-review.mjs';
import { ASSESSMENT_DEVELOPMENT_CASES, createSampleAssessmentPilot } from './resume-assessment-sample.mjs';
import { createAssessmentPresentation, assessmentFieldLocations } from './resume-assessment-presentation.mjs';
import { validateAssessmentComparison } from './resume-assessment-comparison.mjs';
import { validateAssessmentHistory } from './resume-assessment-history.mjs';

const words = value => String(value).replaceAll('-', ' ');
const money = value => '$' + value.toFixed(4);
const conditionAtoms = node => node.kind === 'atom' ? [node] : node.children.flatMap(conditionAtoms);
function JobSourceReview({ manifest, snapshot }) {
  if (!manifest || !snapshot.jobSegments.length) return null;
  return <details data-candidate-jd-sources><summary>Job description source coverage ({snapshot.jobSegments.length} segments)</summary>
    <p>Accounting for a segment does not prove every clause was understood. Check the complete source, assigned treatment and linked criteria before approval.</p>
    {snapshot.jobSegments.map(segment => {
      const disposition = manifest.segments.find(item => item.id === segment.id);
      const links = manifest.requirements.flatMap(requirement => conditionAtoms(requirement.condition).filter(atom => atom.segmentId === segment.id).map(atom => ({ requirement, atom })));
      return <article className="resume-finding rws-candidate-card" key={segment.id} data-candidate-jd-segment={segment.id}>
        <h4>{segment.id} <small>Marked {words(disposition.disposition)}</small></h4>
        <blockquote>{segment.text}</blockquote><p>{disposition.reason}</p>
        {links.length ? links.map(({ requirement, atom }) => <div key={atom.id}>
          <p>{requirement.label} — {words(requirement.importance)}; {atom.id}, characters {atom.start}–{atom.end}</p><blockquote>{atom.quote}</blockquote>
        </div>) : <p>No scored criterion is linked to this segment. Confirm that this treatment is appropriate.</p>}
      </article>;
    })}
  </details>;
}
function Condition({ node, onChange, depth = 0, disabled = false }) {
  if (depth > 4 || !node) return <p>Invalid condition. Correct the full inventory before approval.</p>;
  if (node.kind === 'atom') return <blockquote>{node.quote}</blockquote>;
  return <fieldset className="rws-candidate-condition" disabled={disabled}><legend>Compound requirement</legend>
    <select aria-label="Condition relationship" value={node.kind} onChange={event => onChange({ ...node, kind: event.target.value })}>
      <option value="anyOf">Any one of these alternatives</option><option value="allOf">All of these conditions</option>
    </select>
    {node.children.map((child, index) => <Condition key={index} node={child} depth={depth + 1} disabled={disabled} onChange={updated => onChange({ ...node, children: node.children.map((item, position) => position === index ? updated : item) })} />)}
  </fieldset>;
}
function PdfEvidenceLocations({ excerpt, snapshot }) {
  if (!excerpt.pdfSpans) return null;
  return <details data-candidate-pdf-spans><summary>Exact PDF source ({excerpt.pdfSpans.length} {excerpt.pdfSpans.length === 1 ? 'span' : 'spans'})</summary>
    {excerpt.pdfSpans.map((span, index) => <blockquote key={index}>Page {span.page}, item {span.item}, characters {span.start}–{span.end}: {snapshot.artifact.pages[span.page - 1].items[span.item].str.slice(span.start, span.end)}</blockquote>)}
  </details>;
}
function References({ ids, snapshot }) {
  return <div className="rws-candidate-references">{ids.map(id => <details key={id}><summary>Evidence: {id}</summary>
    <blockquote>{snapshot.evidence.find(item => item.id === id)?.text}</blockquote>
    <PdfEvidenceLocations excerpt={snapshot.evidence.find(item => item.id === id)} snapshot={snapshot} />
  </details>)}</div>;
}
function ContextReferences({ challenge, snapshot }) {
  if (!challenge.contextEvidence?.length) return null;
  return <details data-candidate-context><summary>Additional context — not decision-bearing</summary>
    <p>The model classified these additional sources as context. Their relevance is not independently verified; source uncertainty remains visible below.</p>
    {challenge.contextEvidence.map(item => <div key={item.id}><p>{item.reason}</p><References ids={[item.id]} snapshot={snapshot} /></div>)}
  </details>;
}
function PdfStructureReview({ snapshot }) {
  const audit = snapshot.artifact.structure;
  if (!audit) return null;
  return <section data-candidate-structure>
    <h3>Authored PDF structure: {audit.status}</h3>
    <p>{audit.reason}</p>
    <p>This compares a checked export with its authored fields. A row-order probe is not a column-aware reader or a vendor ATS. Unknowns remain unresolved.</p>
    {[['native', 'PDF content order'], ['rows', 'Top-to-bottom row probe']].map(([key, label]) => audit[key] && <details key={key}>
      <summary>{label}: associations {audit[key].association}; entry order {audit[key].order}</summary>
      <p>{audit[key].locatedFields} / {audit[key].totalFields} fields uniquely located.</p>
      {audit[key].entries.map(entry => <article key={entry.id} className="resume-finding rws-candidate-card"><h4>{entry.label} <small>{entry.state}</small></h4><p>{entry.reason}</p></article>)}
      <details><summary>Exact PDF field locations</summary>{audit[key].fields.map(field => <div key={field.id}>
        <p><strong>{field.label} ({field.id}): {field.state}</strong>{field.reason && ' - ' + field.reason}</p>
        {field.spans.map((span, index) => <blockquote key={index}>Page {span.page}, item {span.item}, characters {span.start}–{span.end}: {snapshot.artifact.pages[span.page - 1].items[span.item].str.slice(span.start, span.end)}</blockquote>)}
      </div>)}</details>
    </details>)}
  </section>;
}

function PdfOrderReview({ snapshot }) {
  const audit = snapshot.artifact.readingOrder;
  if (!audit) return null;
  return <section data-candidate-pdf-order>
    <h3>PDF reading-order probes: {audit.status}</h3>
    <p>{audit.reason}</p>
    <p>No alternative order has been selected or used to assign employers. Distant horizontal text runs remain separate in candidate evidence; the original file is unchanged.</p>
    {audit.pages.map(page => <details key={page.page}>
      <summary>Page {page.page}: {page.status}</summary>
      {page.reasons.map(reason => <p key={reason}>{reason}</p>)}
      {page.gutter && <p>Possible gutter at {page.gutter.x.toFixed(1)} PDF points; supported by {page.gutter.supportRows} rows. This may also be aligned dates or a table.</p>}
      {[['native', 'PDF content order'], ['rows', 'Top-to-bottom row probe'], ['columns', 'Possible two-region order — not selected']].map(([key, label]) => page.orders[key] && <details key={key}>
        <summary>{label}</summary>
        {page.orders[key].map(index => {
          const item = snapshot.artifact.pages[page.page - 1].items[index];
          return <blockquote key={index}>Page {page.page}, item {index}, characters 0–{item.str.length}: {item.str}</blockquote>;
        })}
      </details>)}
    </details>)}
  </section>;
}

function SemanticReview({ interpretation, snapshot }) {
  if (!interpretation) return null;
  return <section data-candidate-semantics>
    <h3>Source relationships and JD interpretation</h3>
    <p>Model-challenged, not independently verified. Unresolved source relationships withhold affected judgments; unresolved JD interpretation withholds role judgments.</p>
    {interpretation.groups.length === 0 && <p>No experience groups were established. This is not proof that the resume contains no work history.</p>}
    {interpretation.groups.map(group => <article key={group.id} className="resume-finding rws-candidate-card" data-candidate-group={group.id}>
      <h4>Proposed: {group.role?.quote || 'Role not established'} / {group.employer?.quote || 'Employer not established'} <small>{words(group.state)}</small></h4>
      <p>{group.reason}</p><p>Challenge: {group.challengeReason}</p>
      <p>Dates: {group.dates?.quote || 'Not established'}</p>
      {[group.role, group.employer, group.dates, ...group.achievements].filter(Boolean).map((reference, index) => <div key={index}>
        <blockquote>{reference.quote}</blockquote><p>{reference.id}, source characters {reference.start}–{reference.end}</p>
        <References ids={[reference.id]} snapshot={snapshot} />
      </div>)}
    </article>)}
    <details><summary>Every included excerpt: classification and attribution</summary>
      {interpretation.excerpts.map(excerpt => <article key={excerpt.id} className="resume-finding rws-candidate-card">
        <h4>{excerpt.id} — {excerpt.kind} <small>{words(excerpt.state)}</small></h4>
        <p>{excerpt.reason}</p><p>Challenge: {excerpt.challengeReason}</p>
        {excerpt.unmappedText && <p>Unmapped experience text: {excerpt.unmappedText}</p>}
        <References ids={[excerpt.id]} snapshot={snapshot} />
      </article>)}
    </details>
    <details><summary>Every JD segment: semantic completeness challenge</summary>
      {interpretation.segments.map(segment => <article key={segment.id} className="resume-finding rws-candidate-card">
        <h4>{segment.id} <small>{words(segment.state)}</small></h4>
        <blockquote>{snapshot.jobSegments.find(item => item.id === segment.id).text}</blockquote><p>{segment.reason}</p>
      </article>)}
      {!interpretation.segments.length && <p>General review: no job description was supplied.</p>}
    </details>
  </section>;
}

function CandidateFindings({ presentation, snapshot }) {
  return <section data-candidate-findings><h3>Prioritized next actions</h3>
    <p>Derived from this assessment, not another score or a new AI opinion. Clarification comes before rewriting; already-supported conditions do not need extra evidence just to satisfy an unused alternative.</p>
    {!presentation.findings.length && <p>No actionable finding was derived. This is not a clean bill of health or proof that no improvement is possible.</p>}
    {presentation.findings.map(finding => <article className="resume-finding rws-candidate-card" key={finding.id} data-candidate-finding={finding.id}>
      <h4>{finding.title} <small>{finding.action.kind === 'no-change-needed' ? 'No change needed' : 'Priority ' + finding.priority}</small></h4>
      <p>{finding.priorityReason}</p>
      {finding.gaps.map(gap => <p key={gap}>{gap}</p>)}
      <p><strong>Next action:</strong> {finding.action.label}</p><p>{finding.expectedBenefit}</p>
      <References ids={finding.evidenceIds} snapshot={snapshot} />
      <details><summary>Finding references and field locations</summary>
        <p>Finding: {finding.id}</p>
        {Object.entries(finding.references).filter(([, ids]) => ids.length).map(([kind, ids]) => <p key={kind}>{words(kind)}: {ids.join(', ')}</p>)}
        <p>{finding.affectedFieldIds.length ? 'Overlapping checked-PDF fields: ' + finding.affectedFieldIds.join(', ') + '. Review the field before editing; this is not an approved Apply target.'
          : 'No editor field is established for this finding. Original-file evidence is not silently mapped to the current canvas.'}</p>
      </details>
    </article>)}
    <p>These findings do not change the resume or trigger a paid recheck. Checked revisions are available only for an explicitly selected field in a current checked PDF.</p>
  </section>;
}
function CandidateResult({ result, snapshot }) {
  const [ready, setReady] = useState(null), [failure, setFailure] = useState(null);
  useEffect(() => {
    let current = true; setReady(null); setFailure(null);
    createAssessmentPresentation(result, snapshot).then(presentation => {
      if (current) setReady({ input: result, snapshot, presentation });
    }, error => { if (current) setFailure({ input: result, snapshot, message: error.message }); });
    return () => { current = false; };
  }, [result, snapshot]);
  if (failure?.input === result && failure.snapshot === snapshot) return <p role="alert">Assessment presentation could not be validated: {failure.message}</p>;
  if (ready?.input !== result || ready.snapshot !== snapshot) return <p role="status">Validating the complete assessment for display...</p>;
  return <CandidateReport presentation={ready.presentation} snapshot={snapshot} />;
}
function CandidateReport({ presentation, snapshot }) {
  const result = presentation.assessment, summary = presentation.summary;
  const report = result.report, role = report.dimensions.roleEvidence;
  return <section data-candidate-result className="rws-candidate-result">
    <h3>Assessment: {words(report.status)}</h3>
    <p>No headline score is available. Evidence relevance and document associations are not independently verified.</p>
    <article className="resume-finding rws-candidate-card" data-candidate-summary>
      <h4>{snapshot.target.mode === 'general' ? 'General resume review' : [snapshot.target.role, snapshot.target.company].filter(Boolean).join(' / ') || 'Job-specific review'}</h4>
      <p>Document: {summary.artifact.failed} failed observations; {summary.artifact.risks} risk observations; {summary.artifact.unresolved} unresolved observations. These are not vendor pass/fail counts.</p>
      <p>{summary.role.applicable ? `Role evidence: ${summary.role.supported} of ${summary.role.total} approved compound criteria supported; ${summary.role.unresolved} unresolved. Counts are not a score.`
        : 'Role evidence: not applicable in general mode.'}</p>
      <p>Communication: {summary.communication.unresolved} of 3 judgments unavailable.</p>
      <p>Input coverage: {summary.coverage.includedExcerpts} included excerpts; {summary.coverage.excludedExcerpts} excluded. {summary.coverage.accountedSegments} of {summary.coverage.totalSegments} JD segments accounted for. Accounting does not establish semantic completeness.</p>
      <p><strong>Start here:</strong> {summary.nextFindingId ? presentation.findings.find(item => item.id === summary.nextFindingId).title : 'Review the evidence and limitations; no change is automatically required.'}</p>
      <details><summary>Assessment identity</summary><p>{report.id}</p><p>Artifact SHA-256: <code>{report.binding.artifactSha256}</code></p>
        <p>Method: {report.method.id}, version {report.method.version}; presentation version {presentation.version}.</p></details>
    </article>
    {role.requiredGaps.length > 0 && <p className="rws-inline-warning"><strong>{role.requiredGaps.length} required {role.requiredGaps.length === 1 ? 'criterion is' : 'criteria are'} not fully supported.</strong> Review the evidence and unresolved judgments below.</p>}
    {result.challenge.inventoryIssues.map((issue, index) => <p className="rws-inline-warning" key={index}>Inventory needs review: {issue.reason}</p>)}
    {result.interpretation && (result.interpretation.excerpts.some(item => item.state === 'unknown') || result.interpretation.segments.some(item => item.state === 'unknown')) &&
      <p className="rws-inline-warning">Source or JD interpretation is unresolved. Affected judgments have been withheld rather than treated as settled.</p>}
    <CandidateFindings presentation={presentation} snapshot={snapshot} />
    <h3>Document readability</h3>
    <p>These are observations about the selected artifact, not a vendor ATS pass.</p>
    {report.dimensions.artifact.observations.map(item => <article className="resume-finding rws-candidate-card" key={item.id}>
      <h4>{words(item.id)} <small>{words(item.status)}</small></h4><p>{item.reason}</p>
    </article>)}
    <PdfStructureReview snapshot={snapshot} />
    <PdfOrderReview snapshot={snapshot} />
    <SemanticReview interpretation={result.interpretation} snapshot={snapshot} />
    <h3>Role evidence</h3>
    <JobSourceReview manifest={report.requirements} snapshot={snapshot} />
    {role.status === 'not-applicable' && <p>No job match is inferred in general mode.</p>}
    {role.requirements.map(item => {
      const requirement = report.requirements.requirements.find(entry => entry.id === item.id);
      return <article className="resume-finding rws-candidate-card" key={item.id}>
        <h4>{requirement.label} <small>{words(item.state)}</small></h4><p>{words(item.importance)}</p>
        {conditionAtoms(requirement.condition).map(({ id }) => {
          const rating = role.ratings.find(entry => entry.id === id), draft = result.draft.ratings.find(entry => entry.id === id), challenge = result.challenge.ratings.find(entry => entry.id === id);
          return <div key={id}><p><strong>{id}: {words(rating.state)}</strong> — {rating.reason}</p>
            <References ids={rating.evidence} snapshot={snapshot} />
            <details><summary>Assessment and challenge</summary><p>First pass: {words(draft.state)}. {draft.reason}</p>
              <References ids={draft.evidence} snapshot={snapshot} /><p>Challenge: {challenge.verdict}. {challenge.reason}</p><References ids={challenge.evidence} snapshot={snapshot} />
              <ContextReferences challenge={challenge} snapshot={snapshot} /></details>
          </div>;
        })}
      </article>;
    })}
    <h3>Communication</h3>
    {report.dimensions.communication.ratings.map(item => <article className="resume-finding rws-candidate-card" key={item.id}>
      <h4>{words(item.id)} <small>{item.rating === null ? 'Unknown' : item.rating + ' / 4 — model judgment'}</small></h4>
      <p>{item.reason}</p><References ids={item.evidence} snapshot={snapshot} />
      <details><summary>Assessment and challenge</summary><p>{result.draft.communication.find(entry => entry.id === item.id).reason}</p>
        <p>{result.challenge.communication.find(entry => entry.id === item.id).reason}</p>
        <ContextReferences challenge={result.challenge.communication.find(entry => entry.id === item.id)} snapshot={snapshot} /></details>
    </article>)}
    <details><summary>Approved evidence and exclusions</summary>
      <p>{result.selection.includedIds.length} included excerpts; {result.selection.excluded.length} author-reviewed exclusions.</p>
      <References ids={result.selection.includedIds} snapshot={snapshot} />
    </details>
    <details><summary>Method, limitations and execution receipts</summary>
      {presentation.limitations.map(limit => <p key={limit}>{limit}</p>)}
      {result.limitations.map((limit, index) => <p key={index}>{limit}</p>)}
      {result.execution.map(entry => <p key={entry.requestId}>{entry.stage}: {entry.provider} / {entry.model}<br />Request: {entry.requestId}<br />
        {entry.usage ? `${entry.usage.inputTokens} input / ${entry.usage.outputTokens} output tokens` : 'Token usage unknown'}</p>)}
    </details>
  </section>;
}

function CandidateRevision({ assessment, snapshot, pilot, document, getRecord, value, run, loading, stale, applyRevision }) {
  const [view, setView] = useState(null), [validationError, setValidationError] = useState('');
  const [findingId, setFinding] = useState(''), [fieldId, setField] = useState(''), [author, setAuthor] = useState(''), [authorConfirmed, setAuthorConfirmed] = useState(false);
  const [consent, setConsent] = useState(false), [accepted, setAccepted] = useState(false), [savedId, setSavedId] = useState('');
  useEffect(() => {
    let active = true; setView(null); setValidationError('');
    createAssessmentPresentation(assessment, snapshot).then(result => { if (active) setView(result); }, error => { if (active) setValidationError(error.message); });
    return () => { active = false; };
  }, [assessment, snapshot]);
  useEffect(() => {
    setAccepted(false); setConsent(false);
    if (value) { setFinding(value.context.findingId); setField(value.context.fieldId); setAuthor(value.context.authorEvidence?.text || ''); setAuthorConfirmed(!!value.context.authorEvidence); }
  }, [value?.id]);
  const resetConsent = () => { setConsent(false); setAccepted(false); };
  const matching = value && value.context.findingId === findingId && value.context.fieldId === fieldId &&
    (value.context.authorEvidence?.text || '') === author && !!value.context.authorEvidence === authorConfirmed;
  let history;
  try { history = pilot.revisionHistory().filter(item => item.assessmentId === assessment.report.id); }
  catch (failure) { return <p role="alert">Revision history could not be read: {failure.message}</p>; }
  if (validationError) return <p role="alert">Revision preparation failed: {validationError}</p>;
  if (!view) return <p role="status">Validating revision context...</p>;
  const findings = view.findings.filter(item => ['role', 'communication'].includes(item.category) && item.action.kind !== 'no-change-needed');
  const ids = assessmentFieldLocations(snapshot, assessment.selection.includedIds);
  const fields = resumeFields(document.model).filter(item => ids.includes(item.id) && (item.label === 'Achievement' || item.id === 'summary' || item.id.endsWith('.text')));
  const disabled = !!loading || stale;
  return <section data-candidate-revision><h3>Review a claim-safe revision</h3>
    <p>Explicitly select the finding and field. The model may ask a question or recommend no change instead. Every proposed claim and the whole replacement are challenged; model agreement is not independent verification.</p>
    <label className="rws-field"><span>Revision finding</span><select aria-label="Revision finding" value={findingId} disabled={disabled} onChange={event => { setFinding(event.target.value); resetConsent(); }}>
      <option value="">Choose a finding</option>{findings.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <label className="rws-field"><span>Revision field</span><select aria-label="Revision field" value={fieldId} disabled={disabled} onChange={event => { setField(event.target.value); resetConsent(); }}>
      <option value="">Choose a uniquely located field</option>{fields.map(item => <option key={item.id} value={item.id}>{item.label}: {item.value.slice(0, 80)}</option>)}</select></label>
    {fieldId && <blockquote>{fields.find(item => item.id === fieldId)?.value}</blockquote>}
    <details><summary>Additional author-provided evidence</summary><p>Optional, up to 8,000 characters. Oversized input is blocked, not truncated. Confirm only facts you can stand behind. They are not independent verification or evidence already in the submitted resume.</p>
      <label className="rws-field"><span>Author-provided facts</span><textarea aria-label="Author-provided facts" value={author} disabled={disabled} onChange={event => { setAuthor(event.target.value); setAuthorConfirmed(false); resetConsent(); }} /></label>
      {author.length > 8000 && <p role="alert">Author evidence exceeds 8,000 characters. Shorten it explicitly before requesting a revision.</p>}
      <label className="chk"><input type="checkbox" checked={authorConfirmed} disabled={disabled || !author.trim()} onChange={event => { setAuthorConfirmed(event.target.checked); resetConsent(); }} />I confirm these facts as author-provided evidence.</label>
    </details>
    <p>Two additional calls: revision plus claim challenge, reserved together against the same approved pilot budget. Failures remain reserved; there is no automatic retry or refund.</p>
    <label className="chk"><input type="checkbox" checked={consent} disabled={disabled} onChange={event => setConsent(event.target.checked)} />Allow the selected field, approved evidence and any confirmed author facts to be sent for both revision calls.</label>
    <button className="btn btn--primary" disabled={disabled || !findingId || !fieldId || !consent || author.length > 8000 || !!author.trim() && !authorConfirmed}
      onClick={() => run('Preparing and challenging revision', () => {
        const { document, version } = structuredClone(getRecord());
        return pilot.proposeRevision({ confirmed: true, document, version, findingId, fieldId, authorEvidence: author.trim() ? { text: author, confirmed: authorConfirmed } : null });
      }, resetConsent)}>Prepare checked revision</button>
    {matching && <article className="resume-finding rws-candidate-card" data-candidate-revision-result>
      <h4>{words(value.interpretation.status)}</h4><p>{value.draft.reason}</p><p>Challenge: {value.challenge.reason}</p>
      {value.draft.kind === 'question' && <p><strong>{value.draft.question}</strong> Add an answer above only if you can support it, then explicitly request another review.</p>}
      {value.draft.kind === 'supported' && <p>No change was proposed. The earlier assessment is preserved; this decision does not rescore it.</p>}
      {value.draft.kind === 'revision' && <><h4>Original</h4><blockquote>{value.context.before}</blockquote><h4>Proposed</h4><blockquote>{value.draft.after}</blockquote>
        {value.interpretation.claims.map(claim => <details key={claim.id}><summary>Claim: {claim.quote}</summary>
          {claim.evidence.map((reference, index) => <div key={index}><p>{reference.id}: {words(reference.source)}; characters {reference.start}–{reference.end}</p><blockquote>{reference.quote}</blockquote></div>)}
          <p>{value.challenge.claims.find(item => item.id === claim.id).reason}</p></details>)}
        {value.interpretation.status === 'review-required' && <>
          <label className="chk"><input type="checkbox" checked={accepted} disabled={disabled} onChange={event => setAccepted(event.target.checked)} />I reviewed the original, proposed wording and every claim. Apply this change with a before-change checkpoint.</label>
          <button className="btn btn--primary" disabled={disabled || !accepted} onClick={() => run('Applying reviewed revision',
            signal => applyRevision({ revision: value, snapshot, assessment, signal }), () => setAccepted(false))}>Apply reviewed revision</button>
        </>}
      </>}
      {value.interpretation.blockers.map((reason, index) => <p key={index} className="rws-inline-warning">{reason}</p>)}
      <p>No ATS point gain is predicted. Apply does not run an assessment; the earlier result becomes historical.</p>
    </article>}
    {!!history.length && <details><summary>Saved candidate revisions and questions</summary>
      <label className="rws-field"><span>Saved revision</span><select aria-label="Saved revision" value={savedId} disabled={disabled} onChange={event => setSavedId(event.target.value)}>
        <option value="">Choose a revision receipt</option>{history.map(item => <option value={item.id} key={item.id}>{words(item.status)} / {item.id}</option>)}</select></label>
      <button className="btn btn--ghost" disabled={disabled || !savedId} onClick={() => run('Validating saved revision', () => {
        const { document, version } = structuredClone(getRecord()); return pilot.restoreRevision(savedId, { document, version });
      }, resetConsent)}>Open saved revision</button>
    </details>}
  </section>;
}

function CandidateComparison({ value, baseline, result, snapshot }) {
  const [checked, setChecked] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true; setChecked(null); setError('');
    validateAssessmentComparison(value, baseline.result, baseline.snapshot, result, snapshot)
      .then(comparison => { if (active) setChecked(comparison); }, failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [value, baseline, result, snapshot]);
  if (error) return <p className="rws-inline-warning" role="alert">Comparison withheld: {error}</p>;
  if (!checked) return <p role="status">Validating both assessments and their comparison...</p>;
  return <section data-candidate-comparison>
    <h3>{checked.comparable ? 'Before / after recheck' : 'These assessments are not comparable'}</h3>
    <p>Baseline: {checked.beforeId}<br />Recheck: {checked.afterId}</p>
    {checked.reasons.map(reason => <p key={reason} className="rws-inline-warning">{reason}</p>)}
    {checked.comparable && <p>Improved: {checked.counts.improved}; worsened: {checked.counts.worsened}; unchanged: {checked.counts.unchanged}; unresolved: {checked.counts.unresolved}; other changes: {checked.counts.changed}. These are observation counts, not a score.</p>}
    <p>PDF bytes: {checked.artifactChanged ? 'changed' : 'unchanged'}. Recovered text: {checked.textChanged ? 'changed' : 'unchanged'}.</p>
    <p>Authored document: {checked.documentChanged ? 'changed' : 'unchanged'}. Saved version: {checked.versionChanged ? 'changed' : 'unchanged'}.</p>
    {checked.rows.map(row => <details className="resume-finding rws-candidate-card" key={row.id} data-candidate-transition={row.id}>
      <summary>{row.label}: {words(row.direction)}</summary>
      {['before', 'after'].map(side => <div key={side} data-candidate-comparison-side={side}>
        <h4>{side === 'before' ? 'Before' : 'After'}: {row[side].state === null ? 'Unknown' : words(row[side].state)}</h4>
        {row[side].reasons.map((reason, index) => <p key={index}>{reason}</p>)}
        <References ids={row[side].evidence} snapshot={side === 'before' ? baseline.snapshot : snapshot} />
      </div>)}
    </details>)}
    {checked.limitations.map(limit => <p key={limit}>{limit}</p>)}
  </section>;
}

function PrivateAssessmentHistory({ service, run, loading, onRecheck, canRecheck }) {
  const [items, setItems] = useState([]), [cursor, setCursor] = useState(null), [selected, setSelected] = useState(''), [saved, setSaved] = useState(null);
  const list = next => run('Loading private history - no AI call', signal => service.list(next, signal), value => {
    setItems(previous => next ? [...previous, ...value.items.filter(item => !previous.some(prior => prior.id === item.id))] : value.items); setCursor(value.cursor);
  });
  return <details data-candidate-private-history><summary>Private cross-device assessment history</summary>
    <p>Reading saved history makes no AI call and never replaces the open document. Historical revisions are read-only; saving originals requires separate consent.</p>
    <button className="btn btn--ghost" disabled={!!loading} onClick={() => list(null)}>Load private history</button>
    {cursor && <button className="btn btn--ghost" disabled={!!loading} onClick={() => list(cursor)}>Load more private history</button>}
    {items.length > 0 && <>
      <label className="rws-field"><span>Private assessment</span><select aria-label="Private assessment" value={selected} disabled={!!loading} onChange={event => setSelected(event.target.value)}>
        <option value="">Choose saved history</option>{items.map(item => <option key={item.id} value={item.id}>{item.label} / {item.id}</option>)}
      </select></label>
      <button className="btn btn--ghost" disabled={!!loading || !selected} onClick={() => run('Restoring exact private history - no AI call', async signal => {
        const value = structuredClone(await service.read(selected, signal));
        let baseline = null;
        if (value.baseline) baseline = { snapshot: await captureAssessmentInput(value.baseline.input), result: value.baseline.record.result };
        const validated = await validateAssessmentHistory(value.record, value.input.bytes, baseline);
        return { ...value, snapshot: validated.snapshot, baseline };
      }, setSaved)}>Open private assessment</button>
    </>}
    {saved && <section data-candidate-restored-history>
      <h3>{saved.record.label} - saved history</h3>
      <p>{saved.receiptStatus === 'server-receipted-not-independent-truth' ? 'Assessment and revision responses match server request/output receipts; not independent factual verification. Inventory approvals and diagnostics remain client-reported.' : 'Owner-imported history: provider output is not attested by the server.'}</p>
      <p>Stored extraction is restored with its original bytes and method. This is not a new independent extraction or current-document assessment.</p>
      <button className="btn btn--ghost" onClick={() => {
        const url = URL.createObjectURL(new Blob([saved.input.bytes], { type: saved.input.mediaType }));
        const anchor = document.createElement('a'); anchor.href = url;
        anchor.download = 'assessment-original.' + (saved.input.mediaType === 'application/pdf' ? 'pdf' : saved.input.mediaType === 'text/plain' ? 'txt' : 'docx');
        anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Download stored original</button>
      <CandidateResult result={saved.record.result} snapshot={saved.snapshot} />
      {saved.record.comparison && <CandidateComparison value={saved.record.comparison} baseline={saved.baseline} result={saved.record.result} snapshot={saved.snapshot} />}
      <details><summary>Saved revisions and diagnostic receipts ({saved.record.revisions.length})</summary>
        {saved.record.revisions.map(revision => <article key={revision.id}><h4>{revision.id}: {words(revision.interpretation.status)}</h4>
          <p>{revision.draft.after || revision.draft.question || revision.draft.reason}</p><pre>{JSON.stringify(revision, null, 2)}</pre></article>)}
        <p>Failure diagnostics are client-reported, not independent provider outcomes.</p><pre>{JSON.stringify(saved.record.failures, null, 2)}</pre>
      </details>
      {canRecheck && saved.input.kind === 'export' && <button className="btn btn--ghost" disabled={!!loading} onClick={() => onRecheck({
        snapshot: saved.snapshot, result: saved.record.result, capturedInput: saved.input, label: saved.record.label,
        archiveId: saved.record.id, archiveEtag: saved.etag
      })}>Use saved baseline for explicit recheck</button>}
    </section>}
  </details>;
}

export function ResumeCandidateReview({ open, Dialog, onClose, document, version, sources = [], getRecord, readSource, prepareExport, applyRevision, connection, target = document?.target, externalInput }) {
  const latest = useRef(null); latest.current = { getRecord, sources, target, externalInput };
  const pilotRef = useRef(null), abortRef = useRef(null), epoch = useRef(0), active = useRef(false);
  const [bundle, setBundle] = useState(null), [state, setState] = useState(null), [loading, setLoading] = useState(''), [error, setError] = useState('');
  const [example, setExample] = useState('dev-alternatives'), [sourceId, setSourceId] = useState(''), [context, setContext] = useState(null);
  const [catalog, setCatalog] = useState(null), [model, setModel] = useState(''), [budget, setBudget] = useState(''), [budgetConsent, setBudgetConsent] = useState(false);
  const [budgetScope, setBudgetScope] = useState('server');
  const [inventoryText, setInventoryText] = useState(''), [inventoryConsent, setInventoryConsent] = useState(false), [sendConsent, setSendConsent] = useState(false);
  const [exclusions, setExclusions] = useState({}), [evidenceConsent, setEvidenceConsent] = useState(false);
  const [history, setHistory] = useState([]), [historyId, setHistoryId] = useState('');
  const [recheck, setRecheck] = useState(null);
  const [retentionConsent, setRetentionConsent] = useState(false), [archiveAcks, setArchiveAcks] = useState({});
  const selectedInput = bundle || context;
  const stale = selectedInput?.mode === 'upload'
    ? !externalInput && selectedInput.targetSignature !== JSON.stringify(target)
    : ['source', 'export'].includes(selectedInput?.mode) && (selectedInput.snapshot.binding.documentSignature !== resumeSignature(document) ||
      selectedInput.snapshot.binding.documentVersion !== version || (selectedInput.mode === 'source' && !sources.some(source => source.id === selectedInput.sourceId)));
  function stop() {
    epoch.current++; active.current = false; abortRef.current?.abort(); pilotRef.current?.cancel();
    setLoading(''); if (pilotRef.current) setState(structuredClone(pilotRef.current.state()));
  }
  useEffect(() => { if (!open) stop(); }, [open]);
  const applyingRevision = loading === 'Applying reviewed revision';
  useEffect(() => { if (stale && !applyingRevision) { stop(); setError('The document, saved version or attached source changed. This result is historical. Start a new pilot before sending more data.'); } }, [stale, applyingRevision]);
  useEffect(() => () => { epoch.current++; abortRef.current?.abort(); pilotRef.current?.cancel(); }, []);
  async function run(label, action, done = () => {}) {
    if (active.current) { setError('Another candidate operation is still running.'); return; }
    const current = ++epoch.current; active.current = true;
    if (!abortRef.current || abortRef.current.signal.aborted) abortRef.current = new AbortController();
    setLoading(label); setError('');
    try {
      const value = await action(abortRef.current.signal);
      if (current !== epoch.current) { value?.pilot?.cancel(); return; }
      done(value); if (pilotRef.current) { setState(structuredClone(pilotRef.current.state())); setHistory(pilotRef.current.history()); }
    } catch (failure) { if (current === epoch.current) { setError(failure.message); if (pilotRef.current) setState(structuredClone(pilotRef.current.state())); } }
    finally { if (current === epoch.current) { active.current = false; setLoading(''); } }
  }
  function install(value) {
    pilotRef.current = value.pilot; setBundle(value); setState(structuredClone(value.pilot.state())); setContext(null);
    setInventoryText(''); setInventoryConsent(false); setSendConsent(false); setExclusions({}); setEvidenceConsent(false); setHistoryId(''); setRetentionConsent(false);
  }
  function reset() {
    stop(); pilotRef.current = null; setBundle(null); setState(null); setContext(null); setCatalog(null); setBudgetConsent(false); setHistory([]); setError(''); setRecheck(null);
  }
  async function prepare(input, signal, label) {
    input = structuredClone(input);
    const extraction = await extractAssessmentArtifact(input.bytes, input.mediaType, { signal, ...(input.kind === 'export' ? { document: input.document } : {}) });
    const getInput = async () => {
      if (latest.current.externalInput) return { ...await latest.current.externalInput.read(signal), extraction };
      if (input.kind === 'upload') return { ...input, extraction, target: latest.current.target };
      const { document, version } = latest.current.getRecord();
      return { ...input, extraction, document, version,
        ...(input.kind === 'source' ? { source: latest.current.sources.find(item => item.id === input.source.id) } : {}) };
    };
    const capturedInput = structuredClone({ ...input, extraction });
    const snapshot = await captureAssessmentInput(capturedInput); signal.throwIfAborted();
    const current = await captureAssessmentInput(await getInput()); signal.throwIfAborted();
    if (snapshot.fingerprint !== current.fingerprint) throw new Error('The artifact or target changed while preparing. Start again.');
    return { snapshot, capturedInput, getInput, mode: input.kind, sourceId: input.source?.id, targetSignature: JSON.stringify(input.target), label };
  }
  function prepareRecheck(anchor) {
    stop(); pilotRef.current = null; setBundle(null); setState(null); setContext(null); setCatalog(null); setBudgetConsent(false); setHistory([]); setRecheck(anchor);
    if (anchor.archiveId) setBudgetScope('server');
    run('Preparing edited PDF for explicit recheck', async signal => {
      const value = await prepareCheckedExport(signal, 'Recheck of current checked PDF');
      if (value.snapshot.binding.documentId !== anchor.snapshot.binding.documentId ||
          value.snapshot.binding.targetSha256 !== anchor.snapshot.binding.targetSha256) throw new Error('The document identity or target changed. Start a separate assessment; this is not a comparable recheck.');
      return value;
    }, setContext);
  }
  async function prepareCheckedExport(signal, label) {
    const input = await prepareExport(signal);
    return prepare({ ...input, kind: 'export', mediaType: 'application/pdf' }, signal, label || input.entry.name);
  }
  async function savePrivateHistory(signal) {
    if (!retentionConsent) throw new Error('Confirm complete original-file and history retention first.');
    const acknowledgements = { ...archiveAcks };
    async function retainBaseline(anchor) {
      if (anchor.archiveId && !anchor.history) return;
      if (!anchor.history) throw new Error('The baseline receipts are unavailable. Save its original history before this pair.');
      if (anchor.baseline) await retainBaseline(anchor.baseline);
      const saved = await connection.history.save({ ...anchor.history, input: anchor.capturedInput, label: anchor.label,
        confirmed: true, expected: acknowledgements[anchor.result.report.id] || anchor.archiveEtag || '*',
        baseline: anchor.baseline ? { input: anchor.baseline.capturedInput, result: anchor.baseline.result, comparison: anchor.comparison } : null }, signal);
      acknowledgements[saved.record.id] = saved.etag;
    }
    if (recheck) await retainBaseline(recheck);
    const saved = await connection.history.save({ ...bundle.pilot.historyData(state.result.report.id), input: bundle.capturedInput, label: bundle.label,
      confirmed: true, expected: acknowledgements[state.result.report.id] || '*',
      baseline: recheck ? { input: recheck.capturedInput, result: recheck.result, comparison: state.comparison } : null }, signal);
    acknowledgements[saved.record.id] = saved.etag;
    return acknowledgements;
  }
  const inputDescription = mode => mode === 'upload' ? 'UPLOADED ORIGINAL ONLY - no editor content or attached supporting sources. This file is not automatically attached or saved.'
    : mode === 'export' ? 'CURRENT CHECKED PDF - actual generated PDF bytes, freshly extracted and verified. No original file is replaced.'
    : 'ATTACHED ORIGINAL ONLY - freshly extracted from its bytes, not the edited canvas or cached source text.';
  const selectedModel = catalog?.models.find(item => item.id === model);
  let estimate = null, estimateError = '';
  if (selectedModel && context) {
    try {
      const pricing = { ...selectedModel.pricing, checkedAt: catalog.checkedAt };
      const cost = stage => resumeCompletionReservation({ stage, system: '', user: '', maxTokens: RESUME_COMPLETION_LIMITS[stage] }, pricing).maximumAmount;
      estimate = { inventory: recheck || context.snapshot.target.mode === 'general' ? 0 : cost('requirements'), evaluation: cost('assessment') + cost('challenge') };
    } catch (failure) { estimateError = failure.message; }
  }
  let manifest = null, manifestError = '';
  if (inventoryText && bundle) {
    try { manifest = validateAssessmentManifest(JSON.parse(inventoryText), bundle.snapshot); }
    catch (failure) { manifestError = failure.message; }
  }
  const editManifest = value => { setInventoryText(JSON.stringify(value, null, 2)); setInventoryConsent(false); };
  const step = !bundle ? 0 : ['complete', 'historical'].includes(state?.phase) ? 3 : ['evidence-review', 'assessment-ready'].includes(state?.phase) ? 2 : 1;
  const close = () => { stop(); onClose(); };
  if (!open) return null;
  return <Dialog wide title="Candidate assessment" onClose={close} actions={<>
    <button className="btn btn--ghost" onClick={close}>{loading ? 'Cancel and close' : 'Close'}</button>
    {(bundle || context || recheck) && <button className="btn btn--ghost" disabled={!!loading} onClick={reset}>Start over</button>}
  </>}>
    <div className="rws-candidate" data-candidate-root data-candidate-mode={bundle?.mode || context?.mode || 'setup'} data-candidate-phase={state?.phase || 'setup'} aria-busy={!!loading}>
      <p className="pass__sub">LOCAL CANDIDATE · The current ATS score and document are unchanged.</p>
      <ol className="rws-candidate-steps" aria-label="Candidate assessment steps">{['Choose input', 'Review job inventory', 'Approve evidence', 'Read assessment'].map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}>{label}</li>)}</ol>
      {error && <p className="rws-inline-warning" role="alert">{error}</p>}
      {loading && <p role="status">{loading}… <button className="rws-text-button" onClick={() => { stop(); setError('Cancelled. A sent request may still be billed; reservations are not refunded.'); }}>Cancel operation</button></p>}
      {connection?.history && <PrivateAssessmentHistory service={connection.history} run={run} loading={loading} onRecheck={prepareRecheck} canRecheck={!!prepareExport} />}
      {recheck && <section data-candidate-recheck-baseline>
        <h3>Frozen baseline for this recheck</h3>
        <p>The same complete job inventory, priorities and compound conditions will be reused. Review the newly extracted evidence separately. A different target, model or inventory requires Start over, not an improvement claim.</p>
        <p>Baseline model: {recheck.result.execution[0].provider} / {recheck.result.execution[0].model}. {recheck.archiveId ? 'Restored from private history with its exact original input.' : 'Not yet durably retained; save the pair with explicit original-file retention consent for later restoration.'}</p>
        <details><summary>Original approved inventory - read only</summary>
          <JobSourceReview manifest={recheck.result.approval.manifest} snapshot={recheck.snapshot} />
          {recheck.result.approval.manifest.requirements.map(requirement => <article key={requirement.id}>
            <h4>{requirement.label}: {words(requirement.importance)}</h4><Condition node={requirement.condition} disabled />
          </article>)}
        </details>
        <details><summary>Baseline assessment and evidence</summary><CandidateResult result={recheck.result} snapshot={recheck.snapshot} /></details>
        {!bundle && !context && <button className="btn btn--ghost" disabled={!!loading} onClick={() => prepareRecheck(recheck)}>Prepare recheck PDF again</button>}
      </section>}
      {!bundle && !context && !recheck && <>
        {externalInput ? <>
          <h3>{externalInput.label}</h3>
          <p>Checks only this selected file against the target from ATS setup or its original review. No editable resume is created, migrated or replaced. Preparing sends nothing to AI.</p>
          <details><summary>Selected target</summary><p>{target.company} / {target.level} / {target.mode}</p><pre>{target.jd || 'General mode - no job match'}</pre></details>
          <button className="btn btn--primary" disabled={!!loading} onClick={() => run('Reading selected resume file', async signal => {
            const input = await externalInput.read(signal);
            return prepare(input, signal, externalInput.label);
          }, setContext)}>Prepare selected resume file</button>
        </> : <>
        <h3>Fictional walkthrough</h3><p>Scripted responses, no AI calls and no budget spent. This example is not an assessment of your open resume.</p>
        <label className="rws-field"><span>Fictional scenario</span><select aria-label="Fictional scenario" value={example} disabled={!!loading} onChange={event => setExample(event.target.value)}>
          {ASSESSMENT_DEVELOPMENT_CASES.map(item => <option key={item.id} value={item.id}>{item.purpose}</option>)}
        </select></label>
        <button className="btn btn--primary" disabled={!!loading} onClick={() => run('Preparing fictional example', () => createSampleAssessmentPilot(example), value => install({ ...value, mode: 'sample', label: 'Fictional example — not the open resume' }))}>Start fictional walkthrough</button>
        <h3>Assess an uploaded original</h3>
        <p>PDF, DOCX or UTF-8 TXT, up to 20 MB. Uses the current target job, but no editable-document content. Choosing a file sends no data to AI.</p>
        <label className="rws-field"><span>Upload file for candidate assessment</span><input type="file" accept=".pdf,.docx,.txt" disabled={!!loading}
          onChange={event => {
            const file = event.target.files?.[0];
            if (!file) return;
            event.target.value = '';
            const target = structuredClone(latest.current.target);
            run('Reading uploaded original', async signal => {
              const mediaType = assessmentFileType(file);
              if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('Choose a nonempty file no larger than 20 MB.');
              const bytes = new Uint8Array(await file.arrayBuffer()); signal.throwIfAborted();
              return prepare({ kind: 'upload', bytes, mediaType, target }, signal, file.name);
            }, setContext);
          }} /></label>
        <h3>Assess an attached original</h3>
        <p>This re-reads one selected original file, never substitutes the edited canvas and does not rely on stored extraction.</p>
        {!connection?.connectAssessment && <p className="rws-inline-warning">The real pilot requires an open local Studio connection. This standalone preview can inspect file inputs and run the fictional walkthrough, but cannot send an assessment.</p>}
        <label className="rws-field"><span>Original file to assess</span><select aria-label="Original file to assess" value={sourceId} disabled={!!loading} onChange={event => setSourceId(event.target.value)}>
          <option value="">Choose one attached original</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select></label>
        {!sources.length && <p>Attach the original resume first. Supporting evidence does not automatically count as submitted resume content.</p>}
        <button className="btn btn--ghost" disabled={!!loading || !sourceId} onClick={() => run('Reading selected original', async signal => {
          const source = structuredClone(latest.current.sources.find(item => item.id === sourceId));
          const { document, version } = structuredClone(latest.current.getRecord());
          const bytes = await readSource(source, signal);
          return prepare({ kind: 'source', document, version, source, bytes, mediaType: assessmentFileType(source) }, signal, source.name);
        }, setContext)}>Prepare selected original</button>
        <h3>Assess the current checked PDF</h3>
        <p>Saves pending edits, renders or reuses a matching checked export, then reads and verifies its exact bytes. No AI call and no change to existing scores.</p>
        <button className="btn btn--ghost" disabled={!!loading || !prepareExport} onClick={() => run('Preparing current checked PDF', signal => prepareCheckedExport(signal), setContext)}>Prepare current checked PDF</button>
        </>}
      </>}
      {context && !bundle && <>
        <h3>{context.label}</h3><p>{inputDescription(context.mode)}</p>
        <p>Artifact SHA-256: <code data-candidate-artifact-hash>{context.snapshot.binding.artifactSha256}</code></p>
        <details><summary>Target job and recovered file text</summary><pre>{context.snapshot.target.jd || 'General mode — no job match'}</pre><pre>{context.snapshot.artifact.text}</pre></details>
        <PdfStructureReview snapshot={context.snapshot} />
        <PdfOrderReview snapshot={context.snapshot} />
        {context.snapshot.artifact.evidenceMap && <details data-candidate-evidence-map>
          <summary>PDF evidence locations ({context.snapshot.evidence.length} excerpts)</summary>
          <p>These locations follow the actual extraction, including repeated wording. Source locations do not verify employer attribution or factual truth.</p>
          {context.snapshot.evidence.map(excerpt => <article key={excerpt.id} data-candidate-mapped-excerpt={excerpt.id}>
            <blockquote>{excerpt.text}</blockquote><PdfEvidenceLocations excerpt={excerpt} snapshot={context.snapshot} />
          </article>)}
        </details>}
        {connection?.assessmentModels && <label className="rws-field"><span>Budget authority</span><select aria-label="Budget authority" value={budgetScope} disabled={!!loading || !!recheck} onChange={event => { setBudgetScope(event.target.value); setCatalog(null); setBudgetConsent(false); }}>
          <option value="server">Server enforced - shared across devices</option><option value="browser-origin">Browser-local development pilot - not cross-device</option>
        </select></label>}
        <button className="btn btn--ghost" disabled={!!loading || stale || !connection?.connectAssessment} onClick={() => run('Loading model catalog — no assessment call', async signal => {
          if (budgetScope !== 'server' || !connection.assessmentModels) return connection.models();
          const value = await connection.assessmentModels({ signal, inventory: !recheck && context.snapshot.target.mode !== 'general',
            evidencePolicy: recheck ? recheck.result.evidencePolicy : new URLSearchParams(location.search).get('evidencePolicy') ?? undefined });
          if (value.scope !== 'server' || value.id !== 'candidate-review' || !Number.isFinite(value.ceiling) || !Number.isFinite(value.reserved)) throw new Error('Invalid central budget response. No browser fallback was used.');
          return value;
        }, value => {
          if (value.recommendation && !value.models.some(item => item.id === value.recommendation.modelId)) throw new Error('The recommended model is missing from the verified catalog.');
          const baseline = recheck?.result.execution[0];
          if (baseline && (value.provider !== baseline.provider || !value.models.some(item => item.id === baseline.model))) throw new Error('The baseline model is no longer eligible. Start a separate assessment; do not change models for an improvement comparison.');
          setCatalog(value); setModel(baseline?.model || value.recommendation?.modelId || ''); setBudgetConsent(false);
        })}>Load available models</button>
        {catalog && <>
          <label className="rws-field"><span>Pilot model</span><select aria-label="Pilot model" value={model} disabled={!!loading} onChange={event => { setModel(event.target.value); setBudgetConsent(false); }}>
            <option value="">Choose a model with current pricing</option>{catalog.models.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
          </select></label>
          {catalog.recommendation && !recheck && <details data-candidate-model-recommendation><summary>Task-based recommendation: {catalog.recommendation.modelId}</summary>
            <p>{catalog.recommendation.confidence === 'provisional' ? 'Provisional selection: task quality is not independently established.' : 'Selection uses available task observations; it is not a guarantee of the best result.'} You may choose another eligible model. Refreshing reevaluates available models; the approved run keeps its chosen model and price.</p>
            <ul>{catalog.recommendation.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
          </details>}
          {estimate ? <p>Maximum reservation: {money(estimate.inventory)} for inventory; {money(estimate.evaluation)} for assessment plus challenge. Actual billed cost may differ.</p> : <p>Choose a model with fresh, valid pricing before connecting. Refresh the catalog if pricing is unavailable or expired.</p>}
          {estimateError && <p role="alert" className="rws-inline-warning">{estimateError}</p>}
          <label className="rws-field"><span>Approved total budget (USD)</span><input type="number" min="0.01" step="0.01" value={budget} disabled={!!loading} onChange={event => { setBudget(event.target.value); setBudgetConsent(false); }} /></label>
          {catalog.scope === 'server' ? <p>Budget ID: candidate-review. Server ceiling: {money(catalog.ceiling)}; last observed reserved: {money(catalog.reserved)}. Shared across supported desktop devices; clearing local history cannot reset it. Covers central candidate requests only; earlier browser-development and other AI usage are separate. Failed/unknown attempts remain reserved; no automatic refund or retry. This is not a settled provider bill.</p>
            : <p>Budget ID: candidate-review. Development only, reused for this browser origin; not cross-device. Clearing browser storage removes this local ledger. This does not authorize a reset or a higher existing ceiling.</p>}
          <label className="chk"><input type="checkbox" checked={budgetConsent} disabled={!!loading} onChange={event => setBudgetConsent(event.target.checked)} />{catalog.scope === 'server' ? 'I approve this server-enforced shared budget.' : 'I approve this browser-local pilot budget.'} Connecting sends no resume text to the model.</label>
          {new URLSearchParams(location.search).has('evidencePolicy') && <p className="rws-inline-warning">Experimental decision/context evidence policy requested. Offline-tested only; real-model relevance and quality are not accepted. Existing reports are not reinterpreted.</p>}
          <button className="btn btn--primary" disabled={!!loading || stale || !estimate || !budgetConsent || !Number.isFinite(Number(budget)) || Number(budget) <= 0} onClick={() => run('Connecting approved pilot', async signal => {
            const pilot = await connection.connectAssessment({ getInput: context.getInput, expectedFingerprint: context.snapshot.fingerprint, provider: catalog.provider, model,
              evidencePolicy: recheck ? recheck.result.evidencePolicy ?? null : new URLSearchParams(location.search).get('evidencePolicy') ?? undefined,
              ...(recheck ? { getBaselineInput: () => structuredClone(recheck.capturedInput), baselineId: recheck.result.report.id, expectedBaselineFingerprint: recheck.snapshot.fingerprint } : {}),
              ...(recheck?.archiveId ? { baselineHistoryId: recheck.archiveId } : {}),
              pricing: { ...selectedModel.pricing, checkedAt: catalog.checkedAt }, budget: { id: 'candidate-review', maxCost: Number(budget), approved: true, scope: catalog.scope === 'server' ? 'server' : 'browser-origin' }, signal });
            return { ...context, pilot };
          }, install)}>Connect approved pilot</button>
        </>}
      </>}
      {bundle && <>
        <h3>{bundle.label}</h3>
        <p>{bundle.mode === 'sample' ? 'SCRIPTED FICTIONAL EXAMPLE — no provider was contacted. Responses and provisional reference labels are developer-authored, not independently validated.' : inputDescription(bundle.mode) + (bundle.pilot.budget().scope === 'server' ? ' Server-enforced shared budget; full history remains browser-local unless separately saved with original-file retention consent.' : ' Browser-local private history; no cross-device budget guarantee.')}</p>
        <details><summary>Bound input and complete job description</summary><p>{bundle.snapshot.target.role} / {bundle.snapshot.target.level}</p>
          <pre>{bundle.snapshot.target.jd || 'General mode — role evidence is not applicable.'}</pre><p>Artifact SHA-256: {bundle.snapshot.binding.artifactSha256}</p></details>
        {bundle.mode !== 'sample' && <p>Last observed reserved: {money(bundle.pilot.budget().reserved)}. {bundle.pilot.budget().scope === 'server' ? 'The server rechecks its current ceiling before every central reservation.' : 'Development browser ledger only; not a server-enforced ceiling.'} This is not a settled provider bill.</p>}
        {bundle.pilot.budget().scope === 'server' && <button className="btn btn--ghost" disabled={!!loading || stale} onClick={() => run('Refreshing shared budget - no AI call', () => bundle.pilot.refreshBudget())}>Refresh shared budget (no AI call)</button>}
        {state?.phase === 'ready' && recheck && <>
          <label className="chk"><input type="checkbox" checked={inventoryConsent} disabled={!!loading || stale} onChange={event => setInventoryConsent(event.target.checked)} />I reviewed the original approved inventory and will reuse it unchanged.</label>
          <button className="btn btn--primary" disabled={!!loading || stale || !inventoryConsent} onClick={() => run('Reusing approved inventory - no AI call', () => bundle.pilot.reuseInventory({ confirmed: true }), () => setSendConsent(false))}>Reuse approved inventory (no AI call)</button>
        </>}
        {state?.phase === 'ready' && !recheck && <>
          <label className="chk"><input type="checkbox" checked={sendConsent} disabled={!!loading || stale} onChange={event => setSendConsent(event.target.checked)} />
            {bundle.mode === 'sample' ? 'Continue with the fictional job inventory; no data leaves this page.' : 'Allow this complete job description to be sent for inventory. Resume evidence is not sent in this stage.'}</label>
          <button className="btn btn--primary" disabled={!!loading || stale || !sendConsent} onClick={() => run('Building job inventory', () => bundle.pilot.inventory({ confirmed: true }), value => { editManifest(value.manifest); setSendConsent(false); })}>Build job inventory</button>
        </>}
        {state?.phase === 'inventory-review' && <>
          <h3>Review the job inventory</h3><p>Check completeness, priority and alternatives against the full JD before approving.</p>
          <JobSourceReview manifest={manifest} snapshot={bundle.snapshot} />
          {manifest?.requirements.map((requirement, index) => <article className="resume-finding rws-candidate-card" key={requirement.id}>
            <h4>{requirement.label}</h4><label className="rws-field"><span>Priority: {requirement.label}</span>
              <select aria-label={"Priority: " + requirement.label} value={requirement.importance} disabled={!!loading} onChange={event => editManifest({ ...manifest, requirements: manifest.requirements.map((item, position) => position === index ? { ...item, importance: event.target.value } : item) })}>
                <option value="required">Required</option><option value="responsibility">Responsibility</option><option value="preferred">Preferred</option>
              </select></label>
            <Condition node={requirement.condition} disabled={!!loading} onChange={condition => editManifest({ ...manifest, requirements: manifest.requirements.map((item, position) => position === index ? { ...item, condition } : item) })} />
          </article>)}
          <details><summary>All job segments and structural corrections</summary><p>Every JD segment must remain accounted for. Advanced corrections can add/remove criteria or change exact source spans; invalid inventories cannot be approved.</p>
            <textarea aria-label="Full candidate inventory JSON" rows={12} value={inventoryText} disabled={!!loading} onChange={event => { setInventoryText(event.target.value); setInventoryConsent(false); }} /></details>
          {manifestError && <p role="alert" className="rws-inline-warning">{manifestError}</p>}
          <label className="chk"><input type="checkbox" checked={inventoryConsent} disabled={!!loading || !!manifestError || stale} onChange={event => setInventoryConsent(event.target.checked)} />I reviewed all job requirements and their importance.</label>
          <button className="btn btn--primary" disabled={!!loading || stale || !manifest || !inventoryConsent} onClick={() => run('Approving inventory', () => {
            const previous = state.approval?.manifest || state.inventory.manifest;
            const corrected = JSON.stringify(manifest) === JSON.stringify(previous) ? manifest : { ...manifest, revision: previous.revision + 1 };
            return bundle.pilot.approveInventory({ confirmed: true, manifest: corrected });
          })}>Approve job inventory</button>
        </>}
        {state?.phase === 'evidence-review' && <>
          <h3>Review included evidence</h3><p>Inspect every excerpt. Only whole name/contact excerpts may be excluded; mixed excerpts may contain useful work evidence. This is not automatic anonymization.</p>
          {bundle.snapshot.evidence.map(excerpt => <article className="resume-finding rws-candidate-card" key={excerpt.id} data-candidate-excerpt={excerpt.id}>
            <blockquote>{excerpt.text}</blockquote><PdfEvidenceLocations excerpt={excerpt} snapshot={bundle.snapshot} /><label className="rws-field"><span>Handling: {excerpt.id}</span><select aria-label={"Handling: " + excerpt.id} value={exclusions[excerpt.id] || 'include'} disabled={!!loading} onChange={event => { setExclusions({ ...exclusions, [excerpt.id]: event.target.value }); setEvidenceConsent(false); }}>
              <option value="include">Include in assessment</option><option value="name">Exclude — name</option><option value="contact">Exclude — contact</option>
            </select></label></article>)}
          <label className="chk"><input type="checkbox" checked={evidenceConsent} disabled={!!loading || stale} onChange={event => setEvidenceConsent(event.target.checked)} />I reviewed the included evidence and these exclusions.</label>
          {!bundle.snapshot.evidence.some(item => !['name', 'contact'].includes(exclusions[item.id])) && <p role="alert" className="rws-inline-warning">Keep at least one reviewable evidence excerpt included.</p>}
          <button className="btn btn--primary" disabled={!!loading || stale || !evidenceConsent || !bundle.snapshot.evidence.some(item => !['name', 'contact'].includes(exclusions[item.id]))} onClick={() => run('Approving evidence', () => bundle.pilot.approveEvidence({ confirmed: true,
            excluded: Object.entries(exclusions).filter(([, reason]) => reason !== 'include').map(([id, reason]) => ({ id, reason })) }), () => setSendConsent(false))}>Approve included evidence</button>
        </>}
        {state?.phase === 'assessment-ready' && <>
          <h3>Ready for assessment and challenge</h3><p>{state.selection.includedIds.length} excerpts included; {state.selection.excluded.length} excluded. Both passes use the approved inventory and included evidence.</p>
          <label className="chk"><input type="checkbox" checked={sendConsent} disabled={!!loading || stale} onChange={event => setSendConsent(event.target.checked)} />
            {bundle.mode === 'sample' ? 'Run the scripted assessment and challenge; no AI call or spending.' : 'Allow the selected evidence to be sent for both assessment and challenge within the approved budget.'}</label>
          <button className="btn btn--primary" disabled={!!loading || stale || !sendConsent} onClick={() => run('Assessing evidence and challenging judgments', () => bundle.pilot.evaluate({ confirmed: true }))}>Run assessment and challenge</button>
          <button className="rws-text-button" disabled={!!loading || stale} onClick={() => { setState({ ...state, phase: 'evidence-review' }); setEvidenceConsent(false); setSendConsent(false); }}>Change included evidence</button>
        </>}
        {!recheck && ['evidence-review', 'assessment-ready'].includes(state?.phase) && <button className="rws-text-button" disabled={!!loading || stale} onClick={() => {
          editManifest(state.approval.manifest); setState({ ...state, phase: 'inventory-review' }); setSendConsent(false);
        }}>Review inventory again</button>}
        {state?.result && <CandidateResult result={state.result} snapshot={bundle.snapshot} />}
        {state?.result && bundle.capturedInput && bundle.pilot.historyData && connection?.history && <section data-candidate-save-history>
          <h3>Retain complete private history</h3>
          <p>This saves the original file, full captured document/extraction (including contacts excluded from AI), approved inventory, results, revisions and bound diagnostics. A comparison also saves its baseline. Existing editor content is not replaced. Cancellation or a later failure cannot undo an acknowledged file upload.</p>
          <label className="chk"><input type="checkbox" checked={retentionConsent} disabled={!!loading} onChange={event => setRetentionConsent(event.target.checked)} />I consent to retaining these complete originals and assessment records in private server history.</label>
          <button className="btn btn--ghost" disabled={!!loading || !retentionConsent} onClick={() => run('Saving complete private history - no AI call', savePrivateHistory, value => { setArchiveAcks(value); setRetentionConsent(false); })}>Save private assessment history</button>
          {archiveAcks[state.result.report.id] && <p role="status">Private history acknowledged for this assessment. Later receipts need another explicit save.</p>}
        </section>}
        {state?.comparison && recheck && <CandidateComparison value={state.comparison} baseline={recheck} result={state.result} snapshot={bundle.snapshot} />}
        {state?.result && bundle.mode === 'export' && bundle.capturedInput && prepareExport && connection?.connectAssessment && <button className="btn btn--ghost" disabled={!!loading}
          onClick={() => prepareRecheck({ snapshot: bundle.snapshot, result: structuredClone(state.result), capturedInput: structuredClone(bundle.capturedInput), label: bundle.label,
            history: bundle.pilot.historyData(state.result.report.id), baseline: recheck, comparison: state.comparison,
            ...(archiveAcks[state.result.report.id] ? { archiveId: state.result.report.id, archiveEtag: archiveAcks[state.result.report.id] } : {}) })}>Prepare explicit PDF recheck</button>}
        {state?.result && bundle.mode === 'export' && applyRevision && bundle.pilot.proposeRevision && <CandidateRevision
          assessment={state.result} snapshot={bundle.snapshot} pilot={bundle.pilot} document={document} getRecord={getRecord}
          value={state.revision} run={run} loading={loading} stale={stale} applyRevision={applyRevision} />}
        {['cancelled', 'failed'].includes(state?.phase) && <p>The pilot stopped. Earlier saved results and spent reservations are retained. Start over to review a fresh connection; no automatic retry is made.</p>}
        {history.length > 0 && <details><summary>Saved candidate results — this pilot budget</summary><label className="rws-field"><span>Saved assessment</span><select aria-label="Saved assessment" value={historyId} onChange={event => setHistoryId(event.target.value)} disabled={!!loading}>
          <option value="">Choose a saved result</option>{history.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} / {item.id}</option>)}</select></label>
          <button className="btn btn--ghost" disabled={!!loading || stale || !historyId || state?.phase === 'cancelled'} onClick={() => run('Validating saved assessment — no AI call', () => bundle.pilot.restore(historyId))}>Open saved assessment</button></details>}
      </>}
    </div>
  </Dialog>;
}
