/* =================================================================
   NODE-WEB — a scroll-driven particle field that seeds through the page
   and grows into a connected, bokeh-depth network that gathers around the
   statement. Evolves the old ambient bg-field into the "capabilities moment".

   Perf: DPR-capped, pre-rendered glow sprites (fake bokeh, no per-frame blur),
   paused off-screen / tab-hidden, real-FPS self-disable. On software GPUs /
   low-power devices (bgCapable false) — or if the live FPS can't hold up — it
   degrades to a calm STATIC bokeh frame instead of a blank void (?nodes forces
   the full animated web on for testing).

   Interaction: capability chips fade in beside nodes that snap sharp (the
   "tip-tip" reveal, zone-weighted + collision-avoiding), and the cursor pulls
   the nearest soft orb into focus (a quiet focus-lens).
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
    IVORY = cssVar("--text", light ? "#1b1915" : "#ECE7E1");
    glowIvory = makeGlow(IVORY);
    glowAccent = makeGlow(ACCENT);
  };

  const canvas = document.createElement("canvas");
  canvas.className = "bg-field"; // reuse existing fixed / z-index:-1 / pointer-events:none rule
  canvas.setAttribute("aria-hidden", "true");
  document.body.insertBefore(canvas, document.body.firstChild);
  const ctx = canvas.getContext("2d");

  let W = 0, H = 0, DPR = 1, parts = [];
  let mX = -9999, mY = -9999, rafId = 0, running = true, frozen = false;
  let f = 0, sampleT0 = 0, checked = false;
  let intensity = 0; // 0 = ambient seeds .. 1 = full network (statement centred)
  let lensNode = null; // the soft orb currently pulled sharp by the cursor focus-lens

  // Calm STATIC fallback — a single still bokeh frame (no rAF, no chips). Used on software GPUs /
  // low-power devices, and when the live FPS can't sustain the animated web. The About page still
  // lists every capability, so this is a graceful degrade, not a loss of content.
  function renderStatic() {
    syncTheme();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    const vw = window.innerWidth, vh = window.innerHeight;
    W = canvas.width = Math.floor(vw * DPR);
    H = canvas.height = Math.floor(vh * DPR);
    canvas.style.width = vw + "px";
    canvas.style.height = vh + "px";
    ctx.clearRect(0, 0, W, H);
    // bias the halo toward the statement (or the viewport centre on other pages)
    let cy = 0.42;
    const heroEl = document.getElementById("wsec-hero");
    if (heroEl) { const r = heroEl.getBoundingClientRect(); if (r.height && r.top < vh && r.bottom > 0) cy = clamp((r.top + r.height / 2) / vh, 0.15, 0.85); }
    const n = Math.round(clamp(vw * vh / 28000, 22, 60));
    ctx.globalCompositeOperation = curLight ? "source-over" : "lighter";
    for (let i = 0; i < n; i++) {
      const depth = Math.random(), accent = Math.random() < 0.16;
      const x = Math.random() * W;
      const yb = cy + ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * 0.9;
      const y = clamp(yb, 0.02, 0.98) * H;
      ctx.globalAlpha = clamp((0.06 + depth * 0.16) * (curLight ? 1.5 : 1), 0, 0.55);
      if (depth < 0.62) {
        const s = (3 + (1 - depth) * 9) * DPR;
        ctx.drawImage(accent ? glowAccent : glowIvory, x - s, y - s, s * 2, s * 2);
      } else {
        ctx.fillStyle = accent ? ACCENT : IVORY;
        ctx.beginPath(); ctx.arc(x, y, Math.max(1, 2 * DPR), 0, 6.2832); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  // Software GPU / low-power (and not forced): render one calm still frame and stop — no animation.
  if (!force && !bgCapable()) {
    renderStatic();
    const reStatic = () => renderStatic();
    window.addEventListener("resize", reStatic, { passive: true });
    try { new MutationObserver(reStatic).observe(root, { attributes: true, attributeFilter: ["data-appearance"] }); } catch (e) {}
    window.__nodeWeb = { static: true, redraw: renderStatic };
    return;
  }

  // Capability chips — the "tip-tip" focus-pull reveal. A fixed DOM layer above the
  // content (styled in css); each chip fades in beside a node that has snapped crisp.
  const chipLayer = document.createElement("div");
  chipLayer.className = "node-chips";
  chipLayer.setAttribute("aria-hidden", "true");
  document.body.appendChild(chipLayer);
  let chips = [], capPool = [], capIdx = 0, nextSpawnAt = 0, lastScrollY = 0;

  const resize = () => {
    if (frozen) { renderStatic(); return; } // after an FPS freeze we only keep the still frame fresh
    for (let i = 0; i < chips.length; i++) chips[i].el.remove();
    chips = [];
    lensNode = null;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.width = Math.floor(window.innerWidth * DPR);
    H = canvas.height = Math.floor(window.innerHeight * DPR);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    const count = Math.round(clamp(window.innerWidth * window.innerHeight / 16000, 40, 140));
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
        a: 0, focus: 0, focusTarget: 0, chip: false, zf: 0,
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
  // --- energy zones (from the user's map): the STATEMENT + CONTACT form the PRIMARY column — densest
  //     nodes AND densest link structures — the band under the cards is SECONDARY, the footer is
  //     TERTIARY, all with a soft horizontal centre-bias so it reads as a centred constellation rather
  //     than a full-width wash. Boundaries come from the live element rects (CSS px). ---
  let curBands = null;
  const computeBands = () => {
    const R = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    const cs = R("#cases"), hero = R("#wsec-hero"), ct = R("#contact"), ft = R("footer, .footer");
    const vw = window.innerWidth, vh = window.innerHeight;
    const casesBottom = cs ? cs.bottom : -1e9;
    const primaryTop = hero ? hero.top : (ct ? ct.top : vh * 0.4);
    const primaryBottom = ct ? ct.bottom : (hero ? hero.bottom : vh * 0.7);
    const footerBottom = ft ? ft.bottom : primaryBottom + 200;
    const cx = hero ? (hero.left + hero.right) / 2 : vw / 2;
    return { casesBottom, primaryTop, primaryBottom, footerBottom, cx, vw };
  };
  // vertical weight: PRIMARY (1.0) across the statement+contact column, a modest SECONDARY band under
  // the cards, easing to TERTIARY through the footer; zero outside the spawn area. Kept clearly below
  // primary so the densest nodes/links/chips gather in the red column, not the empty band up top.
  const vWeight = (b, y) => {
    if (y < b.casesBottom - 30 || y > b.footerBottom + 14) return 0;
    if (y < b.primaryTop) return 0.42;             // SECONDARY: band under the cards (flat, modest)
    if (y <= b.primaryBottom) return 1;            // PRIMARY: statement + contact
    const t = (y - b.primaryBottom) / Math.max(1, b.footerBottom - b.primaryBottom);
    return clamp(0.5 - 0.24 * t, 0.26, 0.5);       // contact edge -> footer (TERTIARY)
  };
  // horizontal weight: 1 down the centre column, easing to ~0.34 at the far edges
  const hWeight = (b, x) => clamp(1 - Math.abs(x - b.cx) / (b.vw * 0.5) * 0.92, 0.34, 1);
  const zoneFactor = (b, x, y) => vWeight(b, y) * hWeight(b, x);

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
  const pickNode = (estW) => {
    if (!titleRect()) return null;
    // Chips ride the SAME zone map as the nodes/links: primarily the statement+contact column, some
    // in the band under the cards, sparse over the footer — weighted toward the primary centre.
    const b = curBands || computeBands();
    const cands = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.focusTarget || p.depth > 0.6) continue;         // only a soft orb gets pulled sharp
      if (p.x < 44 * DPR || p.x > W - 44 * DPR) continue;   // just off the extreme edges (label can take either side)
      const w = zoneFactor(b, p.x / DPR, p.y / DPR);
      if (w < 0.12) continue;
      cands.push({ p: p, key: Math.pow(Math.random(), 1 / w) }); // weighted-random order: higher zone weight spawns more often
    }
    cands.sort((a, b) => b.key - a.key);
    const existing = chips.map((c) => c.el.getBoundingClientRect());
    // every real content rect currently in view — the label keeps a clear 16px margin from all of them
    const occ = [];
    document.querySelectorAll(OCCUPIED).forEach((e) => {
      const r = e.getBoundingClientRect();
      if (r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth) occ.push(r);
    });
    const M = window.innerWidth < 760 ? 10 : 16; // tighter clearance on phones so a chip still fits
    const edge = window.innerWidth < 760 ? 4 : 6;
    const fits = (box) => {
      if (box.left < edge || box.right > window.innerWidth - edge) return false;
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
    chip.el.style.left = (chip.side === "right" ? nx + 11 : nx - 11) + "px"; // 11px gap on whichever side of the dot
    chip.el.style.top = ny + "px";
  };
  const spawnChip = () => {
    const cap = nextCap(); if (!cap) return;
    const mobile = window.innerWidth < 760;
    const estW = Math.min(mobile ? 188 : 250, String(cap).length * (mobile ? 6.4 : 7.2) + (mobile ? 16 : 22));
    const res = pickNode(estW); if (!res) return;
    const p = res.p;
    p.focusTarget = 1;
    p.chip = true; // claimed by a chip: the cursor-lens leaves it alone
    const el = document.createElement("div");
    el.className = "node-chip" + (res.side === "right" ? " node-chip--r" : "");
    el.textContent = String(cap);
    chipLayer.appendChild(el);
    const chip = { p: p, el: el, born: performance.now(), state: "in", outAt: 0, side: res.side };
    positionChip(chip);
    requestAnimationFrame(() => el.classList.add("is-in"));
    chips.push(chip);
  };
  const updateChips = (now) => {
    // The node-web is a FIXED layer: nodes don't scroll, but the page content does. So a label that
    // spawned in clear space ends up over a card/text once you scroll. Retire chips the instant the
    // page scrolls (they respawn once you settle back on the statement).
    const sy = window.scrollY || window.pageYOffset || 0;
    if (Math.abs(sy - lastScrollY) > 1.5) {
      lastScrollY = sy;
      for (let i = chips.length - 1; i >= 0; i--) { chips[i].el.remove(); chips[i].p.focusTarget = 0; chips[i].p.chip = false; }
      chips.length = 0;
      nextSpawnAt = now + 350; // let the scroll settle before revealing again
      return;
    }
    lastScrollY = sy;
    if (intensity > 0.34 && chips.length < (window.innerWidth < 760 ? 1 : 3) && now >= nextSpawnAt) {
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
        chip.p.chip = false;
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
    curBands = computeBands();
    const themeMul = curLight ? 1.4 : 1;

    // --- cursor focus-lens: the nearest soft orb under the pointer snaps sharp (a quiet, discoverable
    //     delight that reuses the same focus-pull the chips use). Chip-claimed orbs are left alone. ---
    if (mX > -9998) {
      const lr2 = (118 * DPR) * (118 * DPR);
      let best = null, bd = lr2;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.chip || p.depth > 0.6 || p.a < 0.03) continue;
        const dx = mx - p.x, dy = my - p.y, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = p; }
      }
      if (best !== lensNode) {
        if (lensNode && !lensNode.chip) lensNode.focusTarget = 0;
        lensNode = best;
      }
      if (lensNode) lensNode.focusTarget = 1;
    } else if (lensNode) {
      if (!lensNode.chip) lensNode.focusTarget = 0;
      lensNode = null;
    }

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
      // shape by the zone map when the statement is engaged; a flat, faint ambient field otherwise
      const zf = zoneFactor(curBands, p.x / DPR, p.y / DPR);
      p.zf = zf;
      a *= (0.32 + 0.68 * zf) * intensity + 0.6 * (1 - intensity);
      p.a = clamp(a * themeMul, 0, 0.85);
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
          const prox = 1 - Math.sqrt(d2) / ld;
          // denser, bolder links inside the primary column; they thin out toward the edges/footer
          const la = prox * intensity * intensity * 0.34 * themeMul * clamp((a.zf + b.zf) * 0.9, 0.28, 1.25);
          if (la < 0.02) continue;
          ctx.globalAlpha = Math.min(0.46, la);
          ctx.strokeStyle = (a.accent || b.accent) ? ACCENT : IVORY;
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
      } else if (p.depth > 0.62) {
        // near: a crisp small node (the network's vertices)
        ctx.globalAlpha = p.a;
        ctx.fillStyle = p.accent ? ACCENT : IVORY;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, p.size * 0.26), 0, 6.2832); ctx.fill();
      } else {
        // far: a soft bokeh orb
        ctx.globalAlpha = p.a;
        const g = p.accent ? glowAccent : glowIvory;
        const s = p.size;
        ctx.drawImage(g, p.x - s, p.y - s, s * 2, s * 2);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    updateChips(performance.now());

    // real-FPS self-disable (skipped when forced on for testing) — degrade to the calm still frame
    f++;
    if (f === 30) sampleT0 = performance.now();
    else if (!force && !checked && f === 90) {
      checked = true;
      if (60000 / (performance.now() - sampleT0) < 34) { freezeStatic(); return; }
    }
    rafId = requestAnimationFrame(step);
  };

  // Stop the animation but keep a tasteful still frame (chips + lens gone), instead of a blank void.
  const freezeStatic = () => {
    frozen = true;
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    window.removeEventListener("mousemove", onMove);
    for (let i = 0; i < chips.length; i++) chips[i].el.remove();
    chips = [];
    if (chipLayer.parentNode) chipLayer.remove();
    renderStatic();
  };

  const disable = () => {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    window.removeEventListener("resize", resize);
    window.removeEventListener("mousemove", onMove);
    for (let i = 0; i < chips.length; i++) chips[i].el.remove();
    chips = [];
    if (chipLayer.parentNode) chipLayer.remove();
    if (canvas.parentNode) canvas.remove();
  };

  const onMove = (e) => { mX = e.clientX; mY = e.clientY; };
  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("mousemove", onMove, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!canvas.parentNode || frozen) return;
    running = !document.hidden;
    if (running) { if (!rafId) rafId = requestAnimationFrame(step); }
    else if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  });

  resize();
  step();
  // debug/tuning handle
  window.__nodeWeb = { disable, parts: () => parts, get intensity() { return intensity; } };
}
