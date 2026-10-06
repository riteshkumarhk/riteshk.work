# Unified Resume Assessment Specification

Release scope (2026-10-06): the accumulated implementation is approved for
publication, not for new paid evaluations or a scoring cutover. Candidate
entry points remain explicitly loopback-gated with `candidate=1`; default hosted
reviews retain the existing assessment path and now prepare validated revisions
with the consented review. Earlier dated no-release statements below describe
their implementation checkpoints, not the current publication authorization.
Offline integration results do not establish independent semantic quality.

Status: local mechanisms through Step 11 are implemented and offline-tested,
2026-10-05. The owner extended the target toward Step 15. Earlier full offline
coverage and the latest focused structured-response integration checks pass;
semantic acceptance, separately approved provider use,
calibration and held-out evaluation remain gated. The current hosted
evaluator, scoring, persistence and UI are unchanged. This document defines the
complete target contract and its acceptance gates; it is not evidence of achieved
semantic accuracy or vendor acceptance.

Current direction: **offline integration readiness and task-aware model
selection, not the rejected $10,401.190325 evaluation campaign**. The owner
explicitly rejected that proposal and requested practical request/response/UI
readiness without more paid calls. Sonnet is one supported test case, not a
permanent product model lock. All four historical paid workflows remain stopped.

### Offline handoff and task-aware candidate selection - October 5

The candidate's central-budget model loader now reuses the existing
`aiOrchestrator.choices(..., "analysis")` ranking, rather than a second model-name
ranking or an inference-based model audition. It refreshes metadata only and
limits choices to the selected configured provider and the intersection of live
availability and server-authorized models. Prices must match; reasoning/request
policy, context/output limits, declared structured support and remaining server
budget must cover the requested initial assessment phases. Missing eligibility
or provider mismatch is an explicit error, never another-provider fallback.
Recency alone does not establish quality; the existing task observations and
incumbent rules apply. No automatic evaluation is started or enabled.

The UI preselects the recommendation and discloses reasons and provisional
confidence through the existing details pattern. Manual selection remains;
changing selection or refreshing the catalog clears budget consent. Connection
rechecks current API, model and price. An approved run retains its chosen model,
price and request policy. Rechecks select the original baseline model and inherit
its evidence policy, regardless of a newer recommendation or current URL flag.
If that model becomes ineligible, start a separate assessment, not a cross-model
improvement comparison.

The server model policy accepts optional **`structuredOutput: true|false`**.
Enable it only for a model whose supported endpoint/schema behavior has been
verified. The compatibility default remains true for the historical Sonnet5.5
profile and false for other models; explicit false disables it. Anthropic uses
`output_config.format`; supported OpenAI Chat Completions uses strict
`response_format.json_schema`. Both use the existing exact-target schema and
decoder. Unsupported transports, including Gemini for this candidate path, are
not silently enabled. Future opaque model IDs need no model-name code change,
but do require current server-authorized capability/price metadata. Generic
Anthropic reasoning models use a versioned service-default/no-temperature
profile; this does not claim to enable a vendor-specific thinking mode. The old
Sonnet adaptive/medium and historical temperature policies remain readable.
Removing structured support blocks dispatch before inference, not a raw-JSON
downgrade. Existing stored receipts are validated against their own contract,
not rewritten according to today's available models.

Offline browser tests now traverse the real connector, budget HTTP route,
durable attempt claim, provider request builder, provider envelope parser,
strict domain validation and UI/private-history path. Only external provider
responses and authentication are synthetic. They check exact requests and
usage/response IDs; hidden thinking is not rendered. Complete journeys exercise
disputed revisions, reviewed Apply, Undo/Redo, actual checked-PDF recheck and
private history restoration. Nine injected failures cover HTTP401/429, a thrown
deadline, malformed JSON, oversized response, truncated assessment, missing
challenge target, refused revision and wrong model during recheck. Failed
attempts retain reservations, preserve prior valid results/source text, block
Apply/comparison and cannot replay through budget refresh or duplicate requests.
The thrown-deadline case tests error handling, not actual elapsed vendor latency.

This is software integration evidence, **not independent model-quality or live
vendor acceptance**. No new paid call, shared reload, authentication change or
public deployment is authorized. A current local build and verified server
model/budget/history configuration are still needed to use the feature with a
real service. The rejected campaign is not a prerequisite for this offline
deliverable; independent quality/calibration acceptance remains unclaimed.

Verification: 186 final contract/routing/history/baseline tests pass
(39647.4343 ms); the complete candidate UI file passes 24 tests
(238539.6206 ms), including 22 browser journeys. After tightening eligibility
before incumbent selection and integer-millionth budget comparisons, four
targeted browser journeys pass again (107607.2689 ms). The 31 existing Worker
tests pass (12580.4499 ms). Main build passes (6068 ms), with Resume builds in
browser validation. The 28-file runtime stamp is
`8918d03fdfeb6d4dbfc0545a18806a555a322e46f34dd236be3df37637a90001`.
Earlier failed receipts retain the fixture mistakes: reading attempts from a
budget summary instead of the actual ledger, and expecting a Sonnet policy for
the new generic-model test. No production validation was weakened to pass them.

## Implemented foundation

[resume-assessment.mjs](../src/js/resume-assessment.mjs) is an isolated,
browser-compatible module with no AI/network/storage calls:

- `createAssessmentSnapshot` captures original bytes, supplied extraction,
  positions, target and optional document signature/version before asynchronous
  hashing. It returns a deeply frozen snapshot with exact source offsets.
- `assertAssessmentCurrent` rejects changed bytes, extraction, target or document.
  Snapshots must be constructed from authoritative inputs, not deserialized
  binding metadata. Stored reports can be validated against a newly constructed
  snapshot of the same original inputs.
- `validateAssessmentManifest` validates a supplied complete segment inventory,
  exact JD spans, compound `allOf`/`anyOf` conditions and bounded unique IDs.
  It does not generate an inventory or prove its semantic completeness.
- `createCandidateAssessment` computes artifact observations and compound states
  from supplied atomic judgments. Missing geometry stays unknown; empty positional
  extraction fails; bounds/column/contact-region observations are qualified.
  Reading order and field association remain explicitly unverified.
- `validateCandidateAssessment` reconstructs derived fields against the
  authoritative snapshot and rejects altered evidence, counters, bindings, methods,
  invented totals, malformed values and success claims. The foundation accepts no
  complete verdict or numeric headline.

All supplied judgments remain `reference-checked-only`. In particular, a valid
but irrelevant citation does not become a semantically verified judgment. The
foundation reports that limitation; the separate evaluator below challenges
meaning without claiming independent truth. Unknown/conflicting conditions and required gaps remain
distinct. An empty findings list means findings were not generated, not that the
resume needs no improvements.

Run the [offline contracts](../resume-assessment.test.mjs) with
`node --test resume-assessment.test.mjs`. The existing root release runner discovers
this file automatically. Sixteen tests pass; module coverage is 100% lines/functions
and 92.36% branches in the recorded run. Existing 14 focused Resume unit tests and
72 ATS assertions also pass. The module compiles as a browser bundle in memory;
no deployed or preview assets were replaced.

### Implemented evaluator

[resume-assessment-evaluator.mjs](../src/js/resume-assessment-evaluator.mjs) now
orchestrates the candidate through an injected, single-call transport. The
evaluator itself has no provider discovery, credentials or direct network calls.
The local pilot connection below now supplies transport and browser-local
persistence. Initial validation used synthetic responses; later real-provider
attempts and their stopped outcomes are recorded below.

| API | Contract |
| --- | --- |
| `inventoryCandidateAssessment(snapshot, options)` | Sends only role/level and complete JD segments, never candidate evidence. Returns a structurally validated inventory plus receipts, then stops for approval. General mode makes no inventory call or reservation. |
| `approveAssessmentInventory(snapshot, inventory, { confirmed, manifest })` | Requires explicit confirmation. Supports an explicitly corrected manifest, freezes it and binds it to the entire target. Reuse it across resume edits for the same target; changing the target requires approval again. |
| `approveAssessmentEvidence(snapshot, { confirmed, excluded })` | Requires review of included excerpts and exact name/contact exclusions. Binds the selection to this snapshot. It is not automatic anonymization; do not exclude job-relevant evidence to improve a result. |
| `evaluateCandidateAssessment(snapshot, { approval, selection, ...options })` | Requires both approval objects and explicit call consent. Runs assessment, validates every atomic/communication judgment, then separately challenges every judgment and JD inventory. No automatic repair/retry. |
| `validateEvaluatedAssessment(result, snapshot)` | Rebuilds the derived report, verifies request fingerprints, approval/exclusion records, priced reservations and actual provider/model/usage receipts against authoritative inputs. It does not independently verify provider receipts or factual truth. |

The challenge receives all included evidence, the approved inventory and the
draft. It checks relevance, negation, attribution, overlooked evidence and
inventory defects. It is a separate critical pass, not a blind independent human
review. Both passes may use the same locked model; shared-model bias remains.
Inventory source offsets are resolved deterministically from exact, unique
quotations in named JD segments; the model is not asked to count characters.
Missing or ambiguous quotations fail explicitly rather than guessing a span.

Disagreement/uncertainty becomes `unknown` for requirements and null for
communication ratings. An inventory defect makes role judgments unresolved until
the author reviews the inventory; there is no automatic easier re-inventory.
Original judgments, challenge reasons and both citation sets remain in the result.
An agreeing challenge is not a certification and does not enable a headline.

The result is a versioned `candidate-evaluation` envelope containing `approval`,
`selection`, `draft`, `challenge`, the derived foundation `report`, `execution`,
`reservations` and limitations. The foundation report intentionally remains
partial/blocked and `reference-checked-only`; do not discard the envelope and
present that report alone as an AI-verified result. Future storage/UI adapters must
validate and preserve the full envelope.

Transport options require explicit consent, a current-snapshot getter, a locked
OpenAI/Anthropic model with fresh pricing, a durable `reserve(plan)` callback and
an `invoke(request)` callback. Shared reservation math and factual policy come
from the existing evidence-review module; its existing prompts are unchanged.

- Known complete input is preflighted before reservation. Reserve the whole phase
  before invoking: one inventory call, or assessment plus challenge. Worst-case
  reservations use the existing 110,000-token input bound and stage output caps:
  8,000 inventory, 12,000 assessment and 12,000 challenge, including reasoning
  where the provider bills it as output. Actual inputs still fail explicitly if
  their UTF-8-byte-plus-overhead bound exceeds the limit; no slicing.
- The durable callback must acknowledge the exact plan ID/amount and enforce the
  approved aggregate budget. This module does not create a cross-device ledger or
  refund reservations. A failed/unknown outcome remains reserved.
- `invoke` must make exactly one request, honor cancellation/output limits and
  return `{ text, provider, model, requestId, usage }`. Usage is either exact
  nonnegative input/output token counts or explicitly null. Model/provider
  mismatch, malformed JSON, invalid references or exceeded bounds fail; no
  unrestricted multi-call Studio orchestrator may be used as this transport.
- Each stage retains actual model identity, request fingerprint and usage. Pricing
  and reservation time are retained for reproducible historical cost validation;
  a later-expired price does not invalidate an old receipt.
- Current-input checks surround reservation, calls and final validation. The
  default phase deadline is 120 seconds, configurable up to 300 seconds. Abort or
  timeout settles even a nonresponsive transport; a sent request may still be
  billed. Failed attempts carry execution/reservation metadata on
  `error.assessmentAttempt`, not a fabricated successful result.
- Only approved excerpts and job data reach the injected model; original bytes,
  complete document signatures and excluded name/contact excerpts do not.
  Exclusions are author-reviewed whole excerpts, not a claim of complete PII
  detection. The future UI must make mixed identity/work-content excerpts explicit.

[Evaluator tests](../resume-assessment-evaluator.test.mjs) contain 17 offline cases,
including a hung-transport deadline and historical pricing receipts. Together
with 16 foundation tests, 33 pass (379.6312ms in the final hardening run);
evaluator coverage is 100% lines/functions and 93.42% branches. Foundation
coverage in that run is 100% lines/functions and 93.67% branches. Seventeen existing Resume tests,
including actual budget/single-attempt helpers, and 72 ATS assertions pass.
Both test files are discovered by the existing root release runner. Main and
Resume builds pass; Resume JS is 1.13, CSS remains 1.8. The shared preview tabs
were not reloaded.

Still pending: complete candidate entry-point integration, server-authoritative cross-device budgets,
actual field-association extraction, claim-safe revisions, common review adapter,
worker persistence, real-provider/held-out quality evaluation and headline policy.
No production candidate switch, real AI call, vendor submission or public release
has been performed. The tests demonstrate orchestration and safeguards, not that
the model reliably understands resumes.

### Implemented local Studio pilot connection

[resume-assessment-pilot.mjs](../src/js/resume-assessment-pilot.mjs) connects the
evaluator to the actual Studio request-building helpers through the explicit
`window.__RKStudio.resumeAI.connectAssessment(...)` developer API. It is allowed
only in an open Studio on a loopback hostname. The visible local UI described
below is separately gated; there is no automatic call on opening Studio,
production activation or replacement score.

Same-bundle connection requires an authoritative snapshot/current-snapshot getter, the
selected provider and exact model, current catalog pricing, and an explicitly
approved `{ id, maxCost, scope: "browser-origin", approved: true }` budget.
It locks configuration and model metadata before use. Models need known
input/context capacity and at least 12,000 output tokens. Capacity is checked
conservatively before each actual request; nothing is truncated to fit.
Configuration changes, expired pricing, closed Studio and changed snapshots
stop the operation. A model alias returning a different actual model is rejected,
not relabelled as the requested model. The editor iframe instead supplies
`getSource()` and `expectedFingerprint`: the host copies the original bytes,
source metadata and current document, rebuilds its own authoritative snapshot
and checks the fingerprint. Snapshot brands are never trusted across bundles
or browser realms. Inventory corrections are copied into the receiving realm
before strict validation.

| Pilot method | Explicit boundary |
| --- | --- |
| `inventory({ confirmed: true })` | Authorizes sending only the JD, then stops at inventory review. Persists the inventory and actual receipt. |
| `approveInventory({ confirmed: true, manifest? })` | Approves the exact inventory or an explicitly corrected manifest; no call. |
| `approveEvidence({ confirmed: true, excluded })` | Confirms the included snapshot excerpts and whole-excerpt name/contact exclusions; no call. |
| `evaluate({ confirmed: true })` | Separately authorizes assessment plus challenge, reserves both stages before either request, validates and saves the full envelope. |
| `state()`, `budget()`, `history()` | Expose phase/error, browser-local reserved amount and result identities. Reserved cost is not actual billed cost. |
| `restore(id)` | Revalidates a full saved envelope against the authoritative snapshot without AI; restored results are historical and do not restore call approvals. |
| `cancel()` | Permanently closes that pilot handle, settles even hung transport/input checks, retains reservations and failure evidence. Reconnection requires the explicit budget inputs again. |

The transport reuses Studio's non-streaming OpenAI/Anthropic request helpers
with one attempt and bounded output. Reasoning models use the existing provider
sampling/output-cap rules. It reads actual model/response/request identities and
usage, including reported Anthropic cached input counts; absent usage stays
unknown. Truncation, refusal, unfinished/tool responses and malformed receipts
fail explicitly. Existing text-only callers retain their previous return shape.
Only the candidate receipt mode is stricter; it cannot enable streaming or
temperature-repair retries.

The pilot stores one versioned ledger under
`rk:resume:assessment-pilot:<budget-id>`, using Web Locks and synchronous
localStorage writes/read-back acknowledgement. Whole-phase totals use integer
millionths of a dollar; multiple connections/tabs sharing that browser origin
and budget ID share the same reservations. Failures are not refunded. Increasing
the saved ceiling under the same ID is rejected, not treated as fresh approval.
The ledger preserves inventory receipts, successful full envelopes and failed
attempt metadata. Storage failures stop progression; if the provider already
answered, the error retains received execution metadata even when saving fails.

**This is a browser-origin pilot ledger, not a production or cross-device budget
authority.** Other browser profiles/origins/devices do not share it, and clearing
browser storage removes it. Do not automatically create new budget IDs or silently
reconnect after storage loss. Records contain private assessment material and
must not be uploaded to public content. Server-authoritative budgets and private
worker storage remain required before hosted promotion.

Fourteen [pilot integration tests](../resume-assessment-pilot.test.mjs) exercise
the actual Studio connector and HTTP request helpers with an injected fake
`fetch`; no real provider or owner data is used. Together with the evaluator and
foundation, **47 tests pass** (412.2606ms). Pilot coverage is 100% lines, 88.30%
branches and 96.08% functions; evaluator 100% lines/functions and 94.40% branches;
foundation 100% lines/functions and 93.99% branches in this combined run.
Seventeen existing Resume unit tests plus 72 ATS assertions pass (285.6261ms).
The owning main build passes; the pilot also compiles as a 73,829-byte browser
bundle in memory. Studio's existing timestamped lazy loader needs no new cache
version. Resume JS 1.13/CSS 1.8 and admin CSS 1.215 are unchanged.
No shared tab was reloaded; no new browser walkthrough or model-quality result
is claimed for that initial pilot milestone. The local review UI below is now
implemented; complete entry-point integration, artifact association and safe
revisions remain subsequent gates.

### Implemented visible local candidate review — October 4

The initial milestone below describes the first source-only UI. The shared-input
follow-up later in this section supersedes its stored-extraction and export limits.

The owner approved the full roadmap and continuation on October 4.
[ResumeCandidateReview](../src/js/resume-assessment-ui.jsx) is now accessible in
the existing editor's **Review** panel when `candidate=1` is explicitly set on a
loopback URL. Example: `http://127.0.0.1:5538/studio/resume-preview/?candidate=1`.
A same-origin local Studio parent can pass the flag to its hosted editor.
Production hostnames and ordinary unflagged sessions do not show the entry.
The ATS setup dialog, original review and current scores remain unchanged.

Use **Review > Preview candidate assessment > Start fictional walkthrough**
for a no-network demonstration. Three selectable scripted examples cover OR
alternatives/unresolved ownership, explicit negation and an irrelevant title
citation. They are conspicuously labelled as fictional, not the open resume.
Their virtual ledger is memory-only; they neither use real AI nor write a real
pilot budget or authored document.

The same dialog supports a selected attached original through the local Studio
connector. The standalone preview has no such connection and explains that
limitation instead of falling back to another provider. It:

- Reads and hash-checks one explicitly selected original against its stored text,
  target and current document/version. It does not mix supporting sources or
  silently grade the edited canvas. Missing extraction provenance is labelled
  `stored-source-text-unverified-v1`, not claimed as a verified parser.
- Separates model/catalog loading, explicit browser-local budget approval,
  JD submission, inventory approval, included-evidence approval and the final
  assessment/challenge submission. The fixed `candidate-review` budget ID is
  reused; Start over does not reset spending or silently raise its ceiling.
- Shows the full JD, priorities, recursive AND/OR conditions and advanced full
  inventory corrections. Invalid/incomplete inventories cannot be approved;
  corrections reset consent and produce a new approved revision.
- Shows every source excerpt and explicit whole-excerpt name/contact exclusions.
  Excluding all evidence is blocked. Authors can revisit the inventory/evidence
  before sending; changing either requires the corresponding approval again.
- Displays artifact observations, required gaps, role judgments, communication,
  cited passages, original/challenged reasoning and execution limitations together.
  It has no candidate headline and clearly says suggestions are not generated.
- Restores validated saved results without another AI call. Changes to the open
  document/version/source mark the held result historical and stop further calls.
  Close/cancel discards late completions and preserves existing saved results.

The dialog reuses the existing native modal, typography and contained cards.
Keyboard Escape returns focus; narrow-layout resilience is tested but does not
expand Studio beyond its desktop-supported scope.

[UI tests](../resume-assessment-ui.test.mjs) pass **6 cases**: two source/reference
unit tests and four actual-browser tests, including the editor/Studio realm
boundary with synthetic original bytes and a mocked provider. Final duration:
15,763.2193ms. The preceding 47 candidate contracts also pass (354.8057ms).
Existing 17 Resume units and 72 ATS assertions pass (252.4001ms), plus five
protected review/editor browser regressions (13,220.2691ms). Three desktop/narrow
screenshots were inspected. Main and clean Resume builds pass; Resume JS is
1.14, Resume CSS 1.9, admin CSS remains 1.215. No shared preview was reloaded.
There is no actual-provider/CORS/billing or semantic-quality acceptance claim.

[Development references](../src/js/resume-assessment-sample.mjs) version three
fictional cases and provisional developer-authored expected states, with links
to the relevant acceptance IDs. Comparing scripted responses to these labels
tests the workflow, not model accuracy. Independent human labels, held-out
examples and real paired evaluation remain pending.

## 1. Product contract

One assessment must explain:

1. Whether the submitted artifact can be read and its information associated
   correctly.
2. How well the resume documents the actual job requirements.
3. How clearly and credibly it communicates contribution, scope and outcomes.
4. Which evidence-backed changes would help, and what each change addresses.

These are dimensions of one report, not competing headline scores. Performance,
assessment completeness and confidence in individual judgments are different
concepts. None is a hiring probability, a candidate's worth or a universal ATS pass.

Keep the existing journey: Prepare > Resume ATS Check > review > Edit / Continue
editing > explicit Re-check > checked PDF. Keep the launch/setup dialog unchanged.
No automatic paid calls, employer submissions, source replacement or application
decisions. No public release until separately approved.

### Decision lineage

| Existing decision | Reason to preserve | Candidate treatment |
| --- | --- | --- |
| Hybrid scoring | An opaque AI headline barely reflected measurable improvements. | Retain observable measurements and explainable contributions; do not return to a model-invented headline. |
| Bidirectional scores | Applying a bad suggestion must be able to make the result worse. | Test helpful, neutral and harmful changes; no guaranteed increase or first-draft score bands. |
| Local measured checks | Useful editing feedback without a paid call or invented PDF/AI observations. | Current diagnostic facts, not a second authoritative total. |
| Keyword and neural matching | Reproducible terminology coverage plus retrieval beyond exact wording. | Evidence-discovery aids; similarity or presence is not proof of a requirement. |
| Lexical fallback | An unconfigured embeddings service differs from a configured service failing. | Preserve that distinction and explicit consent for a degraded configured service. Record the actual method. |
| Evidence rubric | Stable JD criteria, defensible reasons, qualitative outcomes and explicit unknowns. | Reuse these mechanisms, but validate semantic quality rather than adopting its weights by default. |
| Selective revisions and projections | Understand a recommendation's consequences before applying it. | Preserve before/after inspection and safe Apply; distinguish measured deltas from reassessment. |
| Shared hosted ATS path | One editor and one journey, without relabelling old scores or losing sources. | One candidate evaluator for intake and rechecks; immutable legacy assessments remain readable. |

## 2. Current implementation and ownership

| Existing surface | Reuse | Required change during implementation |
| --- | --- | --- |
| [Shared ATS adapter](../src/js/resume-ats.mjs) | Intake/recheck convergence, assessment-to-editor mapping, migration identities. | Introduce a separately versioned candidate result; do not coerce it into the old blend or mutate legacy results. |
| [Deterministic core](../src/js/ats-core.js) | Tokenization, retrieval helpers and positional observations where valid. | Fix/qualify empty geometry, capped coverage, broad aliases, negation and denominator assumptions. |
| [Evidence review](../src/js/resume-review.mjs) | Inventory-before-candidate, frozen requirements, citation IDs, strict response validation, cancellation. | Explicit compound requirements, evidence-relevance review and versioned dimension rules. No automatic adoption of 60/15/15/10. |
| [Workspace](../src/js/resume-workspace.mjs) | Stable field identity, exact before text, sources, signatures, history and proposals. | Separate diagnostic facts from the assessment; add claim-level revision checks and assessment history handling. |
| [PDF verification](../src/js/resume-pdf.mjs) and [hosted client](../src/js/resume-hosted.mjs) | Actual artifact bytes, completeness, bounds and renderer identity. | Distinguish content inclusion from extraction order and field association; compare intended and extracted links. |
| [Studio host](../src/js/admin-studio.js) | Existing setup, AI selection, original viewer and source retention. | Use the same candidate orchestrator for all assessment entry points; retain actual execution receipts, not only configured model labels. |
| [Editor](../src/js/resume-preview.jsx) | Review/outline/content/design, cards, evidence navigation and save-safe return. | Render the common result and current diagnostics without competing totals. Preserve every editing action. |
| [Worker store](../worker/resume-workspace.mjs) | Private originals, versioned saves, CAS, checked exports and legacy guards. | Validate the new result schema and binding before persistence; preserve existing limits and immutable history. |

The old rebuilt-canvas projection helpers are not the current hosted editor.
The standalone local preview's experimental rubric is not a third equal hosted
assessment choice. Neither should be mistaken for the production route.

## 3. Versioned assessment record

The following is the full target field contract; the foundation above implements
only its documented subset. All referenced IDs must resolve inside the bound
snapshot. Unknown fields, invalid enums, non-finite numbers, duplicate IDs and
dangling references must fail validation. Optional data is explicitly nullable,
not replaced with a successful default.

| Field | Required meaning |
| --- | --- |
| `schemaVersion` | Integer `1` for this new contract; separate from existing document/review schema versions. |
| `id` | Unique assessment identity, stable once persisted. |
| `status` | `complete`, `partial` or `blocked`. Failed/cancelled attempts have a separate receipt, not a successful assessment record. |
| `createdAt` | Completion timestamp. Never used by itself to establish freshness. |
| `binding` | Document ID/version/signature when available; artifact SHA-256/type; target and manifest fingerprints; selected evidence hashes; extraction and renderer versions where applicable. |
| `target` | Frozen mode, level, role, company, complete JD text and source URL when supplied. URL is provenance, not authorization to fetch other links. |
| `method` | Assessment, rubric, prompt, extraction, retrieval and scoring-policy versions; supported language/role/format scope. |
| `execution` | Actual provider/model per executed stage, request receipts, input/output usage when available, reservation and fallback state. Missing actual model identity is explicit. |
| `coverage` | Input character/page/excerpt counts; total/accounted JD segments; total/assessed/unknown requirements; processed evidence IDs and any excluded scope with reasons. |
| `requirements` | Frozen manifest with source spans, importance, compound logic and approval revision. Empty in general mode. |
| `evidence` | Stable source spans, exact text, role/organization/date context and provenance; no inferred employer facts. |
| `dimensions` | Exactly `artifact`, `roleEvidence`, `communication`; each has status, observations/ratings, evidence references, limitations and unresolved issues. |
| `findings` | Stable, criterion/observation-linked findings with priority, rationale, affected fields and revision/question/resolution state. Zero findings is valid. |
| `headline` | `value: null` until a scoring policy passes the release gates; otherwise integer 0-100 plus policy ID, exact contributions and blockers. Always carries an unavailable reason when null. |
| `limitations` | Explicit untested vendors, missing data, method limits and unsupported scope. No boilerplate that conceals an actual failure. |

Freshness is derived against the current snapshot, not stored as a permanently
true boolean. Target, content, evidence, artifact or relevant method changes make
the corresponding observations historical. A failed recheck leaves the previous
assessment intact and shows the failed attempt separately.

Original intake binds to the original file's hash, even before an editable
document exists. Opening an editor links that assessment; it does not pretend the
new rendering is the original artifact. Hosted rechecks bind to the current saved
document and exact checked export. Text-only inputs explicitly lack layout data.

### Requirement and evidence records

- A requirement has `id`, exact JD source spans, `label`, `importance`
  (`required`, `responsibility`, `preferred`), and a condition tree.
- Condition nodes are an `atom`, `allOf` or `anyOf`; every atom has its own exact
  JD span and explicit threshold/proficiency wording when present. Empty groups
  and inferred conditions are invalid.
- Independent requirements are separate. Repetition merges with all source spans
  retained. Alternatives remain `anyOf`; "such as" examples do not become an
  all-tools checklist. Eligibility/application questions remain separate context.
- The complete JD is inventoried before candidate evaluation. Every segment gets
  a disposition; semantic coverage must also be checked, not inferred merely from
  segment counts. User corrections create a new manifest revision.
- Evidence records distinguish `submitted-artifact`, `current-field`,
  `supporting-source` and `author-answer`. Supporting evidence can justify a
  proposed edit but cannot earn submitted-resume credit until included and rechecked.
- Artifact evidence has file hash, page when applicable, character span and
  extracted text; field evidence has field ID and exact snapshot value. Geometry
  is optional and never invented for a text-only source.

## 4. Dimension rules

### A. Artifact readability and extraction

Report observations, not a percentage made from generic formatting penalties.
Each observation has `id`, `status` (`pass`, `warn`, `fail`, `unknown`,
`not-applicable`), method/version, relevant artifact spans and a reason.

Required checks for a supported format:

- Actual selectable/recoverable text and extraction coverage.
- Reading order and association of role, employer, dates and their achievements.
- Contact-field extraction, not merely presence in the editor model.
- Missing, duplicated, garbled or unmapped text; ambiguous section boundaries.
- For generated PDFs: authored-text inclusion, page count/size, physical bounds,
  expected fonts and link targets. Respect the author's explicit page limit.
- For original uploads: format-specific observations without pretending there is
  an authoritative editable model to compare against.

Zero items cannot establish parse success. A failed positional extractor is an
error/unknown, not a clean layout. Column or header placement is a risk observation,
not proof that every vendor loses the content. A simulated reading strategy must
be labelled as such; PDF.js is not a vendor parser.

Missing text, known incorrect association or invalid artifact binding prevents a
successful artifact verdict. Ambiguity is visible and requires comparison. Content
review may still be shown as partial, but cannot imply the artifact is ready.
Never weaken export verification to make an assessment complete.

DOCX and TXT use their supported extraction paths; absent PDF geometry is
not-applicable, not parse=100. Scanned/image-only documents stop with an actionable
extraction limitation until an explicitly approved OCR path is implemented and
evaluated. Format support must be tested separately.

### B. Role evidence

Assess every frozen requirement against all relevant submitted evidence:

| State | Meaning |
| --- | --- |
| `not-evidenced` | Full supported input was examined; the criterion is not documented. This is not proof of inability. |
| `mentioned` | A list or claim, without the demonstration required by this criterion. |
| `partially-supported` | Some material conditions are supported; identify the missing conditions. |
| `supported` | The actual criterion, including its stated proficiency, is supported. Do not invent a higher bar. |
| `contradicted` | Explicit evidence conflicts with the criterion; cite the conflict. |
| `unknown` | Input, context or interpretation is insufficient; explain what would resolve it. |
| `conflicting-evidence` | Sources materially disagree; show both rather than silently choosing one. |

Keyword/similarity retrieval proposes candidate excerpts; it does not set a
rating. Negation, attribution, dates, proficiency and alternatives affect judgment.
FigJam is not automatically proof of Figma proficiency; related tools/domains
must not become unconditional equivalences. An equivalent demonstrated skill can
count without literal wording.

Every positive or contradictory judgment needs relevant evidence and an
explanation of how it satisfies/conflicts with the exact criterion. Citation
existence is only a structural check. Add an independent relevance/contradiction
review stage for candidate evaluation, then test whether it improves correctness;
agreement between models is not proof. Unresolved disagreement remains unknown or
conflicting, not forced into a confident rating.

No scorable JD means role evidence is not applicable. General-mode communication
and artifact checks remain useful, but no invented job match is displayed.
Required gaps and eligibility context remain visible regardless of aggregate.
Relevant duration may be computed only against explicit requirements, with
overlapping periods deduplicated and uncertain dates left uncertain.

### C. Communication and credibility

Keep distinct assessments of scope/ownership, outcomes/credibility and clarity.
Each uses versioned criterion-specific anchors, evidence and a stated reason.
Reuse existing 0-4 anchors as a comparison baseline, not accepted calibration.

- Judge the author's contribution rather than employer prestige or job title.
- Credit qualitative outcomes, delivered value and learning; numbers are not
  mandatory, and dates are not outcomes.
- Do not impose universal MM/YYYY dates, page length, exact English heading text,
  a summary, or a fixed number of bullets as a proxy for candidate quality.
  Explain actual ambiguity or readability problems instead.
- No expected score distribution, first-draft penalty or quota of criticism.
- Protected attributes and proxies do not contribute. Do not infer eligibility
  from nationality, address, age, gaps or graduation year.

## 5. Headline and uncertainty policy

The candidate initially has no new headline formula. Evaluate the existing ATS
blend and evidence-rubric total as labelled baselines in developer evaluation,
never as two new competing user verdicts.

A candidate headline may be enabled only when:

1. Its construct, exact inputs, fixed weights/anchors and exclusions are versioned.
2. Every contribution is reproducible from stored dimension judgments; overlapping
   keyword, semantic and holistic judgments are not added repeatedly.
3. Removing an unavailable input cannot raise a comparable score. Unknown
   required inputs suppress the headline rather than renormalizing a better total.
4. Material parsing failures, unresolved required contradictions and eligibility
   questions cannot be hidden by an attractive average.
5. Benchmark gates pass without tuning merely to lift scores.

The report must distinguish measured input coverage from uncertainty about a
judgment. Do not emit an uncalibrated confidence percentage. A mathematical
possible-score range, if later introduced, is not a statistical confidence interval.
Scores across different methods, targets or manifests are not directly comparable.

## 6. Findings and safe improvements

Each finding references a requirement or artifact/communication observation and
contains: stable ID, priority with reason, present evidence, precise gap, affected
field IDs, expected benefit, and one next action:
`edit`, `ask`, `inspect-artifact`, or `no-change-needed`.

- Prioritize verified content-loss/association issues, material required gaps and
  contradictions before optional polish. Do not invent a fixed number of findings.
- Deduplicate findings about the same underlying issue. Preserve their criterion
  references and original finding identity through editor navigation.
- Before asking for a fact, inspect existing relevant evidence and explain why it
  does not answer the question. Already-supported evidence may resolve a finding
  without a rewrite.
- Proposed wording must map its material claims to evidence: actor/ownership,
  action, object, scope, dates, quantities, outcomes and credentials.
- New claims, stronger attribution, reused numbers with changed meaning and
  unsupported causal claims block AI-prepared Apply until corrected or supported.
  Exact substring/numeric checks remain necessary but are not semantic proof.
- Record author confirmation as author-provided evidence, not independent
  verification. Preserve manual editing; never claim it has passed an AI check.
- Show original/proposed text and evidence before Apply. Recheck the signature and
  field text after saving a named before-change checkpoint. Preserve undo/redo,
  Set aside/reopen, questions, source return, conflict handling and history.

Immediate projections describe deterministic changes only: text length, an
observed diagnostic or terminology presence. No promised ATS point gain. Full
before/after assessment requires explicit consent, the same frozen target and
method, and a current artifact. Neutral and harmful changes must remain possible.
No automatic paid recheck after Apply.

## 7. Execution, persistence and presentation

1. Capture immutable input/source identity and validate complete input limits
   before a paid stage. Do not silently slice text or accept a failed JD fetch as
   a general review when job-specific assessment was requested.
2. Extract the artifact; expose unsupported/ambiguous input and stop unsafe stages.
3. Inventory and approve the target; reuse the approved manifest on rechecks.
4. Evaluate requirements and communication, review evidence relevance, validate
   the common report, then persist against the still-current signature/version.
5. Publish the result to both existing review surfaces using the same adapter.

Retain existing bounded evidence-review limits initially: 20,000 JD characters,
60,000 serialized evidence characters, 300 JD segments and 60 requirements. These
are explicit supported-input limits, not permission to drop material. Provider
context/output budgets may require smaller requests; preflight them and fail
explicitly. Larger inputs need a separately tested partition-and-merge design.

Reserve the complete approved cost of planned stages before execution using the
existing consent/budget mechanism. No implicit verifier calls, automatic repair
loops, retry-on-invalid-response or resetting a spent reservation. Cancellation
cannot promise an already-sent request was unbilled. Record actual stage execution;
configured "automatic selection" is not actual provider/model provenance.

Do not assume current browser-local reservations enforce a cross-device budget.
Embedding-unconfigured uses labelled lexical retrieval without nagging; a
configured service failure preserves the existing choice to continue or cancel.
Neither path uses a provider-independent cosine-to-quality percentage.

Persist only validated complete/partial reports with explicit limitations. Keep
failed attempt metadata separately, without fabricated results. Failed save/CAS,
late responses, navigation and sign-out cannot attach a result to another version
or overwrite newer work. History/undo must recognize the new record. Worker
validation and local preview storage must honor the same schema and size bounds.

Presentation retains the compact dial, shared cards, typography and responsive
layout. During evaluation, the recorded legacy assessment stays clearly labelled;
candidate reports are isolated developer/sample output, not a second user score.
After an approved cutover, one primary report shows dimensions, evidence,
limitations and prioritized findings. Live diagnostics have no competing total.
Pending revisions are separate from findings. Technical provenance stays in
diagnostics; important uncertainty and blockers remain visible.

No source-preview refresh, migration or assessment may replace original bytes.
Historical 72/84/etc. results retain their recorded method and meaning; fictional
sample scores never acquire invented breakdowns.

## 8. Acceptance matrix

These are acceptance goals, not a claim that all 26 cases now pass. The foundation
tests the structural portions of A01-A05, R03-R06, R09, L03 and L05 plus snapshot
identity and serialization. A03/R06 explicitly remain unverified rather than
pretending association or relevance has been solved. Audit probes
below were offline synthetic calls against the legacy code; they are not actual
provider responses, vendor results or frequency estimates.

| ID | Case | Required candidate outcome |
| --- | --- | --- |
| A01 | Empty positional pages/items | No successful parse verdict or 100-point default. |
| A02 | Known bad parse observation becomes unavailable | No improved comparable headline; show unknown/error. |
| A03 | All text is present but role/bullet order or association is wrong | Completeness alone cannot pass association checks. |
| A04 | Missing glyph/word/contact field, wrong link, wrong artifact hash | Specific failure; no successful export/assessment claim for the affected check. |
| A05 | Columns, right-aligned dates and header contact with intact extraction | Report measured behaviour and uncertainty; no universal failure based on style alone. |
| R01 | Skill list versus "No experience with" the same skills | Neither proves demonstrated skill; explicit negation cannot earn positive support. |
| R02 | FigJam-only evidence against Figma proficiency | Related tool is not automatically equivalent proficiency. |
| R03 | "Python or Java" with sufficient Python evidence | `anyOf` satisfied; no demand to add Java. |
| R04 | Forty independent JD skills, resume covers only selected 28 terms | Inventory all 40; missing requirements remain visible, not 100% complete coverage. |
| R05 | Important criterion/evidence beyond old 8k/12k truncation points | Include it within supported limits or fail explicitly before assessment. |
| R06 | Valid but irrelevant title citation used for every rating | Relevance review flags it; schema validity cannot establish supported requirements. |
| R07 | Meaning preserved through paraphrase, acronym or reordered evidence | Equivalent judgments within predefined repeatability tolerance. |
| R08 | Preferred item followed by required sibling; examples and repeated criteria | Correct local importance, no accidental all-tools requirement or duplicate credit. |
| R09 | Ambiguous, conflicting, omitted and explicitly contradicted evidence | Distinct states with precise reasons; no guessed resolution. |
| C01 | Strong qualitative outcomes without numerical metrics | Full support remains attainable when the criterion is met. |
| C02 | Repeated keywords, verbose padding or inflated title | No improved role-evidence judgment from repetition/title alone. |
| C03 | Job-irrelevant identity/prestige counterfactual | No assessment change attributable to the irrelevant attribute. |
| S01 | "Supported work" rewritten as leading an organization or holding a credential | Unsupported claim blocks AI-prepared Apply; source citation alone is insufficient. |
| S02 | Existing number reused for another outcome or another person's work | Claim/attribution check rejects unsupported reassignment. |
| S03 | Helpful, neutral and harmful changes | Appropriate dimension changes; no forced score increase. |
| S04 | Existing evidence already answers the proposed follow-up | Resolve without demanding a redundant fact or rewrite. |
| L01 | Cancel, invalid response, budget exhaustion, failed save or changed signature | Explicit failure; no extra calls, wrong-version result or lost prior assessment. |
| L02 | Intake, original recheck and hosted current-export recheck | Same method for equivalent bound inputs; different artifacts remain distinguishable. |
| L03 | Missing JD, failed URL fetch, unsupported language/format or oversized input | Explicit scope/unknown/error; no success-shaped generic substitution. |
| L04 | Legacy history, current drafts, originals, saved versions and source returns | Preserved through local candidate integration and eventual opt-in migration. |
| L05 | Malformed/null/string score, duplicate criteria, unknown evidence IDs | Strict schema rejection; never numeric coercion into a valid result. |

Observed baseline audit examples: positive skill list and explicit negation both
returned keyword rate 86; FigJam/Figma returned 100; a selected 28-term set against
40 synthetic skill requirements returned 100 with no missing terms; empty layout
returned parse 100; removing parse=0 raised a blend from 74 to 80. A mocked review
with only the title "Designer" cited for all ratings passed structural validation
at 100. These define regressions to defeat, not proof that all current assessments
are wrong.

### Evaluation protocol and proposed quality gates

1. Version fixtures, reference labels, prompts, model settings and scoring policy.
   Separate development cases from held-out acceptance cases before tuning.
2. Start offline with the exact adversarial cases above, real generated artifacts
   from fictional documents and mocked failure/lifecycle responses.
3. Then, only with explicit provider budget and data permission, run a paired
   current-versus-candidate evaluation. Use the same inputs and provider settings
   where possible; disclose differences in calls, tokens, latency and method.
4. Start with the currently supported English product-design levels and
   PDF/DOCX/TXT. Broader professions/languages are a coverage expansion requiring
   their own labelled cases, not inferred support. Use anonymized permitted real
   examples only when separately authorized; synthetic cases do not prove vendor
   acceptance.
5. Human reference judgments must be independent of the candidate output.
   Ambiguous/disputed labels are adjudicated or retained as ambiguity. Randomize
   output order for review; do not label the preferred system to reviewers.
6. Measure by slice and report counts, not just averages:
   field extraction precision/recall and association accuracy; requirement
   precision/recall and compound-logic accuracy; evidence relevance;
   contradiction detection; false criticism; revision factual fidelity and
   usefulness; repeatability; cost and latency.

Proposed initial gates, to freeze before a paid acceptance run:

- All deterministic contract/lifecycle and adversarial acceptance tests pass;
  zero silent truncations, lost sources, stale applications or unapproved calls.
- Zero unsupported new claims in accepted AI revisions on the acceptance set.
  Report the sample size; zero observed failures is not a universal guarantee.
- At least 95% requirement precision and recall, 95% cited-evidence relevance and
  95% role/employer/date/bullet association accuracy in each supported test slice;
  at most 5% materially false criticisms. These are initial targets, not achieved
  results or a claim of industry leadership.
- No missed required criterion in the curated critical regression cases; any
  such miss blocks promotion even if the aggregate metric passes.
- At least 95% requirement-state agreement across three identical-input runs
  on the repeatability subset, excluding human-adjudicated ambiguity; no
  supported/contradicted flips. Report all flips and denominators.
- Candidate must improve the identified baseline failure cases, preserve existing
  valid behaviour and demonstrate paired quality improvement on the held-out set.
  Publish uncertainty/sample-size limits privately with the result. Insufficient
  evidence means expand evaluation, not claim superiority.
- Record p50/p95 latency, total stage cost and failure rate. Establish approved
  absolute cost/latency ceilings from the initial measured pilot before promotion;
  there is no evidence yet for an honest fixed production budget/SLA.

Passing a small fixture set is necessary, not sufficient. Size held-out samples
before paid execution to support the desired precision and meaningful slices;
report uncertainty rather than treating a tiny perfect sample as validation.
Vendor claims need separately authorized, vendor-specific observed results.

### Shared actual-artifact inputs — October 4 follow-up

[Input capture and extraction](../src/js/resume-assessment-input.mjs) now provide
one candidate boundary for three explicitly selected inputs in the same dialog:

- **Uploaded original:** PDF, DOCX or UTF-8 TXT, maximum 20 MB; takes an explicit
  target and creates a snapshot with no editable document/version. The dialog
  takes that target from the open editor, but never its resume content. Uploading
  neither attaches the file nor writes an original or assessment into the editor.
- **Attached original:** fetches immutable original bytes and extracts again,
  ignoring potentially stale cached source text. Checks attachment, original
  SHA-256, current document/version and target. Supporting files are not combined.
- **Current checked PDF:** saves pending edits through existing persistence,
  uses the existing checked-export service, fetches the exact export bytes and
  parses them. Checks export identity, content signature, renderer, byte length
  and SHA-256. Re-verifies authored text, page count/size and physical bounds
  against actual PDF positions, and separately checks that the recovered evidence
  text contains the authored fields. No existing score/history is recalculated.
  A cached export from an earlier saved version is reusable only when content
  signature and renderer still match; the assessment binds the current version,
  not the export's older creation version.

[The shared PDF reader](../src/js/resume-pdf.mjs) is reused by hosted finalization
and candidate extraction. It copies bytes, retains positions and observed link
targets, bounds pages/items and destroys the parser on completion/cancellation.
Candidate parsing rejects unreadable text, unmapped glyphs, unresolved markers,
invalid UTF-8, extraction warnings and over-limit text without truncation.
DOCX uses the actual Mammoth raw-text parser; it does not claim page geometry.
TXT preserves recovered whitespace. PDF line reconstruction is not verified
reading order or role/employer/date/bullet association. Link syntax checks do
not establish that each intended link target survived correctly.

The Studio `getInput` callback reconstructs an authoritative snapshot in the
receiving realm from bytes and parsed inputs and checks the expected fingerprint;
it does not trust a transferred snapshot brand. Current guards rebuild that
binding before later stages. Uploaded-file results track target changes, not
unrelated editor-body changes. Source/export results track their saved document.
Existing same-bundle and older `getSource` developer callers remain compatible;
the latter still explicitly labels stored extraction as unverified.

All three choices can prepare and display file text/hash without an AI connection.
Sending still requires the open local Studio connector and all existing staged
budget/data approvals. No current score is replaced; no automatic AI recheck.
The Summary/Phone verification error remains blocking and unresolved.

Evidence: **55 candidate contract tests** pass (517.8833ms), including eight new
input cases and a real fictional DOCX parsed by Mammoth. **Eight UI tests** pass
(35408.213ms): two earlier units and six actual-browser cases, including source,
unlinked upload and checked-export connection across separate Studio/iframe
bundles; actual rendered PDF re-upload; missing-text and wrong-hash blocking;
unchanged originals/scores, cancellation and 390px fit. These use synthetic
documents and mocked provider replies only. **36 existing Resume unit tests plus
72 ATS assertions** pass (9462.2648ms); **seven protected browser regressions**
pass (55531.6616ms), including real hosted export finalization and long/bulleted
PDF preservation. The narrow checked-export screenshot was inspected.
Main and Resume builds pass; Resume JS1.15/CSS1.10, adminCSS1.215.

**Scope at that checkpoint (superseded by the launcher follow-up below):** the upload contract works without a document, but its
visible picker currently lives inside an open editor. It is not yet connected
to the pre-editor Studio ATS intake or legacy original-recheck launchers.
Consequently step 2 remains partial rather than claiming all-entry-point
convergence. Server-authoritative extraction/history/budgets, actual association,
safe revisions, independent quality benchmarks and production cutover remain
separate roadmap work. No real AI, owner-file submission, shared-editor reload,
cloud checklist update or public release was performed.

### Pre-editor intake and original-recheck launchers — October 4

With `candidate=1` on a loopback **Studio** URL, ATS setup's New view now offers
**Preview candidate assessment**, and the original review offers **Candidate
original recheck**. Ordinary sessions and the legacy check/regenerate actions
are unchanged. The experimental action remains inside New setup rather than
appearing as an action for an unrelated history selection.

Both launch the same existing Resume iframe in an intake-only mode. That mode
mounts the shared native candidate dialog, **not** the editor: no library load,
editable-document creation, migration or score write occurs. The bridge refuses
editable-resume storage requests from this mode. Closing restores the parent
setup/review and trigger focus without a cloud-library refresh.

Intake uses either the selected uploaded file or the explicitly selected site
resume. Recheck reads the retained original, using the existing integrity-checked
source reader when necessary; cached review text is never a substitute. Missing
originals fail rather than falling back to a site replacement or edited canvas.
The target comes from current setup or the selected review. A job-mode request
without a JD fails; no automatic URL fetch or general-mode fallback occurs.
General mode deliberately excludes a hidden previous JD.

The host validates the iframe caller, opt-in gate, open Studio, pinned owner
session, parent lifetime and source selection. Retained-review records are pinned
against later changes. Target/byte fingerprints are rebuilt before subsequent
stages. Preparing is read-only; the existing catalog, budget, inventory, evidence
and assessment/challenge permissions still apply. Results remain separate
browser-local candidate envelopes, not relabelled legacy ATS results.

Validation: 55 contract tests pass (410.224ms), eight existing candidate UI tests
pass (26220.4909ms), and a new actual-Studio integration case plus three protected
ATS cases pass (25127.9847ms). The new case completes a mocked three-call intake,
checks retained-original and site-PDF inputs, stale target/review and missing-JD
blocks, caller/cancellation/closed-session guards, zero editor-storage requests,
unchanged history/score and focus restoration. Starting over re-reads a changed
external target rather than comparing against a stale opening descriptor.
Existing 36 Resume units and
72 ATS assertions also pass (5712.4726ms). An intake screenshot was inspected.
Main and clean Resume builds pass: JS1.16/CSS1.10/adminCSS1.215.

The first original-file run exposed Windows local-server MIME detection:
`serve.py` served `.mjs` as `text/plain`, blocking the PDF worker. The helper now
explicitly serves `.js`/`.mjs` as `text/javascript`. Tests verify that mapping and
serve the actual worker with it. **An already running instance needs a separately
approved restart to use the new mapping; shared servers/tabs were not restarted
or reloaded.** This is not a public deployment or real-provider acceptance.

The candidate's local entry-point convergence is now implemented. Actual
reading order/field association, Summary/Phone root-cause repair, safe revisions,
central history/budgets and independent quality acceptance are still pending.

### Checked-export structure and visible-text verification - October 4

[resume-pdf-structure.mjs](../src/js/resume-pdf-structure.mjs) adds the versioned
`authored-pdf-order-v1` inspection for **checked exports only**. It compares
authored experience roles, employers, dates and achievements with actual PDF
positions in native content-stream order and a geometric row-order probe.
Both probes must agree on associations and authored entry order for `consistent`.
An association mismatch in both is `mismatch`; missing/repeated/shared fields,
ambiguous boundaries or disagreement remain `unknown`. A row-order probe is
not a column-aware reader or a vendor ATS parser. Original/uploaded files do not
inherit associations from an edited canvas.

Uniquely located fields retain exact original PDF references: one-based page,
zero-based item and UTF-16 character offsets. Short fields embedded in longer
authored text and unexpected word prefixes cannot masquerade as unique matches.
The inspection requires role/employer anchors, dates when authored, achievements
and unique section boundaries. It is bounded to 50 pages, 50,000 items, 120,000
positional characters, 500 fields, 65 candidate matches per field and 4,000 output
span references; exceeded/ambiguous bounds do not yield a partial grade.

The foundation computes this optional inspection before hashing, rather than
trusting caller-supplied results. It is frozen into the extraction fingerprint
and recomputed during saved-report validation. Flagless snapshots retain their
old shape. The scoped `authored-structure-agreement` observation does not replace
the global unverified reading-order/field-association observations or enable a
headline. The existing candidate dialog shows both probes, reasons, coverage and
exact field locations before AI consent and in the combined report.

Real fictional PDFs reproduced missing Summary and Phone-field errors with
U+00AD soft hyphens and U+200B zero-width spaces dropped during rendering.
Shared visible-text comparison now ignores those invisible controls; only an
authored soft hyphen may also become a printed ASCII hyphen at that break.
Other punctuation remains literal: missing words, phone digits, negation and
visible hyphens still fail. This fixes the reproduced formatting case, **not a
confirmed diagnosis of the owner's historical file**. "Phone" means the resume's
phone-number field. Admin mode and all Prepare tools remain desktop-only.

Checked-export evidence extraction also excludes only recognized page counters
using the same footer rule as geometry verification. It retains full positions
and uses the distinct `-checked-body-v1` extractor identity. Original/upload
extraction retains its footer text. Long achievements spanning pages therefore
remain contiguous evidence without discarding authored fractions.

Validation: 66 candidate/structure cases pass (5693.4769ms), including 11 new
structure cases, two of them actual browser-rendered PDF cases covering Inter,
Gelasio and multipage content. Eight candidate UI cases pass (36638.3862ms);
the desktop structure screenshot was inspected. Existing Resume/ATS and routing
checks pass: 56 Node tests, including 36 Resume units plus 72 ATS assertions
(13561.7573ms). Five protected browser cases pass (50348.5323ms): hosted PDF
finalization, long fields/counters, bullet import, original review and candidate
launchers. Main and clean Resume builds pass; JS1.17/CSS1.10/adminCSS1.215.
The mixed candidate UI/structure suites are now mandatory in the sequential
`resume-workspace` browser shard, not the browser-free root job.

This is partial Step 3 implementation, not original-file semantic association,
independent parser quality or vendor acceptance. No paid AI, owner-file
submission, shared-editor reload/server restart or public release occurred.

### Original-PDF order probes and separated evidence runs - October 4

`inspectPdfReadingOrder` adds `pdf-order-probes-v1` without an authored document.
All newly captured candidate PDFs receive the inspection; original/uploaded
files still receive **no authored-field verdict**. It retains native item order,
geometric row order and, when one repeated gutter hypothesis is supported by at
least three rows, a possible two-region order. Full-width spanning rows separate
bands so a hypothetical column traversal does not cross those boundaries.
Every exposed order retains each visible item exactly once, with original
page/item/UTF-16 character references. No alternative is automatically selected.

A gutter may be aligned dates or a table, not columns. Multiple incompatible
gutters, distant runs with insufficient support and different native/row orders
remain ambiguous. Rotation/direction metadata is captured from PDF.js; missing
metadata, non-horizontal/non-left-to-right text, overlapping boxes, invalid
visible bounds and pages without positioned text remain unknown. The method
supports at most 50 pages, 2,000 positional items, 120,000 positional characters
and 512 candidate horizontal gaps per page. Whole-input limits produce no
partially graded pages. These are bounded horizontal probes, not OCR, table
understanding, verified reading order or employer parsing.

Candidate PDF extraction now separates distant same-row runs rather than
silently joining unrelated text. Adjacent fragments still join; the shared gap
threshold is `max(24 PDF points, 3 * smaller text height)`. It does not reorder
columns, rewrite bytes or assign roles. This opt-in extraction has a
`-separated-runs-v1` identity. Legacy import and hosted PDF finalization retain
their prior default extraction; checked-body footer handling remains intact.

The optional inspection is computed before snapshot hashing, frozen, fingerprinted
and revalidated in saved reports. Old flagless snapshots/request shapes remain
valid; newly extracted results use the new method identity, not retroactive
reinterpretation of older results. The candidate shows page reasons and exact
alternative orders before model connection and in the combined report.
Assessment and challenge receive only the version/status/fixed reasons and an
attribution/absence warning, not raw geometry or excluded positional text.
JD inventory remains candidate-independent. This warning is not proof that a
real model obeys it; independent judgment quality remains unverified.

Validation: 73 candidate/structure cases pass (10693.4253ms), including seven new
cases across geometry, actual two-column PDF rendering, separated extraction,
snapshot tamper rejection and both judgment requests with name/contact exclusions.
Eight candidate UI cases pass (27657.4407ms); the original-PDF desktop screenshot
was inspected. Existing/routing 56 Node tests pass (5758.057ms), including 36
Resume units plus 72 ATS assertions. Five protected browser cases pass
(66220.2911ms). Main and clean Resume builds and generated syntax pass;
JS1.18/CSS1.10/adminCSS1.215. Initial two test failures were incorrect expected
error strings: tampering was correctly rejected by the existing validator;
assertions now match that exact error and the failed log is retained.

Step 3 remains partial: source-region/evidence binding and trustworthy original
role/employer/date/achievement attribution are still needed. No calibrated
score, vendor acceptance, paid AI or owner-file diagnosis is claimed. Admin and
Prepare remain desktop-only; shared tabs/servers and public release are untouched.

### Exact PDF evidence binding and visible JD source coverage - October 4

Candidate PDF extraction now retains line-boundary metadata, including PDF.js
empty-item end-of-line markers. `mapResumePdfEvidence` reconstructs the same
separated-run text and exact source spans from positional items. Trimming,
adjacent fragments, moved list markers and page separators preserve original
UTF-16 item offsets; inserted formatting spaces do not become invented glyph
references. Checked-body mapping uses the existing recognized-counter rule;
original mapping retains original counters.

The optional `bindPdfEvidence: 'pdf-evidence-map-v1'` snapshot contract requires
complete line-boundary metadata. It recomputes the extraction, rejects changed
text/unresolved markers and derives `evidence[].pdfSpans` itself before hashing.
It does not accept a caller's proposed span list or guess an occurrence by
matching repeated words. The artifact retains a version/count summary; its
text/positions/method are fingerprinted and evidence maps are frozen. Saved
report validation rejects substituting another occurrence even when its wording
is identical. Old flagless snapshots remain valid. New mapped extractor
identities cannot silently discard their provenance method.

The candidate shows exact excerpt locations before model connection, during
evidence approval and through the shared citation details in judgment/history
views. The locations establish extraction provenance, not employer attribution
or factual truth. Models still receive only included excerpt IDs/text and
existing fixed uncertainty metadata: positional span arrays are deliberately
excluded from both requests, so they neither bypass exclusions nor inflate
provider evidence payloads. Existing evidence-text budget checks remain before
local positional decoration.

JD inventory review and the combined report now show every original segment,
its proposed disposition/reason and the criteria/atomic quotes linked to its
exact character ranges. Segments with no scored criterion remain visible with
an explicit confirmation warning. Invalid inventories do not show stale valid
coverage or permit approval. This makes omissions inspectable; accounting for
a segment is **not** proof that every clause was understood. Existing priority,
compound-condition editing, advanced corrections and approval resets remain.

Validation: 75 candidate/structure cases pass (14019.1263ms), including two new
mapping cases and expanded actual two-column/two-font/multipage checks. The
existing two-pass privacy test now uses mapped PDF evidence. Nine UI cases pass
(30960.8761ms), including a new unscored/invalid JD coverage case; two desktop
screenshots were inspected. A final focused PDF UI case passes (11534.2264ms)
after correcting singular/plural source-span labels. Existing/routing 56 Node
tests pass (11512.3562ms), including 36 Resume units plus 72 ATS assertions;
five protected browser regressions pass (65609.602ms). Main and clean Resume
builds pass; JS1.19/CSS1.10/adminCSS1.215.

The owner targeted progress through Step 5, then clarified to continue the normal
sequence without requiring them to manage each increment. Existing no-paid-AI,
desktop-only and separate release/quality gates remain unchanged. Exact source
binding is implemented; verified semantic role/employer/date/achievement
relationships, actual JD interpretation and evidence-judgment quality remain
unfinished. No complete Step 3-5 or real-provider quality claim is made.

### Integrated source attribution and full JD semantic challenge - October 4

[resume-assessment-semantics.mjs](../src/js/resume-assessment-semantics.mjs)
implements the versioned `source-attribution-v1` contract. New shared candidate
inputs and scripted examples opt in; old flagless snapshots retain their exact
request/record behavior when validated against their original authoritative
inputs. This is a local implementation checkpoint, not measured model accuracy.

The existing assessment call now classifies **every included excerpt** as
experience, general/unscoped or uncertain, and proposes bounded experience
groups with exact role/employer/date/achievement quotations. Quotations must
occur uniquely within included excerpts; offsets are resolved by code. Missing
metadata is null, not inferred. Duplicate or overlapping achievement attribution, excluded/
unknown references and malformed/incomplete records fail without repair.
At most 60 groups, 40 achievements per group and 300 association references are
accepted. Unmapped meaningful experience text cannot borrow a settled group.

The existing challenge call must review **every excerpt classification, every
proposed group and every original JD segment**, including segments labelled
benefits/context/eligibility. Its instructions cover omitted clauses, importance,
scope, alternatives/conjunctions, examples, proficiency, duration and negation.
Disputed/missing source relationships remain unknown; agreeing citations alone
do not override them. There are still three calls in job mode (inventory,
assessment, challenge), two in general mode, with unchanged stage token caps,
whole-phase reservations, explicit consent and no retry/repair.

These results are enforced, not merely displayed:

- Uncertain classification, incomplete/disputed groups or unmapped experience
  words withhold affected atomic judgments and communication ratings.
- Any unresolved JD segment or reported inventory issue withholds role judgments;
  it does not silently produce an easier replacement inventory.
- Unresolved source interpretation or a known unreadable PDF page prevents a
  settled absence claim.
- Original judgments and challenge explanations remain alongside the derived
  result. `model-agreed` explicitly means model-challenged, **not independent
  verification**. Source uncertainty is not converted into a headline score.

The full envelope retains a recomputed/frozen `interpretation`; tampering or
discarding this record is rejected. The desktop report shows proposed groups,
exact source quotes/ranges, every excerpt's classification and every JD segment's
challenge. A fourth versioned scripted example deliberately assigns an employer
incorrectly while both rating passes agree; the source challenge still withholds
the affected judgment, including after reopening history.

Validation: 82 candidate/structure/semantic cases pass (10283.4797ms), including
seven new semantic cases and preserved flagless contracts. Ten UI cases pass
(39736.9967ms), including the new source-veto/history case; desktop screenshot
inspected. Existing/routing 56 Node tests pass (11034.3117ms), including 36 Resume
units plus 72 ATS assertions. Five protected browser cases pass (65789.7645ms).
Main and clean Resume builds pass; JS1.20/CSS1.10/adminCSS1.215.
The final seven semantic cases also pass (301.7934ms) after strengthening the
unreadable-page absence check to use original geometry even when the bounded
order probe cannot produce page summaries.

**Completion boundary:** the integrated local mechanisms for supported inputs
in Steps 3-5 are now implemented and exercised with scripted responses. Genuine
semantic accuracy, broad layout/language coverage, OCR, the owner's historical
Summary/phone-number diagnosis and vendor acceptance are not thereby proven.
The separately approved real-provider and independent held-out evaluations
remain required. No public release, paid call, owner-file submission, shared
tab reload or server restart occurred.

### Shared presentation and derived findings - October 4

[resume-assessment-presentation.mjs](../src/js/resume-assessment-presentation.mjs)
provides one versioned adapter for the candidate dialog used by intake, retained
originals and checked exports. It revalidates the **full evaluation envelope**
against the authoritative snapshot before producing an immutable view. A
standalone foundation, modified result or wrong snapshot is rejected. History
regenerates identical finding identities from the same inputs.

The summary separates failed/risk/unresolved artifact observations, compound
criterion support and uncertainty, unavailable communication judgments and
input coverage. Counts are explicitly not scores or semantic-confidence
percentages. No calibrated headline or competing total is introduced. Original
proposals, evidence, PDF locations, JD coverage and both model passes remain
available beneath the prioritized actions.

Findings are derived from existing challenged judgments, not another model call:

- Artifact failures and source/JD uncertainty precede required gaps and optional
  communication work. Each finding records stable identity, priority/reason,
  precise recorded gaps, evidence, criterion references, expected benefit and
  one next action: inspect the artifact, clarify evidence, or keep supported text.
- Shared source causes absorb their affected role/communication references; one
  JD inventory challenge is not repeated for every withheld role rating. Identical
  communication reasons and evidence share an action while retaining all criteria.
- A supported OR condition does not create a gap for its unused alternative.
  Contradictions remain gaps, unknowns remain clarification requests, and generic
  observations about missing independent verification do not become invented
  editing tasks. Existing passages are shown before asking for more evidence.
- Authored field IDs are exposed only when native and row probes uniquely locate
  the same physical PDF spans. These are overlapping locations, not approved Apply
  targets. Original files and ambiguous/repeated fields never borrow canvas IDs.
- No automatic rewrite, Apply or paid recheck is connected by this adapter. An
  empty findings list is not proof of a perfect resume.

Receiving pilot state is cloned into the iframe's own JavaScript realm before
strict validation. This fixes a real cross-realm presentation failure without
trusting copied snapshot brands or weakening validators. Loading/error states
are explicit; obsolete asynchronous views cannot replace a newer result.

Validation: 46 presentation/semantic/evaluator/pilot cases PASS429.8314ms;
10 candidate UI cases PASS34407.3113ms; 37 existing Node cases PASS4744.8569ms
(36 Resume units plus the wrapper containing72ATS assertions); three protected
browser cases PASS61603.5595ms. Main build PASS740ms; clean Resume build passed
through isolated UI setup. Desktop summary/findings screenshot inspected.
Initial evidence retains one incorrect rejection-message assertion and the
cross-realm UI failure; both were corrected and rerun, not waived.
ResumeJS1.21/CSS1.10/adminCSS1.215. No paid AI, owner data, cloud/public changes,
shared reload/restart or phone support is implied. Steps8-10 are the next target.

### Claim-mapped revisions and checked Apply - October 4

[resume-assessment-revisions.mjs](../src/js/resume-assessment-revisions.mjs)
implements revision contract v1 behind the existing local candidate flag.
Only a current saved checked PDF can supply an editable target. The author
explicitly chooses a finding and an achievement, summary or text field with
agreeing unique native/row locations. Every meaningful character in that field's
PDF spans must belong to included evidence; an included fragment cannot leak
an excluded remainder through the full original-field text.

The revision stage returns one proposed replacement, one focused question, or a
no-change decision. It reads all included evidence first. Optional author facts
require explicit confirmation and remain labelled author-provided, never
independently verified or evidence already in the submitted resume. The 8,000
character author-input limit rejects oversized input without silently truncating
it. A no-change decision must cite submitted evidence, not new author facts.

Each replacement has up to40 nonoverlapping, uniquely quoted claim passages,
each with up to8 exact source references. All meaningful replacement text must
be covered. A separate challenge reviews every claim and the whole before/after
for changed actors, ownership, scope, dates, units, outcomes, credentials,
negation and qualifiers. Missing/malformed maps fail; disagreement, uncertain
source interpretation and numbers absent from a claim's cited evidence block
Apply. Matching numbers alone never prove unchanged meaning.

The shared evaluator session/receipt helpers now support this separate
revision-plus-challenge phase while preserving original assessment prompts,
requests and validation. Both calls are reserved together in the same pilot
budget. Failures remain reserved; there is no automatic repair/retry/refund.
Pilot revision/question receipts are an optional versioned collection; old
browser ledgers remain readable. Restoring a receipt revalidates context, claims,
requests and reservations against the original assessment and current document.

The dialog shows original/proposed text, exact claim evidence, challenge reasons
and blockers. Apply requires explicit review confirmation. It revalidates the
full receipt and current document/version, saves a named before-change
checkpoint, verifies its exact acknowledgement, checks again for edits or
cancellation, and saves only the selected replacement with provenance.
Existing save conflicts/errors remain explicit; a failed final save may leave
the reviewed change pending locally, not falsely marked saved or rolled back.
Undo/redo, manual editing and legacy suggestion controls remain intact.
Apply preserves the old assessment as historical and makes no assessment call.

Validation:56revision/evaluator/pilot/presentation/semantic cases PASS890.8861ms;
final10boundary cases PASS715.0597ms;11candidate UI cases PASS44809.2327ms;
final real-PDF revision/8001-character/receipt/Apply/undo case PASS15736.1749ms
including setup.37existing Node cases PASS9598.7524ms include36Resume units
and72ATS assertions;4protected browser cases PASS62523.3293ms.
Main build PASS702ms; clean Resume build passed through isolated UI setup.
Desktop revision image inspected. Initial fixture-coordinate, accessible-label
and blocked-font expectation failures were corrected, not waived.
ResumeJS1.22/CSS1.10/adminCSS1.215. No real provider, owner file, cloud deployment,
public push or shared reload/restart. This verifies local control flow, not
independent semantic safety or model quality. Explicit recheck/comparison and
central spending authority remain Steps9-10.
Final complete-field coverage uses per-item byte maps rather than scanning every
evidence span for every character. Ten boundary cases PASS702.0896ms; the final
real-PDF UI case PASS23133.5523ms including setup; main rebuild PASS3782ms and
clean Resume rebuild PASS. The acceptance conditions are unchanged.

### Explicit edited-PDF recheck and equivalent-input comparison - local Step 9

The current checked-PDF result offers **Prepare explicit PDF recheck**, including
after an applied or manual edit makes it historical. This renders/reads the
current saved export without a model call. The old raw input is retained only
in memory so the Studio/iframe boundary can independently reconstruct and
fingerprint the original snapshot; copied snapshot brands are never trusted.
Both initial preparation and recheck use the same checked-export helper.

Reconnect to the existing browser budget with explicit consent and the original
actual provider/model. Confirm the original complete approved inventory,
including priorities and compound conditions, without another inventory call.
Review the fresh evidence/exclusions and separately consent to assessment plus
challenge. Changed targets, document identity, models, missing baselines or
budget resets are rejected before any call. Rechecks cannot edit their inventory.
Two calls share the original budget; failed attempts remain reserved.

The versioned comparison validates both full evaluation envelopes against their
own immutable snapshots. Comparable transitions require the same editable
document, full target, approved manifest, evaluation/extraction/rendering/
provenance methods, actual provider/model and reviewed exclusion scope.
Price differences alone do not change the measurement method. Identical result
IDs and reverse chronology cannot count as a fresh comparable recheck.
PDF bytes, recovered text, authored-document and saved-version changes are
reported separately. Unchanged text does not rule out layout or model variation.

Known role support, communication ratings and artifact statuses may improve,
worsen or remain unchanged. Unknown/conflicting/unavailable judgments remain
unresolved. Contradiction versus absence is not forced onto an arbitrary scale;
added/removed artifact observations are not automatic passes. Non-comparable
inputs suppress improvement counts. There is no overall score, point promise,
causal claim or independent truth claim. Each side's reasons and citations use
that side's own PDF evidence and exact spans.

Result and derived comparison are saved in one browser-ledger write. Failed
storage cannot publish a partial successful pair; reservations/failure receipts
remain. Paired history restores only after full validation and recomputation.
Old version-1 ledgers remain readable. Original bytes are not saved in this
ledger; reconstructing comparisons across reloads/devices awaits durable private
input/history infrastructure. This does not complete Step 10 or Step 11.

Validation uses fictional PDFs and scripted responses only: 64 comparison,
evaluator, pilot, revision, presentation and semantic cases; 11 candidate UI
cases; 37 existing Node cases including 72 ATS assertions; four protected
browser journeys. Main and clean Resume builds pass. The desktop comparison
shows separate version-specific quotes and explicit unknowns. An initial missing
PDF media type was fixed through the shared preparation helper; no validator was
weakened. A transient existing set-aside explanation assertion passed unchanged
on the complete four-journey rerun; both logs are retained.
Resume JS1.23/CSS1.10/adminCSS1.215. Local Step 9 mechanisms are implemented;
central cross-device spending and independent quality gates remain pending.

### Central spending authority - local Step 10

Central candidate calls now have a dedicated owner-session/allowed-origin-gated
worker path. It uses the existing private `VAULT` R2 binding and conditional
ETag writes, following the operational-state/storage pattern. No new cloud
resource, migration or live configuration was applied.

The fixed owner-wide budget identity is `candidate-review`, stored at
`system/resume-assessment-budget-v1.json`. It is not chosen per browser,
document, assessment or request. Initial approval must explicitly confirm a
positive USD ceiling within the operator's maximum. An existing ceiling cannot
be raised, lowered, reset or deleted through this API. Clearing browser history,
reconnecting or restarting the service does not reset the server ledger.
Browser-development and other AI usage are separate; untrusted old local spending
is not imported as authoritative history. This is not an account-wide provider
billing limit or a retroactive migration of the legacy AI budget.

Routes under `/admin/resume/assessment/`:

- `GET budget`: current approval, ceiling, reserved/remaining amount, observation
  time and server-owned model/price metadata; no model request.
- `POST approve`: exactly `{confirmed:true,maxCost}`. Same-ceiling approval
  preserves all prior reservations.
- `POST reserve`: the existing complete versioned phase plan. The server
  validates identity, allowed stages/order, current server model/price quote,
  timestamps, exact output limits and recomputed worst-case amount. The entire
  inventory or assessment/challenge or revision/challenge phase is reserved.
- `POST execute`: exactly `{reservationId,provider,model,stage,system,user,maxTokens}`.
  The server validates capacity and the matching reservation, then durably
  claims the stage before invoking the provider. Challenge cannot precede a
  received first pass. A stage is attempted at most once, even after lost
  acknowledgement, timeout, storage failure, concurrent devices or refresh.

The worker constructs the actual OpenAI/Anthropic request using its stored key,
fixed provider URL, non-streaming text-only body and exact token cap. Browser
URLs, extra bodies/tools, streaming, alternate caps and unapproved models/prices
are rejected. OpenAI reasoning models use `max_completion_tokens`; there is no
temperature repair, alternate model or automatic retry. Redirects are rejected.
Request/response byte limits and bounded execution deadlines apply.

All reservations remain charged against the ceiling: failures, cancellations,
unknown usage and lost acknowledgements receive no automatic refund. Token
usage is an observation, not a settled bill. The bound depends on the approved
server prices and provider honoring its limits; real-provider billing and model
behavior remain separate pilot gates. The server stores plan/attempt identity,
request hashes, status, timing, request IDs, usage and failure information, not
resume bytes, prompt text or complete model output. A full history record is
still Step 11. The ledger has explicit 1,000-phase/2MiB bounds; nothing is pruned
to make room.

**Disabled unless explicitly configured:** `RESUME_ASSESSMENT_POLICY` is an
operator-owned JSON string. No value was added to the live worker or checked-in
deployment configuration. Missing policy/storage or expired prices fail closed.
Its exact schema is:

```text
{
  version: 1,
  provider: "anthropic" | "openai",
  checkedAt: <verified price timestamp in epoch milliseconds>,
  maxCost: <positive USD ceiling, whole millionths>,
  models: [{
    id: <exact actual model ID>,
    pricing: { input: <USD per million>, output: <USD per million> },
    maxInputTokens: <positive integer>,
    maxOutputTokens: <integer at least 12000>,
    contextWindow: <integer greater than 12000>,
    reasoning: <boolean>
  }]
}
```

Prices must be independently verified by the operator, positive, no more than
24 hours old and not future-dated. Do not refresh the timestamp without checking
the prices. The worker never accepts browser-supplied pricing as authority.
Enabling policy, updating allowed origins or conducting a real-provider pilot
requires separate approval; this implementation does not grant it.

The real Studio connector defaults to the server authority and uses server model
metadata, explicit budget consent, guarded session/input binding and dedicated
reserve/execute endpoints. The old browser mode is an explicitly selected
development option, never an automatic fallback when the server is unavailable.
Separate local history keys prevent mixing authorities. All candidate input
paths, revisions and rechecks use the selected authority. Last-observed budget
values are labelled; **Refresh shared budget (no AI call)** retrieves new totals
without changing the assessment phase. Server checks remain authoritative even
if the displayed observation is stale.

Offline validation: 72 candidate contract cases, 12 candidate UI cases, all31
existing worker regressions, 37 existing Node cases including72ATS assertions,
and four protected browser journeys. Tests use real local R2 conditional writes,
concurrent service instances, runtime restart persistence and fictional provider
responses. The browser PDF revision/recheck journey runs under both authorities,
including disabled-server refusal, fresh consent, same-budget reservations,
history/refresh, no automatic calls after Apply and working undo/redo.
One legacy intake fixture initially assumed browser authority; it now explicitly
selects its scripted development mode and passes. The failure log is retained;
no production guard was weakened.
Main and clean Resume builds pass; desktop budget UI inspected.
Resume JS1.24/CSS1.10/adminCSS1.215. Local mechanisms through Step 10 are
implemented, not deployed or independently quality-accepted.

### Durable private assessment history (local Step 11)

The existing private `VAULT` holds immutable content-addressed original files at
`assessment-history/artifacts/<sha256>` and conditional assessment records at
`assessment-history/records/<assessment-id>.json`. This adds no cloud resource.
`RESUME_ASSESSMENT_HISTORY=enabled` is an explicit operator gate and remains
unconfigured live, independently of the central spending policy.

Owner-session/allowed-origin protected routes under `/admin/resume/history/`:

- `GET records?cursor=...`: metadata pages of 20 records.
- `GET records/<id>`: validated full record and save ETag.
- `GET artifacts/<sha256>`: verified original bytes, authenticated attachment.
- `PUT artifacts/<sha256>`: exact nonempty bytes/type/hash, at most 20 MiB,
  immutable conditional creation and idempotent identical retries.
- `PUT records/<id>`: complete JSON, at most 4 MiB, explicit `If-Match: *` for
  first creation or the last acknowledged ETag for append.

Both writes require `X-Assessment-Retention: confirmed`. The UI separately
explains and asks permission to retain the **entire original file and captured
document/extraction, including contacts excluded from AI**. Budget consent does
not authorize this storage. No automatic upload, model call, editor replacement,
deletion, pruning or historical Apply occurs when browsing history.

Records retain original input metadata, artifact/snapshot hashes, the full
assessment, original/reused inventory, revisions, client-reported failure
diagnostics and optional comparison/baseline identity. Every record reconstructs
its own branded snapshot from raw input and validates complete evaluator and
revision envelopes. Inventories validate their expected request/reservation or
explicit baseline reuse; diagnostics have strict bounded shapes. Comparison
validation uses each side's original bytes and recomputes the comparison.
Original inventories retain their result association through local restoration.
Saving a chain retains unsaved ancestors instead of discarding prior comparisons.

Assessment/revision request hashes, response JSON digests, actual request IDs,
usage and reservation plans are matched against central receipts when available.
Known mismatches are rejected. Missing older bindings/browser-origin records
remain explicitly `owner-imported-not-server-attested`; they never acquire a
manufactured server attestation. The other status,
`server-receipted-not-independent-truth`, attests those matching execution
receipts, **not factual accuracy, independent extraction, inventory approvals or
client-reported failure outcomes**. The budget ledger stores only hashes, not
original files, prompt text or full provider output.

Fixed input/results/comparison cannot change; revisions and diagnostics can only
be appended without altering/removing prior entries. Concurrent stale updates
fail rather than silently merge. Exact retries acknowledge the existing record.
Artifact upload and record publication are not a multi-object transaction: a
failed/cancelled metadata write may leave an unindexed original. The client says
so explicitly; retrying the file is idempotent. Upload reads are bounded by size,
cancellation and a 60-second deadline; unexpected storage errors return 503.

The history panel loads only on request, displays the common assessment,
comparison and read-only revision receipts, and downloads exact originals.
Restored checked exports can seed explicit rechecks with fresh budget/evidence/
call consent. Parent/iframe boundaries clone raw inputs/results and reconstruct
snapshots in the receiving realm. Clearing local history cannot reset server
spending or discard remote records; history reads do not require fresh pricing.

Historical extraction remains the captured client extraction, not a new
server-side PDF extraction. Checked-export restoration currently requires a
supported renderer/method version. Future incompatible versions must report that
limitation, never delete raw artifacts or silently reinterpret old assessments;
a general historical-renderer compatibility layer is not implemented.

Offline evidence: 136 full candidate/PDF/history/browser cases pass, including
actual isolated R2 restart, 21-record pagination, CAS conflicts, exact excluded
original bytes, forged response rejection, old unbound receipt compatibility,
strict inventory/diagnostic validation and interrupted writes. The actual
Studio/iframe PDF journey saves two revisions plus a comparison, clears only
fixture local history, reopens/downloads exact bytes without editor mutation or
AI calls, and reconnects a saved baseline to the unchanged central budget.
31 worker regressions, 37 existing Node cases (including 72 ATS assertions), and
four protected browser journeys pass. Main and clean Resume builds pass;
JS1.25/CSS1.10/adminCSS1.215. No live enablement, paid provider, owner-file
submission, shared-page reload or public push occurred.

### Step 12 offline evidence and remaining semantic gates

The complete offline suite now runs together, rather than treating a few visible
cases as complete acceptance. This establishes the following **mechanisms**, not
all 26 semantic outcomes:

| Acceptance goals | Offline evidence | Still requires independent model/reference evaluation |
| --- | --- | --- |
| A01-A05 | Empty/invalid input refusal; actual PDF glyph/link/order/field probes, exact hashes, bounds and uncertainty; source/edited-file separation. | Correct association and extraction across the supported real-world distribution and unsupported layouts. |
| R01-R02, R06 | Explicit atomic states, two-pass semantic review, evidence/exclusion binding and disagreement gates; no automatic lexical equivalence in candidate scoring. | Negation, tool proficiency and actual citation relevance; two agreeing passes can still be wrong. |
| R03-R05, R08-R09 | Compound logic, full inventory/source coverage, no hidden truncation, exact spans, importance/schema and distinct unknown/contradiction states. | Correct generated decomposition, local importance, duplicate identification and truthful absence/contradiction judgments. |
| R07, C01-C03 | Deterministic reconstruction, frozen equivalent-input comparisons and no mandatory numerical-metric/headline default. | Paraphrase repeatability, qualitative outcome recognition, padding resistance and identity counterfactual fairness. |
| S01-S04 | Every claim and complete revision challenged, source/author evidence bound, disputed Apply blocked, safe questions/no-change and improved/neutral/worsened comparisons. | Actual factual fidelity, attribution of numbers, usefulness and nonredundant questions. |
| L01-L05 | Cancellation, budgets, immutable files, CAS/history, stale input, entry-path parity, unsupported input/schema rejection and protected legacy journeys. | Real-provider billing/latency and actual supported desktop/cloud acceptance after separate activation. |

The four scripted development examples are not held-out reference labels.
Step 12's executable contract pass is recorded; the complete semantic acceptance
matrix remains open into Steps 13-15. No headline weights, quality percentages,
repeatability claims or promotion permission are inferred from these tests.

### Step 13 capped probe: $4 approval, credential/setup blocker

After reviewing the proposal, the owner answered the explicit paid-permission
question: **"Mate do not exceed more than $4. Pls"**. The maximum is therefore
**$4 USD**, not the earlier $8/$15 proposals. This permission is for fictional
candidate data only; it does not authorize owner-data submission, unrelated
legacy/embedding calls, live configuration/deployment, budget increases or retries.
The owner separately authorized checking only whether `ANTHROPIC_API_KEY` exists.
It was **not configured**; no value was displayed and no other credential store
or shared editor was accessed. **Paid requests: zero. Spend: $0.** A secure key,
the isolated execution harness and the existing input/phase approval gates remain
required. The paired evaluation and Steps 14-15 are not complete.

**Recommended first probe:** Claude Sonnet 5.5 (`claude-sonnet-5-5`), standard
direct Claude API, no tools, caching, batch, priority/fast-mode or regional
premium. Official documentation checked October 4 lists **$2/million input
tokens and $10/million output tokens**, 1M context and 128K maximum output:
[pricing](https://platform.claude.com/docs/en/about-claude/pricing) and
[model specification](https://platform.claude.com/docs/en/models/sonnet-5-5/overview).
Availability to this account is not verified; prices/capabilities must be
rechecked before execution, never just given a fresh timestamp.

**Compatibility implementation, offline-tested:** Sonnet 5.5 rejects sampling
parameters according to its
[migration guide](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide).
The local candidate worker now selects the explicit immutable
`anthropic-sonnet-5-5-medium-v1` policy: adaptive thinking, medium effort, no
sampling parameters, unchanged stage caps and non-streaming one-attempt requests.
Other Anthropic and both OpenAI request paths preserve their existing parameters.
The incompatible browser-development Sonnet 5.5 path refuses before storage or
invocation; it never silently falls back.

New server reservations freeze `requestPolicy`; a missing or changed policy
blocks execution before a provider call. Older ledger records remain readable,
but their unbound reservations cannot resume under newly selected settings.
Successful receipts carry the policy through evaluator/inventory/revision
execution, failure diagnostics and private history provenance. One phase cannot
mix recorded policies. Different or one-sided unavailable policies withhold
comparable improvements; old paired records keep their original validation
semantics. Existing history cannot silently lose a server-matched policy.
Policy IDs and their parameter definitions must remain immutable; future changes
need a new version. Do not catch a provider rejection and change parameters.

Proposed data and sequence:

1. Prepare two entirely fictional, versioned resume/JD cases: explicit negation;
   and a two-employer checked PDF with an attribution/ownership trap, an OR
   requirement and qualitative outcome evidence. Generate the
   PDF locally from fictional authored fields. No owner resumes, contacts,
   employment details, URLs, supporting files or production history are used.
2. Freeze reference expectations before calls. Developer-authored expectations
   and these already-known cases are development evidence, not held-out labels.
3. Start with one three-call candidate assessment and inspect it before
   proceeding. Preserve the existing inventory/evidence approval gates; budget
   consent does not authorize automatic approval of a generated inventory.
4. Finish those **two complete candidate assessments**, each inventory +
   assessment + challenge. Repeated-run and broader related-tool cases are
   deferred, not counted as passed.
5. On the fictional checked-PDF case, request one checked revision and one
   explicit post-edit recheck: two calls each, with the existing independent
   author/Apply/evidence/call consent gates. A blocked/no-change revision is a
   valid observed outcome, not permission to invent a successful edit.

The existing reservation function was evaluated locally with the verified
published prices, its unchanged 110,000 worst-case input bound, stage output
caps and 10% margin. It gives the following **reserved maxima**, not predictions
of actual bills:

| Phase | Maximum calls | Reserved USD |
| --- | ---: | ---: |
| One inventory | 1 | 0.330000 |
| One assessment + challenge | 2 | 0.748002 |
| Two complete candidate assessments | 6 | 2.156004 |
| One revision + challenge | 2 | 0.660001 |
| One explicit recheck, frozen inventory | 2 | 0.748002 |
| **Total reduced probe** | **10** | **3.564007** |

**Owner-approved ceiling: $4 USD for this isolated probe.** Stop on the first
invalid/refused/truncated response, identity mismatch, unacknowledged persistence,
budget failure or disputed unsafe change. No automatic repair, retry, refund,
fallback, extra run or increased cap. The first complete assessment reserves
$1.078002, already included above. The earlier $8 and $15 proposals are
superseded and not authorized. Remaining headroom does not authorize an extra
run. A test uses the actual reservation implementation to assert exactly
3,564,007 millionths of USD for these ten planned stages; an additional
assessment/challenge phase and an attempted increase to $8 are rejected.

Run only after secure credential provisioning and offline harness verification
in an isolated local evaluator/CLI or test
service with a **persistent, never-reset paid-pilot ledger** and the fixed
approved ceiling. API credentials must be supplied through an approved secure
local mechanism, never pasted into chat, source, logs or committed files.
Do not delete a paid ledger as if it were a disposable scripted test fixture.
The live worker, shared browser pages and live history flags remain untouched.
Local setup/credential access is itself a prerequisite, not permission already
granted. Provider retention is governed by the account terms; this is not a
zero-retention claim. The cap covers this probe, not unrelated account spending.

**Paired baseline is separately gated:** the actual hosted legacy path is
`resumeStudioAssess -> atsEvaluate -> assessAtsResume`, including optional
OpenAI/Gemini embeddings through `atsEmbed`, not the older two-call
`reviewResumeWithAI` helper. The current candidate reservation protocol does not
cover those embedding calls or automatically cap the legacy completion helper.
Do not price a fake baseline, silently disable its neural path, or claim the $4
cap covers it. Before a genuine paired run, freeze the baseline configuration,
verify its actual embedding/completion prices, route every paid operation through
explicit bounded accounting, test failure behavior offline, and present a total
paired budget for approval. No production baseline code was changed.

October 5 quote-preparation trace: the logical agent limit is 12 calls, but
`aiTextRequest` can perform two HTTP attempts per call when negotiating an
unsupported temperature parameter. The raw completion envelope is therefore
**up to 24 requests**, plus the embedding path and any enabled automatic
evaluation. Count each raw attempt separately; do not discard the first
reservation or silently disable baseline behavior. Both streaming and
non-streaming helpers use this request boundary. Full advertised output
capacity, growing context/schema bytes, backend embedding-provider selection,
configuration/history binding and durable cumulative authority remain necessary
parts of the unfinished accounting work.

The owner authorized preparation of **one complete capped quote**, with **no
spending until explicit approval**. The previous 207-call candidate scenario
alone is 74.646154 USD additional; with the current 3.322008 USD held, that is
77.968162 USD **before the still-unresolved baseline**. This is neither a complete
quote nor an approved ceiling. Current authenticated model metadata could not
be collected because the browser-tool connection remained disconnected after
a requested reconnection. No baseline runtime change, new provider call or
complete quality evaluation occurred during this trace.

#### Offline bounded baseline accounting - October 5

The subsequent implementation adds
[a persistent accounting library](../tools/resume-baseline-accounting.mjs) and
[focused tests](../resume-baseline-accounting.test.mjs). This is a developer
backend library, not a standalone execution CLI or an enabled live service.
No real baseline enrollment or provider request was performed.

The existing Studio path now has an explicit, loopback-candidate-only capability:
`window.__RKStudio.resume.baseline.version === 1`, with `prepare` and `assess`.
An old bundle without this capability must be rejected before execution;
passing an extra argument to an old unguarded method is not safe negotiation.
Preparation uses the same saved-export/signature checks and extraction as the
existing assessment, returning `{ input, inputSha256 }` without inference.
The input binds actual artifact bytes, extracted text and level/company/JD.
The accounting adapter verifies that binding before any model request; changed
inputs cannot reuse a reservation. Semantic inputs have their own derived
binding. Receiving-realm cloning precedes strict JSON validation.

The guard preserves the actual legacy evaluator, prompts, JSON parser/repair,
task agent, provider output capacities, streaming request flags and temperature
negotiation. Coordinator, delegate and draft requests all pass through the
same guard at the actual fetch boundary. The shared retry limit is two, so
12 logical agent calls reserve for up to **24 raw completion requests**, plus
at most one configured embedding request. Each raw retry gets its own identity
and exact body hash; a failed first attempt is not forgotten.

Key boundaries:

- The policy requires exact model IDs, input/output capacities, upper-bound
  prices, current explicit price-check time, runtime and configuration hashes,
  an explicit embedding selection (including null), and a finite cumulative
  ceiling. Prices are not automatically renewed. Unknown metadata is an error.
- Bounded completions currently support Anthropic/OpenAI. Gemini completion is
  rejected, not silently substituted. Embeddings support OpenAI/Gemini and reuse
  the worker's unchanged normalization. The Studio capability requires known
  saved-provider metadata, selected-provider routing, automatic evaluation OFF
  and a zero evaluation budget. None of those settings is changed by the guard.
- Provider scope, manual model, routing policy and actual embedding selection
  must match the frozen configuration. Configured embeddings cannot silently
  become lexical fallback. A verified no-embedding configuration remains
  explicitly unavailable, matching the observed legacy behavior.
- Twenty-four source/dependency-manifest files are fingerprinted. Execution
  requires agreement with both the loaded runtime and current disk source.
  Changed code requires a new process and separately reviewed binding.
- Whole-run worst-case allocations are reserved before requests. The separate
  ledger also protects the **full historical authority ceiling**, not merely
  its observed reservation, avoiding a cross-ledger spending race. Current
  historical reservation remains 3.322008 USD; its protected ceiling is 6 USD.
  These are different figures, neither a refund nor a settled provider bill.
- R2 conditional writes and a separate filesystem identity/lock protect
  enrollment and updates. A synced pending intent precedes each ledger write;
  the committed ledger hash follows acknowledgement. Missing records,
  rolled-back runs/attempts, partial writes, lost acknowledgements and orphaned
  locks block further execution. There is no automatic reset, repair, refund,
  policy amendment or lock deletion.
- Requests must have explicit bounded output limits. Unpriced tools, images,
  cache directives and unknown request features reject. Input is bounded
  without truncating it. Replies are bounded to 8 MB; cancellation, broken
  streams and unknown transport outcomes retain the whole allocation.
- This gated benchmark adapter buffers the complete response before releasing
  it, preserving response bytes and stream parsing but **not incremental
  token-display timing**. It is not a production streaming replacement.
- The existing live/default path remains unchanged when no accounting adapter
  is supplied. Existing candidate single-attempt behavior is preserved.

Library flow:

| Operation | Meaning |
| --- | --- |
| `baselineCodeFingerprint()` / `review()` | Unpaid fingerprint/quote preparation; no inference or automatic enrollment. |
| `approve({ approvalSha256 })` | Separate operator enrollment only after explicit owner approval of that exact packet. Not authorized in this batch. |
| `reserve({ id, inputSha256 })` | Reserve a complete run within the cumulative ceiling; duplicate run identities reject. |
| `bindBaselineAccounting(...)` | Bind a run to source/configuration verification, guarded raw requests and an explicit embedding transport. |
| `baseline.prepare(...)` / `baseline.assess(...)` | Read-only input preparation, then the distinct gated legacy assessment entry with the bound adapter. |
| `status()` / `finish(...)` | Inspect or explicitly close a run without refunding reservations. HTTP completion alone is not independent assessment acceptance. |

Final verification: **131 focused cases pass** (21 guard cases plus 110 existing
routing/Studio/pilot cases), 10107.8566 ms. Another 31 worker cases,
two targeted ATS/single-attempt cases and two existing candidate browser journeys
pass. The browser journeys exercise actual PDF/revision/Apply/recheck/history
regressions, not a live bounded-baseline connection. Final main build passes;
Resume rebuilds in browser verification.

An initial integration fixture confused a delegate instruction with the
coordinator prompt; the corrected fixture uses the exact coordinator prefix.
A later source-binding check exposed a genuine cross-realm JSON boundary issue;
receiving-side cloning fixed it without weakening the validator. Both failed
receipts are retained rather than counted as passes.

**Remaining:** actual current catalogue/configuration capture, the controlled
saved-Studio connection adapter, complete campaign allocation/quote and explicit
execution approval. Routing-history isolation and independent evaluation inputs
must be fixed in the benchmark method, not inferred from these unit fixtures.
There is no complete all-in price or real paired/held-out acceptance yet.

At closeout, normal browser tools responded again, but the shared Studio was
session-locked and its loaded bundle lacked `resume.baseline`. The read-only
cached routing-policy result is not fresh authenticated catalogue/key metadata.
No unlock, reload, settings change or inference was attempted.

#### Saved-Studio baseline adapter - October 5

[`connectBaselineStudio`](../tools/resume-baseline-studio.mjs) now connects an
existing local candidate Studio page and its already-open saved-Resume iframe
to the persistent Node accounting store. It does not open a document, navigate,
reload, sign in, approve spending or reserve a run automatically.

```js
const connection = await connectBaselineStudio(page, { document, exportId, signal });
try {
  const prepared = await connection.prepare(); // unpaid, no enrollment
  // Review/approval/reservation happen separately; not authorized by connection.
  const result = await connection.assess(store, { runId, inputSha256: prepared.inputSha256 });
} finally {
  await connection.close();
}
```

The caller must supply a fresh, separately approved/reserved run before
`assess`. A connection attempts execution once only; completion or failure
closes the run without a refund. Session, page, iframe, source, configuration
and capability changes fail rather than reconnect. Caller-supplied store
approval is an engineering prerequisite, not evidence of owner consent.

Playwright bindings carry opaque operation IDs. Original request closures and
session credentials stay inside the page; request bodies and bounded responses
cross the accounting boundary. Each upstream call starts only after the durable
claim. Exact HTTP error bodies, retry IDs and buffered streaming bytes are
preserved. Pinned OpenAI/Gemini embedding requests use their exact saved-provider
proxy routes, not the fallback embedding route. Unexpected frames, replay,
oversized responses and unknown/cancelled outcomes fail closed.

The main build stamps `resume.baseline.sourceSha256` from the **26-file**
runtime fingerprint, including the adapter and build script. The adapter rejects
unstamped/stale version1 bundles before preparation or execution. Watch builds
track these inputs too. This is a trusted-build freshness marker, not remote
attestation against a compromised page. The earlier24-file audit remains a
historical snapshot; it is not approval for this revision.

Verification: **37 guard/transport cases pass** (21 existing accounting/source
cases, eight new browser-adapter cases, eight existing Studio bridge cases),
27428.9406ms. Another110routing/Studio/pilot cases pass555.425ms; two existing
candidate PDF/revision/Apply/recheck journeys pass59681.1502ms.
Main build4647ms and Resume builds pass; emitted runtime stamp matches
`9a1a57cc6fe34d4836bd07fb71acbaff00f5eb362f9fe6a807e2080828942b0d`.
Browser adapter cases use scripted saved-Resume capabilities and intercepted
provider responses, not a real-provider baseline or independent quality result.
Actual legacy evaluator parity remains separately covered by source integration.
The initial22/27run failed because the installed Playwright version no longer
supports handle-mode bindings; opaque IDs/page-held handles fixed that boundary.
Its receipt is retained, not counted as a pass.

The owner explicitly allowed metadata-only inspection after normal passkey
unlock. The first checks still reported a locked session; after "unlocked again"
the shared browser client disconnected before inspection. No authenticated
catalogue was captured, no credentials exported and no inference attempted.
The actual historical state remains9calls/$3.322008reserved/all4terminal.

**Still required:** current authenticated metadata, controlled routing-state
method, final cohort/reference review, complete combined campaign allocation
and capped quote, explicit execution approval, real paired/calibrated/held-out
evaluation. This adapter does not complete those independent acceptance gates.

#### Authenticated metadata and proposed campaign ceiling - October 5

**Historical, now rejected proposal.** The owner subsequently rejected this
campaign and superseded the isolated Sonnet-only product direction with
task-aware eligible-model selection. Retain the arithmetic and original evidence
for accountability, not as current scope, a spending request or required work.

Normal browser tooling subsequently recovered. Permitted metadata-only reads
confirmed Anthropic configured, OpenAI/Gemini not configured, selected-provider
routing and automatic evaluation OFF/daily budget0. The authenticated Anthropic
catalogue returned13models. Sonnet5.5 advertises1,000,000input/128,000output
tokens; current Studio catalogue prices and
[official pricing](https://platform.claude.com/docs/en/about-claude/pricing)
agree at$2/$10 per million input/output tokens.
The public loaded bundle still has no bounded baseline capability.
No credentials left the browser and no inference was requested.

The owner selected **both systems pinned to Sonnet5.5 in an isolated comparison**,
explicitly not the as-is automatic-routing benchmark. This approves the method
direction only: no shared settings were changed and no spending was approved.
Isolation must freeze model and routing history separately; merely restricting
the guard's allowed model list does not make the task agent choose that model.

The current conservative accounting policy reserves full input/output capacity
for up to24raw baseline requests: **$78.72 per assessment**. This is not an
expected bill. Retaining all current automatic choices would require$393.60
per assessment at the most expensive available model's declared capacity/rates.
The candidate's existing seven-call PDF assessment/revision/challenge/recheck
workflow reserves at most **$2.486005**, using the actual current reservation
helper (including its rounding), not an empty-prompt usage estimate.

For transparency, a **proposed, unapproved finite scope** of2pilot,9calibration,
36held-out and18additional repeat workflows totals65workflows. Reserving
two baseline assessments per workflow yields455candidate calls and up
to3,120baseline calls:

| Item | Maximum reserved USD |
|---|---:|
| 65 candidate workflows | 161.590325 |
| 130 baseline assessments | 10,233.60 |
| Additional provider reservation | 10,395.190325 |
| Protected historical authority ceiling | 6.00 |
| Cumulative provider ceiling | 10,401.190325 |

A two-workflow pilot alone would require$325.85201 cumulative authority under
the same conservative policy. Historical actual reserved$3.322008 remains
distinct from its protected$6authority. These figures are **not recommended
spending, an expected invoice, automatic approval, or a complete all-in quote**.
No ledger was enrolled or expanded.

Scope, source families, independent references/reviewer cost, calibrated
headline, sampling adequacy, latency target and combined campaign enforcement
are not finalized. Reviewer labor/tax/additional infrastructure are unquoted,
not zero. The saved-Studio baseline reads verified PDFs; separate original-format
extraction tests must not be mislabeled as byte-identical paired comparisons.
There are no unbounded retries or automatic sample expansion in this proposal.
Fresh metadata/prices must be rechecked before future approval. Steps13-15
remain blocked on these inputs and explicit paid-execution permission.

Report every stage's actual model/request identity, validated output, usage,
reservation, elapsed time and failure; inspect disagreements and unsafe
revisions. This reduced probe has no repeated-run acceptance slice. Two development
cases cannot establish 95% accuracy, population p95 latency, fair performance
across slices, calibrated headline weights or superiority over the baseline.
Steps 13 paired evaluation, 14 calibration and 15 independent held-out acceptance
remain incomplete until their separate evidence and approvals exist.

Offline compatibility evidence: 141 full candidate/PDF/history/browser cases,
31 worker regressions, 37 existing Node cases (including72ATS assertions) and
five final browser journeys (policy-bound private history plus the four protected
legacy journeys) pass. Exact constructed Sonnet requests, policy drift, old
receipt readability, unknown-policy comparisons, stripped-provenance rejection
and the $4 reservation ceiling are tested without any real provider. Resume
JS1.26/CSS1.10/adminCSS1.215; no live policy, keys, owner files or public deployment
were changed. This is offline compatibility evidence, not a successful API probe.

### Isolated four-dollar probe harness - offline verification and real probe, October 4

The local CLI is now implemented in
[`tools/resume-assessment-probe-cli.mjs`](../tools/resume-assessment-probe-cli.mjs),
using the existing evaluator, revisions, actual worker budget route and private
history contracts through
[`tools/resume-assessment-probe.mjs`](../tools/resume-assessment-probe.mjs).
It does not introduce another scoring engine or change the shared Studio UI.
**At the unpaid preparation checkpoint, calls and spending were zero.** After the owner's
October4 follow-up, process-environment-only credential access is authorized,
with use still gated by individual phase approvals. The new presence check again
returned `NOT_CONFIGURED`; no key value or other credential store was read.
The owner separately approved unpaid preparation of the fictional originals.
The fixed local workspace was initially prepared for review only: zero operations,
zero reservations/attempts and **no spending ledger created**.

**Later owner review and Studio connection:** the owner approved both fictional
originals ("looks good to me mate"), then requested reuse of Studio's saved
connection instead of entering an environment key. Earlier real $1 Resume and
Storyteller evaluations did use that approach: the provider key stayed encrypted
server-side, and the owner session stayed in the signed-in page. Re-entering a
key is not intrinsically required.

The owner authorized a separate live Studio tab and completed the normal passkey
sign-in. One authenticated, read-only `/admin/ai/keys` check returned HTTP200 and
`anthropicConfigured:true`. Only status booleans were returned; no provider key
or session token was exported, and no paid inference or content write occurred.
The two local previews were not reloaded or changed. This confirms connection
availability, not access to the planned model or current model pricing.

**Studio-backed transport is now implemented and verified offline**, using
[`tools/resume-assessment-studio-bridge.mjs`](../tools/resume-assessment-studio-bridge.mjs).
An actual unpaid connection check also succeeded in a separately authorized,
temporary Edge window after the owner signed in and allowed the normal
localhost permission prompt. No model inference occurred during that check. The check window,
owned bridge server, connection descriptor and operation lock were closed or
removed normally; existing Studio/local-preview tabs were untouched.

The transport reuses the existing persistent local $4 ledger and actual worker
budget implementation before forwarding a request through Studio. API keys
remain server-side; the owner session remains in the signed-in page. No
credential profile/storage is copied. The CLI's internal placeholder is not a
credential and never goes to the remote proxy. This bounds this isolated
runner, not unrelated Studio/account spending or other computers.

`--studio` must be supplied to both `review` and `run`; the transport choice is
part of the exact approval hash and recorded phase metadata. A changed transport
cannot reuse the other mode's approval. Old completed probe phases without that
optional metadata remain readable. The provider body remains fixed Sonnet5.5,
adaptive thinking/medium effort, no sampling, no streaming and existing caps.
No legacy model-selection/completion helper or browser-development refusal is
bypassed, and no production assessment flag or deployment is changed.

The loopback-only broker uses an ephemeral port, exact Studio Origin/Host checks,
a private random connection ticket and one claimed browser connection. The
ticket is a temporary local capability, not an API key or owner-session token;
it is kept in `studio-connection.json` inside the fixed private workspace and
removed on normal closure. Only the runner can enqueue a validated request;
browser endpoints cannot submit arbitrary provider requests. Requests are
delivered once; duplicate deliveries/results and unsolicited acknowledgements
are rejected. Failed/lost delivery or cancellation retains the existing phase
reservation and stops progression. Response bodies and connection/request
lifetimes are bounded. Upstream error details are not exported from the page,
and browser transport closure does not assert assessment success.

Unpaid connectivity command:

```powershell
node .\tools\resume-assessment-probe-cli.mjs check-studio
```

This requires already-prepared originals, opens no paid phase and reads no
environment key. The command announces the private connection-descriptor path;
an authorized signed-in page connects by importing the broker's `/client.mjs`
module and calling its default export with that descriptor. Automation can use
the `onStudioBridge` callback on `runProbeCommand`; start the browser client
there without awaiting its complete polling loop, then await it after the CLI
operation. Authentication/permission errors must not be retried automatically.

**Browser permission boundary:** the integrated browser reported
`loopback-network: denied`; the owner's screenshot showed no localhost option
in its Site Permissions panel. Devices (USB/serial/HID/Bluetooth) is not the
needed permission. Do not save unrelated permission changes, clear storage,
disable security checks or override IP address-space classification.
[VS Code's permission documentation](https://code.visualstudio.com/docs/debugtest/integrated-browser#_permissions)
and [Edge's localhost guidance](https://learn.microsoft.com/en-us/deployedge/ms-edge-local-network-access)
were checked. Current Edge's separate `loopback-network` permission was tested
as both denied and granted in disposable fixtures. The live integrated browser
permission was not changed. The owner explicitly authorized temporary native
Edge instead and approved its normal prompt.

The actual browser client returned `transportClosed:true` and calls0.
The real `check-studio` report has the same digest as the original prepared
state, `92a43755121e6e85f4b253b46bd62ffa96f02c72730a7c15624bcfa207ed5cc0`,
with operations0, reserved0, attempts0 and spending `initialized:false`.
Original hashes and document version1 are
unchanged at that unpaid checkpoint; no paid ledger existed then. That check
browser closed normally. Later paid phases used separately approved temporary
windows, verified prices/model availability and exact phase packets, below.

Validation: all **191** candidate/PDF/history/browser/worker cases pass
(160candidate/PDF plus31worker),292048.2247ms. Eight added cases cover the
Studio CLI's complete7phase10call3.564007USD simulated workflow across restarts,
zero environment-key access, no-call `check-studio`, transport-bound consent,
origin/ticket/duplicate guards, cancellation, missing/changed authentication,
safe error reporting and actual browser permission denial/grant. Main
build4079ms and clean Resume build pass. No UI/CSS/renderer version change;
JS1.26/CSS1.10/adminCSS1.215 remain. This offline run made no real inference
calls; it was not rerun or promoted to semantic acceptance during paid execution.

**Original real execution outcome: stopped after three calls.** Official model,
pricing and migration documentation was genuinely checked at
`2026-10-04T12:04:33.350Z`: `claude-sonnet-5-5`, $2/M input and $10/M output,
with the existing adaptive/medium/no-sampling policy. The owner separately
approved the exact inventory and assessment packets, including temporary native
Edge sign-in. An interrupted approval Submit card was not treated as consent;
a shorter replacement received explicit assessment approval. No portfolio UI
fix or browser-permission override was performed.

The inventory succeeded with one required-by-default Python atom, exact JD
span0..6. The two-call assessment phase sent only the approved fictional
negation/customer-interview excerpts, excluding name/contact. Both assessment
and challenge returned parsed JSON; strict challenge semantic record validation
then rejected the response with `Semantic review: invalid record fields.`
The persistent phase is failed, `stopped:true`, `next:null`. No PDF phase,
resume edit, retry, reset or reservation refund occurred.

| Stage | Input tokens | Output tokens | Token-priced estimate (USD) |
| --- | ---: | ---: | ---: |
| Inventory | 1447 | 153 | 0.004424 |
| Assessment | 2668 | 699 | 0.012326 |
| Challenge | 3054 | 938 | 0.015488 |
| Total | 7169 | 1790 | 0.032238 |

These estimates are **not a settled bill**. The original **$1.078002 reservation
remains held under the unchanged $4 cap**, and the ledger is initialized.
Separate-process status verified the saved failed operation, three receipts,
unchanged originals/document version1 and normal owned transport cleanup.

The first draft necessarily passed validation before challenge execution, but
the failure path at that time retained only execution/reservation metadata, not draft
or malformed challenge bodies. The exact offending field and semantic negation
outcome therefore remain unknown; neither may be reconstructed or claimed as a
pass. This exposes an offline diagnostic/failure-output-retention gap. Preserve
strict validation and stopped paid state while investigating it. Steps13paired
evaluation,14calibration and15held-out acceptance remain incomplete.

**Latest actual continuation outcome:** the owner separately approved unpaid
registration and the exact two-call negation reassessment. Current pricing was
genuinely reverified at2026-10-04T13:26:47.044Z. Both calls completed, but the
challenge omitted `semantic.version`; the received semantic keys were only
`excerpts`, `groups` and `segments`. Strict validation rejected the result.
Both exact response bodies and their receipt/hash bindings are now retained.

The raw draft marks Python `contradicted`, citing the explicit negation; the
raw challenge agrees. Customer-interview job attribution remains uncertain.
These are preliminary model observations, not an accepted full assessment or
independent truth. No missing field was inserted, and no failed result was
rewritten. The original failure's missing output remains unrecoverable.

The two new calls used2668/665 and3020/850input/output tokens:
$0.026526token-priced estimate, bringing the five-call estimate to **$0.058764**,
not a settled bill. **$1.826004 remains reserved under $4.** Both parent and
continuation are stopped; no PDF phase, further retry, second child or refund.

The owner then chose UI feedback using the existing, clearly labelled scripted
fictional walkthrough in a separate local `?candidate=1` tab. It is not this
failed real result and does not contact a provider or edit the open resume.
At21:38 the owner changed the order: finish technical readiness and validation
before UI fixes. The fictional tab stays untouched; complete experience review
and release still follow the technical quality gates.

#### Complete response contract and historical prompt compatibility

New semantic assessments use prompt revision2. Each assessment/challenge prompt
now contains one complete JSON response example, rather than a partial
ratings/communication example followed by an instruction to add semantic fields.
The complete example includes the required nested
`semantic.version:"source-attribution-v1"`, all semantic collections and all
existing judgment fields. A final contract check explicitly requires the literal
version, exact top-level fields and required IDs, even for empty collections.

This is prospective prompt hardening, not provider-enforced structured output
or proof that the earlier split instructions caused the omission. Strict
validation remains unchanged: absent, null, wrong or misplaced versions fail;
there is no response repair, silent metadata insertion or automatic retry.

The application records `promptRevision:2` in new semantic evaluation envelopes,
not in model-authored judgments. An absent marker denotes the historical
revision1 only. Its exact original prompt bytes remain reconstructible. Both
stage hashes must match the selected revision; removed/unsupported markers and
mixed old/new receipts fail. Inventory, legacy non-semantic and revision-proposal
prompts are unchanged. Existing complete history remains readable without
migration or re-attesting imported records. Comparing different semantic prompt
revisions explicitly withholds improvement claims.

Offline coverage includes pre-change frozen request hashes, complete shape
checks, missing/null/wrong/misplaced versions in both JD and general modes,
durable history downgrade rejection and comparison incompatibility. These are
contract tests, not independent model-quality acceptance. The actual stopped
continuation still resolves to its original status digest
`394a04ab0782c35f84ae529b05c16ebb0e90070d27054f4712fc4d31075a7999`,
with five calls and1.826004USDreserved. No failed output, parent, ledger, original
file, document version or authorization is rewritten by this change.

Verification:40initial evaluator/semantic/history tests pass22210.0929ms.
Final127affected evaluator/semantic/comparison/history/pilot/revision/
presentation/probe/budget/browser tests pass411844.6679ms, with zero failures or
skips. This includes actual isolated browser PDF rendering and both browser-origin
and server-budget revision/Apply/recheck journeys, all using scripted provider
responses. Main build passes3714ms; the browser suite rebuilds Resume assets
without deleting chunks still available to shared tabs. Syntax checks pass.
The earlier202-case full offline run is separate historical evidence, not a
full-suite rerun at this checkpoint. No shared tab was reloaded or used for tests.

Remaining order: separately approved real-provider evaluation, calibrated
headline policy, independent held-out/repeatability acceptance, joint complete
experience review/UI fixes, then separately approved release. The existing
stopped workflow cannot be resumed or given another child. Any further paid
plan must preserve its ledger/history and obtain exact owner approval; the
unused ceiling is not permission, and completing all evaluation within4USD
has not been established.

Using the last genuinely checked2/10USD-per-million prices and unchanged
reservation policy, a fresh negative-text assessment/challenge, PDF inventory,
PDF assessment/challenge, revision/challenge and checked-PDF recheck require
nine calls and3.234007USDadditional reservation. With1.826004already held, that
is5.060011USDcumulative, above4USD, before additional paired baselines,
calibration or held-out repeats. This is a planning floor for that journey,
not a new price verification, complete evaluation quote, spending permission,
reservation refund or guarantee that a safe revision will exist.

#### Expanded validation proposal - planning only, October 4

**Subsequent scoped authorization:** the owner explicitly approved the fixed
smoke workflow below and6USDcumulative ceiling. That supersedes the4USDcap
only for this named smoke; it does not approve the207-call quality proposal.

After the offline contract checkpoint, the owner explicitly selected
**"Prepare a larger-budget validation plan only."** This does not change the
4USDceiling, reserve money, register a workflow, authorize a call or approve
release. Both old workflows remain permanently stopped and their held
1.826004USD is included in every cumulative figure below.

**First: unpaid prerequisites.** Freeze the actual legacy
`resumeStudioAssess -> atsEvaluate -> assessAtsResume` configuration and its
optional `atsEmbed` path; record actual model/embedding settings and bounded
prices, not a substitute two-call evaluator. Design/test the accounting for
every baseline operation and any prospective new validation workflow before
requesting implementation/execution approval. No fake baseline, silently
disabled neural path, reset ledger or second child of the stopped workflow.
Any cumulative ceiling amendment needs its own explicit owner approval and
audited accounting design; the current tool intentionally cannot perform it.

Prepare only fictional/permitted inputs. Proposed scope remains English
product-design senior/staff/leader roles and PDF/DOCX/TXT. Six development cases
exercise the known failure families and rubric anchors. A separate independent
reviewer supplies or approves unseen cases and reference labels before seeing
candidate outputs; the developer must not tune on the held-out references.
Proposed held-out cohort:36distinct documents, four in each of the nine
format/level cells. Cover the existing26acceptance goals and critical adversarial
cases through an explicit coverage matrix. Do not count alternate formats of
one document as independent documents.

This sample count is a **planning assumption**, not evidence that four documents
per cell establish95%population accuracy. Before any paid acceptance run,
approve the sampling/label-adjudication protocol, denominators, document-level
clustering, uncertainty reporting and sample-size adequacy. If inadequate,
resize and re-quote before running; do not claim readiness from a tiny perfect
sample. Developer-authored scripts and another pass from the same model are
not independent reference labels.

**Candidate reservation envelope, using last checked prices and unchanged
limits:** no new price verification or actual-bill estimate is implied.

| Phase | New candidate calls | Additional maximum reservation USD | Dependency |
|---|---:|---:|---|
| Technical smoke: negative-text assessment, PDF inventory/assessment, eligible revision and recheck | 9 | 3.234007 | Separately approved new workflow/accounting and exact phases; old workflows stay stopped. |
| Six development/calibration cases | 18 | 6.468012 | Reviewed independent reference anchors; no held-out tuning. |
| Thirty-six held-out first runs | 108 | 38.808072 | Frozen method, labels, sample-size decision and baseline budget. |
| Nine preselected repeatability cases, two more runs each | 36 | 13.464036 | One per format/level cell; three total identical-input runs, same frozen inventory/settings. |
| Nine independently reviewed eligible revision/recheck cases | 36 | 12.672027 | Correct baseline result and permitted safe edit; no forcing edits or replacing no-change cases to improve metrics. |
| **Candidate total** | **207** | **74.646154** | Each phase separately approved; no automatic retries or spending of spare allowance. |

Including the existing held reservation gives **76.472158USDcandidate-only**.
Let **B** be the separately measured/bounded cost of the actual paired legacy
baseline, including any completion/embedding operations across the frozen
comparison cohort. The proposed all-in reservation is **76.472158 + B USD**;
there is deliberately no invented price for B or approved total ceiling yet.
Reusing a byte-identical historical artifact is permitted only if its frozen
configuration, source and exact receipt bindings genuinely satisfy the protocol.

For a smaller first decision, a **proposed6USDcumulative smoke-only ceiling**
would cover the5.060011USDtechnical journey floor. It would NOT complete
paired benchmarking, calibration or held-out acceptance. Neither6USDnor the
larger envelope is approved by selecting planning only. Model invoices may be
far below reserved maxima, but actual settled billing is not known and held
reservations will not be released or discounted without a separately approved
policy change.

**Acceptance/order:** use the existing quality gates above, not easier targets.
Freeze the versioned headline policy before held-out runs; enable a numeric
headline only if calibrated and accepted. A no-headline policy is an explicit
product decision, not a silent way to mark calibration complete. Blind paired
review must show the identified baseline failures improved and existing valid
behaviour preserved, with counts/uncertainty by supported slice. Require zero
unsupported accepted revisions, no missed critical required criteria, proposed
95%precision/recall/relevance/association, at most5%material false criticism,
and95%state agreement across the three-run subset with no supported/contradicted
flips. Report observed stage failures, p50/p95 and cost without pretending this
cohort establishes a production SLA.

Stop on any invalid/refused/truncated response, unsafe change, unknown provider
outcome, unacknowledged persistence or exceeded bound. A no-change/uncertain
revision is an outcome, not permission to buy a replacement case. Repairs
after held-out exposure require a newly reserved untouched set and another
approved budget, never a hidden retry. Insufficient labels, sample size or
paired evidence leave the gate open. Only after technical/quality acceptance
does joint experience review/UI fixing begin; release remains separately gated.

**Next approval is not payment:** review the scope/sample assumptions and
authorize unpaid baseline/accounting/label preparation. Then present a complete
bounded quote with B, freshly verified prices, exact inputs, immutable workflow
identity and stage approvals before requesting any spend.

#### Approved fixed smoke workflow - October 4 approval

The owner explicitly approved one new isolated fictional workflow, at most nine
new calls and6USDcumulative ceiling including1.826004already held. One approval
covers ONLY the fixed sequence: negative-text assessment/challenge; PDF inventory;
PDF assessment/challenge; eligible north-work revision/challenge; checked Apply;
edited-PDF recheck/challenge. Maximum cumulative reservation is5.060011USD and
maximum cumulative call count14. Spare headroom never authorizes another case.
One temporary native Edge with normal sign-in/localhost permission is included.
This replaces per-phase approval only within this workflow, not for the larger
benchmark, other tasks, UI changes or public release.

The original probe and continuation remain immutable/stopped. A separate
`system/fictional-assessment-smoke-approval-v1.json` binds their exact state
hashes, the five-call ledger prefix, source hashes, prompt revision2, executing
code fingerprint, prices, target field, sequence and limits. A new
`system/fictional-assessment-smoke-v1.json` records only the new operations.
The CLI writes its durable identity marker before the one-time CAS claim.
Only this registration amends the existing ledger's maxCost from4to6; all prior
reservations and approvedAt remain unchanged. Reads reconstruct the original
four-dollar prefix to validate old claims and separately enforce cumulative
limits across all three records. Missing/partial claims, changed prefix/code,
unknown prior outcomes or lost acknowledgements fail closed; no registration
retry, replacement budget, second smoke or second child of the old continuation.

Commands `review-smoke` and `register-smoke --confirm --approval <hash>` are unpaid.
`run-smoke --smoke --studio --allow-provider --approval <workflow-hash>` runs the
fixed guarded sequence. Ordinary `run` cannot bypass the smoke guards; alternative
field/finding flags are rejected. The contradiction must remain contradicted
before a PDF call, the PDF inventory must preserve required Python-or-Java,
and a finding must map to the sole approved north-work field before revision.
Question, no-change, disputed/uncertain or blocked revisions stop without Apply
or recheck. Missing/malformed output, transport/cancellation/persistence failure
stops without retry or refund. Workflow consent is not independent factual
review or evidence that a model-agreed revision is universally safe.

Five focused smoke tests pass196426.2041ms: fourteen cumulative scripted calls
and byte-identical stopped records/prefix; exact consent/code/runner checks and
missing-version stop; question-without-Apply; partial registration; CLI identity
marker after deletion of both smoke records. Three original/continuation/runtime/
Studio CLI regression cases pass107756.126ms. Syntax passes; no unrelated build
or127-case rerun. The normal provider route and worker HTTP permissions are
unchanged; only the isolated operator CLI can perform this audited amendment.

Actual registration packet approval:
`de4fc11644d2992232a75f7b33de7742ce1cb31f32a8c04676424bed23ce50c1`;
code fingerprint`cf8db72ba9a36483de5bf905889e9a6eef6d6002377f75115972de250534e39c`.
Official Sonnet5.5 model/pricing pages were read again; checkedAt
2026-10-04T18:45:17.111Z,2USD/Minput and10USD/Moutput. Registration is durable,
made no inference call and retained5calls/1.826004reserved under the newly
approved6USDceiling. Actual execution outcome is recorded separately; do not
infer success from registration or the scripted tests.

Read-only baseline configuration was also verified after normal owner sign-in:
Anthropic selected, no OpenAI/Gemini embedding provider configured, automatic
evaluation disabled/daily budget0, selected-service agent routing, no job limit.
The baseline's no-embedding path therefore reflects observed configuration, not
a benchmark silently disabling it. Completion still uses the multi-call task
agent, not a single priced completion. Settings were inspected and closed without
Save; original category restored, draft hash unchanged and session AI activity0.
These observations do not approve or price a full paired benchmark.

**Actual outcome: stopped, not accepted.** The first two new calls returned
parsed JSON with `semantic.version` present in BOTH responses. The draft
proposed `semantic.groups:[]`; the challenge nevertheless returned one
`job-0` review, even saying that no groups had been proposed. Its group count
was1where0was required. Validation rejected it with
`Semantic review: list exceeds the semantic review contract.` No response
was repaired and no PDF phase, revision, Apply or recheck was started.
This shows prompt revision2 did not guarantee the response contract; it does
not prove the prior missing-version problem can never recur.

Current totals: **seven actual calls,2.574006USDreserved under6USD**. The new
assessment used2910input/482output tokens (0.010640USDtoken-priced estimate),
and challenge3088/904 (0.015216USD). Cumulative token-priced estimate is
0.084620USD, **not a settled invoice**. Both raw bodies/receipts are retained;
output remains null, stopped=true and next=null. Neither old failed workflow
was rewritten. The new workflow is also terminal; no second smoke, retry or
refund is authorized by its original approval.

Stopped status digest:
`66338149386cc13907c06a769c55b5fb1ada472f4b6ce7287d8428c46f4f578e`.
Workflow approval remains`de4fc11644d2992232a75f7b33de7742ce1cb31f32a8c04676424bed23ce50c1`;
the failed phase packet was`d7fda984f51c80850144bdda819a12cb030da62f5cd8155025ed31bdb041cf37`.
An exact empty-group regression was added; all15semantic tests pass451.383ms.
The initial filtered attempt did not register that test correctly and is not
counted as verification; it was corrected and the full semantic file rerun.

Before proposing another real attempt, address provider-enforced response
structure and input-dependent identities/empty collections, with historical
compatibility and offline malformed-response tests. Do not merely patch this
retained result or treat another prompt-only tweak as proven readiness.
Real-provider/paired acceptance, calibration, held-out quality and release remain
open. The owned temporary Edge, bridge and lock were closed after failure.

#### Enforced response transport - October 5

The owner approved the full offline implementation after discussing end-user
value, time and the alternative of parking this work. This is a reliability
change, not an accuracy claim, UI redesign, new paid authorization or release.

[resume-assessment-output.mjs](../src/js/resume-assessment-output.mjs) builds
input-specific JSON schemas using the supported subset documented by
[Anthropic](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
New Sonnet 5.5 sessions select `assessment-json-v1`,
`assessment-semantic-json-v1` or `revision-json-v1`. The central request includes
`output_config.format: {type:"json_schema",schema:...}` while retaining adaptive
thinking, medium effort, existing output caps and the single-attempt policy.
Other models retain their prior behavior; no unsupported structured-output
capability is inferred for them.

- Fixed inventory segments, atomic/communication judgments, semantic reviews
  and revision-claim reviews use required object keys drawn from their actual
  inputs. Every keyed review also retains its literal ID. Extra/missing keys or
  mismatching IDs reject. Zero expected groups require an empty object.
- Proposed requirements, experience groups and revision claims remain arrays:
  they are genuinely model-authored proposals, not predetermined review targets.
  Compound inventory conditions use a bounded, nonrecursive schema through depth4.
- Every JD segment has an explicit issue decision. `issue:false` requires an
  empty reason; `issue:true` retains its explanation. This avoids both optional
  fields and a nullable union for every segment, respecting the documented
  24-optional/16-union limits. A60segment challenge has neither optional fields
  nor unions. Internal provider compilation limits can still reject a schema.
- The versioned decoder maps valid keyed records into the existing domain
  arrays. This is a declared wire conversion, not repair: it does not create
  missing semantic versions, substitute IDs, drop unknown keys or fix judgments.
  Raw response text remains unchanged in receipts; opted-in private retention
  hashes that exact receipt. Server output bindings hash the decoded domain
  result, and the evaluator independently decodes/validates it.
- Request fingerprints include the contract identifier and exact generated
  schema. The transport must acknowledge the contract. A reserved phase cannot
  switch contracts between calls. Saved execution/failure records retain the
  marker; stripped, mixed, unsupported or context-mismatched markers reject.
  Historical records without it reconstruct their original prompts and hashes,
  including prompt revisions1/2. Cross-contract comparisons withhold gains.
- Schema bytes count toward the existing110,000input bound before dispatch;
  nothing is truncated and no ceiling is increased. Refusals, incomplete
  responses, malformed JSON and unknown outcomes stop without retry/refund.
  The old complete-Markdown-fence accommodation remains legacy-only.
- Studio checks the exact schema against the actual data and stage on both sides
  of its bridge, using the same browser-bundled schema generator. Stripped or
  modified formats reject. The existing authenticated proxy forwards the body
  unchanged; no key/session export or live Worker change was needed.
- Disagree/uncertain, missing-evidence, question and no-change outcomes remain
  available. Excerpt reviews can challenge missed grouping even when the draft
  proposed zero groups. A required response field is not a required positive
  judgment.

The three registered isolated probe definitions deliberately retain their old
wire contract, not an automatic fallback for new sessions. Their approvals,
records and reservations cannot be migrated into a structured run. The CLI
fingerprint now includes the new output module (22runtime files).

Verification:106focused checks pass29937.9614ms; the new structured-server browser
journey passes46615.0281ms, including disputed revision blocking, reviewed Apply,
fresh actual PDF export/recheck, durable R2 history and reopening. Two frozen
legacy smoke/CLI checks pass94983.9146ms. Final23boundary/legacy checks pass
62005.0157ms, including browser loopback permission and legacy hosted PDF/import
behavior. Main build passes1070ms; Resume builds in the browser suites without
cleaning old chunks. The restored comparison screenshot was inspected.

These are scripted-provider checks, not a successful remote grammar compilation
or quality benchmark. No new provider calls, owner-resume edits, shared-tab
reloads, subagents or public push/deployment occurred. A fresh unpaid status read
returns the exact prior stopped digest,7calls/2.574006USDreserved/max6. The
next real check needs a new exact approval and execution scope; none of the
stopped workflows may be resumed.

#### Separately approved structured smoke - October 5

After the offline structured-output milestone, the owner explicitly approved one
new fixed workflow: at most nine Sonnet5.5 calls on the same fictional TXT/PDF,
with3.234007USDadditional conservative reservation. The unchanged seven-call
prefix reserves2.574006USD; completion can reach16cumulative calls and
5.808013USDreserved within the existing6USDceiling. These are reservations, not
settled invoices. No ceiling amendment, larger benchmark or public release is
authorized.

`system/fictional-assessment-structured-smoke-approval-v1.json` binds the exact
three stopped states, four previous reservations, original sources,22file runtime
fingerprint, structured contract identifiers, stages, price check and sole edit
target `north-work`. Its independent
`system/fictional-assessment-structured-smoke-v1.json` holds only the new run.
The identity file adds a separate durable claim marker; missing/partial records
cannot be recreated. Registration neither calls the provider nor changes the
ledger. Historical approval packets and legacy wire contracts remain unchanged.

`review-structured` and `register-structured --confirm --approval <hash>` are
unpaid. `run-structured --structured --studio --allow-provider --approval <hash>`
executes only the whole approved sequence with the original genuine
`--prices-checked-at` value. Ordinary phase execution is unavailable for this
mode. The existing guards stop on negation uncertainty, changed inventory,
missing eligible finding, unsafe/uncertain/question/no-change revision, error or
unknown outcome; no forced Apply, retry or refund follows.

New requests propagate `responseContract` and bind retained receipts to the exact
schema-bearing request identity. One whole-workflow Studio connection permits at
most nine calls and has a15minute lifetime; ordinary phase connections retain
their two-call/five-minute limits. Both client and broker enforce the selected
fixed limit. Normal sign-in/localhost permission and server-only provider keys
remain mandatory; the connection cannot extend or renew authentication.

Verification covers22distinct focused cases across retained runs: complete
16call scripted workflow, immutable prior records/reservations, exact approval/
code/contract/source checks, partial registration, CLI identity/restarts,
nine-call Studio connection, legacy compatibility and all guarded stops.
Initial test-fixture mistakes (CLI summary versus exported report, `supported`
versus an invented no-change kind, receipt versus envelope contract marker) were
corrected and rerun, not counted as passes. Final CLI check passes123597.897ms;
three corrected/unknown-outcome stops pass156269.5717ms; the exact real-outcome
regression passes51389.4453ms. No full-suite or unrelated build rerun.

Registration approval:
`f33ae0c6b494f491a9778d3ffa9210079ac72457836912c1baeeb3313118e1dc`;
runtime:
`e5ec323cb8db271acd3ff7c51545f3fb7a5decfbc6f01b2e40023cc72a03f990`.
The first temporary native attempt timed out before connection readiness. A
separately approved native connection retry timed out waiting for sign-in; the
owner reported no visible Edge window. Neither claimed a phase or added spend.
Process/page startup was not sufficient proof of owner-visible UI.

The owner then explicitly approved the existing visible VS Code Studio tab,
without reload or content changes. Normal sign-in was checked as a boolean only;
keys/session were not exported. Its broker closed normally after **two real
calls**. The provider accepted both schema-bearing assessment/challenge requests,
returning valid required maps, semantic versions and an empty challenge-group
object. Inventory/PDF/revision schemas have still not been tested remotely.

Both model passes recognized `No experience with Python.` as contradicted.
However, the challenge additionally cited the unrelated handoff excerpt, whose
classification was uncertain. The existing all-cited-evidence uncertainty rule
therefore made the final role rating `unknown`. The fixed guard stopped before
PDF inventory. This is a valid partial assessment and a semantic/evidence-policy
limitation, not another malformed response or successful end-to-end smoke.
No citation was dropped, judgment patched, guard relaxed or retry attempted.

Final status digest:
`e05066ff95eaed9f517222c118b757e59574f45c89e53bc1c5bf9a9264ebc843`.
All four workflows are terminal;9cumulative calls/3.322008USDreserved/max6.
New usage:11,362input/1,528output tokens;0.038004USDtoken-priced estimate,
0.122624USDcumulative estimate, neither a settled invoice. The exact raw receipts,
prior state/prefix hashes and original TXT/PDF are retained. No PDF call, revision,
Apply, recheck, owner edit or public release occurred. Next is an explicitly
versioned evidence-relevance decision and independent quality validation, not
another blind provider retry or automatic use of remaining headroom.

#### Offline decision/context evidence experiment - October 5

The owner requested continued work through Step 15, then explicitly selected
**no further paid calls; continue offline only**. That restriction supersedes
unused headroom in earlier approvals. No new registration, provider request,
authentication change, shared-page reload, public release or subagent is
authorized. The four actual workflows remain terminal at nine calls and
3.322008 USD reserved. Offline implementation is not independent acceptance.

The opt-in `decision-context-v1` policy uses
`assessment-semantic-evidence-json-v1` for assessment/challenge, with the existing
semantic inventory and revision contracts unchanged. It is supported only with
semantic review, structured output, Anthropic and `claude-sonnet-5-5`.
Default sessions and historical records retain their previous behavior.

- Pass `evidencePolicy: 'decision-context-v1'` to the evaluator/pilot, or use the
  loopback candidate URL `?candidate=1&evidencePolicy=decision-context-v1`.
  The candidate explains the experimental policy before connection.
- Challenge ratings and communication entries require `contextEvidence`, even
  when empty. Each entry is `{ id, reason }`: an included source ID and a
  bounded explanation of why this additional context cannot change the judgment.
- Existing `evidence` remains decision-bearing, including counterevidence and
  material uncertainty. Context is additional, unique and disjoint from both
  original and challenge decision evidence. Agreement must retain **every**
  original decision-bearing ID; it cannot retain one and silently drop another.
- Material uncertainty, disagreement, unresolved inventory and the global
  uncertain-source check for absence still block conclusions. No lexical
  relevance guessing, citation deletion, response repair or historical rewrite.
- Context sources and reasons remain visible in existing details, with an
  explicit model-classification limitation. The model's relevance/materiality
  classification is **not independently verified**.
- New records carry a policy marker bound to both execution contracts. Removed,
  forged or mixed markers reject; cross-policy comparisons withhold gains.
  Rechecks inherit their baseline policy, including after the URL flag is
  removed, and reject an explicit policy switch.
- Local shape validation does not authenticate non-decision-bearing context.
  Central history binds the full challenge to its actual response receipt and
  rejects altered context. Existing generic history support provides this
  boundary; there is no permissive new worker path.

The actual structured-smoke result remains unknown under its historical policy.
The new policy has **not** been tried with a real provider and is not promoted
to the default. Scripted success cannot establish accurate relevance decisions.

#### Offline calibration and quality measurement - October 5

[The pure measurement module](../tools/resume-assessment-quality.mjs) and
[local JSON CLI](../tools/resume-assessment-quality-cli.mjs) implement explicit
measurement gates without a provider, label generator or score formula:

```powershell
node .\tools\resume-assessment-quality-cli.mjs --mode calibration --input "<local calibration JSON>"
node .\tools\resume-assessment-quality-cli.mjs --mode quality --input "<local quality JSON>"
```

The input must be a regular local JSON file no larger than 4 MB. Unknown options,
including provider permission, reject. JSON goes to stdout. Exit **0** means
supplied measurements meet the calculator's criteria, **2** means valid input
with unmet criteria, and **1** means invalid input/execution failure. None
authorizes promotion or release.

Calibration input contains `version`, `policySha256`, `developerId`, `frozenAt`,
`minimumDocuments`, `maximumMeanAbsoluteError`, `maximumAbsoluteError` and
`samples`. Each sample binds document/family/artifact/reference, reviewer and
independence declarations, approval/prediction times and exact policy to
`expected`/`predicted` values. Null means unassessable or missing, not zero.
Duplicate families/bytes, missing predictions, invented numeric headlines for
unassessable references and policy/time mismatches block. MAE and maximum error
use the explicitly supplied limits; no numeric pairs never passes.

Quality input contains `protocol`, `references`, `runs` and `calibration`.
The protocol binds draft/frozen status, developer/time, method/baseline/headline/
reference hashes, development families, per-slice minimum, independent sampling
approval/rationale, preselected repeats and explicit latency/reservation limits.
References bind independent labels, coverage, criterion states and critical IDs
to distinct source families/artifacts. Runs bind method/inventory/artifact,
repeat index, outcome, elapsed time, reserved cost, adjudicated metrics, states
and blinded paired verdict. Exact fields and executable synthetic examples are
in [the tests](../resume-assessment-quality.test.mjs); those examples are not
independent reference data.

The report measures all nine PDF/DOCX/TXT x senior/staff/leader slices and
26-goal coverage. First runs alone contribute quality denominators; zero
denominators stay unmeasured. It enforces 95% precision/recall/relevance/
association, at most 5% false criticism, critical-state fidelity, zero unsupported
accepted revisions and observed revision fidelity in every slice. Failed/unknown
runs remain counted. Repeatability requires three equivalent runs for one
preselected document per slice, all three pairwise comparisons, 95% agreement
and no supported/contradicted flips, including on human-ambiguous labels.
Calibration/held-out family or artifact overlap blocks. Reservations use whole
millionths; completed-run p50/p95 use nearest-rank, with failures shown separately.

Reviewer identities, independence, counts and blind-review claims are supplied
observations needing external audit, not authenticated by this calculator.
Ratios are not population confidence bounds. Sample/clustering adequacy,
uncertainty analysis, actual baseline execution and independent labeling remain
external prerequisites. Outputs always keep `promotionAuthorized: false` and
quality additionally keeps `populationAccuracyEstablished: false`.

The saved October 5 readiness diagnostic uses an explicitly **draft** protocol,
unfrozen timestamp zero, provisional four documents per slice, no baseline or
headline policy, no references/runs/calibration and zero additional spending.
Its 24-file development-method snapshot is not an approved experiment. Actual
result: **exit 2, zero documents/runs, criteria unmet**. It lists missing
independent labels, slice measurements, coverage, repeats, baseline, calibration,
sampling approval and limits. Its zero dataset reservation does not erase the
historical 3.322008 USD. This is a truthful readiness diagnostic, not a failed
software test or a completed quality evaluation.

Verification: 134 focused cases pass (27954.4324 ms); a later 15-case output
suite passes (827.3505 ms), including two additional partial-support/no-JD
boundaries. Do not sum overlapping suites. Two full browser journeys pass
(74062.2265 ms), covering legacy/new policy, context disclosure, guarded Apply,
actual PDF recheck and private history. Main build passes (6031 ms); Resume
builds in browser verification. An initial incorrect local-authentication test
expectation is retained as a failure, then corrected to test the actual central
receipt boundary. No production guard was weakened to satisfy it.
Final numeric-boundary verification adds explicit safe-integer checks on combined
precision/recall denominators, not just their component counts. All seven quality
tests pass again (782.0658 ms), including both overflow cases. A new final
source-bound readiness snapshot again returns exit 2; the earlier snapshot and
receipts are retained rather than overwritten.

#### Offline failure diagnostics and private response retention

The fictional probe now opts into a server-internal `retainResponse` callback.
It is not an HTTP option, production flag, new budget or general Studio logging
feature. Normal budget callers do not retain raw bodies or add raw-response
hashes. The probe enables it only inside its existing exact-approved execution.

The budget layer validates the provider/model identity, receipt shape, request
ID, usage and nonempty response text bound (at most60,000characters) before
calling the retention sink, then parses the response JSON. This captures
bounded malformed JSON as well as schema-invalid JSON before either can be
discarded. HTTP errors, refusals, invalid receipt envelopes and oversized text
are not retained; no truncation or credential-bearing upstream error dump is
used. Headers, API keys and owner sessions are never passed to the sink.

Each private operation's optional `responses` array stores
`{reservationId,stage,requestSha256,receipt,sha256}`. The receipt contains the
exact response text and provider/model/request-ID/usage metadata. Its full
canonical hash is bound into the central attempt's optional
`rawResponseSha256`; the request hash binds the exact system/user pair.
The probe checks stage order, phase count, hashes and budget associations on
reload. Body evidence lives only in private probe state/inspection reports,
not normal cloud history or logs; the existing8MiB total-state cap remains.
Successful phases require all planned retained responses. These are diagnostic
records, never accepted assessments, independent truth or permission to replay.

Retention must acknowledge before parsing/returning a result or starting a
later stage. Save failures and cancellation retain the reservation and halt.
A lost acknowledgement may leave an unfinished `started` operation instead of
a cleanly recorded failure; it still blocks progression and requires audit.
No callback retry, paid replay, refund or stale-lock bypass is introduced.
Historical operations/budgets without these optional fields remain readable
without rewriting them. The stopped real probe is not migrated or restarted,
and its missing response bodies cannot be recovered by this change.

Strict semantic record-field errors now include the exact structural path and
expected/received keys or type. Key summaries are bounded and do not print
field values. Prompt examples were compared with the validator's record fields;
no demonstrated mismatch was found. Prompts and historical request hashes
remain unchanged, and invalid fields are still rejected rather than repaired.

Validation: **196 full offline cases pass** (165candidate/PDF/history/browser
plus31worker),298390.8641ms,zero failures/skips. Five new cases cover diagnostic
paths, prompt field agreement, opt-in privacy and60,000/60,001bounds, rejected
text across R2 restart/tamper, cancellation and lost persistence acknowledgements.
Main build638ms, clean Resume build and syntax checks pass. The actual stopped
paid report remains identical after read-only validation: three calls,
$1.078002reserved, no migration or new inference.

#### One same-ledger continuation - offline implementation only

The owner approved planning, offline implementation/testing and later exact
registration plus the first two-call phase. **That real follow-up is now
stopped on the missing-version failure described above.** These reference
commands must not be used to replay or register another child. This is not a
reset or an unlocked original run.

Only the specific parent shape is eligible: completed negation inventory,
followed by a stopped semantic-record failure after both assessment calls were
received and parsed. All three parent execution receipts must match the
original budget. Unknown provider outcomes, different failure stages, changed
parents, edited documents or missing ledgers cannot use this continuation.

An unpaid registration packet binds the immutable parent state hash, original
budget-prefix hash, original files, Studio transport, fixed model/prices and
the explicit one-repeat exception. A single CAS claim and separate child record
live in the existing R2 workspace. The CLI first durably marks the existing
identity file with the approved registration hash. Partial registration or
missing/mismatched records fail closed; even deleting both R2 registration
records cannot make the CLI forget its identity marker. Ordinary status/review
never creates a marker, claim or child; actual registration did so only after
the later separate owner approval.

The parent and its old reservations remain unchanged. A shared audit recognizes
only the parent and registered child reservations; orphaned or duplicated
reservations are rejected. Parent status remains stopped but reports cumulative
spending after a registered follow-up. Child status must be selected explicitly.
The combined parent/child/claim state retains the existing8MiB bound.

| Follow-up phase | Additional calls | Reservation (USD) |
| --- | ---: | ---: |
| `negation.assessment`, reusing the existing reviewed inventory | 2 | 0.748002 |
| `pdf.inventory` | 1 | 0.330000 |
| `pdf.assessment` | 2 | 0.748002 |
| Additional total | 5 | 1.826004 |
| Including the original three calls | 8 | 2.904006 |

These ceilings use the fixed $2/M input and $10/M output pricing, not an actual
bill. The global ceiling remains $4; the $1.095994 remainder is unallocated,
not permission for more calls. This follow-up excludes revision, Apply and
recheck. No second continuation, general retry or replacement budget is exposed.

The registration sequence required separate owner permission and genuine
price verification. The following commands are references, not new approval:

```powershell
node .\tools\resume-assessment-probe-cli.mjs review-continuation --prices-checked-at $checkedAt
node .\tools\resume-assessment-probe-cli.mjs register-continuation --confirm --prices-checked-at $checkedAt --approval "<exact registration SHA>"
node .\tools\resume-assessment-probe-cli.mjs status --continuation
```

Registration is unpaid and does not read a key or open Studio. It returns the
original stopped status; `status --continuation` selects the child. Registration
consent is not provider consent. Each paid child phase needs a new exact packet:

```powershell
node .\tools\resume-assessment-probe-cli.mjs review --continuation --studio --prices-checked-at $checkedAt
node .\tools\resume-assessment-probe-cli.mjs run --continuation --studio --prices-checked-at $checkedAt --approval "<exact phase SHA>" --allow-provider
```

Packets include the registration, cumulative spending and current ledger hash.
Before `pdf.inventory`, the packet also includes the complete repeated negation
assessment: inspect its actual semantics, not merely parse success. That run
additionally requires `--confirm` for explicit prior-result review. If it is
unsafe or inconclusive, do not confirm; use unpaid
`finish --continuation --confirm --reason "<actual reason>"` instead.
This is an operator quality gate, not an automatic model-truth claim.

The same raw-response retention, exact input checks, single-attempt execution,
CAS phase claims and no-refund rules apply. Failure, cancellation, incomplete
writes or lost acknowledgements cannot advance the child or spawn another one.
After its three phases there is no next paid action. A successful fictional run
would still not complete paired benchmarking, calibration or held-out acceptance.

Offline validation: **202 full cases pass** (171candidate/PDF/history/browser
plus31worker),456272.8645ms,zero failures/skips. Initial five continuation cases
passed139223.2688ms; the final suite adds cancellation/retention/tamper coverage
and preserves the original seven-phase flow. Main684ms, clean Resume build and
syntax checks pass. At that offline checkpoint, actual paid status was still
the stopped three-call report, before the later approved registration/execution.

The executable has one fixed private workspace:
`%USERPROFILE%\.riteshk-work\assessment-probe-v1`. No command-line reset,
alternate directory, budget override, arbitrary extra run or automatic retry exists.
Original TXT/PDF bytes, full results, revision/checkpoint receipts and comparisons
are retained in local persistent R2. This is local storage, not a claim of cloud
replication, encryption or independent factual verification. Reports and original
inspection copies are immutable, hash-named files outside the public repository.
The prepared originals were verified again through a separate CLI `status`
process, including byte hashes and unchanged zero-spend state:

- TXT SHA256: `b19b6d5ba9935e8c9c1e61fab1fe51a95c625bc9087263bf28476716ab4caafc`
- PDF SHA256: `2b2985e61dc4ab9c63e15b6b29d04d4b6912af3034ec6aaad652b420d720f219`
- Prepare/status report digest: `92a43755121e6e85f4b253b46bd62ffa96f02c72730a7c15624bcfa207ed5cc0`

Those prepare/status reports describe the original unpaid checkpoint, not the
current paid ledger. The current probe is stopped with no next phase after the
failed assessment described above. No price timestamp was refreshed merely to
prepare files. A key configured in a separate terminal is local to that process
and is not automatically inherited by this already-running assistant.

Exclusive process locking and conditional phase claims prevent concurrent paid
winners. A started/failed phase blocks further execution. Missing paid state,
changed completed outputs, invalid ledger receipts or disappeared storage require
an audit, never initialization of a replacement budget.

The fixed fictional inputs are Avery Example / `avery@example.test`: a TXT
negation case and an actual exported PDF with Northstar Example / Atlas Example
experience and the JD `Python or Java`. The review packet shows the complete
extracted original, source fingerprint, included/excluded evidence, inventory,
request policy and applicable revision context before each approval. The PDF
styles the first and last names separately; only those exact leading excerpts
and the exact fictional email are proposed for exclusion, not employer words.

Developer reference expectations, to review before any real call:

- Explicit "No experience with Python" must not become positive Python evidence.
- `Python or Java` is an alternative, not a requirement for both tools.
- Each employer, role, date and achievement must retain its own attribution.
- "With the team" is not sole ownership. Qualitative handoff/customer evidence
  does not authorize invented numerical impact.
- A wording-only revision does not establish a genuine skill gain. Question,
  blocked or no-change outcomes are valid and must not be forced into an edit.

These known development cases and expectations are not independent held-out
labels. Scripted test ratings deliberately exercise comparison mechanics; their
apparent gains are not measured real-model improvements.

| Order | Phase | Calls | Required review |
| --- | --- | ---: | --- |
| 1 | `negation.inventory` | 1 | Actual TXT and JD |
| 2 | `negation.assessment` | 2 | Generated inventory and included/excluded evidence |
| 3 | `pdf.inventory` | 1 | Actual exported PDF and JD |
| 4 | `pdf.assessment` | 2 | PDF inventory and source evidence |
| 5 | `pdf.revision` | 2 | Explicit eligible finding and uniquely mapped field |
| 6 | `pdf.apply` | 0 | Full proposed revision, claims and challenge; separate author approval |
| 7 | `pdf.recheck` | 2 | New verified PDF, frozen baseline inventory and fresh evidence approval |

After approved local setup, run commands from the repository directory:

```powershell
node .\tools\resume-assessment-probe-cli.mjs prepare
node .\tools\resume-assessment-probe-cli.mjs status
```

Both commands are unpaid and do not read credentials. Open the returned original
files and inspection report. Before each paid phase, manually check the official
published model/prices linked above. The harness supports only the approved
Sonnet5.5 profile and $2/$10 per million rates. If these change, stop; do not
substitute another model or manufacture a current timestamp. Set `$checkedAt`
to the actual verification time in ISO UTC (maximum age24hours), then:

```powershell
node .\tools\resume-assessment-probe-cli.mjs review --prices-checked-at $checkedAt
```

Read the entire returned review report. Its `approvalSha256` is consent for that
exact packet, not all remaining phases. Only after secure local credential use
is authorized and that phase is explicitly approved:

```powershell
node .\tools\resume-assessment-probe-cli.mjs run --prices-checked-at $checkedAt --approval "<reviewed SHA256>" --allow-provider
```

Do not put credentials in these arguments, source, chat or logs. The CLI reads
only `ANTHROPIC_API_KEY` from its own process when a paid phase is explicitly
requested; a missing key refuses before the durable phase claim or reservation.
These examples use environment transport. For the owner's preferred saved-Studio
connection, add `--studio` to both review and run and use an explicitly authorized
browser context as described above; the key stays server-side and the session
stays page-side. Inspect status and the retained result after every phase; there
is no command to run all phases automatically or resume the stopped paid probe.

For revision, select an eligible finding and field from the status report, and
pass the same `--finding "<id>" --field "<id>"` to both `review` and `run`.
Do not assume the scripted test's IDs indicate a real eligible finding. For
Apply, use `review` and `run --approval "<reviewed SHA256>"` without provider
permission; it performs the named checkpoint and checked save (versions1to3),
then renders and validates new PDF bytes. Recheck requires another paid review
and approval. If the inventory is wrong, the revision is blocked/question/no-change,
or no eligible safe edit exists, end the probe instead of altering facts:

```powershell
node .\tools\resume-assessment-probe-cli.mjs finish --confirm --reason "<actual reason for stopping>"
```

`finish` is unpaid and its reason becomes immutable. An interrupted lock is not
automatically removed: audit the recorded process, durable operation and ledger
first. There is no stale-lock bypass. SIGINT/SIGTERM cancel through the bounded
request flow; reservations remain held when the provider outcome is unknown.
A failed inspection-copy export is distinguished from the durable operation:
read status, never replay the phase to regenerate a report.

Offline verification: **152candidate/PDF/history/browser cases +31worker cases
=183passed**,203874.1921ms. The11new harness cases include real PDF
rendering/extraction, all7operations with exactly10scripted calls and3.564007USD
reserved, receipt-attested history, original preservation, Apply tampering,
runtime/CLI restarts, malformed/missing ledger, changed consent, key absence,
concurrent/lost claims, failed persistence, cancelled unresponsive provider,
question-without-edit closure, immutable inspection copies and fixed-directory
identity/lock guards. All API responses/keys in tests are synthetic injections.
The final11probe cases also pass84853.3098ms after reuse of the shared canonical
history serializer; three private checklist-preservation tests pass660.7882ms.
Existing37Node cases pass4680.3782ms (including72ATS assertions); four protected
browser journeys pass62960.566ms. Main build3384ms and clean Resume build pass.
No UI/renderer version change: JS1.26/CSS1.10/adminCSS1.215. This verifies the
offline harness, not account/model availability, actual billing, paired
benchmarking, calibration, repeatability or Steps13-15 acceptance.

## 9. Implementation and promotion order

The owner aligned with this expanded path on October 4. Completed foundations
and the developer connector are described above. These checkpoints distinguish
implemented local mechanisms from verified product/quality outcomes.

| Step | Task | Current checkpoint |
| --- | --- | --- |
| 1 | Visible candidate flow in the existing Resume journey | Local gated dialog implemented; fictional and attached-original flows browser-tested. |
| 2 | Same assessment for intake, original recheck and current checked export | Implemented/tested behind the local flag, including pre-editor upload/site-file intake and retained-original launcher. Same dialog/evaluator; no automatic editor creation or legacy-score replacement. |
| 3 | Genuine readability, reading-order and role/employer/date/bullet association | Local supported-input mechanisms implemented: PDF probes/provenance plus quoted source groups and mandatory attribution challenge. Uncertainty enforced. Independent accuracy, unsupported layouts/OCR and owner-specific diagnosis remain unverified. |
| 4 | Complete, correct JD interpretation | Local inventory/approval/source coverage and mandatory full-segment semantic challenge implemented. Unresolved clauses withhold role conclusions. Actual interpretation quality remains subject to independent evaluation. |
| 5 | Relevant, correctly attributed evidence judgments | Local two-pass judgments and attribution/absence safeguards implemented. New decision/context policy is explicitly opt-in and offline-tested; default/legacy uncertainty remains unchanged. Model relevance classification and real accuracy remain unverified quality gates. |
| 6 | One coherent assessment presentation | Local full-envelope-validated common adapter and summary implemented/tested across candidate entry points/history. Production cutover remains gated. |
| 7 | Specific, prioritized, deduplicated evidence-linked findings | Local derived actions implemented/tested: exact evidence/criterion references, source/JD cause deduplication, supported alternatives preserved and conservative authored field locations. Not new AI judgments or verified revision proposals. |
| 8 | Claim-safe revisions and checked Apply | Local versioned claim mapping, separate whole-text/claim challenge, author evidence, question/no-change paths, shared budget/history and checkpoint/CAS Apply implemented/tested. Existing editor controls retained; actual semantic quality remains gated. |
| 9 | Edit, explicitly recheck and compare equivalent inputs | Local checked-PDF recheck, frozen inventory reuse, fresh consent, validated paired history and own-version evidence comparisons implemented/tested. Non-equivalent inputs withhold improvement claims; no automatic paid recheck or promised point gain. |
| 10 | Central, cross-device spending enforcement | Local worker implementation/offline tests complete: fixed owner budget, server price/cap validation, R2 CAS whole-phase reservations, at-most-once execution and explicit central UI. Policy remains disabled/unconfigured live; browser development mode is not central authority. |
| 11 | Private worker schema, full history and concurrency-safe persistence | Local implementation and offline tests complete: exact originals, full envelopes, immutable/CAS history, provenance, explicit retention and restored baseline rechecks. Not enabled live. |
| 12 | Full end-to-end offline acceptance | Earlier171-case candidate/PDF/history/browser plus31worker suite passed. Latest policy/quality work has134focused passes,15later output-boundary passes (overlapping) and2full browser journeys. Coverage/limits mapped above; all26 independent semantic outcomes are not accepted. |
| 13 | Small paired real-provider pilot | Started, not accepted. Four historical workflows remain stopped at9calls/3.322008USDreserved/max6; valid structured TXT responses but an unknown final negation rating stopped the smoke before PDF. No real PDF/revision/Apply/recheck or paired baseline. The source-bound baseline accounting guard is now implemented/offline-verified; current metadata, controlled live connection, complete quote and explicit execution approval remain pending. No automatic retry, historical rewrite or use of unused headroom. |
| 14 | Define/calibrate a reproducible headline policy | Offline calibration measurement/validation implemented and tested. Actual formula, independent reference anchors and accepted frozen calibration remain pending. No headline enabled or averaging old engines. |
| 15 | Held-out quality/repeatability evaluation | Offline nine-slice/26-goal measurement CLI implemented/tested. Actual draft readiness report has zero independent documents/runs and blocks acceptance. Held-out corpus/labels, adequacy approval, paired baseline and repeat observations remain pending; scripted declarations are not independent evidence. |
| 16 | Joint review of the complete experience | Pending full journey; review local increments with the owner along the way. |
| 17 | Approved release, exact deployment verification and monitoring | Not authorized. Focused local gate/full mandatory CI, rollback/history protection, private checklist and full canonical-memory closeout remain required. |

Stages can overlap where independent, but permission and quality gates cannot be
skipped. Tune on development data, not held-out acceptance labels; if final
evaluation leads to tuning, reserve a new untouched acceptance set. Broader
professions, languages, OCR and vendor-specific claims need separate coverage.

Rollback restores the prior evaluator for new checks, not old-editor writes.
New-method history remains readable and separately labelled. No migration deletes
or retroactively recalculates historical scores.

## 10. Evidence boundary

The October 3 read-only audit ran 72 existing ATS assertions and 14 focused Resume
unit tests successfully. No new provider/vendor evaluation was run. Earlier real
evaluation showed both an evidence misinterpretation and a later corrected
interpretation; neither establishes broad calibration. The foundation and
evaluator, local pilot and gated review UI now have the tests recorded above.
Complete candidate integration and actual model-quality acceptance remain pending.

Primary vendor documentation checked during the audit:

- [Greenhouse parsing](https://support.greenhouse.io/hc/en-us/articles/200989175-Unsuccessful-resume-parse):
  parsing populates fields; failed parsing can leave the file attached for manual
  entry. Formatting risks and file limits are vendor-specific observations.
- [Greenhouse Talent Matching](https://support.greenhouse.io/hc/en-us/articles/41396009937307-Talent-Matching):
  recruiter-defined criteria/weighting and assistive matching, not automatic
  advance/rejection or a universal external score.
- [Greenhouse auto-reject](https://support.greenhouse.io/hc/en-us/articles/360000653472-Auto-reject):
  configured application-question responses can drive rejection independently of
  resume quality.

These sources ground the separation of parsing, matching and application rules.
They do not validate this product or justify claims about other vendors.
