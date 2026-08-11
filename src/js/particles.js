/* =================================================================
   NODE-WEB — a scroll-driven particle field that seeds through the page
   and grows into a connected, bokeh-depth network that gathers around the
   statement. Evolves the old ambient bg-field into the "capabilities moment".

   Perf: DPR-capped, pre-rendered glow sprites (fake bokeh, no per-frame blur),
   paused off-screen / tab-hidden, real-FPS self-disable. Gated off on software
   GPUs (bgCapable) unless forced (?nodes) — a static fallback lands in a later
   phase. Chips (the tip-tip capability reveal) land in phase 2.
   ================================================================= */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Same capability probe the site has always used to keep heavy motion off
// software-rendered / low-power machines (Cloud PC, old phones).
function bgCapable() {
  if ((navigator.hardwareConcurrency || 8) <= 2 || (navigator.deviceMemory || 8) <= 2) return false;
  try {
    const gc = document.createElement("canvas");
    const gl = gc.getContext("webgl") || gc.getContext("experimental-webgl");
    if (!gl) return false;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || "").toLowerCase() : "";
    if (r && /swiftshader|llvmpipe|software|basic render|microsoft basic|paravirtual|mesa offscreen/.test(r)) return false;
  } catch (e) { return false; }
  return true;
}

// Pre-rendered soft radial glow (a single bokeh dot). Drawn scaled per particle,
// so there is zero per-frame blur cost.
function makeGlow(color) {
  const s = 64, c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, color);
  grd.addColorStop(0.25, color);
  grd.addColorStop(1, "transparent");
  g.globalAlpha = 1; g.fillStyle = grd;
  g.beginPath(); g.arc(s / 2, s / 2, s / 2, 0, 6.2832); g.fill();
  return c;
}

export function initNodeWeb(opts) {
  opts = opts || {};
  if (opts.lite) return;
  const force = !!opts.force;
  if (!force && !bgCapable()) return; // static fallback comes later

  const root = document.documentElement;
  const cssVar = (v, d) => (getComputedStyle(root).getPropertyValue(v).trim() || d);
  // Colours + glow sprites follow the theme (re-synced whenever it changes): ivory/bronze glowing
  // on the dark theme; dark ink/gold on the light theme so nothing washes out on cream.
  let ACCENT = "#D8A657", IVORY = "#ECE7E1", glowIvory = makeGlow("#ECE7E1"), glowAccent = makeGlow("#D8A657"), curLight = null;
  const syncTheme = () => {
    const light = root.getAttribute("data-appearance") === "light";
    if (light === curLight) return;
    curLight = light;
    ACCENT = cssVar("--accent", light ? "#9c6b1a" : "#D8A657");
    // On light the ambient web is a deep INK-NAVY (crisp): strong contrast on cream, cool + editorial, never the muddy bokeh 'mould'.
    IVORY = light ? "#33405e" : cssVar("--text", "#ECE7E1");
    glowIvory = makeGlow(IVORY);
    glowAccent = makeGlow(ACCENT);
  };

  const canvas = document.createElement("canvas");
  canvas.className = "bg-field"; // reuse existing fixed / z-index:-1 / pointer-events:none rule
  canvas.setAttribute("aria-hidden", "true");
  document.body.insertBefore(canvas, document.body.firstChild);
  const ctx = canvas.getContext("2d");

  let W = 0, H = 0, DPR = 1, parts = [];
  let mX = -9999, mY = -9999, rafId = 0, running = true;
  let f = 0, sampleT0 = 0, checked = false;
  let intensity = 0; // 0 = ambient seeds .. 1 = full network (statement centred)

  // Capability chips — the "tip-tip" focus-pull reveal. A fixed DOM layer above the
  // content (styled in css); each chip fades in beside a node that has snapped crisp.
  const chipLayer = document.createElement("div");
  chipLayer.className = "node-chips";
  chipLayer.setAttribute("aria-hidden", "true");
  document.body.appendChild(chipLayer);
  let chips = [], capPool = [], capIdx = 0, nextSpawnAt = 0, lastScrollY = 0, recentPts = [];

  const resize = () => {
    for (let i = 0; i < chips.length; i++) chips[i].el.remove();
    chips = [];
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = Math.floor(window.innerWidth * DPR);
    H = canvas.height = Math.floor(window.innerHeight * DPR);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    // Node count tracks screen AREA so the density (nodes per pixel) stays constant on every screen —
    // a laptop and a 4K display read at the same calm density, the big screen just holds more of the
    // same field (more nodes within link range = richer constellations). Cap keeps huge displays sane;
    // at constant density the drawn-link count scales linearly, so this stays cheap.
    const count = Math.round(clamp(window.innerWidth * window.innerHeight / 16000, 40, 520)); // constant density; cap gives 4K full density
    parts = new Array(count).fill(0).map(() => {
      const depth = Math.random(); // 0 = far (big soft bokeh) .. 1 = near (small crisp node)
      return {
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.10 * DPR, vy: (Math.random() - 0.5) * 0.10 * DPR,
        depth,
        size: (2.5 + (1 - depth) * 9) * DPR,   // far particles are the big soft bokeh
        baseA: 0.12 + depth * 0.26,            // near particles read a touch brighter
        birth: Math.pow(Math.random(), 1.6),   // most only fade in as the network grows
        accent: Math.random() < 0.16,          // sparse bronze; the rest ivory
        a: 0, focus: 0, focusTarget: 0,
      };
    });
  };

  // Network strength from the statement's position: peaks (1) when the statement
  // is centred in the viewport, eases to 0 roughly a viewport away.
  const targetIntensity = () => {
    const el = document.getElementById("wsec-hero");
    if (!el || el.hidden) return 0;
    const r = el.getBoundingClientRect();
    if (r.height === 0) return 0;
    const c = r.top + r.height / 2;
    const d = Math.abs(c - window.innerHeight / 2) / window.innerHeight;
    return clamp(1 - d * 1.3, 0, 1);
  };
  const statementCanvasY = () => {
    const el = document.getElementById("wsec-hero");
    if (!el || el.hidden) return -1;
    const r = el.getBoundingClientRect();
    if (r.height === 0) return -1;
    return (r.top + r.height / 2) * DPR;
  };

  const LINK = () => 128 * DPR;

  // --- capability chip choreography (tip-tip) ---
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  };
  const nextCap = () => {
    const src = ((opts.getData && opts.getData()) || {}).capabilities || [];
    if (!src.length) return null;
    if (capIdx >= capPool.length) { capPool = shuffle(src); capIdx = 0; }
    return capPool[capIdx++];
  };
  const titleRect = () => { const t = document.getElementById("heroTitle"); return t ? t.getBoundingClientRect() : null; };
  // Anything a chip must never cover: text, media, links, buttons and the fixed UI.
  const OCCUPIED = "a,button,input,textarea,select,label,h1,h2,h3,h4,h5,h6,p,li,img,svg,nav,header,footer,.marquee,.logos,.himarq,.dock,.workcue,.hero__now,.hero__label,.hero__avail";
  // Pull a SOFT (out-of-focus) orb in the statement's halo into focus, but only where its label —
  // which sits to the LEFT of the node — lands entirely on empty space (never over content/UI).
  const rectsOverlap = (a, b) => !(a.right + 12 < b.left || a.left - 12 > b.right || a.bottom + 10 < b.top || a.top - 10 > b.bottom);
  const chipZone = (nx, ny) => {
    const tr = titleRect(); if (!tr) return 0;
    const cx = (tr.left + tr.right) / 2, cy = (tr.top + tr.bottom) / 2;
    const ce = document.getElementById("contact");
    const topLimit = tr.top - 200;                                 // up into the open space above the words
    const botLimit = ce ? Math.min(tr.bottom + 90, ce.getBoundingClientRect().top - 26) : tr.bottom + 90; // stop ABOVE the contact block
    if (ny < topLimit || ny > botLimit) return 0;
    // a broad HALO around the statement: the weight eases with distance from the words so chips gather
    // AROUND "I shape what gets built, and why", reaching well into the side gutters where the
    // constellations form, and fading at the far edges.
    const rx = (nx - cx) / (tr.width * 0.5 + 560);
    const ry = (ny - cy) / 300;
    let w = clamp(1 - (rx * rx + ry * ry) * 0.7, 0.06, 1);
    for (let k = 0; k < recentPts.length; k++) { const d = recentPts[k]; if ((nx - d.x) * (nx - d.x) + (ny - d.y) * (ny - d.y) < 160 * 160) { w *= 0.12; break; } } // spread spawns out
    return w;
  };
  const pickNode = (estW) => {
    const tr = titleRect();
    if (!tr) return null;
    const ld2 = LINK() * LINK();
    const cands = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.focusTarget || p.depth > 0.6) continue;         // only a soft orb gets pulled sharp
      if (p.x < 44 * DPR || p.x > W - 44 * DPR) continue;   // just off the extreme edges (label can take either side)
      const w = chipZone(p.x / DPR, p.y / DPR);
      if (w <= 0.05) continue;                              // outside the considered region
      // NO SOLO SPAWNS: the node must be linked into the web; PREFER denser constellations, keep variety
      let conn = 0;
      for (let j = 0; j < parts.length; j++) { if (j === i) continue; const q = parts[j]; if (q.a < 0.04) continue; const ddx = p.x - q.x, ddy = p.y - q.y; if (ddx * ddx + ddy * ddy <= ld2) { if (++conn >= 6) break; } }
      if (conn < 1) continue;                                // never a lone/floating node
      cands.push({ p: p, k: Math.pow(Math.random(), 1 / (w * (1 + conn * conn * 0.3))) }); // strongly prefer the densest constellations
    }
    cands.sort((a, b) => b.k - a.k);
    const existing = chips.map((c) => c.el.getBoundingClientRect());
    // every real content rect currently in view — the label keeps a clear 16px margin from all of them
    const occ = [];
    document.querySelectorAll(OCCUPIED).forEach((e) => {
      if (e.closest("#menu")) return;                       // skip the mobile-menu overlay: a hidden full-width phantom on desktop (pointer-events:none)
      const r = e.getBoundingClientRect();
      if (r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth) occ.push(r);
    });
    const mob = window.innerWidth < 760;
    const M = mob ? 9 : 16, EG = mob ? 4 : 6;                     // tighter clearance on narrow screens so a label can still fit
    const fits = (box) => {
      if (box.left < EG || box.right > window.innerWidth - EG) return false;
      for (let k = 0; k < occ.length; k++) { const o = occ[k]; if (!(box.right + M < o.left || box.left - M > o.right || box.bottom + M < o.top || box.top - M > o.bottom)) return false; }
      for (let k = 0; k < existing.length; k++) { if (rectsOverlap(box, existing[k])) return false; }
      return true;
    };
    let fallback = null;
    for (let i = 0; i < cands.length; i++) {
      const p = cands[i].p, nx = p.x / DPR, ny = p.y / DPR;
      const leftOk = fits({ left: nx - 11 - estW, right: nx - 11, top: ny - 15, bottom: ny + 15 });
      const rightOk = fits({ left: nx + 11, right: nx + 11 + estW, top: ny - 15, bottom: ny + 15 });
      // primarily LEFT: take the first left-capable node (occasionally RIGHT when both have room)...
      if (leftOk) return { p: p, side: (rightOk && Math.random() < 0.28) ? "right" : "left" };
      // ...and only fall back to a RIGHT-only node when nothing can take a left label
      if (rightOk && !fallback) fallback = { p: p, side: "right" };
    }
    return fallback;
  };
  const positionChip = (chip) => {
    const nx = chip.p.x / DPR, ny = chip.p.y / DPR;
    if (!chip.w) chip.w = chip.el.offsetWidth || 0;               // measure the rendered pill once
    const vw = window.innerWidth;
    let left = chip.side === "right" ? nx + 11 : nx - 11;         // 11px gap on whichever side of the dot
    if (chip.side === "right") left = Math.max(4, Math.min(left, vw - 4 - chip.w)); // keep the label fully on-screen
    else left = Math.min(vw - 4, Math.max(left, chip.w + 4));
    chip.el.style.left = left + "px";
    chip.el.style.top = ny + "px";
  };
  const spawnChip = () => {
    const cap = nextCap(); if (!cap) return;
    // accurate label footprint per screen (smaller mono pill on mobile); the positionChip clamp
    // then guarantees the pill never spills off a viewport edge even if this estimate is tight.
    const estW = window.innerWidth < 760
      ? Math.min(190, String(cap).length * 6.2 + 16)
      : Math.min(250, String(cap).length * 7.2 + 22);
    const res = pickNode(estW); if (!res) return;
    const p = res.p;
    p.focusTarget = 1;
    const el = document.createElement("div");
    el.className = "node-chip" + (res.side === "right" ? " node-chip--r" : "");
    el.textContent = String(cap);
    chipLayer.appendChild(el);
    const chip = { p: p, el: el, born: performance.now(), state: "in", outAt: 0, side: res.side };
    positionChip(chip);
    requestAnimationFrame(() => el.classList.add("is-in"));
    chips.push(chip);
    recentPts.push({ x: p.x / DPR, y: p.y / DPR });
    if (recentPts.length > 5) recentPts.shift();
  };
  const updateChips = (now) => {
    // chips live on a viewport-FIXED layer while the page scrolls underneath, so a chip that spawned
    // clear ends up over other content once you scroll. Clear them the instant the page scrolls and
    // let them respawn once you settle back on the statement.
    if (Math.abs(window.scrollY - lastScrollY) > 1.5) {
      lastScrollY = window.scrollY;
      for (let i = chips.length - 1; i >= 0; i--) { chips[i].el.remove(); chips[i].p.focusTarget = 0; }
      chips.length = 0;
      nextSpawnAt = now + 350;
      return;
    }
    lastScrollY = window.scrollY;
    // On phones the centred statement + contact + marquee fill the width, leaving no clear space for a
    // label — so a chip could only ever sit ON content. Chips are a desktop delight; phones get the calm field.
    const maxChips = window.innerWidth < 760 ? 0 : 3;
    if (intensity > 0.34 && chips.length < maxChips && now >= nextSpawnAt) {
      spawnChip();
      nextSpawnAt = now + 820 + Math.random() * 520;
    }
    const dropping = intensity < 0.18;
    for (let i = chips.length - 1; i >= 0; i--) {
      const chip = chips[i];
      positionChip(chip);
      if (chip.state === "in" && (now - chip.born > 2600 || dropping)) {
        chip.state = "out"; chip.outAt = now;
        chip.el.classList.remove("is-in");
        chip.p.focusTarget = 0;
      } else if (chip.state === "out" && now - chip.outAt > 480) {
        chip.el.remove();
        chips.splice(i, 1);
      }
    }
  };

  const step = () => {
    if (!running) return;
    syncTheme();
    intensity += (targetIntensity() - intensity) * 0.07;
    ctx.clearRect(0, 0, W, H);

    const mx = mX * DPR, my = mY * DPR, near = 150 * DPR, near2 = near * near;
    const stmtY = statementCanvasY();
    const themeMul = curLight ? 1.4 : 1;

    // keep the ambient field OUT of the readable content so it never sits over the type and hurts
    // legibility (worst on the light theme). Cheap: a few rects, gathered once per frame.
    const avoid = [];
    document.querySelectorAll("#heroTitle, #contact, #workHeading, .hero__intro, .hero__label").forEach((e) => {
      const r = e.getBoundingClientRect();
      if (r.width > 1 && r.height > 1 && r.bottom > -24 && r.top < window.innerHeight + 24) {
        const m = e.id === "contact" ? 46 : 8; // keep the field WELL clear of the contact details (bigger halo)
        avoid.push({ x0: r.left - m, x1: r.right + m, y0: r.top - m, y1: r.bottom + m });
      }
    });
    const inAvoid = (cxp, cyp) => { const x = cxp / DPR, y = cyp / DPR; for (let k = 0; k < avoid.length; k++) { const a = avoid[k]; if (x > a.x0 && x < a.x1 && y > a.y0 && y < a.y1) return true; } return false; };

    // --- position + alpha pre-pass ---
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy;
      const dx = mx - p.x, dy = my - p.y;
      if (dx * dx + dy * dy < near2) { p.x += dx * 0.0006; p.y += dy * 0.0006; }
      if (p.x < -30) p.x = W + 30; else if (p.x > W + 30) p.x = -30;
      if (p.y < -30) p.y = H + 30; else if (p.y > H + 30) p.y = -30;

      const vis = clamp((intensity - p.birth) / 0.4, 0, 1);
      p.focus += ((p.focusTarget || 0) - p.focus) * 0.18;
      let a = p.baseA * (0.18 + 0.82 * vis);              // faint seed floor -> grows in
      if (stmtY >= 0) {                                    // concentrate around the statement band
        const band = clamp(1 - Math.abs(p.y - stmtY) / (H * 0.62), 0, 1);
        a *= 0.55 + 0.45 * band * intensity + 0.55 * (1 - intensity);
      }
      p.a = clamp(a * themeMul, 0, 0.8);
      if (inAvoid(p.x, p.y)) p.a = 0;      // never render the field over the readable text
    }

    // --- connection pass (behind the dots): the network wires up as it grows ---
    if (intensity > 0.1) {
      const ld = LINK(), ld2 = ld * ld;
      ctx.lineWidth = Math.max(1, DPR * 0.55);
      for (let i = 0; i < parts.length; i++) {
        const a = parts[i];
        if (a.a < 0.04) continue;
        for (let j = i + 1; j < parts.length; j++) {
          const b = parts[j];
          if (b.a < 0.04) continue;
          const dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 > ld2) continue;
          if (inAvoid((a.x + b.x) / 2, (a.y + b.y) / 2)) continue; // don't draw a line across the text
          const prox = 1 - Math.sqrt(d2) / ld;
          const la = prox * intensity * intensity * 0.34 * themeMul * (curLight ? 1.6 : 1);
          if (la < 0.02) continue;
          ctx.globalAlpha = Math.min(curLight ? 0.55 : 0.42, la);
          ctx.strokeStyle = (!curLight && (a.accent || b.accent)) ? ACCENT : IVORY;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }

    // --- dot pass: additive glow on dark; normal blend (dark marks) on light so it never washes out ---
    ctx.globalCompositeOperation = curLight ? "source-over" : "lighter";
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.a < 0.012 && p.focus < 0.02) continue;
      if (p.focus > 0.02) {
        // focused: a soft orb pulls into a single crisp bronze dot with a brief halo ring
        const rr = (2.6 + p.focus * 2.2) * DPR;
        ctx.globalAlpha = clamp(Math.max(p.a, 0.2) + p.focus * 0.6, 0, 1);
        ctx.fillStyle = ACCENT;
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = p.focus * 0.4;
        ctx.lineWidth = DPR;
        ctx.strokeStyle = ACCENT;
        ctx.beginPath(); ctx.arc(p.x, p.y, rr + 6 * DPR, 0, 6.2832); ctx.stroke();
      } else if (curLight || p.depth > 0.62) {
        // crisp small node. On LIGHT every particle is crisp (soft bokeh muddies into 'mould' on
        // cream) and the ambient web is cool slate; bronze stays reserved for the focused/chip nodes.
        ctx.globalAlpha = curLight ? Math.min(0.9, p.a * 1.3) : p.a;
        ctx.fillStyle = (p.accent && !curLight) ? ACCENT : IVORY;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, p.size * (p.depth > 0.62 ? 0.26 : 0.16)), 0, 6.2832); ctx.fill();
      } else {
        // dark, far: a soft bokeh orb
        ctx.globalAlpha = p.a;
        const g = p.accent ? glowAccent : glowIvory;
        const s = p.size;
        ctx.drawImage(g, p.x - s, p.y - s, s * 2, s * 2);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    updateChips(performance.now());

    // real-FPS self-disable (skipped when forced on for testing)
    f++;
    if (f === 30) sampleT0 = performance.now();
    else if (!force && !checked && f === 90) {
      checked = true;
      if (60000 / (performance.now() - sampleT0) < 34) { disable(); return; }
    }
    rafId = requestAnimationFrame(step);
  };

  const disable = () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    window.removeEventListener("resize", resize);
    for (let i = 0; i < chips.length; i++) chips[i].el.remove();
    chips = [];
    if (chipLayer.parentNode) chipLayer.remove();
    if (canvas.parentNode) canvas.remove();
  };

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("mousemove", (e) => { mX = e.clientX; mY = e.clientY; }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!canvas.parentNode) return;
    running = !document.hidden;
    if (running) { if (!rafId) rafId = requestAnimationFrame(step); }
    else if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  });

  resize();
  step();
  // debug/tuning handle
  window.__nodeWeb = { disable, parts: () => parts, get intensity() { return intensity; } };
}
