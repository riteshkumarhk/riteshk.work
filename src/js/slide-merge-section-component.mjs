const protection = ["off", "locked", "encStub", "vaultBlock", "private", "confidential", "protected", "requiresReview"];

export function sectionComponentPlan(block, plain, prefix, resources = {}) {
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
    elements: [{ type: "rectangle", id: `${prefix}-section`, x: 64, y: 36, width: 1152, height: 648,
      frameId: "lab-slide", link: null,
      backgroundColor: "rgba(0, 0, 0, 0)", strokeColor: "transparent", fillStyle: "solid", roughness: 0,
      customData: { sectionComponent: snapshot, sectionIcons: icons } }]
  };
}