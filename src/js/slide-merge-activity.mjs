const fields = {
  position: ["x", "y"], size: ["width", "height", "scale", "points"], rotation: ["angle"],
  text: ["text", "originalText"], typography: ["fontFamily", "fontSize", "textAlign", "verticalAlign", "lineHeight"],
  style: ["strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "roundness", "opacity"],
  grouping: ["groupIds"], bindings: ["boundElements", "containerId", "startBinding", "endBinding"],
  lock: ["locked"], media: ["fileId", "crop", "link"], metadata: ["customData"]
};

function fingerprint(value) {
  const text = JSON.stringify(value) || "";
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function activitySnapshot(elements) {
  return elements.filter(element => !element.isDeleted).map(element => ({
    id: element.id, type: element.customData?.slideBackground ? "background" : element.type,
    ...Object.fromEntries(Object.entries(fields).map(([name, keys]) => [name, fingerprint(keys.map(key => element[key]))])),
    visibility: !!element.customData?.labLayerHidden,
    name: fingerprint(element.customData?.labLayerName),
    settings: fingerprint(element.customData?.slideSettings)
  }));
}

export function activityChanges(before, after) {
  const previous = new Map(before.map(element => [element.id, element]));
  const next = new Map(after.map(element => [element.id, element]));
  const messages = [];
  for (const [verb, items] of [["Added", after.filter(element => !previous.has(element.id))], ["Deleted", before.filter(element => !next.has(element.id))]]) {
    const types = new Map();
    for (const item of items) types.set(item.type, (types.get(item.type) || 0) + 1);
    for (const [type, count] of types) messages.push(`${verb} ${count} ${type} layer${count === 1 ? "" : "s"}`);
  }
  const categories = new Map();
  for (const element of after) {
    const old = previous.get(element.id);
    if (!old) continue;
    for (const name of [...Object.keys(fields), "visibility", "name", "settings"]) {
      if (old[name] !== element[name]) categories.set(name, (categories.get(name) || 0) + 1);
    }
  }
  for (const [name, count] of categories) messages.push(`Changed ${name} on ${count} layer${count === 1 ? "" : "s"}`);
  if (!messages.length && before.map(element => element.id).join() !== after.map(element => element.id).join()) messages.push("Changed layer order");
  return messages;
}

export const ACTIVITY_CAPABILITIES = "Slides: add, delete, duplicate, reorder, skip, sections, title, notes. Canvas: text, typography, shapes, style, move, resize, rotate, bindings, media, backgrounds, layouts, guides, layers, visibility, locking, grouping, undo, redo. Views: current, all, editing on/off, rehearsal. Text and media content omitted; changes coalesced after interaction.";

export function activityText(events) {
  const start = events[0]?.t || 0;
  return ["# Slide studio lab - activity log", `# ${ACTIVITY_CAPABILITIES}`, ...events.map(event => `+${event.t - start}ms ${event.k.toUpperCase()} [${event.c}] ${event.d}`)].join("\n");
}