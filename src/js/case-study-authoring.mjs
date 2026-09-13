export const CASE_LIMITS = Object.freeze({ sources: 80, characters: 120000, sourceCharacters: 16000, sections: 24, images: 16, fileBytes: 100 * 1024 * 1024, workspaceBytes: 120 * 1024 * 1024 });
export const CASE_TYPES = ['text', 'statement', 'metrics', 'steps', 'media', 'split', 'faq'];
const textKeys = new Set(['heading', 'body', 'sub', 'kicker', 'nav', 'title', 'label', 'value', 'caption', 'q', 'a', 'text', 'list', 'left', 'right', 'items', 'cells', 'leftLabel', 'rightLabel']);
const copy = value => structuredClone(value);
export const protectedSection = block => !!(block?.locked || block?.encStub || block?.vaultBlock);
export const caseRevision = work => JSON.stringify([work.id, work.title, work.client, work.study || {}]);
const plain = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

export function sectionEvidence(value) {
  if (typeof value === 'string') return plain(value);
  if (Array.isArray(value)) return value.map(sectionEvidence).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value).filter(([key]) => textKeys.has(key)).map(([, item]) => sectionEvidence(item)).filter(Boolean).join('\n');
}

export function caseSources(work, state) {
  const sources = (state.sources || []).filter(source => source.enabled !== false).map(source => ({ ...source }));
  if (state.material?.trim()) sources.unshift({ id: 'notes', label: 'Author notes', text: state.material.trim(), kind: 'notes' });
  if (state.includeExisting) (work.study?.blocks || []).forEach((block, index) => {
    if (protectedSection(block) || block.off) return;
    sources.push({ id: 'section-' + index, label: block.editorName || block.heading || block.nav || 'Section ' + (index + 1), text: sectionEvidence(block), kind: 'section', sectionIndex: index });
  });
  if (!sources.length) throw new Error('Add source notes or select source pages first. Links and style references are not evidence.');
  if (sources.length > CASE_LIMITS.sources) throw new Error('Select at most ' + CASE_LIMITS.sources + ' source pages.');
  const ids = new Set();
  let characters = 0, images = 0;
  for (const source of sources) {
    if (!source.id || ids.has(source.id) || typeof source.text !== 'string') throw new Error('Invalid or duplicate source. Remove and reimport it.');
    ids.add(source.id);
    if (source.text.length > CASE_LIMITS.sourceCharacters) throw new Error(source.label + ' is too long. Split it into smaller sources.');
    characters += source.text.length; images += source.images?.length || 0;
  }
  if (characters > CASE_LIMITS.characters) throw new Error('Selected source text exceeds 120,000 characters. Select fewer sources.');
  if (images > CASE_LIMITS.images) throw new Error('Select at most 16 pages with visuals per draft. No pages are silently omitted.');
  return sources;
}

export function caseSourcePrompt(sources) {
  return sources.map(source => ({ id: source.id, label: source.label, text: source.text, images: source.images?.length || 0, reusableSection: Number.isInteger(source.sectionIndex) ? source.sectionIndex : null }));
}

export function parseCaseResponse(raw, sources, work, normalize) {
  if (typeof raw !== 'string' || raw.length > 160000) throw new Error('The response exceeds the proposal size limit.');
  let obj;
  try { obj = JSON.parse(String(raw).trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new Error('Incomplete or invalid response. No sections were applied. Try a smaller draft.'); }
  if (!obj || !Array.isArray(obj.blocks) || !obj.blocks.length || obj.blocks.length > CASE_LIMITS.sections) throw new Error('The proposal must contain 1-24 sections.');
  const sourceMap = new Map(sources.map(source => [source.id, source]));
  const entries = obj.blocks.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.evidence) || !entry.evidence.length || entry.evidence.length > 8) throw new Error('Section ' + (index + 1) + ' needs source evidence.');
    const evidence = entry.evidence.map(citation => {
      const source = sourceMap.get(citation.sourceId), quote = plain(citation.quote);
      if (!source || quote.length < 4 || quote.length > 2000 || !plain(source.text).includes(quote)) throw new Error('Section ' + (index + 1) + ' contains an unverified source quotation.');
      return { sourceId: source.id, label: source.label, quote };
    });
    let block;
    if (entry.reuseSourceId) {
      const source = sourceMap.get(entry.reuseSourceId), original = work.study?.blocks?.[source?.sectionIndex];
      if (!source || !Number.isInteger(source.sectionIndex) || !original || protectedSection(original) || original.off) throw new Error('The referenced artifact is unavailable.');
      block = copy(original);
    } else {
      if (!entry.block || !CASE_TYPES.includes(entry.block.type)) throw new Error('Unsupported section type. Use an existing artifact reference instead.');
      const fields = { text: ['heading','body','list'], statement: ['body','sub'], metrics: ['heading','items'], steps: ['heading','items'], media: ['heading','items'], split: ['heading','leftLabel','rightLabel','left','right'], faq: ['items'] };
      const itemFields = { metrics: ['value','label'], steps: ['title','body'], media: ['caption'], faq: ['q','a'] };
      const allowed = new Set(['type', 'nav', 'kicker', ...fields[entry.block.type]]);
      if (Object.keys(entry.block).some(key => !allowed.has(key))) throw new Error('The proposal contains unsupported section fields.');
      for (const [key, value] of Object.entries(entry.block)) {
        if (['list','left','right'].includes(key)) {
          if (!Array.isArray(value) || value.length > 12 || value.some(item => typeof item !== 'string' || item.length > 2000)) throw new Error('Invalid section list.');
        } else if (key === 'items') {
          if (!Array.isArray(value) || !value.length || value.length > 12 || value.some(item => !item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(field => !itemFields[entry.block.type].includes(field)) || Object.values(item).some(text => typeof text !== 'string' || text.length > 2000))) throw new Error('Invalid section items.');
        } else if (typeof value !== 'string' || value.length > 8000) throw new Error('Invalid section text.');
      }
      const payload = JSON.stringify(entry.block);
      if (payload.length > 16000 || /"(?:src|url|locked|encStub|vaultBlock|html|script)"\s*:/.test(payload)) throw new Error('The proposal contains unsupported media or protection fields.');
      block = normalize({ blocks: [entry.block] }, {}).blocks[0];
      const written = sectionEvidence(block);
      if (!written.trim()) throw new Error('The proposal contains an empty section.');
      const cited = evidence.map(item => item.quote).join(' ');
      const numbers = written.match(/\d+(?:[.,]\d+)*(?:%|\b)/g) || [];
      const citedNumbers = new Set(cited.match(/\d+(?:[.,]\d+)*(?:%|\b)/g) || []);
      const missing = [...new Set(numbers.filter(number => !citedNumbers.has(number)))];
      if (missing.length) throw new Error('Section ' + (index + 1) + ': number ' + JSON.stringify(missing[0]) + ' is not in its evidence quotes. Cite an exact supporting source quote or remove the unsupported claim. Do not invent evidence.');
    }
    return { block, evidence, reuseSourceId: entry.reuseSourceId || null };
  });
  const strings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 8).map(item => item.slice(0, 600)) : [];
  return { revision: caseRevision(work), entries, outline: strings(obj.outline), questions: strings(obj.questions), summary: String(obj.summary || '').slice(0, 1200), createdAt: Date.now() };
}

export function applyCaseProposal(work, proposal, selections) {
  if (caseRevision(work) !== proposal.revision) throw new Error('The case study changed. Generate a fresh proposal before applying.');
  if (!selections.length) throw new Error('Select at least one section.');
  const next = { ...(work.study || {}), blocks: [...(work.study?.blocks || [])] }, used = new Set();
  for (const selection of selections) {
    const entry = proposal.entries[selection.index];
    if (!entry || used.has('entry-' + selection.index)) throw new Error('Invalid proposal selection.');
    used.add('entry-' + selection.index);
    if (selection.target === 'append') next.blocks.push(copy(entry.block));
    else {
      const index = Number(selection.target), original = next.blocks[index];
      if (!Number.isInteger(index) || !original || protectedSection(original) || !['text', 'statement'].includes(original.type) || original.type !== entry.block.type || used.has(index)) throw new Error('Only matching, unprotected text sections can be updated.');
      used.add(index);
      const updated = { ...original };
      for (const key of ['nav', 'kicker', 'heading', 'body', 'list', 'sub']) if (key in entry.block) updated[key] = copy(entry.block[key]);
      next.blocks[index] = updated;
    }
  }
  return next;
}

export function importFigmaSources(payload, fileId) {
  if (payload?.schema !== 'rk-figma-slides-v1' || !Array.isArray(payload.slides) || !payload.slides.length || payload.slides.length > CASE_LIMITS.sources) throw new Error('Choose a Studio Figma Slides export or export the deck as PDF.');
  return payload.slides.map((slide, index) => {
    if (typeof slide.text !== 'string' || slide.text.length > CASE_LIMITS.sourceCharacters) throw new Error('Invalid Figma slide text.');
    const images = [];
    if (slide.image) {
      if (typeof slide.image !== 'string' || slide.image.length > 8000000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(slide.image)) throw new Error('Invalid Figma slide image.');
      images.push({ src: slide.image, mime: 'image/png', b64: slide.image.split(',')[1] });
    }
    return { id: fileId + '-' + index, label: String(payload.title || 'Figma Slides').slice(0, 160) + ' / Slide ' + (index + 1), kind: 'figma', text: slide.text, images, enabled: index < CASE_LIMITS.images, warning: 'Speaker notes, animations, and interactive embeds are not included.', fileId };
  });
}

let database;
function openDatabase() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open('rk-case-authoring-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(error => { database = null; throw error; });
  return database;
}
export async function caseWorkspace(id, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', value === undefined ? 'readonly' : 'readwrite');
    const store = transaction.objectStore('projects'), request = value === undefined ? store.get(id) : value === null ? store.delete(id) : store.put(value, id);
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Source workspace save failed.'));
  });
}