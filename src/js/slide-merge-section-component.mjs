const protection = ["off", "locked", "encStub", "vaultBlock", "private", "confidential", "protected", "requiresReview"];

export function normalizeSectionReference(value) {
  if (value?.version !== 1) return null;
  const { caseStudyId, sectionId } = value;
  if (![caseStudyId, sectionId].every(part => typeof part === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(part))) return null;
  return { version: 1, caseStudyId, sectionId };
}

export function sectionTextVisibility(value) {
  return Object.fromEntries(['heading','kicker','description','caption'].filter(key => value?.[key] === false).map(key => [key,false]));
}

export function sectionTextFields(block) {
  if (!block || block.encStub || block.vaultBlock) return [];
  const present = value => typeof value === 'string' && value.trim().length > 0;
  const captions = value => value && typeof value === 'object' && (present(value.caption) || Object.values(value).some(child => child && typeof child === 'object' && captions(child)));
  return [
    ['heading', 'Heading', present(block.heading)],
    ['kicker', 'Kicker', present(block.kicker)],
    ['description', 'Description', ['body','desc','sub'].some(key => present(block[key]))],
    ['caption', 'Caption', captions(block) || /<figcaption[\s>]/i.test(block.body || '')]
  ].filter(([, , exists]) => exists).map(([key,label]) => ({key,label}));
}

function sectionElement(prefix, customData) {
  return { type: "rectangle", id: `${prefix}-section`, x: 64, y: 36, width: 1152, height: 648,
    frameId: "lab-slide", link: null,
    backgroundColor: "rgba(0, 0, 0, 0)", strokeColor: "transparent", fillStyle: "solid", roughness: 0,
    customData };
}

export function sectionComponentPlan(block, plain, prefix, resources = {}) {
  const sourceReference = resources.sectionReference || ((block?.locked || block?.encStub || block?.vaultBlock) && resources.caseStudyId ? {version:1,caseStudyId:resources.caseStudyId,sectionId:block.sectionId} : null);
  if (sourceReference) {
    const reference = normalizeSectionReference(sourceReference);
    if (!reference || !block || block.off) throw new Error("Protected section reference is not available");
    return { title: "Protected section", notes: "", elements: [sectionElement(prefix, { sectionReference: reference })] };
  }
  const snapshot = structuredClone(block);
  const seen = new WeakSet();
  const icons = {};
  function check(value) {
    if (typeof value === "string" && /(?:vault:|rkenc:|assets\/protected\/|\/vault\/|\.enc(?:$|[?#]))/i.test(value)) throw new Error("Protected section media is not available");
    if (!value || typeof value !== "object") return;
    if (seen.has(value)) throw new Error("Cyclic section content is not supported");
    if (protection.some(key => value[key])) throw new Error("Protected or disabled section content is not available");
    const name = value.icon || (value.type === "icon" ? value.name : null);
    if (typeof name === "string" && Object.hasOwn(resources.customIcons || {}, name) && typeof resources.customIcons[name] === "string") icons[name] = resources.customIcons[name];
    seen.add(value);
    Object.values(value).forEach(check);
    seen.delete(value);
  }
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || typeof snapshot.type !== "string") throw new Error("Invalid section component");
  check(snapshot);
  const title = plain(snapshot.heading || snapshot.nav || snapshot.editorName || snapshot.type);
  return {
    title,
    notes: plain(snapshot.body || snapshot.desc || ""),
    elements: [sectionElement(prefix, { sectionComponent: snapshot, sectionIcons: icons })]
  };
}