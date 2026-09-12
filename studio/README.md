# Content Studio Chrome

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
Restored ATS reviews show saved text when the original file was not retained;
they do not pin old findings onto a different current resume. Whiteboard history
retains its role, coaching feedback, scorecards and separate new-prompt sessions.

Local save failures keep changes in memory with an explicit warning and retry.
Do not close the tab until retry succeeds. Authenticated cloud writes use an
outbox; retries retain newer edits, and deletion tombstones reject stale pulls.
This is not a backup or a guarantee against losing an abruptly terminated tab.
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