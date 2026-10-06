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
