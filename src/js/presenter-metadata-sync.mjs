const keys = ['notes', 'title', 'durationMinutes'];
const fieldId = field => JSON.stringify([field.slideId, field.key]);
const valueOf = (slide, key) => key === 'durationMinutes' ? Number(slide[key]) || 0 : String(slide[key] || '');

export function createPresenterMetadataSync({ request, read, apply, storage, current = () => true }) {
  const saved = storage.load();
  if (saved && (saved.version !== 1 || !Array.isArray(saved.known) || !Array.isArray(saved.pending))) throw new Error('The private sync queue could not be read. Local deck edits are retained.');
  const known = new Map((saved?.known || []).map(field => [fieldId(field), field]));
  const pending = new Map((saved?.pending || []).map(field => [fieldId(field), field]));
  let conflicts = [], error = '', queue = Promise.resolve();
  const guard = () => { if (!current()) throw new Error('The presenter owner session changed. Local edits are retained.'); };
  const persist = () => {
    guard();
    storage.save({ version: 1, known: [...known.values()], pending: [...pending.values()] });
  };
  const state = () => ({ conflicts: structuredClone(conflicts), saveStatus: error || (conflicts.length ? 'Private sync conflict. Review both versions.' : pending.size ? 'Saved on this device. Private sync pending.' : 'Notes and names synced privately.') });
  function serial(task) {
    queue = queue.catch(() => {}).then(async () => {
      try { guard(); error = ''; await task(); }
      catch (failure) { error = failure.message || 'Saved on this device. Private sync failed.'; }
      return state();
    });
    return queue;
  }
  async function reconcile(applyRemote = true) {
    let remote = await request('GET'); guard();
    if (remote?.version !== 1 || !Array.isArray(remote.fields)) throw new Error('Private sync returned an invalid record. Local edits are retained.');
    conflicts = [];
    for (const [id, item] of pending) {
      const slide = read().find(slide => slide.id === item.slideId);
      if (!slide || !keys.includes(item.key)) continue;
      const field = remote.fields.find(field => fieldId(field) === id);
      const local = valueOf(slide, item.key);
      if (local !== item.value) { conflicts.push({ ...item, local, remote: field?.value ?? item.initial, revision: field?.revision || 0 }); continue; }
      if (field?.value === item.value) {
        pending.delete(id); known.set(id, field); persist(); continue;
      }
      if ((field?.revision || 0) !== item.expected) {
        conflicts.push({ ...item, local, remote: field?.value ?? item.initial, revision: field?.revision || 0 }); continue;
      }
      remote = await request('POST', item); guard();
      const acknowledged = remote.fields?.find(field => fieldId(field) === id);
      if (acknowledged?.value !== item.value) throw new Error('Private sync did not confirm this edit. The pending copy is retained.');
      pending.delete(id); known.set(id, acknowledged); persist();
    }
    for (const field of remote.fields) {
      if (!keys.includes(field.key)) continue;
      const id = fieldId(field), slide = read().find(slide => slide.id === field.slideId);
      if (!slide || pending.has(id) || conflicts.some(conflict => fieldId(conflict) === id)) continue;
      const local = valueOf(slide, field.key), previous = known.get(id);
      if (local !== field.value && local !== (previous ? previous.value : field.initial)) {
        conflicts.push({ ...field, local, remote: field.value, revision: field.revision }); continue;
      }
      if (local !== field.value && !(typeof applyRemote === 'function' ? applyRemote() : applyRemote)) continue;
      if (local !== field.value) { guard(); await apply(field.slideId, field.key, field.value); guard(); }
      known.set(id, field);
    }
    persist();
  }
  return {
    state,
    refresh: ({ applyRemote = true } = {}) => serial(() => reconcile(applyRemote)),
    edit(slideId, key, value, initial, { defer = false } = {}) {
      return serial(async () => {
        if (!keys.includes(key)) throw new Error('This presenter field cannot be synced.');
        const id = fieldId({ slideId, key }), previous = known.get(id), outgoing = pending.get(id);
        pending.set(id, { slideId, key, value, initial: outgoing ? outgoing.initial : previous ? previous.initial : initial, expected: outgoing ? outgoing.expected : previous?.revision || 0 });
        persist();
        if (!defer) await reconcile(false);
      });
    },
    resolve(slideId, key, choice, expectedLocal, expectedRemote) {
      return serial(async () => {
        const id = fieldId({ slideId, key }), conflict = conflicts.find(field => fieldId(field) === id);
        const slide = read().find(slide => slide.id === slideId);
        if (!conflict || !slide || valueOf(slide, key) !== expectedLocal || conflict.remote !== expectedRemote) throw new Error('The compared field changed. Refresh before choosing a version.');
        const record = await request('GET'); guard();
        const remote = record.fields.find(field => fieldId(field) === id);
        if ((remote?.revision || 0) !== conflict.revision || (remote?.value ?? conflict.initial) !== expectedRemote) throw new Error('The cloud field changed again. Refresh and compare before choosing a version.');
        if (choice === 'remote') {
          await apply(slideId, key, expectedRemote); guard(); pending.delete(id);
          if (remote) known.set(id, remote);
        } else if (choice === 'local') {
          pending.set(id, { slideId, key, value: expectedLocal, initial: remote ? remote.initial : conflict.initial, expected: remote?.revision || 0 });
        } else throw new Error('Choose a local or cloud version.');
        persist(); await reconcile();
      });
    }
  };
}