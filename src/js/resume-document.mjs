export function resumeContactItems(model) {
  const contact = model.contact;
  const items = [
    ...['email', 'phone', 'location'].filter(key => contact[key]).map(key => ({
      id: 'contact.' + key, fieldId: 'contact.' + key, kind: key, value: contact[key],
      label: { email: 'Email', phone: 'Phone', location: 'Location' }[key],
    })),
    ...contact.links.map(link => ({ id: link.id, fieldId: link.id + '.label', kind: 'link', label: link.label || 'Link', value: link.url })),
  ];
  const order = contact.order || [];
  return [...order.flatMap(id => items.filter(item => item.id === id)), ...items.filter(item => !order.includes(item.id))];
}

export function resumeSectionColumn(section) {
  return section.column || (['experience', 'text'].includes(section.kind) ? 'main' : 'side');
}

export function resumeEntryDate(item) {
  if (item.dates?.trim() || !item.meta?.trim()) return null;
  const month = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
  const date = `(?:${month}\\s+(?:19|20)\\d{2}|(?:0?[1-9]|1[0-2])[/.](?:19|20)\\d{2}|(?:19|20)\\d{2})`;
  const match = item.meta.match(new RegExp(`^(?:(.*?)\\s*(?:[\\u2022|]|\\n)\\s*)?(${date}(?:\\s*(?:[-\\u2013\\u2014]|to)\\s*(?:${date}|present|current))?)\\s*$`, 'is'));
  if (!match) return null;
  if (/^\d{4}$/.test(match[2]) && new RegExp(`\\b${month}\\s*$`, 'i').test(match[1] || '')) return null;
  return { dates: match[2].replace(/\s+/g, ' ').trim(), meta: (match[1] || '').trim() };
}

export function organizeResumeDates(model) {
  const next = structuredClone(model);
  for (const section of next.sections) {
    if (['experience', 'education', 'skills', 'text', 'links'].includes(section.kind)) continue;
    for (const item of section.items || []) {
      const recovered = resumeEntryDate(item);
      if (recovered) Object.assign(item, recovered);
      else if (!item.dates?.trim()) {
        const dates = (item.bullets || []).map(bullet => ({ bullet, recovered: resumeEntryDate({ meta: bullet.text }) })).filter(row => row.recovered && !row.recovered.meta);
        if (dates.length === 1) {
          item.dates = dates[0].recovered.dates;
          item.bullets = item.bullets.filter(bullet => bullet.id !== dates[0].bullet.id);
        }
      }
    }
  }
  return next;
}

export function reorderResumeItems(items, activeId, overId) {
  const from = items.findIndex(item => item.id === activeId), to = items.findIndex(item => item.id === overId);
  if (from < 0 || to < 0) throw new Error('This document item no longer exists. Refresh the document before moving it.');
  const next = [...items], [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function validateResumeOrder(model) {
  const ids = ['contact.email', 'contact.phone', 'contact.location', ...model.contact.links.map(link => link.id)];
  const order = model.contact.order;
  if (order != null && (!Array.isArray(order) || new Set(order).size !== order.length || order.some(id => !ids.includes(id)))) throw new Error('Invalid contact order.');
  if (model.sections.some(section => section.column != null && !['main', 'side'].includes(section.column))) throw new Error('Invalid section column.');
}
