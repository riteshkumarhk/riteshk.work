# Content Studio Chrome

## Release Gate

Focused tests are development feedback, not permission to push. Before a release,
fetch and safely integrate the latest publications without discarding drafts or
unrelated changes. Reuse a local server serving this repository, then run:

```powershell
$env:SLIDE_LAB_URL='http://127.0.0.1:5510'
npm run check:release
```

This runs the same root-test selection as CI, all three builds, bundle syntax
checks, and every existing browser shard with the provider-network guard. Browser
shards run sequentially locally to avoid contention; CI retains its parallel
shards. Missing/wrong/live server URLs and failing commands stop the gate rather
than silently skipping coverage. Existing dependencies and browser installation
are reused; the command does not install packages, publish, commit or push.

Review and stage rebuilt outputs explicitly. Do not edit the candidate while the
gate runs. Fetch again before pushing: if remote changes must be integrated,
validate that final tree, including content-dependent backup/restore checks.
Never force-push over admin publications. CI still verifies committed bundle
freshness and gates deployment on all shards; a local pass does not replace
Linux CI or live-asset verification. Keep genuine manual acceptance separate.

Backup round-trip tests must upload the actual downloaded file by path, not
re-serialize a potentially large backup into Playwright's size-limited in-memory
payload. Preserve the original bytes and all restore/undo/redo assertions.

The shared Studio shell keeps Undo/Redo on the left of its working bar. The preview
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
canvas autosaves text and design changes; **Saved to Cloudflare** appears only
after the server confirms the current version. Failed local history/draft writes
do not block ATS cloud saves. Opening ATS also uploads older local-only history
after checking the remote list, without replacing newer cloud entries. A fresh
signed-in browser can restore the source and editable workspace from Cloudflare.
Pending, failed or signed-out saves are not crash-safe: keep the tab open until
cloud confirmation. Originals absent from legacy history still need reattachment.

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