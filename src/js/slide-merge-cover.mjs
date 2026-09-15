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
export function fetchCoverMedia(url, timeout = 15000) {
  return fetch(url, { cache: "reload", credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(timeout) });
}
export async function restorePresentationCover(slide, work, loadImage, createElements) {
  const scene = slide.scene, frame = scene.elements.find(element => element.id === "lab-slide");
  const saved = frame?.customData?.slideSettings?.cover;
  if (!saved?.source || saved.source.caseStudyId !== work.id) return;
  const cover = coverValues(saved), project = projectCoverData(work);
  for (const key of ["image", "logo"]) {
    if (cover.hidden.includes(key)) continue;
    const element = scene.elements.find(item => !item.isDeleted && item.customData?.slideCover === key);
    if (!element && scene.elements.some(item => item.isDeleted && item.customData?.slideCover === key)) continue;
    if (element?.customData?.labLayerHidden) continue;
    const fileId = element?.fileId || cover[key]?.fileId;
    if (fileId && scene.files[fileId]?.dataURL) continue;
    if (cover.source.overrides.includes(key)) {
      if (element) throw new Error(`The saved cover ${key} is missing. Open the slide in Studio and restore its original file.`);
      continue;
    }
    const source = cover[key]?.source || project[key];
    if (!source) {
      if (element) throw new Error(`The saved cover ${key} is unavailable. Open the slide in Studio to restore it.`);
      continue;
    }
    const image = await loadImage(source);
    if (fileId && image.id !== fileId) throw new Error(`The linked cover ${key} has changed. Refresh the linked cover in Studio before presenting.`);
    scene.files[image.id] = image;
    if (element) continue;
    cover[key] = { fileId: image.id, width: image.width, height: image.height };
    const skeleton = coverSkeleton(cover, cover.fontFamily || 2, `${slide.id}-presenter-cover`).find(item => item.customData.slideCover === key);
    if (!skeleton) continue;
    if (key === "image") {
      const panel = scene.elements.find(item => !item.isDeleted && item.customData?.slideCover === "media-panel");
      if (!panel || panel.customData?.labLayerHidden) continue;
      const width = panel.width - 48, height = panel.height - 48;
      if (width <= 0 || height <= 0) continue;
      const scale = Math.max(width / image.width, height / image.height);
      Object.assign(skeleton, { x: panel.x + 48, y: panel.y + 48, width, height, angle: panel.angle || 0, frameId: panel.frameId,
        crop: { x: (image.width - width / scale) * cover.crop.x / 100, y: (image.height - height / scale) * cover.crop.y / 100, width: width / scale, height: height / scale, naturalWidth: image.width, naturalHeight: image.height } });
      scene.elements.splice(scene.elements.indexOf(panel) + 1, 0, ...createElements([skeleton]));
    } else scene.elements.push(...createElements([skeleton]));
  }
}
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
  const result = { ...COVER_DEFAULTS, layoutVersion: 4 };
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
export function coverSkeleton(value, fontFamily, prefix = "cover", measureText = (text, size) => text.length * size * .55) {
  const cover = coverValues(value);
  const inset = 48, contentX = 136 + inset, contentWidth = 529 - inset - contentX;
  const common = { frameId: "lab-slide", locked: true, roughness: 0, strokeWidth: 0, strokeColor: "transparent", fillStyle: "solid" };
  const shape = (key, x, y, width, height, color, extra = {}) => ({ ...common, id: `${prefix}-${key}`, type: "rectangle", x, y, width, height, backgroundColor: color, customData: { slideCover: key }, ...extra });
  const label = (key, value, x, y, width, height, fontSize, extra = {}) => ({ ...common, id: `${prefix}-${key}`, type: "text", x, y, width, height, text: value, originalText: value, fontSize, fontFamily, strokeColor: cover.text, backgroundColor: "transparent", lineHeight: 1.15, autoResize: false, customData: { slideCover: key, authoredFit: { width, height } }, ...extra });
  const elements = [shape("background", 0, 0, 1280, 720, cover.background, { customData: { slideCover: "background", slideBackground: true } }), shape("rail", 0, 0, 136, 720, cover.rail)];
  if (cover.logo) {
    const scale = Math.min(40 / cover.logo.width, 54 / cover.logo.height), width = cover.logo.width * scale, height = cover.logo.height * scale;
    elements.push({ ...common, id: `${prefix}-logo`, type: "image", x: 68 - width / 2, y: inset, width, height, fileId: cover.logo.fileId, scale: [1, 1], customData: { slideCover: "logo", labCorners: { mode: "squircle", radius: Math.min(width, height) / 4 } } });
  } else if (cover.mark) elements.push(shape("mark-box", 50, inset, 36, 36, cover.panel, { opacity: 25, roundness: { type: 3 } }), label("mark", cover.mark, 52, inset + 11, 32, 14, 11, { textAlign: "center" }));
  if (cover.client) elements.push(label("client", cover.client, -52, 534, 240, 36, 30, { angle: -Math.PI / 2 }));
  let badgeX = contentX, badgeY = inset;
  for (const [key, content] of [["status", cover.status], ["duration", cover.duration && `Duration: ${cover.duration}`]]) {
    if (!content) continue;
    const width = Math.ceil(measureText(content, 18)) + 24;
    if (badgeX > contentX && badgeX + width > 1280 - inset) { badgeX = contentX; badgeY += 44; }
    elements.push(shape(`${key}-box`, badgeX, badgeY, width, 36, cover.panel, { opacity: 45, roundness: { type: 3 }, customData: { slideCover: `${key}-box`, labCorners: { mode: "round", radius: 18 } } }), label(key, content, badgeX + 12, badgeY + 7, width - 24, 22, 18, { strokeColor: cover.muted }));
    badgeX += width + 16;
  }
  const headerOffset = badgeY - inset;
  elements.push(label("title", cover.title, contentX, 110 + headerOffset, 1280 - inset - contentX, 91, 60, { fontFamily: cover.titleFont || fontFamily }));
  const team = cover.team.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);
  if (team.length > 8) throw new Error("A cover supports up to eight team entries.");
  const segments = [], chipFont = 14, chipPadding = 10, chipHeight = 28, chipGap = 6;
  for (const item of team) {
    let line = "";
    for (const word of item.split(/\s+/)) {
      if (measureText(word, chipFont) > contentWidth - chipPadding * 2) throw new Error("A team word is too long for a cover chip.");
      const next = line ? `${line} ${word}` : word;
      if (line && measureText(next, chipFont) > contentWidth - chipPadding * 2) { segments.push(line); line = word; }
      else line = next;
    }
    if (line) segments.push(line);
  }
  let chipX = contentX - chipPadding, chipY = 242 + headerOffset;
  for (const [index, item] of segments.entries()) {
    const width = Math.ceil(measureText(item, chipFont)) + chipPadding * 2;
    if (chipX + width > contentX + contentWidth) { chipX = contentX - chipPadding; chipY += chipHeight + chipGap; }
    if (chipY + chipHeight > 480) throw new Error("Team chips exceed the cover's available rows.");
    elements.push(shape(`team-box-${index}`, chipX, chipY, width, chipHeight, cover.panel, { opacity: 45, roundness: { type: 3 }, customData: { slideCover: `team-box-${index}`, labCorners: { mode: "round", radius: chipHeight / 2 } } }), label(`team-${index}`, item, chipX + chipPadding, chipY + 5, width - chipPadding * 2, 18, chipFont, { strokeColor: cover.muted }));
    chipX += width + chipGap;
  }
  const roleY = Math.max(378 + headerOffset, segments.length ? chipY + chipHeight + 32 : 378 + headerOffset);
  if (cover.role) {
    if (cover.roleLabel) elements.push(label("role-heading", cover.roleLabel, contentX, roleY, contentWidth, 25, 18, { strokeColor: cover.muted }));
    elements.push(label("role", cover.role, contentX, roleY + 32, contentWidth, 618 - roleY - 32, 18, { strokeColor: cover.muted }));
  }
  if (cover.footnote) elements.push(label("footnote", cover.footnote, contentX, 720 - inset - 30, contentWidth, 30, 9, { strokeColor: cover.muted }));
  elements.push(shape("media-panel", 529, 217 + headerOffset, 751, 503 - headerOffset, cover.panel, { roundness: { type: 3 }, customData: { slideCover: "media-panel", labCorners: { mode: "squircle", radius: 32, topRightCornerRadius: 0, bottomRightCornerRadius: 0, bottomLeftCornerRadius: 0 } } }));
  if (cover.image) {
    const width = 1280 - 529 - inset, height = 720 - 217 - headerOffset - inset, scale = Math.max(width / cover.image.width, height / cover.image.height);
    const cropWidth = width / scale, cropHeight = height / scale;
    elements.push({ ...common, id: `${prefix}-image`, type: "image", x: 529 + inset, y: 217 + headerOffset + inset, width, height, fileId: cover.image.fileId, scale: [1, 1], customData: { slideCover: "image", labCorners: { mode: "squircle", radius: 24, topRightCornerRadius: 0, bottomRightCornerRadius: 0, bottomLeftCornerRadius: 0 }, ...(cover.motion && cover.depth && !cover.source?.overrides.includes("image") ? { slideDepth: coverDepth(cover.depth) } : {}) }, crop: { x: (cover.image.width - cropWidth) * cover.crop.x / 100, y: (cover.image.height - cropHeight) * cover.crop.y / 100, width: cropWidth, height: cropHeight, naturalWidth: cover.image.width, naturalHeight: cover.image.height } });
  }
  return elements.filter(element => {
    const role = element.customData.slideCover;
    return !cover.hidden.some(key => key === "team" ? role.startsWith("team-") : key === "role" ? role === "role" || role === "role-heading" : key === "image" ? role === "image" || role === "media-panel" : role === key || role === `${key}-box`);
  });
}