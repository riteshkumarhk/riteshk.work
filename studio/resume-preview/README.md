# Resume Studio

Studio has one resume workflow: Prepare > Resume ATS Check > review > Edit resume / Continue editing > Re-check ATS > checked PDF. Saved resumes remain in ATS history; there is no separate Resumes tab or legacy editable canvas. The editor uses dedicated private storage and the authenticated parent bridge. The separate local preview uses a filesystem store and its experimental evidence rubric; it is not a second production workflow. Automated hosted tests use synthetic authentication and Miniflare, not real account or device acceptance. Enhancv is the baseline to surpass, not a claim of proven superiority.

## ATS Migration

- Opening an old editable workspace copies its saved structured fields, order, target and compatible design settings without AI rewriting. Review-only records use retained source text and require import/layout review.
- Deterministic identities make retries repeat-safe. Original bytes are hash/size checked; legacy snapshots and historical scores are retained. Missing originals are identified explicitly, never replaced with today's website PDF.
- After cutover, edits save only to the new record. Old-editor writes/deletes are rejected. Changed local/cloud legacy copies are recovered as separate variants before editing continues; original migration snapshots remain immutable.
- PDF preview remains available, but migrated layouts require explicit acceptance before download. Unsupported legacy fonts/template decoration and pagination need comparison; identical styling is not promised.
- Hosted Re-check ATS uses the current verified PDF and current target through the same assessment function as ATS intake and original-source rechecks. It reuses Studio AI configuration with explicit request consent. Historical ATS and experimental rubric scores are labelled and not presented as comparable measurements.
- A finding opens an unambiguously matched field. Revision requests reuse citation/number checks and can return a selective proposal or missing-fact question. Only explicit Apply changes authored text and creates a before-change checkpoint.
- Deploy the Worker migration routes and legacy write guards before the site bundle. No migration runs simply from deployment; it happens when the owner opens a saved record. Rollback can read retained snapshots, but must not re-enable legacy writes over migrated records.

## Start And Test

- Start: `node tools/resume-preview.mjs`
- Open: http://127.0.0.1:5530/studio/resume-preview/
- Tests: `node --test resume-workspace.test.mjs worker-stability.test.mjs`; existing ATS checks: `node --test ats-core.test.mjs`.
- Release evidence is recorded in the private checklist. Actual model quality and account/device acceptance are separate from synthetic fixtures.
- PDF/browser tests use installed Edge by default. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to another installed Chromium executable when needed.
- The review store is `%TEMP%/rk-resume-preview-v1`. Keep it to retain sample edits. Tests use a disposable separate store on port 5561.

## Morning Acceptance Checklist

| Workflow | Expected Outcome |
| --- | --- |
| Open a saved resume | Editable current document, not the original assessment. Company, role, version and local save status remain distinct. |
| Back and toolbar | Hosted Back saves pending edits before returning to ATS Check; failed saves keep the editor open. Right-hand tools are circular, Preview PDF is a pill, Export PDF is a gold icon-only button with a tooltip. |
| Properties panel width | Drag the right panel's left edge, or focus the separator and use Left/Right arrows. Double-click or Home resets; End widens to the available maximum. Escape cancels a drag. Width is remembered locally, bounded to keep the canvas usable, and does not change resume content/history. Phone sheets keep their existing layout. |
| Click a name or achievement on the page | Matching field opens in the content inspector. Typed spaces, newlines and comma-separated skills survive save and reload. |
| Sections outline | Navigate, add, reorder and remove sections. Roles, education, skill groups, achievements and links can be edited or removed. Undo restores changes. |
| Duplicate for another role | New document identity; changing its company/JD does not change the original. |
| Version history | Save a named restore point, inspect an older version, restore it as a new version. Original sources and previous exports remain. |
| Import TXT, PDF or DOCX | Original bytes are retained separately. Review extracted text before attaching or creating editable content. Scanned/empty files fail explicitly; OCR is not connected. |
| Structured import | Recognized headings, clear role/bullet blocks, skills and dates become editable fields. Ambiguous blocks and profile text remain intact with review warnings. The source file is unchanged; formatting fidelity and uncertain field assignments still require comparison. |
| Cancelled import | Delayed reads cannot open on another resume. Cancel invalidates pending attachment or creation responses, including after returning to the same resume. Already accepted remote originals may remain available; cancellation does not delete them. |
| Original source check | Capture a frozen lexical check against the current target. Later editing/review does not replace it. |
| Sources and provenance | Linked original files, recorded author answers and export history stay separate. Unlinked library files and hashes are collapsed until needed. Evidence selection retains keyboard focus when a row moves; original-source checks exclude later author answers. Unlinking never deletes source bytes. |
| Role/JD checks | Weighted keyword coverage, lexical context and structure are shown separately, with a provisional measured score and its weights. Role-title-only checks are labelled. |
| Missing requirements | Highest-weight gaps are listed. Matched terms can open the relevant field. Missing terms do not trigger fabricated experience. |
| Fictional suggestion | Inspect current/proposed wording, source excerpt and projected score. Apply only with explicit action; a named before-change restore point is saved. |
| Suggestion navigation | Open the named supporting source or Edit field. Back to suggestion restores the pending proposal, expanded evidence, keyboard focus and review/canvas reading position. Source visits retain the mounted canvas and original bytes; navigation creates no version. Editing the target makes the retained proposal stale and disables Apply. |
| Your proposed revision | Choose Add revision under Suggestions, then a field, wording and exact source excerpt. Review impact without changing content; then Apply. Dismiss and Apply use the matching Studio neutral and gold primary pill styles. Unsupported numbers and nonmatching excerpts are rejected. Semantic truth still needs your review. |
| Stale suggestion | Change document/target/evidence after reviewing a suggestion. Apply becomes unavailable until a fresh review. |
| Design and PDF | Change font, paper size, margins, density or columns. Preview/export share one renderer. Select/copy text, click actual links, inspect page breaks and the parser reading-order view. |
| Compact typography | Body size and line height share a row. Type, use keyboard arrows or the shared chevrons, hold a chevron, or drag a value horizontally. A hold/drag previews the number and commits once on release; Escape, pointer cancellation and losing focus cancel it. Bounds remain 8-14pt and 1.15-1.8. |
| Page separation and layout choices | The editable screen preview has a 32px gap between paper pages after pagination; print output and stored document settings are unchanged. Layout buttons use stable 80px height, 20px icons and wrapping labels within their bounds. |
| Hybrid layout | Single column stacks every section. Two columns uses the sidebar. Hybrid keeps the main document full-width and enables One/Two/Three entry columns for individual custom/link sections in Design. Switching modes retains section choices without changing text; Single ignores those choices until Hybrid is selected again. Check geometry-based reading order as well as native PDF text: local columns can interleave even when native order is correct. |
| Dates and education | Dates, durations and times use a separate right-aligned entry field. Experience and Education keep their existing date fields; custom/link entries also expose Dates / duration / time. Dates written inside older Detail text are not automatically inferred or moved. Education qualification and note flow on one line where space permits, wrapping without clipping in narrow columns. |
| Canvas theme | Sun/moon beside zoom changes only the canvas and page shadow. Paper/PDF remains white, document history unchanged; preference survives reload. Transparent iframe gutters show the canvas without an extra white surround in either mode. |
| PDF preview | PDF.js renders the actual export or original bytes with selectable text, links, page navigation, zoom, fit and retry. Both side panels and mobile panel launchers are hidden for exports. Canvas or Edit resume returns to editing. No browser PDF plugin is required. |
| Accent and notifications | Actual Slide palette, custom colors, hex, spectrum and RGB picker. Escape restores focus; three-digit channels fit at 320px. Desktop screen picking is abortable; unsupported browsers get a dismissible message. Existing `rk-flash` styling replaces the full-width strip; message areas do not block content clicks. |
| ATS review | Hosted Re-check ATS requires explicit consent and the existing Studio AI configuration. It checks the current saved PDF and target, retaining earlier results. The separate local evaluation's evidence rubric keeps its own model/budget and requirement-review consent. |
| Finding decisions | Set aside a finding with a reason. Already evidenced requires a current passage; its exact text is retained with the author decision. Undo, Redo and Reopen work without changing the original AI review or score. |
| Revision outcomes | An explicit revision request can return a source-backed proposal, a focused question, or a cited no-revision recommendation. No-change results require evidence already in the resume; they do not automatically dismiss findings or rescore them. |
| Old PDF | Edit after exporting. The earlier artifact is labelled Historical PDF; exporting again verifies the current version. |
| Failed save | In an isolated test browser, block a save. Local outbox retains it; reload/retry recovers it. No live-site storage keys are used. |
| Two-tab conflict | Change the same resume in two tabs. Compare both versions; keep local edits as a separate copy or explicitly choose the server version. |
| Hosted entry and expired PDF | Open through ATS Check, using a saved review, workspace or Saved resumes. Standalone or cross-origin frames show a signed-in Studio message without API access. Expired PDF verification removes only that pending pair; Retry renders again without changing the resume. |
| Phone | At 390px and 320px, open library, sections, inspector and dialogs; controls stay in bounds and the canvas remains accessible after closing panels. |

## Evidence And Limits

### Local Evaluation API Contract

The provider-neutral `reviewResumeWithAI` adapter in `src/js/resume-review.mjs` accepts the existing provider's completion transport, provider/model identity, cancellation signal and a current-document getter. It does not read keys, call a provider itself, or save/apply content. There are at most two calls: inventory the JD without candidate data, then assess against that inventory. Reuse the returned manifest for subsequent reviews of the same target; do not quietly regenerate easier criteria after an edit. Require user review of the inventory before relying on it. The transport must honor `maxTokens`, cancellation, provider context limits and normal API error handling. There are no automatic repair/retry loops.

| Dimension | Weight | Basis |
| --- | --- | --- |
| Role evidence | 60% | Actual JD criteria; required 3, responsibility 2, preferred 1 within this dimension. Semantic equivalents count, repeated keywords do not. |
| Scope and ownership | 15% | Contribution and responsibility appropriate to senior IC, staff/principal or leader. |
| Outcomes and credibility | 15% | Supported value, results or learning. Qualitative outcomes can receive full credit. |
| Writing and organization | 10% | Specific, coherent, understandable content, not arbitrary style conventions. |

- The model supplies anchored 0-4 ratings, criterion-specific reasons and excerpt IDs. Code resolves original field text, validates the inventory/response, and computes the weighted sum. No freestanding model score is accepted; lexical cosine and keyword matching are not added again.
- Unknown means unassessable, while absent means not documented. Unknowns or no scorable JD suppress the overall score and return a possible range plus assessed-weight coverage. That range is mathematical uncertainty, not a statistical confidence interval. Required gaps remain separately listed; a high average does not override a requirement or predict eligibility.
- Full input is reviewed or the request fails explicitly: 20,000 JD characters, 60,000 serialized evidence characters, 300 JD segments, 60 criteria. No silent resume/JD slicing. Invalid citations, missing/duplicate criteria, extra response keys, bad rating/status pairs, stale targets and cancelled results fail closed. Contact fields and the standalone name field are excluded from model input; text can still contain personal information and is not guaranteed anonymized.
- Prompt rules prohibit fabrication, protected-trait/proxy scoring, embedded prompt instructions, speculative layout judgments and promised score increases. Structural validation cannot prove the model obeyed these semantic rules. The JSON fixtures test arithmetic/guards, not model quality, truth, bias or resistance to adversarial prompts.
- Prompt version 2 retains authored section, role, organization and dates beside excerpts. The exact JD quote governs alternatives such as "CRM or enterprise software"; labels must not silently narrow that requirement. Revision input includes the same frozen requirement. These are input-contract improvements, not proof that the observed semantic errors are fixed in real model output.
- Before integration/release: evaluate real API outputs against a human-rated, diverse, consented dataset; measure criterion coverage, citation relevance, contradiction detection, rank agreement, repeat-run/model drift, keyword-stuffing resistance and demographic-counterfactual consistency. Review false positives/negatives and calibrate anchors/weights; do not tune merely to lift the mean. Persist rubric/provider/model/target/version provenance. Keep parsing evidence and explicit, checkpointed proposal application separate.

### Existing Plateau Audit

The formula has no 76-point cap. The prompt anchors solid/first-draft resumes around 60-75, asks for layout judgments from extracted text and requires a fixed number of fixes. Its returned score is blended with keyword, structure, semantic and parse signals. Quick projections hold the AI component fixed. The retired canvas assumed parse=100; the unified editor now reads the current PDF instead. Existing prompt slicing (12,000 resume / 8,000 JD characters) and scoring calibration are not redesigned by this migration. These are concrete limitations, not a confirmed diagnosis of a particular owner's score.

### Guidance Sources

Reviewed September 16, 2026:
- [Greenhouse: Unsuccessful resume parse](https://support.greenhouse.io/hc/en-us/articles/200989175-Unsuccessful-resume-parse): parsing auto-fills fields and may fail partially. Documents images, columns, headers/footers and inconsistent structure as risks, and a vendor-specific 2.5 MB parsing limit. This is not a universal scoring formula or proof that every columned PDF fails. Fictional sample parsing is not vendor acceptance evidence.
- [EEOC: Employment Tests and Selection Procedures](https://www.eeoc.gov/laws/guidance/employment-tests-and-selection-procedures): job-relatedness, validation, discriminatory impact and appropriate assessment use. These inform guardrails; this personal authoring tool is not a validated hiring selection procedure or legal compliance certification.

### Remaining Limits

- Automated checks cover field preservation, history, source bytes, conflict recovery, evidence validation, score projection, explicit application, stale results, PDF text/links/fonts/page counts and physical-page bounds, plus desktop/phone interactions.
- PDF text completeness and positional heuristics are not proof that Workday or every ATS will parse fields correctly. Actual vendor upload testing remains a user acceptance gate.
- The existing production ATS engine supplies deterministic checks/weighting. Unavailable signals are excluded, not assigned a fictional perfect score. The connected review has strict structural guards, but real suggestion quality and calibration remain unaccepted. Mock responses do not prove semantic accuracy or superiority.
- Built-in generated suggestions are fictional fixtures. User-authored proposals support arbitrary source-backed edits, but exact excerpt/numeric checks do not independently establish semantic truth.
- Deterministic structured text import covers clear English section headings and entry boundaries. Ambiguous blocks are retained as text, not guessed. There is no OCR or arbitrary PDF-layout reconstruction; complicated columns, profile/contact mapping and unusual headings require review.
- The private bucket/binding and Worker endpoints are deployed. The bucket has no public endpoint or custom domain; its one-day lifecycle rule applies only to `pending/`. Finalizing an expired attempt also removes that pending pair. Original sources, saved versions and completed exports are excluded. Lifecycle configuration is verified, but elapsed-time background deletion has not been observed.
- The full Studio entry, private persistence, checked PDF, expired-export retry and failed-close recovery pass with synthetic authentication, Miniflare R2 and local Chromium rendering. Real owner-authenticated Cloudflare rendering and cross-device acceptance must be recorded separately. The production renderer requires the bundled Paged.js asset.
- Budget reservations remain browser-local, not a globally enforced cross-device budget. Real model calibration is incomplete; do not assume a new browser shares an existing evaluation allowance.
- The real-resume milestone is not accepted on suggestion quality. Deployment and passing fixtures do not constitute completion of that acceptance gate. Original files, owner drafts and unrelated ATS/vault data must remain intact.