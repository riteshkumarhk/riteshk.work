export const COVER_FIELDS = [
  ["title", "Title", 160], ["client", "Client", 60],
  ["status", "Status", 40], ["duration", "Duration", 60],
  ["team", "Team", 240], ["roleLabel", "Role heading", 40],
  ["role", "Role description", 500], ["footnote", "Footnote", 240]
];
export const COVER_DEFAULTS = Object.freeze({
  title: "Project title", client: "Client", mark: "", status: "", duration: "",
  team: "", roleLabel: "My role", role: "", footnote: "",
  background: "#08080a", rail: "#0d0d10", panel: "#111116", text: "#ece7e1", muted: "#8f8a84"
});
export const COVER_SOURCE_FIELDS = ["title", "client", "status", "duration", "team", "role", "footnote", "image", "logo"];
export function projectCoverData(work) {
  const study = work.study || {};
  return {
    caseStudyId: work.id,
    title: work.title || "", client: work.client || "", status: study.status || "",
    duration: work.period || "", team: study.team || "", role: study.role || "", footnote: study.scope || "",
    image: work.image || study.cover || "", logo: work.brandLogo || "",
    depth: { ...work.depth }
  };
}
export function linkedCoverValues(previous, source) {
  const overrides = previous.source?.overrides || [];
  const result = { ...previous };
  for (const key of COVER_SOURCE_FIELDS) if (!overrides.includes(key)) result[key] = source[key];
  return { ...result, source: { caseStudyId: source.caseStudyId, overrides: [...overrides] } };
}
export function coverPalette(styles) {
  return Object.fromEntries(Object.entries({ background: "--bg", rail: "--bg-2", panel: "--bg-elev", text: "--text", muted: "--text-dim" }).map(([key, token]) => {
    const value = styles.getPropertyValue(token).trim();
    return [key, /^#[0-9a-f]{6}$/i.test(value) ? value : COVER_DEFAULTS[key]];
  }));
}
export function coverDepth(value) {
  if (typeof value?.fileId !== "string" || !value.fileId) return null;
  const result = { fileId: value.fileId };
  for (const [key, fallback, min, max] of [["strength", .028, 0, .12], ["softness", .014, 0, .1], ["focus", .5, 0, 1], ["zoom", 1.075, 1, 2]]) result[key] = Math.max(min, Math.min(max, Number.isFinite(value[key]) ? value[key] : fallback));
  return result;
}
export function coverValues(value = {}) {
  const result = { ...COVER_DEFAULTS };
  for (const [key] of COVER_FIELDS) if (typeof value[key] === "string") result[key] = value[key];
  if (typeof value.mark === "string") result.mark = value.mark;
  for (const key of ["background", "rail", "panel", "text", "muted"])
    if (/^#[0-9a-f]{6}$/i.test(value[key])) result[key] = value[key];
  for (const key of ["fontFamily", "titleFont"]) if (Number.isInteger(value[key])) result[key] = value[key];
  for (const key of ["image", "logo"])
    if (value[key]?.fileId && value[key].width > 0 && value[key].height > 0)
      result[key] = { fileId: value[key].fileId, width: value[key].width, height: value[key].height, name: String(value[key].name || "Cover image"), ...(typeof value[key].source === "string" ? { source: value[key].source } : {}) };
  if (typeof value.source?.caseStudyId === "string") result.source = { caseStudyId: value.source.caseStudyId, overrides: COVER_SOURCE_FIELDS.filter(key => value.source.overrides?.includes(key)) };
  result.hidden = COVER_SOURCE_FIELDS.filter(key => value.hidden?.includes(key));
  result.crop = { x: Math.max(0, Math.min(100, Number.isFinite(value.crop?.x) ? value.crop.x : 50)), y: Math.max(0, Math.min(100, Number.isFinite(value.crop?.y) ? value.crop.y : 50)) };
  result.motion = value.motion !== false;
  if (coverDepth(value.depth)) result.depth = { ...coverDepth(value.depth), ...(typeof value.depth.source === "string" ? { source: value.depth.source } : {}) };
  return result;
}
export function coverSkeleton(value, fontFamily, prefix = "cover") {
  const cover = coverValues(value);
  const common = { frameId: "lab-slide", locked: true, roughness: 0, strokeWidth: 0, strokeColor: "transparent", fillStyle: "solid" };
  const shape = (key, x, y, width, height, color, extra = {}) => ({ ...common, id: `${prefix}-${key}`, type: "rectangle", x, y, width, height, backgroundColor: color, customData: { slideCover: key }, ...extra });
  const label = (key, value, x, y, width, height, fontSize, extra = {}) => ({ ...common, id: `${prefix}-${key}`, type: "text", x, y, width, height, text: value, originalText: value, fontSize, fontFamily, strokeColor: cover.text, backgroundColor: "transparent", lineHeight: 1.15, autoResize: false, customData: { slideCover: key, authoredFit: { width, height } }, ...extra });
  const elements = [shape("background", 0, 0, 1280, 720, cover.background, { customData: { slideCover: "background", slideBackground: true } }), shape("rail", 0, 0, 136, 720, cover.rail)];
  if (cover.logo) {
    const scale = Math.min(54 / cover.logo.width, 54 / cover.logo.height), width = cover.logo.width * scale, height = cover.logo.height * scale;
    elements.push({ ...common, id: `${prefix}-logo`, type: "image", x: 68 - width / 2, y: 61 - height / 2, width, height, fileId: cover.logo.fileId, scale: [1, 1], customData: { slideCover: "logo" } });
  } else if (cover.mark) elements.push(shape("mark-box", 53, 43, 36, 36, cover.panel, { opacity: 25, roundness: { type: 3 } }), label("mark", cover.mark, 55, 54, 32, 14, 11, { textAlign: "center" }));
  if (cover.client) elements.push(label("client", cover.client, -48, 570, 240, 36, 30, { angle: -Math.PI / 2 }));
  let badgeX = 171;
  for (const [key, content] of [["status", cover.status], ["duration", cover.duration && `Duration: ${cover.duration}`]]) {
    if (!content) continue;
    const width = Math.min(key === "status" ? 230 : 440, Math.max(120, content.length * 9 + 24));
    elements.push(shape(`${key}-box`, badgeX, 47, width, 36, cover.panel, { opacity: 45, roundness: { type: 3 } }), label(key, content, badgeX + 9, 55, width - 18, 22, 18, { strokeColor: cover.muted }));
    badgeX += width + 16;
  }
  elements.push(label("title", cover.title, 171, 110, 1069, 91, 60, { fontFamily: cover.titleFont || fontFamily }));
  const team = cover.team.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);
  if (team.length > 8) throw new Error("A cover supports up to eight team entries.");
  const teamRowHeight = Math.min(40, 120 / Math.max(1, Math.ceil(team.length / 2)));
  for (const [index, item] of team.entries()) {
    const column = index % 2, row = Math.floor(index / 2), width = column ? 164 : 130, position = 173 + (column ? 136 : 0);
    elements.push(shape(`team-box-${index}`, position, 242 + row * teamRowHeight, width, teamRowHeight - 4, cover.panel, { opacity: 45, roundness: { type: 3 } }), label(`team-${index}`, item, position + 10, 246 + row * teamRowHeight, width - 20, teamRowHeight - 12, 16, { strokeColor: cover.muted }));
  }
  if (cover.role) {
    if (cover.roleLabel) elements.push(label("role-heading", cover.roleLabel, 182, 378, 309, 25, 18, { strokeColor: cover.muted }));
    elements.push(label("role", cover.role, 182, 410, 309, 208, 18, { strokeColor: cover.muted }));
  }
  if (cover.footnote) elements.push(label("footnote", cover.footnote, 182, 682, 309, 30, 9, { strokeColor: cover.muted }));
  elements.push(shape("media-panel", 529, 217, 751, 503, cover.panel, { roundness: { type: 3 }, customData: { slideCover: "media-panel", labCorners: { mode: "round", radius: 12 } } }));
  if (cover.image) {
    const width = 714, height = 466, scale = Math.max(width / cover.image.width, height / cover.image.height);
    const cropWidth = width / scale, cropHeight = height / scale;
    elements.push({ ...common, id: `${prefix}-image`, type: "image", x: 566, y: 254, width, height, fileId: cover.image.fileId, scale: [1, 1], customData: { slideCover: "image", ...(cover.motion && cover.depth && !cover.source?.overrides.includes("image") ? { slideDepth: coverDepth(cover.depth) } : {}) }, crop: { x: (cover.image.width - cropWidth) * cover.crop.x / 100, y: (cover.image.height - cropHeight) * cover.crop.y / 100, width: cropWidth, height: cropHeight, naturalWidth: cover.image.width, naturalHeight: cover.image.height } });
  }
  return elements.filter(element => {
    const role = element.customData.slideCover;
    return !cover.hidden.some(key => key === "team" ? role.startsWith("team-") : key === "role" ? role === "role" || role === "role-heading" : key === "image" ? role === "image" || role === "media-panel" : role === key || role === `${key}-box`);
  });
}