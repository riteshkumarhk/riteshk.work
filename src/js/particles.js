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
  const ACCENT = cssVar("--accent", "#D8A657");
  const IVORY = cssVar("--text", "#ECE7E1");
  const glowIvory = makeGlow(IVORY);
  const glowAccent = makeGlow(ACCENT);

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
  let chips = [], capPool = [], capIdx = 0, nextSpawnAt = 0;

  const lightTheme = () => root.getAttribute("data-appearance") === "light";

  const resize = () => {
    for (let i = 0; i < chips.length; i++) chips[i].el.remove();
    chips = [];
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
  // A candidate node lives in the statement's vertical halo, off the edges, and clear of the
  // statement text — so a chip never lands on the words.
  const pickNode = () => {
    const tr = titleRect();
    if (!tr) return null;
    const tcy = ((tr.top + tr.bottom) / 2) * DPR;
    const bandTop = tcy - H * 0.44, bandBot = tcy + H * 0.44;
    const clx0 = (tr.left - 26) * DPR, clx1 = (tr.right + 26) * DPR, cly0 = (tr.top - 16) * DPR, cly1 = (tr.bottom + 16) * DPR;
    const edge = 66 * DPR, cands = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.focusTarget) continue;
      if (p.y < bandTop || p.y > bandBot) continue;
      if (p.x < edge || p.x > W - edge) continue;
      if (p.x > clx0 && p.x < clx1 && p.y > cly0 && p.y < cly1) continue;
      cands.push(p);
    }
    return cands.length ? cands[(Math.random() * cands.length) | 0] : null;
  };
  const positionChip = (chip) => {
    chip.el.style.left = (chip.p.x / DPR) + "px";
    chip.el.style.top = (chip.p.y / DPR - 15) + "px";
  };
  const spawnChip = () => {
    const cap = nextCap(); if (!cap) return;
    const p = pickNode(); if (!p) return;
    p.focusTarget = 1;
    const el = document.createElement("div");
    el.className = "node-chip";
    el.innerHTML = '<span class="node-chip__dot"></span><span class="node-chip__t"></span>';
    el.querySelector(".node-chip__t").textContent = String(cap);
    chipLayer.appendChild(el);
    const chip = { p: p, el: el, born: performance.now(), state: "in", outAt: 0 };
    positionChip(chip);
    requestAnimationFrame(() => el.classList.add("is-in"));
    chips.push(chip);
  };
  const updateChips = (now) => {
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
        chips.splice(i, 1);
      }
    }
  };

  const step = () => {
    if (!running) return;
    intensity += (targetIntensity() - intensity) * 0.07;
    ctx.clearRect(0, 0, W, H);

    const mx = mX * DPR, my = mY * DPR, near = 150 * DPR, near2 = near * near;
    const stmtY = statementCanvasY();
    const themeMul = lightTheme() ? 1.8 : 1;

    // --- position + alpha pre-pass ---
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.x += p.vx; p.y += p.vy;
      const dx = mx - p.x, dy = my - p.y;
      if (dx * dx + dy * dy < near2) { p.x += dx * 0.0006; p.y += dy * 0.0006; }
      if (p.x < -30) p.x = W + 30; else if (p.x > W + 30) p.x = -30;
      if (p.y < -30) p.y = H + 30; else if (p.y > H + 30) p.y = -30;

      const vis = clamp((intensity - p.birth) / 0.4, 0, 1);
      p.focus += ((p.focusTarget || 0) - p.focus) * 0.14;
      let a = p.baseA * (0.18 + 0.82 * vis);              // faint seed floor -> grows in
      if (stmtY >= 0) {                                    // concentrate around the statement band
        const band = clamp(1 - Math.abs(p.y - stmtY) / (H * 0.62), 0, 1);
        a *= 0.55 + 0.45 * band * intensity + 0.55 * (1 - intensity);
      }
      p.a = clamp(a * themeMul, 0, 0.8);
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
          const la = prox * intensity * intensity * 0.34 * themeMul;
          if (la < 0.02) continue;
          ctx.globalAlpha = Math.min(0.42, la);
          ctx.strokeStyle = (a.accent || b.accent) ? ACCENT : IVORY;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }

    // --- dot pass (additive, so glows read as light on the dark) ---
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.a < 0.012 && p.focus < 0.02) continue;
      if (p.focus > 0.02) {
        // focused: a soft orb snaps into a crisp bronze vertex with a halo ring
        const rr = (2.2 + p.focus * 1.7) * DPR;
        ctx.globalAlpha = clamp(Math.max(p.a, 0.16) + p.focus * 0.55, 0, 1);
        ctx.fillStyle = ACCENT;
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = p.focus * 0.42;
        ctx.lineWidth = DPR;
        ctx.strokeStyle = ACCENT;
        ctx.beginPath(); ctx.arc(p.x, p.y, rr + 5 * DPR, 0, 6.2832); ctx.stroke();
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
