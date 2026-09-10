export function deckVisibility(deck) {
  return deck?.slidesPublic === true ? "public" : "private";
}

export function setDeckVisibility(deck, visibility) {
  if (!["public", "private"].includes(visibility)) throw new Error("Invalid visibility");
  const next = structuredClone(deck);
  next.slidesPublic = visibility === "public";
  return next;
}

const ELEMENT_FIELDS = "type x y width height angle strokeColor backgroundColor fillStyle strokeWidth strokeStyle roughness opacity seed fontSize fontFamily text textAlign verticalAlign baseline lineHeight autoResize startArrowhead endArrowhead elbowed simulatePressure".split(" ");
const ELEMENT_TYPES = new Set(["frame", "rectangle", "diamond", "ellipse", "text", "image", "arrow", "line", "freedraw", "embeddable"]);
const MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "image/avif", "video/mp4", "video/webm", "video/quicktime", "video/ogg"]);

function pickScalars(source, keys) {
  const result = {};
  for (const key of keys) {
    const value = source?.[key];
    if (value === undefined) continue;
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) throw new Error(`Unsupported rendering field: ${key}`);
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`Invalid rendering field: ${key}`);
    result[key] = value;
  }
  return result;
}

function numericArray(value) {
  if (!Array.isArray(value)) throw new Error("Invalid geometry");
  return value.map(item => {
    if (Array.isArray(item)) return numericArray(item);
    if (typeof item !== "number" || !Number.isFinite(item)) throw new Error("Invalid geometry");
    return item;
  });
}

function assertUnprotected(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["vaultBlock", "encStub", "protected", "confidential", "private", "requiresReview"].includes(key) && child) throw new Error("Protected source requires a separate cleared copy");
    if (key === "source" && child?.locked) throw new Error("Protected source requires a separate cleared copy");
    if (child && typeof child === "object") assertUnprotected(child);
  }
}

function inlineMedia(dataURL, mimeType) {
  const match = typeof dataURL === "string" && /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataURL);
  if (!match || !MEDIA_TYPES.has(match[1]) || (mimeType && mimeType !== match[1])) throw new Error("Public media must be reviewed original inline bytes; remote or protected URLs are not supported");
  return { dataURL, mimeType: match[1] };
}

export function publicDeckPayload(deck, { reviewedSources = false } = {}) {
  if (deckVisibility(deck) !== "public") throw new Error("Owner-only draft cannot produce a public payload");
  if (reviewedSources !== true) throw new Error("Review all included content and media before public export");
  const slides = (deck.slides || []).filter(slide => !slide.hidden);
  if (!slides.length) throw new Error("No included slides");
  assertUnprotected(Object.fromEntries(Object.entries(deck).filter(([key]) => key !== "slides")));
  const elementIds = new Map();
  return { version:1, visibility:"public", title:String(deck.title || ""), slides:slides.map((slide, index) => {
    const scene = slide.scene;
    if (!scene?.elements) throw new Error("Slide has not been materialized");
    const included = scene.elements.filter(element => !element.isDeleted && !element.customData?.labLayerHidden);
    assertUnprotected(Object.fromEntries(Object.entries(slide).filter(([key]) => key !== "scene")));
    const ids = new Map(included.map(element => {
      if (!elementIds.has(element.id)) elementIds.set(element.id, `element-${elementIds.size}`);
      return [element.id, elementIds.get(element.id)];
    }));
    const frame = included.find(element => element.id === "lab-slide");
    if (!frame) throw new Error("Slide frame is missing");
    ids.set(frame.id, "lab-slide");
    const files = {}, fileIds = new Map(), groups = new Map();
    function binding(value) {
      if (!value || !ids.has(value.elementId)) return null;
      const result = { ...pickScalars(value, ["focus", "gap"]), elementId:ids.get(value.elementId) };
      if (value.fixedPoint) result.fixedPoint = numericArray(value.fixedPoint);
      return result;
    }
    const elements = included.map(element => {
      assertUnprotected(element);
      if (!ELEMENT_TYPES.has(element.type)) throw new Error(`Unsupported public element: ${element.type}`);
      const result = { ...pickScalars(element, ELEMENT_FIELDS), id:ids.get(element.id), isDeleted:false, version:1, versionNonce:0, updated:0, locked:true, link:null };
      result.frameId = ids.get(element.frameId) || null;
      result.containerId = ids.get(element.containerId) || null;
      result.groupIds = (element.groupIds || []).map(id => { if (!groups.has(id)) groups.set(id, `group-${groups.size}`); return groups.get(id); });
      result.boundElements = (element.boundElements || []).filter(bound => ids.has(bound.id)).map(bound => ({ id:ids.get(bound.id), type:included.find(item => item.id === bound.id).type }));
      for (const key of ["points", "pressures", "scale", "lastCommittedPoint"]) if (element[key]) result[key] = numericArray(element[key]);
      if (element.roundness) result.roundness = pickScalars(element.roundness, ["type", "value"]);
      if (element.crop) result.crop = pickScalars(element.crop, ["x", "y", "width", "height", "naturalWidth", "naturalHeight"]);
      if (element.fixedSegments?.length) throw new Error("Fixed elbow segments are not supported by the public contract yet");
      result.startBinding = binding(element.startBinding); result.endBinding = binding(element.endBinding);
      if (element.type === "text") result.originalText = result.text;
      const custom = element.customData || {}, safe = {};
      if (custom.sectionComponent) throw new Error("Native sections require a public component renderer before export");
      if (custom.slideEmbed || custom.pendingEmbed) throw new Error("Linked embeds require the reviewed public publishing integration");
      if (custom.labCorners) safe.labCorners = pickScalars(custom.labCorners, ["mode", "radius"]);
      if (typeof custom.labTextColor === "string") safe.labTextColor = custom.labTextColor;
      if (custom.slideBackground === true) safe.slideBackground = true;
      if (custom.slideSettings) {
        safe.slideSettings = { transition:["none", "fade", "push", "magic"].includes(custom.slideSettings.transition) ? custom.slideSettings.transition : "fade" };
        if (custom.slideSettings.background?.type === "color") safe.slideSettings.background = { type:"color", ...pickScalars(custom.slideSettings.background, ["color"]) };
      }
      for (const key of ["sectionVideo", "slideBackgroundVideo"]) if (custom[key]) safe[key] = inlineMedia(custom[key]).dataURL;
      if (element.type === "embeddable") {
        if (!safe.sectionVideo) throw new Error("Unsupported public embed; replace it with reviewed native content or inline video");
        result.link = "https://slide-lab.invalid/section-video";
      }
      result.customData = safe;
      if (element.type === "image") {
        const file = scene.files?.[element.fileId];
        if (!file) throw new Error("Public image bytes are missing");
        assertUnprotected(file);
        if (!fileIds.has(element.fileId)) {
          const id = `file-${fileIds.size}`;
          fileIds.set(element.fileId, id);
          files[id] = { id, ...inlineMedia(file.dataURL, file.mimeType), created:0 };
          if (file.originalDataURL) files[id].originalDataURL = inlineMedia(file.originalDataURL, file.mimeType).dataURL;
        }
        result.fileId = fileIds.get(element.fileId); result.status = "saved";
      }
      return result;
    });
    return { id:`slide-${index}`, title:String(slide.title || ""), scene:{ version:1, elements, files, appState:pickScalars(scene.appState, ["viewBackgroundColor"]) } };
  }) };
}