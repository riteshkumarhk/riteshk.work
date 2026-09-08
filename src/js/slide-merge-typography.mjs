export function typographySystem(data) {
  const typography = data?.typography;
  if (!Array.isArray(typography?.systems) || !typography.systems.length) return null;
  return typography.systems.find(system => system?.id === typography.active) || typography.systems[0] || null;
}

export async function publishedTypography(fetcher, signal) {
  let failure;
  for (const url of ["https://media.riteshk.work/content.json", "/content.json"]) {
    try {
      const response = await fetcher(url, { signal, credentials:"omit", cache:"no-store" });
      if (!response.ok) throw new Error(`Typography configuration unavailable (${response.status})`);
      return typographySystem(await response.json());
    } catch (error) {
      if (signal?.aborted) throw error;
      failure = error;
    }
  }
  throw failure;
}

export function applyStudioTypography(system, document) {
  if (!system) return;
  function stylesheet(id, href) {
    let link = document.getElementById(id);
    if (!href) { link?.remove(); return; }
    if (!link) { link = document.createElement("link"); link.id = id; link.rel = "stylesheet"; document.head.appendChild(link); }
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
  }
  const google = [], fontshare = [];
  for (const font of [system.display, system.text, system.mono]) {
    if (!font?.css || font.selfHosted) continue;
    if (font.src === "google") google.push(font.css);
    if (font.src === "fontshare") fontshare.push(font.css);
  }
  stylesheet("merge-type-builtins", "/css/fonts-systems.css?v=1");
  stylesheet("merge-type-google", google.length ? "https://fonts.googleapis.com/css2?family=" + google.join("&family=") + "&display=swap" : "");
  stylesheet("merge-type-fontshare", fontshare.length ? "https://api.fontshare.com/v2/css?f[]=" + fontshare.join("&f[]=") + "&display=swap" : "");
  const family = value => String(value ?? "").replace(/[^\w .\-]/g, "");
  const ranges = value => String(value ?? "").replace(/[^\w+,\s-]/g, "");
  const faces = (Array.isArray(system.faces) ? system.faces : []).map(face => {
    const url = String(face?.url || "");
    if (!url || !/^[\w./:%-]+$/.test(url)) return "";
    const weight = String(face?.weight || "400").replace(/[^\d\s]/g, "").trim() || "400";
    return `@font-face{font-family:'${family(face.family)}';font-style:${face.style === "italic" ? "italic" : "normal"};font-weight:${weight};font-display:swap;src:url('${url}') format('woff2');${face.unicodeRange ? `unicode-range:${ranges(face.unicodeRange)};` : ""}}`;
  }).filter(Boolean).join("");
  let style = document.getElementById("merge-type-faces");
  if (faces) {
    if (!style) { style = document.createElement("style"); style.id = "merge-type-faces"; document.head.appendChild(style); }
    style.textContent = faces;
  } else style?.remove();
  const root = document.documentElement;
  for (const [role, token] of [["display", "--serif"], ["text", "--sans"], ["mono", "--mono"]]) {
    if (system[role]?.stack) root.style.setProperty(token, system[role].stack);
    else root.style.removeProperty(token);
  }
  if (system.display?.weight) root.style.setProperty("--serif-weight", String(system.display.weight));
  else root.style.removeProperty("--serif-weight");
  root.dataset.typographySource = "published";
  root.dataset.typographySystem = system.id || "custom";
}

export function watchStudioTypography(window, document) {
  let controller;
  const refresh = () => {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    publishedTypography(window.fetch.bind(window), signal).then(system => {
      if (!signal.aborted) applyStudioTypography(system, document);
    }).catch(error => {
      if (!signal.aborted) console.warn("Studio typography refresh unavailable; keeping the current UI fonts.", error);
    });
  };
  refresh();
  window.addEventListener("focus", refresh);
  return () => { controller?.abort(); window.removeEventListener("focus", refresh); };
}