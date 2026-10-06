import test from 'node:test';
import assert from 'node:assert/strict';
import { createResume, createResumeHistory, editResumeField, resumeSignature } from './src/js/resume-workspace.mjs';
import { resumeBody, renderResumeHtml } from './src/js/resume-render.mjs';
import { resumeContactItems, resumeSectionColumn, reorderResumeItems, validateResumeOrder, resumeEntryDate, organizeResumeDates } from './src/js/resume-document.mjs';
import { RESUME_ICON_PATHS, resumeIcon } from './src/js/resume-icons.mjs';

const fixture = () => createResume({
  id: 'document-order',
  model: { name: 'Fictional Designer', title: 'Designer', summary: '', contact: { email: 'fictional@example.test', phone: '+1 555 0100', location: '', links: [{ id: 'portfolio', label: 'Portfolio', url: 'https://example.test' }] },
    sections: [{ id: 'experience', kind: 'experience', heading: 'Experience', items: [] }, { id: 'skills', kind: 'skills', heading: 'Capabilities', groups: [{ id: 'tools', label: 'Tools', items: ['Figma'] }] }] },
});

test('Document order preserves legacy defaults, stable IDs and omitted contacts', () => {
  const document = fixture(), before = structuredClone(document);
  assert.deepEqual(resumeContactItems(document.model).map(item => item.id), ['contact.email', 'contact.phone', 'portfolio']);
  assert.equal(resumeSectionColumn(document.model.sections[0]), 'main');
  assert.equal(resumeSectionColumn(document.model.sections[1]), 'side');
  assert.deepEqual(document, before);
  document.model.contact.order = ['portfolio', 'contact.phone'];
  assert.deepEqual(resumeContactItems(document.model).map(item => item.id), ['portfolio', 'contact.phone', 'contact.email']);
  document.model.contact.phone = '';
  assert.deepEqual(resumeContactItems(document.model).map(item => item.id), ['portfolio', 'contact.email']);
});

test('Reordering and column placement affect actual renderer and signature without changing text', () => {
  const document = fixture(), original = resumeSignature(document);
  document.model.sections = reorderResumeItems(document.model.sections, 'skills', 'experience');
  document.model.contact.order = ['portfolio', 'contact.phone', 'contact.email'];
  const html = resumeBody(document);
  assert.ok(html.indexOf('data-section="skills"') < html.indexOf('data-section="experience"'));
  assert.ok(html.indexOf('data-field="contact.phone"') < html.indexOf('data-field="contact.email"'));
  assert.match(html, /href="https:\/\/example.test\/"/);
  assert.notEqual(resumeSignature(document), original);
  document.design.layout = 'sidebar';
  document.model.sections[0].column = 'main';
  const columns = resumeBody(document);
  assert.ok(columns.indexOf('data-section="skills"') < columns.indexOf('<aside>'));
  assert.equal(document.model.sections[0].groups[0].items[0], 'Figma');
});

test('Order validation rejects duplicated, missing and cross-group identities', () => {
  const document = fixture();
  assert.throws(() => reorderResumeItems(document.model.sections, 'contact.email', 'skills'), /no longer exists/);
  document.model.contact.order = ['portfolio', 'portfolio'];
  assert.throws(() => validateResumeOrder(document.model), /contact order/);
  document.model.contact.order = ['skills'];
  assert.throws(() => validateResumeOrder(document.model), /contact order/);
  document.model.contact.order = ['contact.email'];
  document.model.sections[0].column = 'unknown';
  assert.throws(() => validateResumeOrder(document.model), /section column/);
});

test('Cancelled inline history groups do not consume Undo or revive cancelled typing', () => {
  const document = fixture(), history = createResumeHistory(document);
  const first = editResumeField(document, 'summary', 'First committed edit');
  history.record(first);
  const second = editResumeField(first, 'summary', 'Cancelled typing');
  history.record(second); history.discard(); history.refresh(first);
  assert.equal(history.undo().model.summary, '');
  assert.equal(history.redo().model.summary, 'First committed edit');
  assert.equal(history.canRedo, false);
});

test('Empty-field affordances and inline code are editor-only; special values are script-safe', () => {
  const document = fixture();
  document.model.name = '</script><script>alert(1)</script>';
  const exported = renderResumeHtml(document), editable = renderResumeHtml(document, { interactive: true });
  assert.doesNotMatch(exported, /resume-empty-field|data-inline-field/);
  assert.doesNotMatch(resumeBody(document), /resume-summary/);
  assert.match(resumeBody(document, true), /data-field="summary"/);
  assert.match(editable, /\\u003c\/script>/);
  assert.doesNotMatch(editable, /<script>alert\(1\)/);
});

test('Resume detail icons accompany real text in editor and print without becoming editable content', () => {
  const document = fixture();
  document.model.contact.location = 'London';
  document.model.contact.links.push({ id: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/in/example' });
  document.model.sections[0].items.push({ id: 'role', role: 'Designer', org: 'Example', dates: '2021 - Present', location: 'Remote', bullets: [] });
  const before = structuredClone(document);
  for (const interactive of [false, true]) {
    const html = resumeBody(document, interactive);
    for (const kind of Object.keys(RESUME_ICON_PATHS)) assert.ok(html.includes(resumeIcon(kind)), kind);
    assert.match(html, /data-detail-field="role.dates"[^]*?data-field="role.dates">2021 - Present/);
    assert.doesNotMatch(html, /data-field="[^"]*"[^>]*><svg/);
    assert.match(html, /href="mailto:fictional@example.test"/);
    assert.match(html, /href="https:\/\/www.linkedin.com\/in\/example"/);
  }
  assert.deepEqual(document, before);
  document.model.sections[0].items[0].dates = '';
  assert.doesNotMatch(resumeBody(document), /data-resume-icon="cal"/);
  assert.doesNotMatch(resumeBody(document, true), /data-resume-icon="cal"/);
  assert.throws(() => resumeIcon('unknown'), /Unknown resume detail icon/);
});

test('Education dates share the calendar icon without printing icons for empty dates', () => {
  const document = fixture();
  document.model.sections = [{ id: 'education', kind: 'education', heading: 'Education', items: [{ id: 'school', school: 'Example University', credential: 'Design degree', dates: '2018', note: '' }] }];
  for (const interactive of [false, true]) {
    const html = resumeBody(document, interactive);
    assert.match(html, /data-detail-field="school.dates"><svg[^>]*data-resume-icon="cal"/);
    assert.match(html, /data-field="school.dates">2018<\/span>/);
  }
  document.model.sections[0].items[0].dates = '';
  assert.doesNotMatch(resumeBody(document), /data-resume-icon="cal"/);
  assert.doesNotMatch(resumeBody(document, true), /data-resume-icon="cal"/);
});

test('Source dates move only from unambiguous metadata boundaries and never overwrite authored dates', () => {
  for (const [meta, dates, remaining] of [
    ['Microsoft \u2022 Aug 2024', 'Aug 2024', 'Microsoft'],
    ['Federation \u2022 Oct\n2021', 'Oct 2021', 'Federation'],
    ['Event\nNovember 2020', 'November 2020', 'Event'],
    ['2024', '2024', ''],
    ['Example | 03/2020 - Present', '03/2020 - Present', 'Example'],
  ]) assert.deepEqual(resumeEntryDate({ meta }), { dates, meta: remaining });
  for (const meta of ['Design certification', 'https://example.test/2024', 'Presented Authenticate 2024', 'Changed since Oct 2024', 'Example \u2022 99/2024']) {
    assert.equal(resumeEntryDate({ meta }), null);
  }
  assert.equal(resumeEntryDate({ meta: 'Example \u2022 Aug 2024', dates: '2023' }), null);
  assert.equal(resumeEntryDate({ meta: 'Example \ufffd Oct\n2021' }), null, 'An unrecovered separator must not split a month from its year');
  const model = fixture().model;
  model.sections.push({ id: 'awards', kind: 'list', heading: 'Awards', items: [{ id: 'award', title: 'Example award', meta: 'Example \u2022 Aug 2024', dates: '', bullets: [] }] });
  const before = structuredClone(model), organized = organizeResumeDates(model);
  assert.deepEqual(model, before);
  assert.equal(organized.sections.at(-1).items[0].dates, 'Aug 2024');
  assert.deepEqual(organizeResumeDates(organized), organized);
  const dateBullet = structuredClone(model);
  dateBullet.sections.at(-1).items[0] = { id: 'speaker', title: 'Speaker', meta: 'Representative', dates: '', bullets: [{ id: 'event-date', text: 'Oct 2024' }, { id: 'achievement', text: 'Presented research findings' }] };
  const recoveredBullet = organizeResumeDates(dateBullet).sections.at(-1).items[0];
  assert.equal(recoveredBullet.dates, 'Oct 2024');
  assert.deepEqual(recoveredBullet.bullets, [{ id: 'achievement', text: 'Presented research findings' }]);
  const history = createResumeHistory(createResume({ model }));
  history.record(createResume({ model: organized }));
  assert.deepEqual(history.undo().model.sections.at(-1), before.sections.at(-1));
});

test('Optional empty fields take no canvas or export space and metadata wraps naturally', () => {
  const document = fixture();
  document.model.sections[1].groups[0].label = '';
  document.model.sections.push({ id: 'education', kind: 'education', heading: 'Education', items: [{ id: 'school', school: 'Example University', credential: 'Degree', dates: '', note: '' }] },
    { id: 'awards', kind: 'list', heading: 'Awards', items: [{ id: 'award', title: 'Award', dates: '', meta: 'First line\nSecond line', bullets: [] }] });
  for (const interactive of [false, true]) {
    const html = resumeBody(document, interactive);
    assert.doesNotMatch(html, /data-field="(?:tools.label|school.note|school.dates|award.dates)"/);
    assert.match(html, /First line\nSecond line/);
  }
  assert.match(renderResumeHtml(document), /\.resume-entry>p,.skill-group\{white-space:normal\}/);
  document.model.sections.at(-1).items[0].meta = '';
  assert.doesNotMatch(resumeBody(document, true), /data-field="award.meta"/);
});
