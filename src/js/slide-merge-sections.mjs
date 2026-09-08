export function sectionPlainText(value) {
  const parsed = new DOMParser().parseFromString(String(value ?? ""), "text/html");
  parsed.querySelectorAll("script,style,iframe,object").forEach(node => node.remove());
  parsed.querySelectorAll("br,p,div,li").forEach(node => node.append("\n"));
  return (parsed.body.textContent || "").trim();
}
export function availableStudies(data) {
  return (Array.isArray(data?.work) ? data.work : []).filter(work => work && !work.off && !work.locked && !work.encStub && !work.vaultBlock).map(work => ({ id: work.id, title: work.title || "Untitled case study", blocks: (Array.isArray(work.study?.blocks) ? work.study.blocks : []).filter(block => block && !block.off && !block.locked && !block.encStub && !block.vaultBlock) })).filter(work => work.blocks.length);
}
export function sectionMediaUrl(source) {
  if (typeof source !== "string" || !source.trim()) return null;
  if (/^(vault:|rkenc:)/i.test(source) || /assets\/protected\//i.test(source) || /\.enc($|[?#])/i.test(source)) return null;
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(source)) return source;
  try {
    const url = new URL(source, "https://riteshk.work/");
    if (url.protocol !== "https:" || url.username || url.password || /(?:^|\/)vault(?:\/|$)/i.test(url.pathname)) return null;
    if (["riteshk.work", "media.riteshk.work"].includes(url.hostname) && url.pathname.startsWith("/assets/uploads/")) { url.hostname = "media.riteshk.work"; url.pathname = url.pathname.slice("/assets/uploads".length); }
    return url.href;
  } catch { return null; }
}
export function sectionPlan(block, plain, fontFamily, prefix) {
  if (!availableStudies({work:[{study:{blocks:[block]}}]}).length) throw new Error("Section is not available");
  const heading = plain(block.heading || block.nav || ""), kicker = plain(block.kicker || "");
  const items = (block.items || []).filter(item => item && !item.locked && !item.encStub && !item.vaultBlock && !item.off);
  const media = items.find(item => sectionMediaUrl(item.src || item.url));
  const body = plain(block.body || block.desc || "") || (block.list || items.map(item => item.text || item.label || item.title || "")).filter(Boolean).map(item => "- " + plain(item)).join("\n");
  let title = heading, prose = body, note = body;
  if (["statement", "stmt"].includes(block.type)) { title = plain(block.body); prose = plain(block.sub); note = [title, prose].filter(Boolean).join("\n\n"); }
  if (block.type === "metrics" && items[0]) { title = plain(items[0].value); prose = plain(items[0].label || heading); note = items.map(item => [plain(item.value), plain(item.label)].filter(Boolean).join(": ")).join("\n"); }
  if (block.type === "voices" && items[0]) { title = plain(items[0].text || items[0].quote || items[0].body || items[0].q); prose = plain(block.heading || items[0].attr || items[0].who || items[0].label); note = [title, prose].filter(Boolean).join("\n\n"); }
  const mediaOnly = media && ["media", "gallery", "mediagrid", "figure", "showpiece"].includes(block.type);
  const width = media ? 500 : 1080;
  const elements = [];
  const addText = (text, x, y, textWidth, fontSize, maxHeight) => {
    if (!text) return;
    const size = Math.max(14, Math.min(fontSize, Math.sqrt(textWidth * maxHeight / Math.max(1, text.length) / .65)));
    elements.push({ type: "text", id: `${prefix}-text-${elements.length}`, x, y, width: textWidth, text, fontSize: size, fontFamily, autoResize: false, textAlign: "left", strokeColor: "#242428", frameId: "lab-slide" });
  };
  if (mediaOnly) addText(plain(media.caption) || heading, 90, 616, 1100, 26, 70);
  else {
    addText(kicker, 90, 60, width, 22, 44);
    addText(title, 90, 124, width, block.type === "metrics" ? 92 : 44, 146);
    const excerpt = prose.length > 500 ? prose.slice(0, 497).trimEnd() + "..." : prose;
    addText(excerpt, 90, title ? 300 : 140, width, 27, title ? 330 : 490);
  }
  const mediaPlan = media ? { url: sectionMediaUrl(media.src || media.url), kind: media.kind || media.type, x: mediaOnly ? 90 : 660, y: mediaOnly ? 52 : 120, width: mediaOnly ? 1100 : 530, height: mediaOnly ? 530 : 490 } : null;
  if (!elements.length && !mediaPlan) throw new Error("This section has no supported text or media");
  return { title: heading || block.editorName || title || block.type || "Section", notes: note, elements, media: mediaPlan };
}