# Resume Studio

Studio has one resume workflow: Prepare > Resume ATS Check > review > Rebuild your resume > clean editable resume > explicit ATS check > further refinement. Saved resumes remain in ATS history; there is no separate Resumes tab or legacy editable canvas. The editor uses dedicated private storage and the authenticated parent bridge. The separate local preview uses a filesystem store and its experimental evidence rubric; it is not a second production workflow. Automated hosted tests use synthetic authentication and Miniflare, not real account or device acceptance. Enhancv is the baseline to surpass, not a claim of proven superiority.

The reviewer toolbar's Rebuild/Continue actions and each finding's **Rebuild to
fix** action use the same hosted editor. PDF extraction retains actual line
boundaries and reconnects positioned bullet markers before structuring the
source. Unambiguous name/contact fields, summary, roles, employers, dates,
locations and education become separate editable fields; repeated section
headings are consolidated without dropping entries. Uncertain text and
unmapped PDF glyphs remain explicit, not guessed or rewritten. Known missing
Inter symbols can be recovered only from exact, visually verified embedded
outline fingerprints and matching left-to-right extraction order. Different
fonts, unknown outlines and ambiguous ordering remain marked. The shared
reader covers review extraction, positional checks and editor import; saved
review input and original bytes remain unchanged. Existing structured copies
repair marked characters only against uniquely matching recovered source
excerpts, preserving custom edits. Legacy ligature normalization remains.
Section anchors
and uniquely matching quotes navigate to the corresponding field; ambiguous
and document-wide guidance never invent a text target.

**Rebuild your resume** and **Rebuild to fix** now use all saved ATS feedback
and the target job for a complete AI-assisted rewrite, not just editor
navigation or a source import. The explicit Rebuild click uses the existing Studio AI
configuration, model-capacity output policy and writing transport. The local
experimental transport retains its priced reservation and 12,000-token output
ceiling; it does not override production Prepare policy. Every editable field, section, entry and
finding must be accounted for. Name, contacts, roles, employers, dates and
credentials remain protected; changed wording requires source citations.
Source numbers cannot be dropped or changed and unsupported skills cannot be
inserted. Citations establish provenance, not independent semantic verification.
Missing facts remain unresolved rather than invented. Invalid, incomplete or
late output fails without overwriting the source draft or silently retrying.
Sections/entries can be reordered, but the rebuild does not merge roles or
delete achievements to force a page count. The request includes an exact
entry-group manifest. `entryOrder` contains reorder operations only: `[]` or
omitted groups retain all existing entries. Supplied groups must contain every
original item ID exactly once; unknown/duplicate groups and incomplete entries
still fail. Editable fields, sections and feedback dispositions remain complete
and strictly validated. This removes redundant order bookkeeping, not content
preservation checks.

The reviewer stays visible with concise progress and Cancel while the rewrite
runs. The modern editor is revealed only after the new copy is saved and its
page is ready. There is no second confirmation checkbox or rebuild dialog.
Failure stays on the reviewer with an explicit error; cancellation rejects late
output. Rebuild completion never performs an ATS check.
Reviewer **Review again** immediately shows a spinner and **Reviewing...**,
guards duplicate invocations and disables conflicting source/rebuild actions.
Success, failure and cancellation clear its busy state; it never retries on its
own. Gold toolbar and contextual rebuild actions inherit shared CTA typography.

An already-saved flattened import reconstructs from retained original bytes
and continues directly when structured recovery succeeds; no source-only
intermediate is passed off as the completed rewrite. Missing or ambiguous
originals require explicit file selection; an unstructured result cannot be
confirmed. These are source-recovery exceptions, not a repeated AI consent step.
**Continue editing
resume** reuses a unique rebuilt copy of the unchanged source without an AI
call. **Rebuild from original** remains a separate source-only recovery action
that creates a copy and keeps historical guidance. Neither path overwrites the
original draft, source bytes or history. New migrations can re-extract retained
original bytes without modifying the legacy review snapshot or its identity.

The AI-rebuilt copy opens in the modern editor with no old score/findings panel
or empty navigation column. **ATS check** is explicit; rebuilding never runs
an assessment. **Rebuild details** in Resume options explains each finding's
disposition and missing facts. After a requested check, the new results appear
and **Rebuild using feedback** supports another iteration. Existing version
history now includes an **ATS checks** tab with dated, read-only results,
targets and submitted text. Older document snapshots are labelled as such;
unavailable checked text is disclosed rather than replaced with today's draft.
Opening history runs no AI, restores nothing and creates no version checkpoint.
If an otherwise valid response changes source numbers or introduces unsupported
skills, only those fields retain their exact original wording; other validated
edits can form a separate copy. The editor explicitly reports partial completion,
with **Needs attention** linking to field-specific reasons, retained text and
document targets. Related findings are not marked applied, and the provider's
success summary is not shown for partial results. Notes persist after reload;
fields edited since rebuilding are labelled as not rechecked. Rebuild never
invents missing skills or purchases an automatic repair call. If no wording or
ordering change validates, no rebuilt copy is created. Malformed/incomplete
responses, invalid citations and stale/cancelled requests still fail closed.
The prompt supplies each field's numeric tokens and original skill list;
numeric magnitude suffixes and plus signs must remain intact.
Visible versions remain export/manual checkpoints only.
Every supported section's authored bullet text, including education/custom
entries, prints and remains subject to strict PDF text verification. Original
page count is not imposed on recovery copies by shrinking or omitting content.

New reviews prepare proposed revisions, focused missing-fact questions, or manual
layout guidance in their assessment response. Opening an editor finding shows
that result without a separate **Suggest a revision** request or any AI call.
Revisions still require explicit **Apply**; **Keep original**, Undo, exact field
matching, source-citation and unsupported-number checks remain in place.
Earlier unversioned `replacement` strings remain historical guidance, not
validated edits. Existing reviews are not silently regenerated on opening.
**Review again** uses explicit consent and the existing configured transport.
The frozen comparison-baseline request remains unchanged.
An outdated hosted parent is rejected before PDF generation or paid review;
reopen Studio to load the matching review contract rather than silently falling
back to an older response format.

Pending revisions linked to an existing finding belong only to that finding's
context card, even when the card is closed or another finding is selected.
The editor does not show a duplicate Proposed changes rail or an empty manual
revision toolbar after a review. Unlinked, older-review and additional proposals
retain their existing review controls so saved work is never silently hidden.

Review and hosted editor show routine **Saving... / Saved / Not saved** state in
Studio's existing status footer, not among findings or beside the document name.
Save failures use one persistent shared error banner above that footer, with
**Retry**; conflicts offer **Compare versions** instead. There is no duplicate
retry action or dismiss/timed expiry. The banner remains during retry and clears
when saving succeeds. Retrying saves existing results; it does not rerun AI.
Unconfirmed acknowledgements, unavailable local copies and required sign-in
remain explicit, without an ineffective retry action for missing authentication.
Opening the editor suspends the retained review's banner; returning restores it.
Leaving Resume restores Studio's normal publication status.
The banner reuses `rk-flash` and its compact text action, not a toolbar-sized
button. Review and editor share cause-aware copy: offline recovery asks the user
to keep the tab open, reconnect and retry; a known service failure asks them to
retry shortly. Unknown failures say the save was not confirmed rather than
inventing a network cause. Sign-in/permission failures do not offer an ineffective
Retry. Keep recovery copy brief: "Changes weren't saved. Try again later." or
"You're offline. Reconnect to save." An uncertain acknowledgement remains
"Save not confirmed. Try again." Do not promise saved changes or invent a
connection problem. Messages wrap within the existing responsive banner.

The original review and hosted editor sit between Studio's actual navigation
header and document-status footer. They do not duplicate either component.
The footer sits above both workspace surfaces so its single shared top divider
stays visible, including when the editor iframe is composited at fractional scale.
Settings and AI activity remain available; switching Studio tabs or leaving
Studio first saves the editor, and a failed save keeps the editor open.
The working bar shares Studio's fixed Back / Undo / Redo slots, 48px single-row
height, 34px controls, spacing and label typography. Review leaves the history
slots empty; the editor uses its own resume history. Secondary actions wrap on
narrow screens without moving or shrinking the navigation controls.
The original review groups its title and target level above the left-panel score,
not in the working bar. Its document canvas has no separate full-width header:
an always-visible floating group at the bottom right contains page count, zoom out,
zoom in, a Fit page / Fit width toggle and canvas lighting. Fit page fits the whole first page within the available
canvas width and height (not fullscreen); initial opening retains a width-fit
reading view. The controls stay 12px inside the canvas edges above the status
footer while the document scrolls. They overlay the PDF without reserving a row
or adding canvas padding; Fit page uses the full canvas with its normal insets. The centred
save banner retains its shared position 12px above the footer. Only when their
bounds would overlap does the floaty move above the banner; it returns to its
normal corner when the banner clears or sufficient horizontal space is available.
Banner wrapping and canvas resizing are observed; keyboard focus is retained.
The editor uses the same shared bottom-right overlay, 34px controls, 16px button
icons, padding, spacing, typography, border and shadow. Both show `Page 1 / 1`
without a page icon and track the page at the viewport midpoint while scrolling.
The editor also updates that counter after zoom, repagination and resizing. Both
fit controls alternate between whole-page fit and width fit; tooltips and accessible
labels name the next action. Manual zoom makes the next fit action Fit page.
Switching fit modes returns to the first page, without changing document content.
The editor's exported PDF preview has one bottom-right single-row floaty:
Show/hide reading order | Previous page, page number/total, Next page | Zoom out, Zoom in |
Two-page toggle (multipage PDFs only), Fit toggle | Download this PDF, Print this PDF, Close PDF preview (X). Four subtle dividers separate these groups, matching
the owner's reference. Previous/next disable at document boundaries. The page-number
input and scrolling also navigate pages. Fit alternates between whole-page and width fit; after manual
zoom its next action is Fit page. Both fit modes respond to viewport resizing.
PDFs with two or more pages also offer a separate Two-page view toggle immediately
before Fit. It starts off and uses PDF.js paired spreads (1–2, 3–4, etc.), with an
unpaired final page retained. Turning it off restores the single-column layout.
The current spread stays in view; the page counter follows PDF.js's first visible
page in a spread. Fit page/width work on the pair without changing their cycle.
Navigation uses PDF.js spread-aware Previous/Next with paired end boundaries.
PDF startup resolves metadata and page one before mounting the viewer, so rapid
close/reopen cannot reject a reset viewer initialization promise.
Switching layout after manual zoom fits the pair/page. Zoom, scrolling, selectable
text and links continue to work. Closing/reopening resets the layout to single-page.
This is display-only: download and print retain the artifact's original pages,
not two-up sheets. Original-source reader controls are unchanged.
Controls are 34px with 16px icons in one 44px-high shell, 12px inside the viewport edges.
At PDF viewport widths of 480px or less, button widths reduce to 28px, and at 380px to 24px (retaining 34px height),
with compact gaps and page input, so all controls remain in one unclipped row.
At 380px or less, the additional two-page button uses tighter group spacing and
page-counter typography; every action still has at least a 24px-wide target.
The panel lifts above an overlapping save/verification banner and
returns to its corner when the banner clears.
PDF preview is a focused subview: the editor's entire action bar is absent,
including workspace Back, Edit resume, history, rename and duplicate Export.
The floaty's final Close PDF preview (X) is the sole local exit and receives focus on entry.
It restores the editor bar, including its normal workspace exit. Studio's global
header and save/error feedback remain unchanged.
Standalone save status remains available to assistive technology in PDF mode;
save failures still use the existing visible feedback banner.
Its former back/status, artifact and PDF-navigation full-width rows are removed.
PDFs start width-fitted and remain scrollable and selectable, with live links
and explicit load/retry errors.
Download uses the displayed artifact's bytes, not a regenerated version; current/
historical version and verification metadata remain in its tooltip and accessible
status. Print uses the loaded PDF.js document, not a regenerated résumé or a
screenshot of the visible viewport. All pages render at 150dpi into an isolated
print frame with artifact-sized, zero-margin sheets and no Studio controls.
The browser print dialog controls printer selection and final settings. Print is
disabled until loaded and while preparing/printing; failures show the existing
error banner. Closing/replacing the preview cancels preparation; afterprint,
cancellation and failures remove the frame and revoke its image URLs. Print focus
returns after its button is enabled again. Native dialogs are stubbed in browser
tests, with an additional Chromium print-to-PDF check for page count and paper size;
tests do not send jobs to a physical printer.
Migrated layouts still require approval before download or print. Close restores
focus to Preview PDF. Original-source PDF controls and the read-only reviewer
are unchanged. In exported PDF mode, parser reading order replaces the Review rail;
the duplicate disclosure below the PDF is removed. The floaty's first button
shows/hides this panel without changing the artifact. Its right edge supports pointer
resizing, Left/Right keys (16px), Home/double-click (default width), End (maximum),
and Escape/pointer cancellation. It shares the properties panel's resize behavior.
Width is bounded to preserve the PDF viewport; panel width and visibility survive
mode changes within the workspace session, without saving document/history data.
The panel defaults closed at every screen size; opening it is an explicit choice
through the floaty toggle. On phones it opens as a resizable overlay above the
floaty, leaving the hide/show action accessible.
Close restores the unchanged Review and Document/Design panels.
There is only one fit control in each view: the icon, with no duplicate Fit/percentage
button. Both floaties have the same four icon-only buttons in the same order.
Reviewer and editor share the same smooth canvas background and page-shadow styles,
without a dotted grid. The sun/moon toggle changes only canvas lighting, not the
document or Studio theme. The existing canvas preference persists and stays in sync
between open review/editor tabs and hosted frames.
The editor retains zoom and canvas-lighting controls, including on narrow
screens. Its normal edit view has no document-toolbar row or added canvas
padding. Original-source and exported-PDF modes retain their return actions and
verification context; mobile Review/Document/Design access remains available. The same
collision handling covers the hosted parent save banner across the iframe and
standalone editor messages, without moving either banner.
Selecting a finding card scrolls to and highlights its cited passage in the resume,
without opening a text input or changing the document. The finding title provides
the same action for keyboard users. Overall findings with no location do not jump
to an invented passage. Embedded evidence and action controls retain their own
behavior; the redundant Edit affected field button is removed.

### Writing and organising the draft

**Write on the page, organise in Document, style in Design.** Review stays on the
left. A shared-style Document / Design toggle sits immediately before Preview PDF
in the upper toolbar and switches the right panel, with Document selected on
opening a resume. The panel has no duplicate tab strip. Arrow keys and Home/End
switch the toggle; on phones its labelled icons open the existing properties
sheet, with bottom navigation and Close properties retained. There is no separate
Content form or left-hand Outline tab. This applies only to the working draft: the reviewer
and original PDFs remain read-only, and suggested revisions still require Apply.

Click a text field on the page to edit it in place. A plain-text input keeps the
full logical field, including text spanning pages. Typing and IME composition keep
a stable input; autosave continues and pagination settles when the field closes.
Enter commits a single-line field; Ctrl/Cmd+Enter commits multiline text. Escape
cancels that editing session; Tab/Shift+Tab move through rendered fields and leave
the page at either end. Toolbar Undo/Redo treats each field-edit session as one
change. Plain-text paste cannot introduce arbitrary document markup.

Document provides drag handles and Move up/down controls for sections, entries,
achievements and contact details. Ordering changes the actual document and PDF,
not only the tree. Two-column layouts show Main/Side groups with an explicit
column selector; dragging stays within each list. Header and Profile remain fixed
above the sections. Add, duplicate and remove operate on the structured model and
remain reversible. The tree selects the corresponding page field, rather than
duplicating its text in another editing form.

Email, phone, location and links open a small anchored detail card with
Done/Cancel/Remove. Links retain separate display text and destination; only valid
HTTP(S) destinations are accepted. Optional `contact.order` and section `column`
properties preserve legacy defaults when absent. Blank-field prompts and inputs
are editor-only: final PDFs contain neither. When prompts affect preview
pagination, export does not assume the editor's page count is the print count;
the final PDF still undergoes its own page-limit, text and geometry verification.

The document retains the existing editor's email, phone, address/location,
website/LinkedIn and calendar icons for employment and education dates. These share the original
SVG geometry, remain decorative beside selectable text, and render in exported
PDFs as well as the editable page. Clicking an icon opens its associated field;
editing the text does not replace the icon. Blank details do not print lone icons.
The email envelope is vertically centred on the font's lowercase letter height,
rather than raised by the shared icon baseline offset; editor and PDF use the same rule.

Review and editor share value-labelled finding categories. Explicit category IDs
are `role`, `impact`, `story`, `interview`, and `readability`; existing unclassified
ATS findings remain under **Review recommendations**, without guessing a category
from their wording or fabricating a category score. The evidence rubric maps its
existing requirement, scope/outcome and clarity criteria to the corresponding
groups. This presentation does not introduce new assessment capabilities.

Concrete suggestions are shown upfront under lightweight headings, not chevrons.
Broader guidance follows under **Deeper review**, with collapsed categories and
visible counts; practical checks remain expandable. A shared partition keeps each
finding in exactly one location with the same original index, evidence and decision.
High-priority findings are promoted upfront regardless of topic. Writing and
unclassified recommendations stay upfront; role/impact advice with cited context
also appears there. Broader role/impact guidance and non-urgent career/interview
guidance remain expandable. This is a presentation rule using existing metadata,
not a new score or semantic classification. Selecting a document pin or handing off
from review opens the relevant collapsed group when necessary. Empty groups are
omitted, and set-aside findings retain their separate reversible history.

Deeper review and Resume essentials share contiguous disclosure rows with the
same 52px minimum heading height, 14px vertical padding and one divider per row.
Fixed 16px chevrons reuse the site's rounded SVG geometry, pointing right when
closed and down when open; they are not text plus/minus symbols. Expanded content
keeps its own spacing. The editor does not add another separator before the next
panel section. Native disclosure keyboard behavior is retained in both surfaces.

The reviewer keeps its original PDF read-only. Selecting a finding or document
highlight opens a bounded contextual panel with the explanation and **Address in
editor**. A passage disclosure is only needed when the quote could not be located
on the PDF. The existing handoff carries the exact saved
finding into the working draft; entering the editor applies no feedback.
In the editor, selection opens the same contextual hierarchy without selecting
an input. The highlighted passage supplies the context: there is no duplicate
View context/evidence disclosure or Open cited field step in the popup. Click
the passage directly to edit it. Pending revisions highlight the actual proposed
field, which may differ from the criterion's original scoring citation.
The contextual panel displays validated pending proposals as Current /
Proposed with **Apply / Keep original**, or a specific missing-fact question or supported
no-revision result. Escape closes it and returns focus to the finding. Geometry
tracks scrolling, zoom and resizing, leaving the bottom view controls accessible.
Overall findings use a bounded panel without inventing a passage anchor.

Recorded practical results remain discoverable under **Resume essentials**;
empty diagnostics, methodology, migration and provenance blocks are not shown in
the feedback rail. Empty hosted proposal sections are omitted.
**Archived suggestions** is the bottommost, collapsible Review module, including
an empty state. Archive retains the finding, reason, note, cited passage and
prepared wording; **Restore suggestion** returns a current-review item to the
active list without an AI request. Archiving/restoring closes the contextual
popup and returns focus to the corresponding Review row. Earlier-review archives
remain inspectable after rechecking, but cannot apply stale wording; their action
opens the normal consented **Review current resume** flow. Legacy decisions retain
their recorded reason/evidence even when no proposal snapshot exists.
These decisions never change the assessment or authored text. Keep original and
standalone proposal Dismiss remain separate wording decisions, not finding archives.
Applying a proposal retains an internal before-change recovery version and leaves the earlier
assessment historical. Checking the rebuilt PDF remains a separate operation.
Local fictional demonstrations use separate records and prevalidated sample
proposals; they never install a production mock-provider bypass.
The normal local and hosted editors omit **Add revision**, **Load sample** and
empty **Proposed changes** sections. Existing saved standalone proposals remain
inspectable/actionable, not deleted. Manual/sample authoring controls are available
only through the explicit localhost-only `?sampleTools=1` development entry.

The score's **Review information** button opens a click/keyboard popover with the
target role/company with **Edit role** aligned beside the details, and **Source options**
collapsed by default. The reviewer retains its existing back-navigation bar.
Its main CTA is **Rebuild your resume**, or **Continue editing resume** when a
working draft already exists. This CTA sits at the far right of the back-navigation
bar, not in the review panel. It uses the compact 34px toolbar sizing and wraps
below the navigation on narrow screens without overlapping the back button.
Review again remains with the assessment. Original
files offer View original, Reupload source and Download. The popover fits narrow
viewports, dismisses with Escape/outside click, and does not edit the document.
The reviewer hands Edit role to the editor; it never rewrites its saved target.
Editor target changes retain the previous assessment and its original score label
until Review again. Reuploading in the editor uses the explicit import confirmation:
attach a source without replacing the draft/earlier sources, or create a separate
resume. Reviewer reattachment accepts only the saved original, with matching text
and checksum where recorded; a different PDF is rejected without rebinding history.

Revision cards lead with the issue, benefit and Current/Proposed comparison.
Archive suggestion is an accessible icon beside Close. There is no per-finding revision
request or consent dialog; Keep original dismisses the prepared proposal.
Routine field citations, internal method tags and duplicate demo explanations
are omitted from a straightforward wording comparison. Source references remain
stored with the proposal, not repeated as an evidence disclosure in its popup.
Missing facts use **Your answer / Save answer**, not evidence jargon.
Saving an answer attaches a source without rewriting the resume or making an AI
request. A separately consented Review again can use selected sources for proposed
revisions, never as evidence already present in the scored resume. Multiple
findings retain their own prepared questions and recorded answers.
Adding an answer does not disable the other questions from that review: the
existing source-addition guard permits collecting all facts before one recheck.
Changing the resume/target or removing reviewed sources still blocks stale answers.
ATS responses use `responseVersion: 1`; partial quote replacements must match
exactly once in one editable field. Invalid responses fail explicitly without
applying edits. Historical/migrated reviews are not promoted into current proposals.
Demo identification stays at workspace/review level.

The editor's single toolbar Back returns to the originating reviewer after a
successful save when opened from that review, preserving the review's selection.
There is no second back button over the editing canvas. Source/proposal visits
without an originating reviewer use the same toolbar arrow to return to the
document or suggestion. Failed saves retain the editor and unsaved work.

**Job language** skill chips appear in both reviewer and editor: **Not mentioned**
and **Covered** use the saved assessment's keyword lists. The editor group starts
open. These are suggestions, not proof of experience or automatic skill additions;
they retain the earlier review's historical status after edits.

The editor toolbar ends with **Document / Design**, **Preview PDF**, then
**Resume options**. Its anchored menu contains **Download PDF**, **Rename resume**,
**Duplicate resume**, **Archive this resume**, and **View version history**.
There are no separate duplicate, history or download buttons in that toolbar.

**Version history** contains only **PDF exported** checkpoints created when
downloading the current resume and explicitly named **Save restore point** entries.
Ordinary edits, PDF previews/verification, AI checks, Apply, Undo/Redo and restores
still save safely, but do not add visible history checkpoints. Internal versions
and existing PDF files are retained, not purged. New saves carry an explicit
`checkpoint` kind (`manual`, `export`, or `null`) through local/hosted persistence
and outbox recovery. Invalid kinds fail without writing. Existing exports identify
their original versions; legacy untyped named points are recognized from identical
adjacent snapshots and non-internal labels, without rewriting the old journal.
An empty history explains how to create a checkpoint and disables PDF preview.
Selecting a row never restores it. **Preview ON / OFF** defaults off; enabling it
shows a read-only, page-fit PDF of the selected snapshot beside the list.
The note identifies the selected saved version and makes clear that the current
draft changes only on Restore; renderer implementation details are not presented
as a warning in this comparison view.
**Download PDF** regenerates that snapshot without saving, restoring or adding
another history entry. **Restore vN** explicitly restores it as a new internal
revision; Undo returns to the draft that was open before restoration.
Older export metadata is identified within its matching version row; there is
no separate Export history section.

New Studio PDF requests use transient rendering: content and design snapshots
remain durable, but generated PDF bytes live in browser memory, not permanent
PDF storage. Hosted verification retains only a short-lived rendering receipt
until finalization; it never writes transient PDF bytes to R2. Local preview
also returns bytes without writing a PDF file. Historical snapshots use the
latest renderer, so later rendering fixes apply to regenerated PDFs. Preview
requests are cancelled on selection/visibility changes and object URLs are
released. Migration layout approval still gates downloads. Existing saved PDFs
and the legacy export API remain readable for backwards compatibility; no
originals or old artifacts are deleted by this UI change.

Candidate assessment and explicit PDF rechecks use those same transient bytes,
without adding an editor checkpoint or retained PDF. Their captured metadata
omits the in-memory Blob entirely so separately consented private assessment
history remains strict JSON and can retain its original assessment artifact.

PDF completeness and reading-order inspection remain with PDF preview/export,
not as incomplete diagnostic cards in the review rail. Errors and save warnings
remain visible at their relevant action; hiding technical UI does not imply a pass.
Surrounding surfaces follow Work's case-study editor: base-colour left rails,
secondary-colour toolbars, properties panels and finding cards, with shared
divider tokens. The document canvas behind the page retains its own existing
background; this chrome alignment does not change the canvas or resume colours.
The standalone filesystem developer preview remains isolated, with its local
preview label; review the shared application shell through hosted Studio.

## Next Assessment Contract

**Current scope: offline handoff readiness; the expensive campaign is rejected.**
The central candidate picker now recommends an eligible model using the existing
analysis-task router within the configured API, live catalog, verified server
capabilities/prices and available budget. It is not permanently pinned to Sonnet.
Reasons/provisional confidence are visible; manual choice and fresh consent
remain. Each approved run stays fixed; comparable rechecks retain their baseline
model and evidence policy. Newly available models require verified server policy
metadata, not a hardcoded name update. Anthropic and compatible OpenAI structured
transports are supported; Gemini candidate transport is not.
See [offline handoff and routing](../resume-assessment.md#offline-handoff-and-task-aware-candidate-selection---october-5).
Real-route offline browser journeys cover successful responses, malformed/refused/
truncated responses, HTTP errors, deadlines, wrong models, safe Apply/recheck and
private restoration. Synthetic replies prove plumbing, not quality of real advice.
No further paid calls, public release, shared reloads or auth changes are approved.

The local developer baseline now has a source-bound, persistent raw-request
accounting guard and a distinct `resume.baseline` preparation/assessment
capability. It counts internal retries and embeddings, detects ledger rollback,
and retains reservations after failures. Default behavior is unchanged.
[Scope, API and remaining gates](../resume-assessment.md#offline-bounded-baseline-accounting---october-5):
the guard is offline-verified, **not a connected/approved live benchmark**.
The [saved-Studio adapter](../resume-assessment.md#saved-studio-baseline-adapter---october-5)
is now implemented and verified with isolated browser transport. It requires
the current source-stamped local bundle and a separately approved/reserved run;
it never signs in, reloads or enrolls automatically. Eight new adapter browser
cases pass; no real-provider baseline or independent quality result is implied.
No paid call or real baseline enrollment was made. The
[conservative campaign-cost proposal](../resume-assessment.md#authenticated-metadata-and-proposed-campaign-ceiling---october-5)
and its prior isolated Sonnet method choice are historical and superseded.
Independent calibration/evaluation remains unclaimed, not required campaign work
for the current offline-integration deliverable.
An explicitly opt-in
`decision-context-v1` experiment now keeps additional context separate from
decision-bearing evidence, with source/reason disclosure and retained-support
guards. Default and historical behavior are unchanged. Use only the local
candidate flag `?candidate=1&evidencePolicy=decision-context-v1`; the new policy
has not been evaluated with a real provider or independently accepted.

[Offline calibration/quality measurement and CLI](../resume-assessment.md#offline-calibration-and-quality-measurement---october-5)
now reject missing measurements, leaked families, unmeasured denominators and
unsupported readiness claims. They do not create a headline formula, independent
labels or a baseline run. The actual draft readiness report has zero independent
documents/runs and correctly blocks acceptance. Steps 13-15 are **not complete**.
Latest verification: 134 focused passes, 15 later output-boundary passes
(overlapping), seven final quality tests including denominator overflow, two
full browser journeys and main/Resume builds.
See [the policy and limits](../resume-assessment.md#offline-decisioncontext-evidence-experiment---october-5).

The preceding structured integration means new Sonnet 5.5 candidate sessions use
[input-specific structured output contracts](../../src/js/resume-assessment-output.mjs)
through inventory, assessment and revisions. Fixed targets use exact keyed
reviews; the versioned decoder preserves the existing UI/domain format and old
history. The scripted browser journey covers Apply, checked-PDF recheck and
private restoration. A separately approved real structured smoke returned valid
assessment/challenge responses, but an additional uncertain context citation
made the final negation rating unknown. The guard stopped before PDF inventory.
All four isolated workflows are terminal: 9 cumulative calls/$3.322008 reserved
within $6. This is not complete provider-path or independent quality acceptance,
and does not authorize another retry, a larger benchmark or release.
See [the implementation and limits](../resume-assessment.md#enforced-response-transport---october-5).
The [new registration](../resume-assessment.md#separately-approved-structured-smoke---october-5)
preserves every earlier record and reservation; it cannot resume a stopped run.

The [unified assessment specification](../resume-assessment.md) defines the local
candidate record, dimension rules, evidence/revision safeguards and acceptance
matrix. It preserves the reasons behind the existing hybrid score, local checks
and experimental evidence rubric. Its isolated
[contract foundation](../../src/js/resume-assessment.mjs) now has
[offline tests](../../resume-assessment.test.mjs) for bound snapshots, compound
requirements, artifact observations and truthful incomplete reports. The isolated
[evaluator](../../src/js/resume-assessment-evaluator.mjs) now adds inventory
approval, assessment, a separate reasoning challenge, bounded reservations and
execution receipts through an injected transport. The opt-in loopback-only
[Studio pilot connector](../../src/js/resume-assessment-pilot.mjs) now adds the
actual single-call provider helpers, browser-origin phase reservations and
validated full-envelope local history. Its14integration tests plus17evaluator
and16foundation tests pass using synthetic HTTP responses. The local editor now
also exposes **Review > Preview candidate assessment** only with `candidate=1`
on a loopback URL. Its fictional walkthrough never contacts a provider or changes
the open document. The same dialog can prepare a new unlinked upload, an attached
original freshly extracted from bytes, or the current saved/checked PDF. All
three display the actual file hash and text; sending requires the local Studio
connector and separate budget/data approvals. Export preparation saves pending
edits but does not change scores or replace originals.55candidate contract tests
and8UI tests pass, including real PDF/DOCX parsing and cross-iframe binding.
With `candidate=1` on the parent loopback Studio URL, ATS setup and the original
review also launch this same dialog in an intake-only iframe. No editor is
mounted, migrated or created; uploaded/site files and retained originals bind
directly to the selected target. One additional actual-Studio browser test covers
this convergence and its stale/cancel/storage guards. Legacy scores remain intact.
General original-file reading-order/association is unverified. Checked candidate
exports now show a scoped authored-experience comparison in native and geometric
row order, with exact PDF spans, explicit ambiguity and no numeric headline.
This is not a column-aware or vendor ATS parser. Eleven structure tests include
real two-font and multipage exports; all66candidate/structure and8UI cases pass.
Visible-text verification now tolerates dropped soft-hyphen/zero-width controls,
never missing visible words/digits/punctuation; checked-body extraction excludes
recognized page counters without changing original extraction or raw geometry.
The fictional Summary/phone-number reproduction is fixed, but the owner's
historical file remains undiagnosed. Admin and Prepare are desktop-only.
Candidate UI/structure tests are mandatory in the `resume-workspace` browser
shard. The Windows `serve.py` helper now
serves `.mjs` workers with JavaScript MIME; existing processes need an approved
restart for that fix. Shared servers/tabs were left untouched.
Four provisional development cases are not a held-out quality benchmark.
No paid call has been made for this work. Real pilot calls require explicit
budget/data approvals; production activation, central storage/budget authority
and scoring replacement remain pending. See the full owner-aligned roadmap.
New candidate PDFs also receive reference-free native/row/possible two-region
order probes, including originals without an editor. Exact item references and
ambiguity are visible before AI consent; no order is selected or employer
association inferred. Repeated gutters may be dates/tables. Unsupported
rotation/direction/overlap and image-only pages remain unknown. Candidate-only
extraction separates distant same-row runs; legacy import/finalization is unchanged.
Assessment/challenge receive fixed uncertainty metadata, never excluded raw
positional text.73candidate/structure cases and8UI cases pass, including a real
two-column original. Original semantic associations remain unverified.
Mapped candidate PDFs now bind each evidence excerpt to its exact source items,
including repeated wording, trimming, late-drawn bullets and page boundaries.
Maps are reconstructed, not accepted from callers; changed text or substituted
saved locations fail. Locations appear before consent and in shared citation
details, but positional arrays are not sent to models. JD review also shows
every segment's proposed treatment and linked criteria; unscored segments remain
visible and invalid coverage cannot be approved.75contracts/9UI cases plus a
final focused PDF UI check pass. Semantic attribution and real quality remain
unverified, not implied by source mapping.
New candidate inputs now require source-attribution-v1: complete excerpt
classification, quoted experience groups and a challenge of every group, excerpt
and JD segment. Source uncertainty withholds affected judgments; unresolved JD
interpretation withholds role conclusions. Proposed relationships and both
passes remain visible/history-validated, never labelled independent truth.
The existing three-call job/two-call general budget flow is unchanged.
82candidate/semantic/PDF cases and10UI cases pass; a fourth scripted example
demonstrates a disputed employer overriding otherwise agreeing rating passes.
Local mechanisms throughSteps3-5 are implemented; real semantic accuracy and
unsupported inputs remain separate quality gates.
The shared presentation now validates the complete envelope, shows one summary
with explicit unknowns and derives prioritized evidence-linked actions. Shared
source/JD causes and identical communication issues are deduplicated; supported
OR alternatives do not demand extra evidence. Only matching unique native/row
PDF locations identify authored fields, never an automatically approved edit.
History retains the same derived identities; iframe state is cloned into the
receiving realm before strict validation.46focused contracts/10UI/37existing
Node cases (including72ATS assertions)/3protected browser cases pass.
Local Steps6-7 are implemented; the owner target is throughStep10, withSteps8-10
recorded below. No paid AI, automatic rewrite/recheck or public release is implied.
Step8 now supplies claim-mapped checked revisions, questions and no-change
decisions for explicitly selected current checked-PDF fields. A separate
whole-text/claim challenge can block Apply despite matching source numbers.
Confirmed author facts stay author-provided; oversized input is rejected intact.
Both calls share the existing pilot budget. Receipt validation and an acknowledged
named checkpoint precede the single-field save, with version/conflict checks,
preserved provenance and working undo/redo. No automatic recheck or point gain.
56focused contracts/11UI cases/final focused revision case/37existing Node cases/
4protected browser cases pass. Actual semantic quality and central spending remain pending.
Step9 now provides **Prepare explicit PDF recheck** for checked-export results,
including after an edit. Confirm the original inventory unchanged, review fresh
evidence and consent to two new calls against the same budget/provider/model.
Before/after observations retain separate PDF citations; unknowns do not become
gains and changed measurement inputs make results non-comparable. The full result
and comparison are saved atomically and revalidated on paired history restore.
The original captured input stays in memory, not durable cross-device history.
64contracts/11candidate UI/37existing Node/4protected browser cases pass.
ResumeJS1.23/CSS1.10; adminCSS1.215. Step10 is recorded below; quality gates remain.
Step10 adds server-enforced shared spending to the same candidate flow. The
worker validates its own model/price/cap policy, atomically reserves the complete
phase and claims each stage before one attempt. Failed/unknown attempts remain
reserved; no automatic retry or refund. Clearing local history cannot reset the
fixed server ceiling. Central candidate usage is separate from other AI and old
browser-development usage; this is not a settled provider bill.
The UI defaults to server authority and has an explicit no-AI budget refresh.
Missing policy or server failures never fall back to the separately labelled
browser-development option. Full assessment history still remains local.
72candidate contracts/12UI/31worker regressions/37existing Node cases and four
protected browser journeys pass with fictional data. Live policy is not enabled;
no cloud deployment or real-provider permission is implied.
ResumeJS1.24/CSS1.10/adminCSS1.215. Local Step10 is implemented; Step11history,
independent quality and release gates remain.
The workflow below remains current until cutover.

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
- After changing renderer code, restart the local preview backend with its existing store directory; rebuilding frontend assets alone does not reload the Node renderer. Then use **Preview PDF** to create a current-renderer export. Historical PDFs remain unchanged; do not delete them to force a refresh.

## Morning Acceptance Checklist

| Workflow | Expected Outcome |
| --- | --- |
| Open a saved resume | Editable current document, not the original assessment. Company, role, version and local save status remain distinct. |
| Back and toolbar | Hosted Back saves pending edits before returning to ATS Check; failed saves keep the editor open. Right-hand order is Document/Design, Preview PDF, then the combined options menu. |
| Properties panel width | Drag the right panel's left edge, or focus the separator and use Left/Right arrows. Double-click or Home resets; End widens to the available maximum. Escape cancels a drag. Width is remembered locally, bounded to keep the canvas usable, and does not change resume content/history. Phone sheets keep their existing layout. |
| Click a name or achievement on the page | Matching field opens in the content inspector. Typed spaces, newlines and comma-separated skills survive save and reload. |
| Document builder | Organise sections, entries, achievements and contact details on the right. Drag or Move up/down; select a row to locate its field on the page. Add/duplicate/remove and column placement are reversible. |
| Duplicate for another role | New document identity; changing its company/JD does not change the original. |
| Version history | Save a named restore point; current downloads add PDF exported. Toggle a read-only snapshot PDF preview, download without mutating history, or explicitly restore as a new version. Original sources and old artifacts remain. |
| Import TXT, PDF or DOCX | Original bytes are retained separately. Review extracted text before attaching or creating editable content. Scanned/empty files fail explicitly; OCR is not connected. |
| Structured import | Recognized headings, clear role/bullet blocks, skills and dates become editable fields. Ambiguous blocks and profile text remain intact with review warnings. The source file is unchanged; formatting fidelity and uncertain field assignments still require comparison. |
| Cancelled import | Delayed reads cannot open on another resume. Cancel invalidates pending attachment or creation responses, including after returning to the same resume. Already accepted remote originals may remain available; cancellation does not delete them. |
| Original source check | Capture a frozen lexical check against the current target. Later editing/review does not replace it. |
| Original sources | Review information > Source options contains original files with View original, Reupload source and Download. Author answers remain stored separately, not displayed as uploaded originals. Source check/provenance/selection plumbing is not exposed in feedback. |
| Role/JD checks | Weighted keyword coverage, lexical context and structure are shown separately, with a provisional measured score and its weights. Role-title-only checks are labelled. |
| Missing requirements | Highest-weight gaps are listed. Matched terms can open the relevant field. Missing terms do not trigger fabricated experience. |
| Fictional suggestion | Inspect current/proposed wording, source excerpt and projected score. Apply only with explicit action; an internal before-change recovery version is retained, not a visible history checkpoint. |
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
| Finding decisions | Archive a suggestion with a reason. Already evidenced requires a current passage; its exact text is retained. The bottommost Archived suggestions module offers inspection and Restore suggestion. Undo/Redo preserve the original review and score. Rechecking retains older archives with historical context and no stale Apply. |
| Revision outcomes | A consented review prepares validated proposals, focused questions or guidance together. Opening a finding makes no AI request. No-change results require evidence already in the resume; they do not automatically dismiss findings or rescore them. |
| History checkpoints | Edits/preview/checks autosave without visible entries. Download PDF or Save restore point creates a checkpoint; failed saves retain its kind/name in recovery. Restore remains explicit and can be undone. |
| Historical PDF | Select an older version and generate its PDF with the latest renderer. Saved text/design and current work remain unchanged; no PDF file or duplicate history entry is stored. |
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