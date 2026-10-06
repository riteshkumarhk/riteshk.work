import test from 'node:test';
import assert from 'node:assert/strict';
import { createResume, createResumeHistory, editResumeField, resumeSignature } from './src/js/resume-workspace.mjs';
import { resumeBody, renderResumeHtml } from './src/js/resume-render.mjs';
import { resumeContactItems, resumeSectionColumn, reorderResumeItems, validateResumeOrder } from './src/js/resume-document.mjs';
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
  assert.match(resumeBody(document, true), /data-resume-icon="cal"/);
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
  assert.match(resumeBody(document, true), /data-resume-icon="cal"/);
});
