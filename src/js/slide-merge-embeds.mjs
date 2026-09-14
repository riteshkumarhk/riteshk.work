import DOMPurify from "dompurify";

export const EMBED_SANDBOX = "allow-scripts allow-presentation";

export function embedAspectRatio(value, fallback = "3/2") {
  const parts = String(value || "").split("/");
  const width = Number(parts[0]), height = Number(parts[1]);
  return parts.length === 2 && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && width / height >= 0.1 && width / height <= 10 ? `${width}/${height}` : fallback;
}

function httpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password && !/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname) && !/\.(?:localhost|local|internal)$/.test(url.hostname)) return url.href;
  } catch {}
  return "";
}

function snippetDescriptor(text) {
  if (typeof document === "undefined") throw new Error("HTML embeds must be validated in a browser.");
  const template = document.createElement("template");
  template.innerHTML = text;
  const iframe = template.content.querySelector("iframe[src]");
  const scripts = [...template.content.querySelectorAll("script")];
  const source = [...template.content.querySelectorAll("a[href]")].map(link => httpsUrl(link.getAttribute("href"))).find(Boolean);
  const socialLink = template.content.querySelector('blockquote.twitter-tweet a[href*="/status/"],blockquote.instagram-media a[href],blockquote.tiktok-embed[cite]');
  if (socialLink) {
    const link = socialLink.getAttribute("cite") || socialLink.getAttribute("href");
    const social = embedDescriptor(link);
    if (["X post", "Instagram post", "TikTok video"].includes(social.title)) return { ...social, url: text, sourceUrl: link };
  }
  if (iframe && !scripts.length && template.content.children.length === 1) {
    const descriptor = embedDescriptor(iframe.getAttribute("src"));
    const width = Number(iframe.getAttribute("width")), height = Number(iframe.getAttribute("height"));
    return { ...descriptor, url: text, sourceUrl: descriptor.url, title: iframe.getAttribute("title")?.slice(0, 120) || descriptor.title, ...(width > 0 && height > 0 ? { aspectRatio: `${Math.min(width, 4096)}/${Math.min(height, 4096)}` } : {}) };
  }
  const fragment = DOMPurify.sanitize(text, { FORCE_BODY: true, ADD_TAGS: ["script", "iframe", "style", "link"], ADD_ATTR: ["async", "defer", "type"], FORBID_TAGS: ["base", "meta", "object", "embed", "form"], FORBID_ATTR: ["srcdoc", "sandbox", "nonce"], RETURN_DOM_FRAGMENT: true });
  fragment.querySelectorAll("[src],[href],[action],[srcset]").forEach(element => {
    element.removeAttribute("srcset"); element.removeAttribute("action");
    for (const attribute of ["src", "href"]) {
      if (!element.hasAttribute(attribute)) continue;
      const value = httpsUrl(element.getAttribute(attribute));
      if (value) element.setAttribute(attribute, value);
      else { element.removeAttribute(attribute); if (element.tagName === "SCRIPT") element.remove(); }
    }
  });
  fragment.querySelectorAll("iframe").forEach(frame => { frame.setAttribute("sandbox", EMBED_SANDBOX); frame.setAttribute("credentialless", ""); });
  fragment.querySelectorAll("a").forEach(link => { link.setAttribute("target", "_blank"); link.setAttribute("rel", "noopener noreferrer"); });
  let aspectRatio = "3/2", title = "Embedded widget";
  const chartScript = [...fragment.querySelectorAll("script[src]")].find(script => {
    const url = new URL(script.getAttribute("src"));
    return url.origin === "https://gs.statcounter.com" && url.pathname === "/chart.php";
  });
  let sourceUrl = source || (iframe && httpsUrl(iframe.getAttribute("src"))) || "";
  if (chartScript) {
    const url = new URL(chartScript.getAttribute("src")), id = url.searchParams.keys().next().value || "";
    const chart = [...fragment.querySelectorAll("div[id]")].find(element => element.id === id);
    if (!chart || !/^[a-z0-9-]{1,160}$/.test(id)) throw new Error("This StatCounter snippet is missing its matching chart container.");
    chart.setAttribute("width", "100%"); chart.setAttribute("height", "100%"); chart.style.cssText = "width:100%;height:100%";
    fragment.querySelectorAll("p").forEach(element => element.remove());
    sourceUrl = "https://gs.statcounter.com/#" + id;
    title = "StatCounter Global Stats chart";
  }
  const container = document.createElement("div"); container.append(fragment);
  if (!container.textContent.trim() && !container.querySelector("iframe,img,video,audio,canvas,svg,script")) throw new Error("This snippet has no embeddable content.");
  const policy = "default-src https: data: blob:; script-src https: 'unsafe-inline'" + (chartScript ? " 'unsafe-eval'" : "") + "; style-src https: 'unsafe-inline'; connect-src https:; frame-src https:; object-src 'none'; base-uri 'none'; form-action 'none'";
  const srcDoc = '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="' + policy + '"><style>html,body{margin:0;width:100%;height:100%;background:#fff;color:#222}body{font:14px sans-serif;overflow:auto}img,video,iframe{max-width:100%;box-sizing:border-box}iframe{border:0}blockquote{margin:0}body>div:only-child{max-width:100%}</style></head><body>' + container.innerHTML + '</body></html>';
  return { url: text, src: "", srcDoc: chartScript ? srcDoc.replace('</style>', 'html,body{overflow:hidden}</style>') : srcDoc, sourceUrl, kind: "html", title, trusted: false, aspectRatio };
}

export function embedDescriptor(value) {
  const text = String(value || "").trim();
  if (text.length > 100000) throw new Error("Keep embed code under 100 KB.");
  if (text.startsWith("<")) return snippetDescriptor(text);
  let url;
  try { url = new URL(text); } catch { throw new Error("Enter a complete HTTPS media link."); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Use an HTTPS link without credentials.");
  if (!httpsUrl(text)) throw new Error("Use a public HTTPS embed link.");
  const host = url.hostname.toLowerCase();
  const social = (src, title, ratio = "4/5") => ({ url: text, src, kind: "frame", title, trusted: true, aspectRatio: ratio });
  if (host === "platform.twitter.com" && url.pathname === "/embed/Tweet.html" && /^\d+$/.test(url.searchParams.get("id") || "")) return social(url.href, "X post");
  if (host === "www.tiktok.com" && /^\/player\/v1\/\d+$/.test(url.pathname)) return social(url.href, "TikTok video", "9/16");
  if (host === "w.soundcloud.com" && url.pathname === "/player/") return social(url.href, "SoundCloud", "3/1");
  if (["datawrapper.dwcdn.net", "flo.uri.sh", "public.flourish.studio"].includes(host)) return social(url.href, "Interactive chart", "3/2");
  if (["www.google.com", "maps.google.com"].includes(host) && url.pathname.startsWith("/maps/embed")) return social(url.href, "Google map", "4/3");
  if (/^(www\.)?(twitter\.com|x\.com)$/.test(host)) {
    const post = url.pathname.match(/^\/[^/]+\/status\/(\d+)/);
    if (post) return social("https://platform.twitter.com/embed/Tweet.html?id=" + post[1], "X post");
  }
  if (/^(www\.)?instagram\.com$/.test(host)) {
    const post = url.pathname.match(/^\/(p|reel|tv)\/([\w-]+)/);
    if (post) return social(`https://www.instagram.com/${post[1]}/${post[2]}/embed/`, "Instagram post");
  }
  if (/^(www\.)?tiktok\.com$/.test(host)) {
    const post = url.pathname.match(/\/video\/(\d+)/);
    if (post) return social("https://www.tiktok.com/player/v1/" + post[1], "TikTok video", "9/16");
  }
  if (host === "open.spotify.com") {
    const item = url.pathname.match(/^\/(?:embed\/)?(track|album|playlist|episode|show|artist)\/([a-zA-Z0-9]+)/);
    if (item) return social(`https://open.spotify.com/embed/${item[1]}/${item[2]}`, "Spotify", "3/2");
  }
  if (/^(www\.)?soundcloud\.com$/.test(host)) return social("https://w.soundcloud.com/player/?url=" + encodeURIComponent(url.href), "SoundCloud", "3/1");
  if (/^(www\.)?linkedin\.com$/.test(host)) {
    const urn = decodeURIComponent(url.pathname).match(/urn:li:(share|ugcPost|activity):(\d+)/);
    const post = url.pathname.match(/activity-(\d+)/);
    if (urn || post) return social("https://www.linkedin.com/embed/feed/update/urn:li:" + (urn ? urn[1] + ":" + urn[2] : "activity:" + post[1]), "LinkedIn post");
  }
  if (/^(www\.)?facebook\.com$/.test(host)) return social("https://www.facebook.com/plugins/post.php?href=" + encodeURIComponent(url.href) + "&show_text=true", "Facebook post");
  if (host === "youtu.be" || /(^|\.)youtube(?:-nocookie)?\.com$/.test(host)) {
    const id = host === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") || url.pathname.split("/").filter(Boolean).at(-1);
    if (!/^[\w-]{11}$/.test(id || "")) throw new Error("This YouTube link does not identify a video.");
    const player = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
    for (const key of ["start", "end", "controls", "autoplay", "mute", "loop", "playlist", "playsinline", "rel", "cc_load_policy", "hl"]) if (url.searchParams.has(key)) player.searchParams.set(key, url.searchParams.get(key));
    if (!player.searchParams.has("start") && url.searchParams.has("t")) {
      const time = /^(?:(\d+)h)?(?:(\d+)m)?(\d+)s?$/.exec(url.searchParams.get("t"));
      if (time) player.searchParams.set("start", String(Number(time[1] || 0) * 3600 + Number(time[2] || 0) * 60 + Number(time[3])));
    }
    return { url: text, src: player.href, kind: "frame", title: "YouTube video", trusted: true, aspectRatio: "16/9" };
  }
  if (/(^|\.)vimeo\.com$/.test(host)) {
    const id = url.pathname.split("/").find(part => /^\d+$/.test(part));
    if (!id) throw new Error("This Vimeo link does not identify a video.");
    return { url: text, src: `https://player.vimeo.com/video/${id}`, kind: "frame", title: "Vimeo video", trusted: true };
  }
  if (/(^|\.)figma\.com$/.test(host)) return { url: text, src: host === "embed.figma.com" || url.pathname === "/embed" ? url.href : `https://www.figma.com/embed?embed_host=ritesh&url=${encodeURIComponent(url.href)}`, kind: "frame", title: "Figma prototype", trusted: true };
  if (host === "docs.google.com" && /^\/(document|presentation|spreadsheets)\/d\/[^/]+\/(edit|view)/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/(edit|view).*$/, "/preview");
    return { url: text, src: url.href, kind: "frame", title: "Google document", trusted: true };
  }
  if (host === "drive.google.com" && /^\/file\/d\/[^/]+/.test(url.pathname)) return { url: text, src: url.origin + url.pathname.replace(/\/[^/]*$/, "/preview"), kind: "frame", title: "Google Drive file", trusted: true };
  if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(url.pathname)) return { url: text, src: url.href, kind: "video", title: "Embedded video" };
  if (/\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(url.pathname)) return { url: text, src: url.href, kind: "audio", title: "Embedded audio" };
  if (/\.(png|jpe?g|webp|gif|avif|svg)$/i.test(url.pathname)) return { url: text, src: url.href, kind: "image", title: "Embedded image" };
  if (/\.(pptx?|docx?|xlsx?)$/i.test(url.pathname)) return { url: text, src: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url.href)}`, kind: "frame", title: "Embedded document", trusted: true };
  return { url: text, src: url.href, kind: "frame", title: /\.pdf$/i.test(url.pathname) ? "PDF document" : "Embedded content", trusted: false };
}