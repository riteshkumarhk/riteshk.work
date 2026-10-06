# Content Studio Chrome

## Release Gate

The release policy separates focused local validation from full mandatory CI.
Before a release, fetch and safely integrate the latest publications without
discarding drafts or unrelated changes. Reuse a local server serving this
repository, then explicitly select coverage for the affected behavior:

```powershell
$env:SLIDE_LAB_URL='http://127.0.0.1:5510'
npm.cmd run check:release -- --file project-recovery.browser.test.mjs --pattern Journey
# Or select one or more complete browser shards:
npm.cmd run check:release -- --shard authoring
# Release-pipeline scripts/tests/workflow and documentation only:
npm.cmd run check:release -- --tooling
# Full Windows/local coverage when required for diagnosis or a broad change:
npm run check:release:full
```

Every local release selection runs the same root-test selection as CI, all three
builds and bundle syntax checks. Selected browser tests retain the provider-network
guard. Omitted/unknown selections and zero-match/skipped-only test runs fail
explicitly. `--tooling` rejects application, content and dependency changes; it is
not a general no-browser escape hatch. File/pattern selection is an explicit
engineering decision, not an automatic claim that other features are unaffected.
Use `npm.cmd` for argument forwarding in Windows PowerShell; on Linux/macOS use
`npm`. Direct invocation (`node tools/release-check.mjs --tooling`) also works.

Local commands run sequentially to avoid software-renderer contention. Independent
browser selections continue after a failure so the report contains all results,
but the command still exits nonzero; root/build failures stop immediately.
Missing/wrong/live server URLs fail before testing. Existing dependencies and
browser installations are reused; no install, publication, commit or push occurs.

Each run writes a timestamped JSON timing/result report outside the repository
by default; `--report <absolute-path>` selects a private/session evidence location.
It records the base revision, input-content fingerprint, exact commands, durations,
test totals and failures. HEAD/input changes during validation invalidate the run.
Generated bundles are excluded from the input fingerprint because builds replace
them; CI separately verifies committed output freshness. A report is evidence,
not authorization to skip tests or a reusable deployment approval.

Review and stage rebuilt outputs explicitly. Do not edit the candidate while the
gate runs. Fetch again before pushing: if remote changes must be integrated,
validate that final tree, including content-dependent backup/restore checks.
Never force-push over admin publications. Full CI still runs every required test,
regardless of the local selection, and deploys only its verified artifact after
every job succeeds. Inventory tests protect browser-shard coverage and partitioning.
The Resume shard includes candidate UI, PDF structure, Studio-bridge, baseline
accounting and assessment-probe tests. The probe indirectly launches Chromium
through real PDF rendering, so it must not run in CI's browser-free root job.
Inventory checks cover both direct launches and preview/PDF-render helpers.
CI bounds the browser-free build job to 15 minutes and each browser shard to
45 minutes; timeouts fail the release rather than leaving it running indefinitely.
CI uses the same persistent Python preview server as local validation.
Cross-frame inline-edit tests await the matching save response after composition
ends before inspecting Saved/outbox state; a previous Saved badge can still be
visible before the parent receives the iframe message.
Undo keyboard-navigation tests also await the matching rendered revision:
a saved model or an earlier non-busy badge does not mean its replacement
paginated frame is ready. The real Tab action and target-focus assertion remain.
Presenter exit tests
retain real clicks and closure/focus assertions, while accepting only the
specific target-closed click error when the clicked DJ window actually closed.
Do not remove tests, add blanket retries or deploy through failed CI for speed.

Case-study iframe tests wait for the embedded button to load, drain finite
ancestor animations including transitions started while earlier ones finish,
and check the outer iframe's actionability before the real inner-button click.
One animation snapshot is insufficient; inner-frame stability does not prove
that its parent has stopped moving. The prototype state assertions remain intact.

Isolated editor, storage and presenter hosts use the shared
`openIsolatedBrowserHost` fixture to create a stable same-origin document.
Do not use the production 404 page as an empty host: its SPA redirect races
dynamic module loading and can abort initialization.

Native text-width drag tests target the center of Excalidraw's side-resize band,
4 CSS pixels outside the element bounds, using the editor's viewport offsets.
The exact element edge is the band's excluded inner boundary and can start a
move instead. Keep the real pointer gesture, verify its horizontal resize cursor,
and assert width reduction without moving the text or scaling its font.

The Python preview server uses `PreviewHTTPServer` with a 128-connection listen
backlog and HTTP/1.1 persistent connections. Python's default five-slot backlog can refuse simultaneous module
requests from native preview frames, even though the files exist and the server
is otherwise responsive. Isolated servers must reuse this class and
`NoCacheHandler`, not construct a plain `ThreadingHTTPServer`. A root regression
queues 32 real TCP connections before accepting requests, then checks every
JavaScript body, MIME type and no-cache header, then verifies that repeated GET
and HEAD requests reuse one socket. HTTP/1.0 connection churn can exhaust Windows
socket buffers during long browser suites. Browser network failures remain
failures; do not add retries or suppress page errors.

For Windows-native/capture, browser/OS integration, dependencies and broad changes,
include the applicable Windows browser suites locally; use full local coverage if
impact cannot be bounded. Full Linux CI is not a substitute for platform-specific
acceptance. Fix or explicitly escalate local failures; never relabel them passed.
The presenters shard now owns the web-presenter tests rather than authoring.
Headless CI keeps the same real tab-capture, pixel, source-identity, input and cleanup
assertions. Optional isolated Windows display-backed checks can set
`$env:RK_CAPTURE_HEADED='1'`. A headed run also reproduced the video-consumption
stall, so changing display mode is not its fix or physical-GPU certification.

Report two milestones separately: **live and verified**, then **release closeout
complete**. The latter still requires updated regression/checklist evidence,
preserved manual results, definitions-only hosted checklist verification, updated
private history/design/master records, and a hash-verified full memory backup with
verified private push. Prepare records during CI where safe, but finalize them
using actual deployment results. Keep credentials and private records out of the
public repository; genuine manual device acceptance remains separate.

Measure release request to verified-live separately from final closeout and active
work. Estimate gains only until several comparable releases provide actual timings.

Backup round-trip tests must upload the actual downloaded file by path, not
re-serialize a potentially large backup into Playwright's size-limited in-memory
payload. Preserve the original bytes and all restore/undo/redo assertions.

R2 persistence tests use real HTTP against the isolated Miniflare server, keeping
the original fetch responses alive. Deferred `dispatchFetch()` response bodies can
be canceled when Undici collects the original response hidden behind its wrapper.
The concurrent-save/restart regression forces GC before reading all eight responses,
checks one winning write and seven conflicts, and verifies persisted history after
restart. Its isolated child must report a real passing test, not an empty selection.
Cross-frame clicks also wait for finite animations on the iframe's ancestors:
Playwright's inner-button stability does not establish stable page coordinates.
The shared helper covers both initially loaded and recovered case-study frames;
a paused-parent regression proves it waits for animation completion, not a delay.

Web presenter capture reads verified native VideoFrames directly where supported,
instead of waiting for a hidden video's playback pipeline. The reader retains only
the newest frame and closes superseded, canceled and late frames. Compatibility
video startup remains available when the frame API is absent, with a cancelable
waiting state rather than a stuck disabled control or premature live claim.
Tests deliberately stall video playback/readiness while verifying real captured
pixels, plus reader ownership/cancellation and normal presenter input/cleanup.
The owner-approved startup guard makes one unchanged-constraint refresh at1s only
if no real frame arrived. A5s deadline disconnects and releases a frameless source,
including when native refresh is still pending. Ready sources incur no delay.
The missing-first-refresh fault also reproduces without presenter code; this is
explicit bounded application recovery, not a CI retry or a claim to fix Chromium.

Standalone slide-editor tests consume the entry module's existing `editor.ready`
promise through `tools/browser-editor-ready.mjs`, not an API/disabled-button proxy.
All 49 matching waits across five suites share it. Startup rejections and page
errors fail immediately with the original cause and a document/API/busy/status
snapshot. A genuinely stalled boot retains its 30s deadline; diagnostics have their
own 1s bound so an unresponsive renderer cannot stall error reporting. A controlled
unsupported-deck regression verifies rejection in under 5s without changing data or
assertions in normal workflows.

The shared Studio working bar reserves fixed **Back / Undo / Redo** positions at
the far left across Content Studio, case studies, native slides and Resume.
Unavailable actions leave their slots empty; read-only Resume review has Back
only, not fake history controls. Applicable but exhausted histories retain disabled
Undo/Redo. Native deck history mounts into its own slot before the project tabs,
so keyboard and visual order agree without routing clicks to site-draft history.
Back keeps each workspace's existing destination and save-before-leaving guard.

Single-row working bars are 48px high with 34px controls, 6px vertical padding,
`.9rem` desktop / 10px narrow-screen insets, `.6rem` group gaps and `.3rem` between
Undo and Redo. Text CTAs share the mono font, `.6rem` size, 1.2 line height and
`.09em` tracking; titles/project tabs use 12px sans labels. Narrow screens may
wrap secondary actions, but the navigation slots stay on the first row and
controls do not shrink. Page canvases and document colours are unchanged.

The preview
mode toggle, screen-size (or slide-view) dropdown, and new-tab (or Rehearse) action
form a right-aligned group. Preview mode behavior is unchanged: split, editor-only,
and preview-only.

A full-width 32px footer sits below the editing and preview panes across Studio
tabs and case-study editors. Live status text takes all remaining space, with draft
storage and activity recording on the right in 24px-high items. Draft storage is
plain text with a status dot, not a pill; amber/red warnings keep the same unframed
treatment, full-message tooltip, and keyboard focus indicator. Truncated status
messages retain their full text in a tooltip. Status and recording remain available
when preview is hidden or unavailable; preview-specific size controls still hide.

The existing publish-progress indicator and success/error feedback belong to this
footer. Publishing, draft storage, new-tab flushing, and recording handlers remain
shared with the existing Studio implementation.

Focused regression check: `node --test studio-status.test.mjs`.
Build: `npm run build`. Both Studio entry points version the shared admin CSS;
the Studio JavaScript continues to use its dynamic cache version.

## Admin Sessions

Remember this device is off by default. Access credentials stay in page memory;
reload or full navigation requires sign-in unless remembering was explicitly
enabled. Same-origin embedded editors and opener-connected presentation windows
can use the active page session. Credentials are not copied into localStorage or
sessionStorage. Old `rk:admin:sess` and `rk:trust` values are removed on load.

Opt-in remembering uses a host-only Secure, HttpOnly, SameSite=Strict cookie on
`https://riteshk.work/admin/*`. Its seven-day maximum does not slide. Access tokens
last five minutes and renew while the session remains active; temporary sessions
have a twelve-hour maximum. Thirty minutes without input locks access and requires
reauthentication. Remembering is not permission to bypass fresh verification for
publication or security changes. Passkey ceremonies require user verification.

Sign out replaces the library X. It flushes native edits and saves the local draft
before revocation, with retry, backup and explicit unsaved-exit options on failure.
Return to site is a separate action, not a server logout. Cross-tab notifications
contain no credentials. Offline sign-out clears page access and blocks automatic
restoration; a persisted revocation-only capability allows retry but cannot sign
in. Server revocation is not claimed until acknowledged. Previously saved drafts,
source files and history remain on this browser and are not encrypted by logout.

Settings > Security > Browser sessions requires fresh verification and supports
individual revocation and Sign out all sessions. Labels describe browser/platform,
not cryptographically bound hardware. The strongly consistent AdminSessions
Durable Object stores hashed credentials, enforces idle/hard expiry, rotates
remember credentials on restoration after five minutes and revokes replay beyond
a ten-second concurrent-request grace period. At fifty sessions, a freshly
authenticated login retires the least recently active one rather than locking the
owner out. Session storage failure fails closed.

Deploy the `admin-sessions-v1` SQLite Durable Object migration and the same-origin
Worker route before the frontend. Enabling the binding rejects legacy signed
sessions and requires existing clients to sign in again. Do not reset passkeys,
rotate unrelated secrets or publish owner content for this migration. Restoring
legacy-token acceptance is not a safe automatic rollback.

Focused checks:
`node --test --test-concurrency=1 auth-lifecycle.test.mjs admin-session.browser.test.mjs`
and `node --test --test-name-pattern="Admin session" worker-stability.test.mjs`.
Browser coverage uses synthetic credentials with Chromium's virtual authenticator;
real provider and physical-device acceptance remain separate.

## AI Counter

The footer uses the shared living ribbon at 18px with an unfilled 1.5 stroke.
Rest has four equal folds, an enlarged center diamond, and a fixed orientation.
Thinking moves between three, four, five, and six folds, varying petal size,
depth, and timing. Streaming adds damped rotation without restarting the morph.
Completion or cancellation settles back to the same rest shape and position.
Reduced motion keeps the rest shape static. The SVG includes that resting path
as its fallback; animation uses the shared `ai-ribbon.mjs` controller.

Gold and neutral stroke colors blend over 400ms in both directions, without
changing opacity. Reduced motion disables this transition as well as the morph
and rotation.

AI actions throughout Content Studio and Slide Studio use the same static rest
mark. Decorative sparkle icons in authored content and icon libraries are unchanged.
Token accounting, activity, provider routing and cancellation use the existing
session controller. The focused browser test checks actual path geometry,
variable folds, static actions, continuous state transitions, stroke bounds,
desktop/phone layout and the full drawer workflow:

```powershell
node --test ai-ribbon.test.mjs
node --test --test-name-pattern="AI session drawer" slide-studio-deck.test.mjs
```

## Connected Prepare

The owner approved releasing this checkpoint after the shared preview browser
could not be automated. It does not publish portfolio content or change provider
settings, Worker services, native presentation apps, or the existing slide editor.
Live Studio still requires the normal owner sign-in.

For local feature testing, open `http://localhost:5512/studio/?devstub=1` and select
Prepare. The existing development harness opens Studio directly on `localhost`
or `127.0.0.1` only, retains the explicit flag after refresh, and supports phone
viewports. Normal sign-in remains in place without development mode and on all
non-loopback hosts, even with the flag. This does not create a cloud session,
unlock protected content, or configure an AI provider.

The Prepare tab has a device-local application brief for company, role, target
level, job description, resume choice and permitted project evidence. The brief
starts collapsed, keeping the existing tool launchers upfront. Each tool
loads it only through **Use brief**. Opening a tool does not replace its inputs.
Selected projects and private-project permission are separate controls; an empty
selection never means all projects. Tool choices can narrow the permitted set,
not widen it. Encrypted, disabled and protected sections stay excluded. A resume
is a separate evidence source: selecting one permits its contents independently
of the project selection. ATS still supports choosing a separate file.

Interview Prep keeps **Questions** and suggested answers as the default. The
optional **Practice Q&A** view adds written responses, a pauseable elapsed timer,
explicit browser dictation, evidence-grounded feedback, follow-ups and saved
attempts. Dictation availability depends on the browser and may use its speech
service. Feedback runs only on request through the existing configured AI path;
it is coaching, not a hiring prediction. Returning to Questions preserves the
original suggested answers.

New interview, story, cover-letter and ATS results retain versioned source and
role snapshots. Regeneration uses those snapshots rather than today's portfolio
or resume. Older interview/story results can **Reconnect sources** through their
existing setup, creating a copy without regenerating or overwriting the original.
New ATS reviews retain the original file bytes in private IndexedDB before AI
runs, with SHA-256 references in history and the existing authenticated private
sync. Restoring a review checks the bytes before rendering its PDF canvas.
Legacy reviews offer **Attach original PDF** and **Check site resume PDF**;
recovery requires the saved hash or, for older text-only entries, an exact
normalized text match. Text-only matches cannot verify the earlier layout and
are labelled accordingly. Saved text, review results and separately linked
rebuilt workspaces are preserved; recovery does not run AI. Whiteboard history
retains its role, coaching feedback, scorecards and separate new-prompt sessions.

ATS source files, review results and rebuilt canvas content/design settings save
to the owner-only Cloudflare R2 history, independently of the site draft. The
canvas autosaves text and design changes; its **Saved** indicator appears only
after the server confirms the current version. Failed local history/draft writes
do not block ATS cloud saves. Opening ATS also uploads older local-only history
after checking the remote list, without replacing newer cloud entries. A fresh
signed-in browser can restore the source and editable workspace from Cloudflare.
Pending, failed or signed-out saves are not crash-safe: keep the tab open until
cloud confirmation. Originals absent from legacy history still need reattachment.

The Resume workspace keeps **Review** on the left, inline document editing
in the centre and **Document / Design** on the right. Post-check ATS results use
the same 340px review rail, header, typography and finding treatment, with the
original PDF in the centre and no empty editing panel. The ATS setup dialog,
source choices, scoring and explicit re-check consent are unchanged.

Selecting a finding highlights its relevant passage on the page and opens its
prepared proposal, factual question or guidance. Opening a finding makes no AI
request. Smaller screens switch between the review rail and document without
losing the finding. Review and Document retain independent scrolling.
A selected ATS finding is carried into Edit /
Continue editing only when the review identity and original finding still match.
Edits retain the historical score until a new explicit assessment.

Both ATS surfaces share the compact score summary: a66px gold ring with the
recorded number centred, and the band, target context and full explanation beside
it. The ring is labelled as a score out of100, not a success probability; missing
scores are shown as unavailable rather than zero. No animated count-up or new
scoring calculation is introduced. The editor puts this block first; the
**Review information** popover contains the target and collapsed source options.
Recorded essentials remain available without empty diagnostic blocks. Re-check remains
explicit and available; historical-review warnings remain visible.
The post-check score summary supplies the single divider above cloud-save
status; the adjacent status block does not add another border or top padding.

New consented reviews prepare validated suggestions together; Apply stays explicit
and preserves original sources. The bottommost **Archived suggestions** module
retains author decisions and supports current-item restoration, while older-review
items remain historical. Normal views do not show sample authoring controls.
**Version history** shows PDF downloads and named restore points, not routine
autosaves; internal recovery versions remain intact. Preview/download of an older
checkpoint never replaces the draft, and explicit Restore can be undone.
See the [Resume workspace contracts](resume-preview/README.md) for the combined
toolbar, PDF floaty, parser pane, inline editor and preservation behavior.

The [unified assessment specification](resume-assessment.md) defines the next
local assessment contract and evaluation gates. It does not change current
scores, launch/setup, historical results or assessment execution. Candidate
contract/evaluator and an opt-in loopback-only Studio pilot connector now exist,
with inventory/evidence approval, assessment/challenge, actual provider receipts,
browser-origin phase budgets and full-envelope local history. The55offline tests
include the real Studio request helpers with fake HTTP responses, not paid AI.
An additional8tests (2units/6actual-browser cases) now cover the gated local
candidate dialog, uploaded/original/checked-export iframe binding and scripted development
examples. Use `candidate=1` on a loopback editor URL, then **Review > Preview
candidate assessment**. Ordinary/production sessions remain unchanged. The dialog
assesses only the chosen actual file, never a substituted canvas, and does not
replace the current score. Checked-export preparation saves pending edits and
preserves PDF verification; uploaded originals are not automatically attached.
The document-independent flow is also available from ATS New setup and the
original review when the parent loopback Studio URL has `candidate=1`. It reuses
the same iframe/dialog without creating or migrating an editor; one additional
actual-Studio test covers both launchers, selected site files, stale/missing inputs
and unchanged legacy history. The local `serve.py` helper now sets JavaScript MIME
for `.mjs` workers; existing processes require an approved restart. No shared
server was restarted here. Server-authoritative cross-device budgets/private storage
and real quality validation still precede any approved scoring cutover.

Checked candidate PDFs now compare authored experience associations and entry
order against actual native/row-order PDF probes, showing exact field spans and
unresolved ambiguity before AI consent and in the report. This is not independent
original-file or column-aware ATS parsing; uploaded originals get no authored
verdict. Eleven new structure tests include real two-font/multipage PDFs.
Shared verification tolerates dropped invisible soft-hyphen/zero-width controls,
not missing visible words/digits/punctuation. Checked evidence omits recognized
page counters while retaining raw geometry. The owner's original Summary/Phone
failure is not diagnosed by fictional reproductions. Admin and Prepare remain
desktop-only; Phone refers to the resume field. JS1.20/CSS1.10/adminCSS1.215.
Candidate UI and structure suites run in the mandatory `resume-workspace`
browser shard, not the browser-free root job. New original and checked PDFs also
receive reference-free order probes: native, row and an unselected two-region
hypothesis where a repeated gutter permits one. Dates/tables and unsupported
writing geometry remain ambiguous/unknown, not an ATS failure or employer
verdict. Candidate extraction separates distant same-row runs; legacy defaults
remain unchanged. Both judgment passes receive fixed uncertainty metadata without
excluded positional text.73candidate/structure and8UI cases pass, including a real
two-column original. Current ResumeJS1.20/CSS1.10/adminCSS1.215.
Exact excerpt-to-PDF locations are now reconstructed from text items and line
boundaries, including repeated wording and late-drawn bullets. Shared evidence/
citation details expose those locations without sending positional arrays to
models. JD review/report also shows every segment, proposed disposition and
linked criteria; unscored segments remain inspectable, invalid coverage cannot
be approved.75candidate/structure and9UI cases pass, plus a final focused PDF
UI check. Source provenance does not prove semantic attribution or JD accuracy.
The integrated source-attribution-v1 contract now requires quoted experience
groups and complete excerpt/JD semantic challenges within the existing calls.
Disputed/incomplete attribution and unmapped experience text withhold affected
judgments; unresolved JD segments withhold role conclusions. The report retains
proposals, exact sources and both passes, including after history restoration.
82candidate/semantic/PDF cases and10UI cases pass. Four scripted examples are
development checks, not independent model-quality evidence. Local Steps3-5
mechanisms are implemented; real-provider/held-out acceptance remains gated.
The shared candidate presentation now revalidates the full envelope before
showing one summary and prioritized evidence-linked actions. Shared source/JD
causes are deduplicated, unused supported alternatives do not become gaps, and
ambiguous originals never borrow editor field IDs. Native/row-confirmed PDF
locations are not approved Apply targets. Steps6-7 are implemented locally;
the owner target now extends throughStep10; Steps8-10 are recorded below.
46focused contracts,10candidate UI cases,37existing Node cases (including72ATS
assertions) and3protected browser cases pass. ResumeJS1.21; no score cutover.
Step8 is now implemented locally: selected checked-PDF fields can receive a
claim-mapped revision, a question or a no-change decision, with a separate
challenge and whole-phase budget reservation. Explicit author review precedes
named-checkpoint/CAS Apply; uncertainty blocks it. Full receipts and provenance
are retained; undo/redo works and no paid recheck is automatic.56focused contracts,
11UI cases plus a final focused revision case,37existing Node cases and4protected
browser cases pass. ResumeJS1.22. Step9 is recorded below; central spending and independent quality remain pending.
Step9 now supports explicit edited-PDF rechecks with the frozen original
inventory, fresh evidence/consent and only two new assessment/challenge calls.
Validated comparisons retain each version's evidence and distinguish improved,
worsened, unchanged, unresolved and non-comparable observations without a score.
The original browser budget and full baseline must still exist; target/model/
inventory changes cannot silently create easier comparisons. Result/comparison
history is written atomically; cross-reload input restoration remains pending.
64contracts/11candidate UI/37existing Node/4protected browser cases pass.
ResumeJS1.23; Step10 is recorded below; independent quality acceptance remains.
Step10 now has a dedicated owner-gated central worker budget using conditional
private R2 writes. One fixed owner budget reserves complete phases and claims
each stage before a single provider attempt; concurrent devices, reloads and
lost acknowledgements cannot duplicate a stage or reset the ceiling. The server
owns model prices/caps; failures stay reserved. Studio defaults to this authority;
browser development mode must be explicitly selected and is never a fallback.
Central candidate requests alone are covered, not other AI or old local usage.
`RESUME_ASSESSMENT_POLICY` is deliberately absent from live configuration;
see the assessment specification for its schema and separate approval gate.
72candidate contracts/12UI/31worker regressions/37existing Node cases and four
protected browser journeys pass offline. ResumeJS1.24; Steps1-10local mechanisms
are implemented. Durable full private history, quality gates and release remain.

ATS suggestion cards share the review's priority badges, title/explanation
hierarchy and suggested-wording styling in both surfaces. Each suggestion has a
subtle elevated background, a full 1px border, 12px squircle corners, 12px internal
padding and 12px separation. Selection adds an accent border/inset marker without
moving the content. The editor shows the
explanation instead of repeating the title; suggested wording starts expanded,
remains collapsible and is explicitly not applied. Original-PDF pin numbers
remain in the review; the editor uses priority dots without implying a PDF
location. General recommendations are distinguished from unresolved field
anchors. All editor functionality remains: rationale/evidence and cited-field
navigation, preparing revisions, follow-up questions/resolutions, setting aside
with reasons/evidence and reopening. Detailed mapping status remains under
Rationale and evidence. Non-ATS rubric cards retain their existing presentation.

Back returns to the owning ATS flow (or the local sample
library); the duplicate header folder/close controls and privacy labels are gone.
Save confirmation is a compact **Saved** indicator beside the document name, not
a storage-provider/version footer. Saving, failed-save and conflict states retain
their recovery actions and never imply an unconfirmed save succeeded.
**Preview PDF** is the primary PDF entry; original files, source comparison and
export history remain under **Review > Files & evidence**. Original/PDF/Sources
tabs and the static "No live changes"/"AI on request" labels are removed. There is
no Canvas tab: **Back to document** returns from PDF/original viewing, while
evidence navigation restores its originating finding and scroll position.
This is a workspace presentation/navigation change: PDF generation/verification, original bytes,
version history, AI consent and storage semantics are unchanged.

Local save failures keep changes in memory with an explicit warning and retry.
Do not close the tab until retry succeeds. Authenticated cloud writes use an
outbox; retries retain newer edits, and deletion tombstones reject stale pulls.
Unsynced changes are not guaranteed to survive an abruptly terminated tab.
Closing a supported Prepare dialog cancels its active requests; Whiteboard also
stops its timer and capture resources on setup/close and rejects late permission
results. Existing answer formatting uses the shared HTML allowlist.

Release verification uses the production build and the test files below. The ATS
core test contains 72 assertions. Providers, speech, capture permissions and
cloud mutations are simulated in isolated contexts.
Desktop 1440px and phone 390px workflows include keyboard launch, focus return,
layout bounds, history, cancellation and unchanged portfolio data.

```powershell
npm run build
node --test slide-studio-deck.test.mjs studio-status.test.mjs slide-merge-design.test.mjs slide-merge-visibility.test.mjs ats-core.test.mjs
```

Not included in this checkpoint: editable letter/story variants and richer
exports, Storyteller-to-slides/notes handoff, revised ATS scoring, or redesigned
Whiteboard recording/image-sharing consent and auto-glance budgets. Existing
Whiteboard capture/recording controls remain available. Real provider quality,
real-device dictation/capture and authenticated remote recovery remain unverified.
The shared browser connection prevented a visible owner walkthrough; isolated
Playwright checks do not substitute for that acceptance. No paid AI calls or
owner content publication were performed for this checkpoint.

The subsequent local Whiteboard changes below supersede this checkpoint's
recording/source controls and automatic-observation behaviour.

### Conversational Whiteboard

The fullscreen mock session now uses a validated structured AI reply to apply
conversational thinking time, clock pause, recap and renewed exploration.
Thinking time suppresses automatic interruptions without stopping the clock;
recap does not finish or score. The practical Pause/Resume and explicit review
controls remain. Typed and completed speech input use the same turn handler.
The old Session tools and editable assumptions/questions forms are removed.
Legacy notes remain readable and available to the interviewer. Source-linked
memory tracks assumptions, questions, decisions and clarifications separately;
corrections require existing evidence. The transcript is retained, and the
derived memory is bounded to 32 entries.

Practise with selects a stakeholder within the current exercise, including
Leadership; no role is selected in a new session. Allow surprise role-play is
checked by default inside the launch dialog's collapsed Advanced options,
not in the fullscreen workspace. New/Existing switching retains the setup choice;
opening a saved session restores that session's preference. Coach conversation,
new prompts and focused retries carry the chosen preference, while clearing old
role/memory state for a new exercise. Choosing a role manually remains available
whether surprises are enabled or not.

The AI may propose a meaningful opportunity as the conversation develops; the
host accepts each validated proposal with a fresh 50% chance, not one lottery for
the whole session or a roll on every message. PM suits framing/priorities and
engineering suits maturing design/feasibility. Head/Director and VP/Exec targets
also allow automatic Leadership for strategy and organisational trade-offs; all
other roles remain manual. Each proposal cites the latest candidate turn and
includes an ordinary fallback reply, so a decline continues the current speaker
without another AI call. The latest decision is saved and reused for the same
candidate turn rather than rerolled on retry.

An active surprise role can transition to another relevant automatic role, such
as PM to engineering, with a fresh announcement and notice. A manually selected
role cannot be automatically replaced. Surprise role-play cannot begin during
thinking, recap, pause or automatic observations, or restart the same active role.
The AI is instructed to wait for meaningful developments after a decline or skip;
host evidence checks do not prove semantic relevance. Its inline notice lasts
20 seconds of unpaused, visible interaction time, excluding hover and keyboard
focus. Dismissal does not grant consent or end the role. Continue dismisses the
notice; Skip and the persistent End role-play action return to the interviewer.
End remains available while a reply is pending and in the floating companion;
it cancels pending output and narration. Natural requests are interpreted by the
configured AI, not a phrase-matching command list.

Coach retains its game plan, draft and feedback workflow. Practise in conversation
opens the shared session with coaching behaviour; the original plan, approach and
feedback remain in Coaching notes and saved history. Mock responses preserve
candidate independence. Role-labelled turns, opt-in, derived memory and coaching
source data survive session recovery; recovered clocks remain paused. Independent
five-minute retries start without the previous role or derived memory.

The local September 29 refinement uses this header order: Record for AI review
(immersive only), Start/Exit immersive session, then Pop out / picture-in-picture.
The two text actions are outlined pills. Redundant header Back, Saved sessions and
focus/maximise controls remain removed. Save & leave is the session exit;
Change setup retains access to the New/Existing session chooser.

Below the main immersive preview is one left-aligned row: screen, camera,
interviewer activity, timer. The tiles share height and width, with overlaid feed
labels, an accent outline on the focused feed, and separate stop-screen-sharing
and camera-off buttons. Source controls are keyboard accessible.

There is ONE focus for preview, live AI images and recording. A newly started
screen share takes focus; otherwise manual thumbnail selection persists. A
camera-only session focuses the camera. Stopping the focused feed falls back to
the remaining feed; stopping the last feed finalises recording. Starting the
camera does not displace a shared screen. The old Sharing & recording options,
independent source selectors, manual-look and auto-observe controls are removed.
Live images accompany conversational turns; ask the interviewer to look in the
conversation. There are no background auto-observation calls. Historical
auto-observation counts remain readable in saved sessions. A quiet status reports
source, last sent time and analysis status; this is not continuous AI watching.

Recording is immersive-only, explicit and off on entry. After an explanation and
microphone permission, a 1920x1080 canvas paced at 15fps records the focused feed (contained,
not cropped) plus microphone audio, including speech never submitted to chat.
Changing focus changes the canvas without restarting audio or the recorder.
Where supported, incoming native video frames drive capture rather than background-
throttled page timers. Source changes replace only the cloned video reader; the
original shared feed and microphone remain active. Browsers without the frame
processor retain foreground recording, but stop explicitly as incomplete if Studio
becomes hidden rather than silently recording approximately one frame per second.
1080p recording preserves 1080p board text resolution; higher-resolution shares
are still scaled down. Live-turn JPEG snapshots remain capped at 1280px width.
Zoom small board text before discussing it; neither path guarantees AI legibility.
Browser speech-to-text remains separate; its Talk button does not mute recording.
Stop recording ends audio capture but leaves sharing active. Exit finalises the
recording before hiding controls. Microphone loss/recorder errors stop capture and
mark any recoverable clip incomplete, not ready for a complete AI review.
Multiple explicitly started recordings remain downloadable in this tab.
They are NOT persisted in history or cloud storage; leaving/reloading loses media.

**Complete recording review** is distinct from the live snapshot path. It currently
requires a directly connected Google Gemini service at its official v1beta
endpoint and a discovered model with verified audio AND video input capability.
The existing model catalogue/ranker, configured budget, manual-model choice and
usage accounting are reused. No model ID is hardcoded. Cloudflare/custom proxies
and image-only providers are not supported for this upload path; configuration
is never silently changed. No Worker deployment is part of this local change.

Wrap-up finalises all recording segments, then requests explicit consent to send
their complete audio/video bytes and conversation to the named Gemini model.
The resumable Files API uploads each Blob, waits for ACTIVE processing state,
counts the complete request's tokens, checks model/context/budget eligibility,
and asks for cost confirmation before one generation attempt. Cancel or failure
never substitutes a transcript-only scorecard. The upload/processing/review
attempt has a 15-minute deadline and a conservative 2 GB per-file limit.
Provider analysis may internally sample video; full-file submission is not a
promise of exhaustive frame-by-frame understanding.

Provider file deletion is requested after success, failure or cancellation with
an independent cleanup timeout. Failures identify the file and warn that deletion
could not be confirmed; Gemini normally expires uploads after 48 hours. Provider
data-use terms still apply. Raw media and provider file URLs are not saved in
Prepare history. Review evidence contains validated recording IDs and in-range
timestamps; readable/audible evidence may support scores, uncertain evidence may
not. Play this moment opens the retained local clip; reopened history explicitly
states that the media was not saved. Real provider evidence quality, actual
browser upload/CORS behaviour and physical-device capture need separately
authorised validation; mocked API success does not establish these.

Without recordings, the existing conversation/final-image review remains.
Final-image scores now require an explicit readable result; absent or uncertain
readability cannot justify a visual score.

The microphone button directly requests browser permission when needed, without
an additional Enable microphone / Not now step. Browser transcription may send
audio to the browser's speech service; the main and companion mic tooltips and
accessible descriptions retain that disclosure. During briefing or pause, the
button checks permission without starting recognition or the clock. During an
active conversation it starts listening, including from the floating companion
without dismissing it. Recording and whole-file AI-upload consent remain separate.

Routine local/cloud autosaves do not flash a warning: pending cloud sync is shown
only after five continuous seconds, without a Retry button while a healthy request
is in flight. Local write failures and cloud errors remain immediate and retryable;
the durable outbox and ATS cloud-confirmation rules are unchanged.

AI activity remains accessible from the footer above the active Whiteboard, while
the underlying editor stays inert. Close/Escape restore focus; AI settings can open
and close without losing the session or draft. Modal confirmations remain above
these Studio panels.

Each live text or focused-image turn uses one routed generation request, not the
general planning/draft/review coordinator. It retains model catalogue/manual
selection, context checks, Prepare's model-output/selection-cost policy, full
conversation context, usage, streamed activity and cancellation. The existing
eight-minute outer deadline is retained, not a responsiveness target; no new
answer-token or reasoning cap is imposed. There is no automatic evaluation,
provider retry or text-only fallback after failed vision. Errors preserve the
candidate response and offer an explicit Retry reply. Structured conversation and
image-readability validation run before applying session changes. Detailed
wrap-up and full-recording review keep their existing separate paths. One-request
synthetic checks prove removal of coordinator overhead, not real-provider latency.

The header/recording experience and subsequent interaction fixes above are ready
for desktop acceptance; synthetic validation does not establish owner acceptance.
Launch setup and the original Coach workflow remain unchanged.
Malformed conversational replies
produce an explicit retryable error without applying partial state changes.
This release has simulated provider coverage only: this proves lifecycle and
state handling, not natural-language interpretation or real coaching quality.
Real-provider, physical speech/capture and owner visual acceptance remain separate.

```powershell
npm run build
node --test whiteboard-media.test.mjs whiteboard-conversation.test.mjs ui-corners.test.mjs
# Requires the existing local preview server (default port 5510):
node --test --test-name-pattern="Prepare Whiteboard|Prepare shared brief connects" slide-studio-deck.test.mjs
```

The opt-in Windows media-engine test uses isolated Edge, synthetic native video
tracks and generated audio only: no devices, credentials or provider requests.
It disables Playwright's default visibility overrides through `noDefaults`,
checks real hidden-page state, then decodes the saved recording with installed
FFmpeg/FFprobe. Assertions cover 1080p, background cadence, current visual markers,
focus transitions, continuous audio, audio/video marker alignment and bounded
private-memory growth. Short probes are not endurance evidence.

```powershell
$env:WB_MEDIA_VALIDATION = "1"
$env:WB_MEDIA_HEADFUL = "1"
$env:WB_MEDIA_SECONDS = "1800" # Real elapsed time, never a fast-forwarded clock
node --test whiteboard-media-engine.test.mjs
```

The test prints its evidence directory (override with `WB_MEDIA_EVIDENCE`) and
retains the synthetic clip, decoded frame and measurements. It is skipped unless
explicitly enabled. This does not establish real-device reliability, 4K readability,
provider understanding, crash recovery or durable media storage.