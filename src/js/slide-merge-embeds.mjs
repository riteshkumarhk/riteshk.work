export function embedDescriptor(value) {
  const text = String(value || "").trim();
  let url;
  try { url = new URL(text); } catch { throw new Error("Enter a complete HTTPS media link."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use an HTTPS link without credentials.");
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be" || /(^|\.)youtube(?:-nocookie)?\.com$/.test(host)) {
    const id = host === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).at(-1);
    if (!/^[\w-]{11}$/.test(id || "")) throw new Error("This YouTube link does not identify a video.");
    return { url: text, src: `https://www.youtube-nocookie.com/embed/${id}`, kind: "frame", title: "YouTube video", trusted: true };
  }
  if (/(^|\.)vimeo\.com$/.test(host)) {
    const id = url.pathname.split("/").find(part => /^\d+$/.test(part));
    if (!id) throw new Error("This Vimeo link does not identify a video.");
    return { url: text, src: `https://player.vimeo.com/video/${id}`, kind: "frame", title: "Vimeo video", trusted: true };
  }
  if (/(^|\.)figma\.com$/.test(host)) return { url: text, src: `https://www.figma.com/embed?embed_host=ritesh&url=${encodeURIComponent(url.href)}`, kind: "frame", title: "Figma prototype", trusted: true };
  if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(url.pathname)) return { url: text, src: url.href, kind: "video", title: "Embedded video" };
  if (/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(url.pathname)) return { url: text, src: url.href, kind: "image", title: "Embedded image" };
  if (/\.(pptx?|docx?|xlsx?)$/i.test(url.pathname)) return { url: text, src: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url.href)}`, kind: "frame", title: "Embedded document", trusted: true };
  return { url: text, src: url.href, kind: "frame", title: /\.pdf$/i.test(url.pathname) ? "PDF document" : "Embedded content", trusted: false };
}