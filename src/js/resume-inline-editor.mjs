// Runs inside the paginated document; all dependencies are passed explicitly.
export function installResumeInlineEditor(fields, notify) {
  let active = null, composing = false;
  const nodes = id => [...document.querySelectorAll('.pagedjs_page [data-field]')].filter(element => element.dataset.field === id);
  const finish = (cancel = false, nextField = null, restoreFocus = true) => {
    if (!active) return;
    const edit = active;
    active = null;
    composing = false;
    edit.box.remove();
    edit.fragments.forEach(element => element.style.removeProperty('visibility'));
    const result = { type: 'resume-edit-end', fieldId: edit.field.id, value: cancel ? edit.field.value : edit.input.value, cancel, nextField };
    notify(result);
    if (restoreFocus) edit.anchor.focus({ preventScroll: true });
    return result;
  };
  const start = (element, focusEnd = false) => {
    const field = fields.find(field => field.id === element.dataset.field);
    if (!field) return;
    finish(false, null, false);
    if (field.special) { notify({ type: 'resume-field', fieldId: field.id }); return; }
    const rect = element.getBoundingClientRect(), page = element.closest('.pagedjs_page').getBoundingClientRect();
    const box = document.createElement('div'), input = document.createElement('textarea');
    box.className = 'resume-inline-edit';
    const width = Math.min(Math.max(rect.width, 180), page.right - Math.max(page.left + 24, rect.left) - 24);
    Object.assign(box.style, { position: 'absolute', zIndex: 10, left: window.scrollX + Math.max(page.left + 24, rect.left) + 'px', top: window.scrollY + rect.top + 'px', width: width + 'px' });
    input.value = field.value;
    input.setAttribute('aria-label', field.label);
    input.setAttribute('data-inline-field', field.id);
    input.spellcheck = true;
    const style = getComputedStyle(element);
    Object.assign(input.style, { fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, color: style.color, width: '100%', boxSizing: 'border-box', resize: 'none', display: 'block', padding: '2px', margin: '-2px', border: '0', outline: '2px solid #ba863c', borderRadius: '2px', background: '#fff', boxShadow: '0 3px 12px #0002' });
    const fit = () => { input.style.height = 'auto'; input.style.height = Math.min(360, Math.max(parseFloat(style.lineHeight) || 24, input.scrollHeight)) + 'px'; };
    const fragments = nodes(field.id);
    active = { field, input, box, fragments, anchor: element };
    fragments.forEach(node => node.style.visibility = 'hidden');
    box.append(input); document.body.append(box); fit();
    notify({ type: 'resume-edit-start', fieldId: field.id, value: field.value });
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; fit(); notify({ type: 'resume-edit', fieldId: field.id, value: input.value }); });
    input.addEventListener('input', () => { fit(); if (!composing) notify({ type: 'resume-edit', fieldId: field.id, value: input.value }); });
    input.addEventListener('keydown', event => {
      if (composing || event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); finish(true); }
      else if (event.key === 'Enter' && (!field.multiline || event.ctrlKey || event.metaKey)) { event.preventDefault(); finish(); }
      else if (event.key === 'Tab') {
        event.preventDefault();
        const visible = [...new Set([...document.querySelectorAll('.pagedjs_page [data-field]')].map(element => element.dataset.field))], index = visible.indexOf(field.id);
        const next = visible[index + (event.shiftKey ? -1 : 1)];
        finish(false, next || null, false);
        if (!next) notify({ type: 'resume-edit-exit', backwards: event.shiftKey });
      }
    });
    input.addEventListener('blur', () => { if (!composing) finish(false, null, false); });
    input.focus({ preventScroll: true });
    input.setSelectionRange(focusEnd ? input.value.length : 0, input.value.length);
  };
  document.querySelectorAll('.pagedjs_page [data-field]').forEach(element => {
    const field = fields.find(field => field.id === element.dataset.field);
    if (!field) return;
    element.tabIndex = 0;
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', 'Edit ' + field.label);
    if (!element.textContent.trim()) { element.dataset.placeholder = field.label; element.classList.add('resume-empty-field'); }
  });
  document.addEventListener('click', event => {
    const element = event.target.closest('[data-field]') || event.target.closest('[data-detail-field]')?.querySelector('[data-field]');
    if (element) { event.preventDefault(); start(element); }
  });
  document.addEventListener('keydown', event => {
    if (event.target.closest('textarea,input')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); notify({ type: 'resume-undo', redo: event.shiftKey }); return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      const element = event.target.closest('[data-field]');
      if (element) { event.preventDefault(); start(element); }
    }
  });
  window.resumeInline = {
    open(id) { const element = nodes(id)[0]; if (element) { element.scrollIntoView({ block: 'nearest' }); start(element); } },
    finish: () => finish(false, null, false),
  };
}
