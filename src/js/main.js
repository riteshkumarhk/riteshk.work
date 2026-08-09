/* =================================================================
   RITESH KUMAR — Digital CV
   Micro-interactions & motion (vanilla, dependency-free)
   ================================================================= */
import { initDepth } from "./depth.js";

(function () {
  "use strict";

  /* Discourage casual media saving on the public site: swallow the right-click
     menu and drag-to-save on images / video / canvas — including project media
     rendered later (galleries, lightbox, focus). Deterrent only: DevTools and the
     network tab still expose the assets. Skipped inside the admin live-preview
     iframe (?preview) so the editor's right-hand preview keeps its native
     "Save image" / "Open image in new tab". */
  if (!new URLSearchParams(location.search).has("preview")) {
    document.documentElement.classList.add("no-mediasave");
    var isMedia = function (t) { return !!(t && t.closest && t.closest("img, picture, source, video, canvas")); };
    document.addEventListener("contextmenu", function (e) { if (isMedia(e.target)) e.preventDefault(); });
    document.addEventListener("dragstart", function (e) { if (isMedia(e.target)) e.preventDefault(); });
  }

  function initInteractions() {
  try { if (window.__rkTrack) window.__rkTrack("pageview"); } catch (e) {}
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isTouch = window.matchMedia("(pointer: coarse)").matches;

  /* Performance "lite" mode is now OPT-IN via ?lite (default = full experience).
     Auto-detection was removed: a software-rendered dev box (Cloud PC / DevBox)
     should still show the full design — the lag there is the missing GPU, not the
     code, and real visitors on real hardware get it smooth. */
  const lite = new URLSearchParams(location.search).has("lite");
  if (lite) document.documentElement.classList.add("lite");

  /* -------------------------------------------------
     0. Smooth (fluid) scrolling - Lenis
  ------------------------------------------------- */
  let lenis = null;
  if (!lite && typeof Lenis !== "undefined") {
    lenis = new Lenis({
      duration: 1.05,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.6,
      // Let modals/lightboxes scroll natively — Lenis otherwise preventDefaults
      // the wheel globally, so nested scroll areas (e.g. the "add a section"
      // picker) show a scrollbar but never move.
      prevent: (node) => !!(node && node.closest && node.closest(".pass, .pjx")),
    });
    const raf = (time) => { lenis.raf(time); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  // Expose the Lenis instance so the project overlay can pause/resume page scroll.
  window.__lenis = lenis;

  const smoothTo = (target) => {
    if (lenis) lenis.scrollTo(target, { offset: 0, duration: 1.2 });
    else target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  };

  // Smooth-scroll for in-page anchor links (menu links handled separately)
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    if (a.closest("#menu")) return;
    a.addEventListener("click", (e) => {
      const hash = a.getAttribute("href");
      if (!hash || hash.length < 2) return;
      const target = document.querySelector(hash);
      if (!target) return;
      e.preventDefault();
      smoothTo(target);
    });
  });

  /* -------------------------------------------------
     1. Custom cursor (dot + ring with easing)
  ------------------------------------------------- */
  if (!isTouch && !lite) {
    const cursor = document.querySelector(".cursor");
    const dot = document.querySelector(".cursor__dot");
    const ring = document.querySelector(".cursor__ring");

    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let rx = mx, ry = my;

    // Inject a label used by the "view" state
    const label = document.createElement("span");
    label.className = "cursor__label";
    label.textContent = "View";
    cursor.appendChild(label);

    window.addEventListener("mousemove", (e) => {
      mx = e.clientX; my = e.clientY;
      dot.style.left = mx + "px";
      dot.style.top = my + "px";
      label.style.left = mx + "px";
      label.style.top = my + "px";
    });

    (function loop() {
      rx += (mx - rx) * 0.15;
      ry += (my - ry) * 0.15;
      ring.style.left = rx + "px";
      ring.style.top = ry + "px";
      requestAnimationFrame(loop);
    })();

    // Hover / view states — delegated on the document so it also covers the
    // work cards & contact pills that render asynchronously from content.json.
    document.addEventListener("mouseover", (e) => {
      const el = e.target.closest && e.target.closest("[data-cursor], a, button");
      if (el) {
        const view = el.getAttribute("data-cursor") === "view";
        cursor.classList.toggle("is-view", view);
        cursor.classList.toggle("is-hover", !view);
      } else {
        cursor.classList.remove("is-hover", "is-view");
      }
    });

    document.addEventListener("mouseleave", () => (dot.style.opacity = ring.style.opacity = "0"));
    document.addEventListener("mouseenter", () => (dot.style.opacity = ring.style.opacity = "1"));
  }

  /* -------------------------------------------------
     2. Scroll reveal (IntersectionObserver)
  ------------------------------------------------- */
  const reveals = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    reveals.forEach((el) => io.observe(el));

    // Stagger index for grouped children (capabilities, tags)
    document.querySelectorAll(".caps__list, .cases").forEach((group) => {
      [...group.children].forEach((child, i) => child.style.setProperty("--i", i));
    });
  } else {
    reveals.forEach((el) => el.classList.add("is-in"));
  }

  /* -------------------------------------------------
     3. Hero line reveal on load
  ------------------------------------------------- */
  (function heroReveal() {
    const lines = document.querySelectorAll(".hero__title .line");
    lines.forEach((line, i) => {
      setTimeout(() => line.classList.add("is-in"), 150 + i * 110);
    });
  })();

  /* -------------------------------------------------
     4. Count-up numbers — each .count animates once, the first time it is
     60% on screen. observeCounts() is re-run by the highlights marquee after
     it repeats the chips, so every chip counts up on its first pass and then
     holds (no re-counting once it is simply looping).
  ------------------------------------------------- */
  let observeCounts = function () {};
  if ("IntersectionObserver" in window) {
    const cio = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          const target = parseInt(el.dataset.count, 10);
          const dur = 1400;
          const start = performance.now();
          (function tick(now) {
            const p = Math.min((now - start) / dur, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            el.textContent = Math.round(eased * target);
            if (p < 1) requestAnimationFrame(tick);
          })(start);
          cio.unobserve(el);
        });
      },
      { threshold: 0.6 }
    );
    observeCounts = function (root) {
      (root || document).querySelectorAll(".count").forEach((el) => cio.observe(el));
    };
  }

  /* -------------------------------------------------
     5. Live clock — Asia/Kolkata
  ------------------------------------------------- */
  const clock = document.getElementById("clock");
  if (clock) {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
    });
    const update = () => (clock.textContent = fmt.format(new Date()));
    update();
    setInterval(update, 15000);
  }

  /* -------------------------------------------------
     6. Nav: scrolled bg, hide on scroll-down + progress
  ------------------------------------------------- */
  const nav = document.getElementById("nav");
  const progress = document.querySelector(".scroll-progress span");
  let lastY = window.scrollY;

  // Work thumbnails drift vertically as they scroll. render.js writes each card's amount and
  // direction as data-par / data-par-max (from the studio control, or the default up / 50 the
  // editor shows), so the homepage motion always matches exactly what the studio shows.
  const parLite = document.documentElement.classList.contains("lite");
  const updateParallax = () => {
    if (parLite) return;
    const pars = document.querySelectorAll(".case__par");
    const vh = window.innerHeight;
    for (let i = 0; i < pars.length; i++) {
      const r = pars[i].getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) continue; // skip offscreen
      const h = r.height;
      const t = (r.top + h / 2 - vh / 2) / vh;            // 0 when centred in the viewport
      const ds = pars[i].dataset;
      const factor = (ds.par !== undefined && ds.par !== "") ? (parseFloat(ds.par) || 0) : 0.12;   // default = up / 50
      const maxFrac = (ds.parMax !== undefined && ds.parMax !== "") ? (parseFloat(ds.parMax) || 0.08) : 0.08;
      if (!factor) { pars[i].style.transform = "translate3d(0,0,0)"; continue; } // intensity 0 = static
      let yv = t * h * factor;
      const max = h * maxFrac;                            // stay within the 20% headroom
      if (yv > max) yv = max; else if (yv < -max) yv = -max;
      pars[i].style.transform = "translate3d(0," + yv.toFixed(1) + "px,0)";
    }
  };

  const onScroll = () => {
    const y = window.scrollY;

    nav.classList.toggle("is-scrolled", y > 40);

    if (y > lastY && y > 400 && !nav.classList.contains("is-open")) {
      nav.classList.add("is-hidden");
    } else {
      nav.classList.remove("is-hidden");
    }
    lastY = y;

    if (progress) {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    }

    updateParallax();
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  if (lenis) lenis.on("scroll", onScroll);
  onScroll();
  window.addEventListener("resize", updateParallax, { passive: true });

  /* -------------------------------------------------
     6b. Marquee engine — continuous scroll where each chip springs in from the
     entering edge and fades out via the CSS edge mask on the far edge. Drives
     BOTH the brand/product logos (right-to-left, elastic) and the highlights
     numbers (left-to-right, softer scale-in + count-up on first pass).
  ------------------------------------------------- */
  function marquee(vp, track, opts) {
    if (!vp || !track) return;
    opts = opts || {};
    const speed = opts.speed || 46;                    // px/s
    const dir = opts.dir === -1 ? -1 : 1;              // 1 = right-to-left (logos), -1 = left-to-right (numbers)
    const popMin = opts.popMin != null ? opts.popMin : 0.92;   // entrance start scale - a subtle grow to 100% (higher = subtler)
    const popRange = 1 - popMin;
    const ease = (p) => 1 - Math.pow(1 - p, 3);        // smooth ease-out, no elastic overshoot
    const onBuild = typeof opts.onBuild === "function" ? opts.onBuild : null;
    let off = 0, setW = 0, last = 0, paused = false, running = false, raf = 0, onScreen = true;
    let baseHTML = "", baseCount = 0, rz = 0;
    let geo = [], W = 0, entry = 0, zone = 1, lastW = -1;            // geometry cached once — the loop never reads layout
    const mo = new MutationObserver(onSource);
    // render.js drops ONE set of chips in the track; repeat it enough to always
    // exceed the marquee's width so the loop never runs out (no empty gap).
    function onSource() { baseHTML = track.innerHTML; baseCount = track.children.length; fill(); }
    function measure() {
      // Cache each card's static offset once, so the animation is pure arithmetic (no layout
      // thrashing) — that's what keeps it smooth on phones while the page scrolls.
      W = vp.clientWidth || 0; lastW = W;
      geo = [];
      const kids = track.children;
      for (let i = 0; i < kids.length; i++) geo.push({ left: kids[i].offsetLeft, w: kids[i].offsetWidth, card: kids[i].firstElementChild });
    }
    function fill() {
      stop();
      if (!baseCount) { setW = 0; track.style.transform = ""; return; }
      mo.disconnect();                                   // our own edits mustn't retrigger onSource
      track.innerHTML = baseHTML;                        // one set, to measure it
      const oneW = track.scrollWidth || 1;
      let copies = Math.ceil(((vp.clientWidth || 0) + oneW) / oneW);
      if (copies < 2) copies = 2; else if (copies > 20) copies = 20;
      track.innerHTML = baseHTML.repeat(copies);
      mo.observe(track, { childList: true });
      setW = track.children[baseCount] ? track.children[baseCount].offsetLeft : oneW;
      off = 0; last = 0;
      measure();                                         // cache offsets + width once per (re)build
      if (onBuild) onBuild(track);                       // e.g. wire count-up onto the repeated chips
      if (setW > 0 && onScreen) start();
    }
    function step(ts) {
      if (!running) return;
      if (!last) last = ts;
      const dt = Math.min(0.05, (ts - last) / 1000); last = ts;
      if (!paused && setW > 0) {
        off += dir * dt * speed;                         // dir 1 = right-to-left, -1 = left-to-right
        if (off >= setW) off -= setW; else if (off < 0) off += setW;
        track.style.transform = "translate3d(" + (-off) + "px,0,0)";
      }
      for (let i = 0; i < geo.length; i++) {             // analytic positions — zero per-frame layout reads
        const g = geo[i]; if (!g.card) continue;
        const half = g.w / 2;
        const cx = g.left + half - off;                  // card centre in viewport coords (0..W)
        // Elastic entry tied to each card's OWN entry: it stays small until it is ~half in, then grows
        // over the SECOND HALF of its entry so it is fully grown exactly as it finishes entering. Cards
        // that are off-stage or fully in clamp to small / full, so there is no stale-scale snap.
        let p = dir === 1 ? (W - cx) / half : cx / half;
        if (p < 0) p = 0; else if (p > 1) p = 1;
        g.card.style.transform = "scale(" + (popMin + popRange * ease(p)).toFixed(3) + ")";
      }
      raf = requestAnimationFrame(step);
    }
    function start() { if (running || setW <= 0 || !onScreen) return; running = true; last = 0; raf = requestAnimationFrame(step); }
    function stop() { running = false; if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    vp.addEventListener("mouseenter", () => { paused = true; });   // pause so a name / number is readable
    vp.addEventListener("mouseleave", () => { paused = false; });
    // Rebuild only on a WIDTH change. Mobile browsers fire resize on EVERY vertical scroll (URL bar
    // show/hide); rebuilding then swaps the scroll-anchor node and bounces the page back to a chip.
    window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(function () { if (vp.clientWidth !== lastW) fill(); }, 180); }, { passive: true });
    // Only animate while the marquee is on screen — no wasted work (or scroll jank) once it's scrolled past.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; if (onScreen) start(); else stop(); }, { rootMargin: "150px 0px" }).observe(vp);
    }
    mo.observe(track, { childList: true });
    onSource();                                          // render already populated the track
  }

  // Brands & products — right-to-left, subtle smooth scale-in (no elastic overshoot).
  marquee(document.getElementById("logoMarquee"), document.getElementById("logoTrack"), {});

  // Highlights numbers — left-to-right, softer scale-in. Count up on the first pass,
  // then hold: a later width-change rebuild just restores the final values (no re-count).
  (function () {
    let counted = false;
    marquee(document.getElementById("hiMarquee"), document.getElementById("hiTrack"), {
      dir: -1,
      onBuild: function (track) {
        if (counted) { track.querySelectorAll(".count").forEach((el) => { el.textContent = el.dataset.count; }); }
        else { counted = true; observeCounts(track); }
      }
    });
  })();

  /* -------------------------------------------------
     7. Mobile menu
  ------------------------------------------------- */
  const toggle = document.getElementById("navToggle");
  const menu = document.getElementById("menu");
  if (toggle && menu) {
    const setMenu = (open) => {
      nav.classList.toggle("is-open", open);
      menu.classList.toggle("is-open", open);
      menu.setAttribute("aria-hidden", String(!open));
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      document.body.style.overflow = open ? "hidden" : "";
      if (lenis) { open ? lenis.stop() : lenis.start(); }
    };
    toggle.addEventListener("click", () => setMenu(!menu.classList.contains("is-open")));
    menu.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", (e) => {
        const hash = a.getAttribute("href");
        setMenu(false);
        if (hash && hash.startsWith("#") && hash.length > 1) {
          const target = document.querySelector(hash);
          if (target) { e.preventDefault(); requestAnimationFrame(() => smoothTo(target)); }
        }
      })
    );
    window.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });
  }

  /* -------------------------------------------------
     7b. Page routing — Work / About as distinct views
     Client-side switch between the two page wrappers. Real paths
     ("/", "/about") via the History API; a direct /about load is
     served by the 404 SPA fallback as /?view=about (see 404.html),
     which we then tidy back to /about. The case-study overlay
     (project.js) owns /work/<id> and is left untouched.
  ------------------------------------------------- */
  (function pageRouter() {
    const pages = [...document.querySelectorAll("[data-page]")];
    if (pages.length < 2) return;
    const pageEl = (name) => pages.find((p) => p.getAttribute("data-page") === name);
    const navLinks = [...document.querySelectorAll("[data-page-link]")];
    const titles = {
      work: "Ritesh Kumar — Product Design Leadership",
      about: "About — Ritesh Kumar",
    };

    const fromLocation = () => {
      const p = new URLSearchParams(location.search);
      if (p.get("view") === "about") return "about";
      if (/^\/about\/?$/i.test(location.pathname)) return "about";
      return "work";
    };

    // Reveal the [data-reveal] elements already in view on the freshly-shown page
    // (the IntersectionObserver handles the rest as the user scrolls). Also re-runs
    // the hero line-reveal when landing back on Work.
    const revealShown = (root) => {
      const vh = window.innerHeight || 800;
      root.querySelectorAll("[data-reveal]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < vh * 0.92) el.classList.add("is-in");
      });
    };

    let active = null;
    function showPage(name, opts) {
      opts = opts || {};
      if (name !== "work" && name !== "about") name = "work";
      if (name === active && !opts.force) return;
      active = name;
      pages.forEach((pg) => {
        const on = pg.getAttribute("data-page") === name;
        pg.hidden = !on;
        pg.classList.toggle("is-active", on);
      });
      navLinks.forEach((a) => {
        a.classList.toggle("is-current", a.getAttribute("data-page-link") === name);
      });
      document.title = titles[name] || document.title;
      if (opts.scroll !== false) {
        if (lenis) lenis.scrollTo(0, { immediate: true });
        else window.scrollTo(0, 0);
      }
      const shown = pageEl(name);
      if (shown) requestAnimationFrame(() => revealShown(shown));
      if (opts.push) {
        try { history.pushState({ rkPage: name }, "", name === "about" ? "/about" : "/"); } catch (e) {}
      }
      onScroll(); // refresh nav scrolled/hidden + progress for the new page height
    }
    window.__rkShowPage = showPage;

    navLinks.forEach((a) => {
      a.addEventListener("click", (e) => {
        const name = a.getAttribute("data-page-link");
        if (name !== "work" && name !== "about") return;
        e.preventDefault();
        showPage(name, { push: true });
      });
    });

    window.addEventListener("popstate", () => {
      // The case-study overlay owns /work/<id>; project.js handles that popstate.
      if (/^\/work\//i.test(location.pathname)) return;
      showPage(fromLocation(), { push: false });
    });

    // Initial view: resolve from ?view / path, then tidy /?view=about → /about.
    const initial = fromLocation();
    if (new URLSearchParams(location.search).get("view") === "about") {
      try { history.replaceState({ rkPage: "about" }, "", "/about"); } catch (e) {}
    }
    showPage(initial, { push: false, scroll: false, force: true });
  })();

  /* -------------------------------------------------
     8. Magnetic elements (subtle pull toward cursor)
  ------------------------------------------------- */
  if (!isTouch && !lite) {
    document.querySelectorAll("[data-magnetic]").forEach((el) => {
      const strength = 0.25;
      el.addEventListener("mousemove", (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - (r.left + r.width / 2)) * strength;
        const y = (e.clientY - (r.top + r.height / 2)) * strength;
        el.style.transform = `translate(${x}px, ${y}px)`;
      });
      el.addEventListener("mouseleave", () => (el.style.transform = ""));
    });
  }

  /* -------------------------------------------------
     9. Footer year
  ------------------------------------------------- */
  const year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  /* -------------------------------------------------
     10. Ambient background particle field — auto-off on low-power / software GPUs
  ------------------------------------------------- */
  const bgCapable = () => {
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
  };
  if (!lite && bgCapable()) {
    const canvas = document.createElement("canvas");
    canvas.className = "bg-field";
    canvas.setAttribute("aria-hidden", "true");
    document.body.insertBefore(canvas, document.body.firstChild);
    const ctx = canvas.getContext("2d");
    let W = 0, H = 0, DPR = 1, parts = [], mX = -9999, mY = -9999, rafId = 0, running = true, f = 0, sampleT0 = 0, checked = false;
    const accent = () => (getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#D8A657");
    const resize = () => {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.width = Math.floor(window.innerWidth * DPR);
      H = canvas.height = Math.floor(window.innerHeight * DPR);
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      const count = Math.max(18, Math.min(70, Math.round(window.innerWidth * window.innerHeight / 26000)));
      parts = new Array(count).fill(0).map(() => ({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.12 * DPR, vy: (Math.random() - 0.5) * 0.12 * DPR,
        r: (Math.random() * 1.3 + 0.5) * DPR, a: Math.random() * 0.32 + 0.05,
      }));
    };
    const step = () => {
      if (!running) return;
      ctx.clearRect(0, 0, W, H);
      const col = accent(), mx = mX * DPR, my = mY * DPR, near = 150 * DPR;
      const aMul = document.documentElement.getAttribute("data-appearance") === "light" ? 2.1 : 1; // dark-gold on cream needs more presence than bronze on black
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.x += p.vx; p.y += p.vy;
        const dx = mx - p.x, dy = my - p.y;
        if (dx * dx + dy * dy < near * near) { p.x += dx * 0.0009; p.y += dy * 0.0009; }
        if (p.x < 0) p.x += W; else if (p.x > W) p.x -= W;
        if (p.y < 0) p.y += H; else if (p.y > H) p.y -= H;
        ctx.globalAlpha = Math.min(0.62, p.a * aMul); ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
      // Measure real FPS over a warm window; if the device can't keep up, switch the field off.
      f++;
      if (f === 30) sampleT0 = performance.now();
      else if (!checked && f === 90) { checked = true; if ((60000 / (performance.now() - sampleT0)) < 38) { disableBg(); return; } }
      rafId = requestAnimationFrame(step);
    };
    const disableBg = () => { running = false; if (rafId) cancelAnimationFrame(rafId); rafId = 0; window.removeEventListener("resize", resize); if (canvas.parentNode) canvas.remove(); };
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("mousemove", (e) => { mX = e.clientX; mY = e.clientY; }, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (!canvas.parentNode) return;
      running = !document.hidden;
      if (running) { f = 0; checked = false; sampleT0 = 0; if (!rafId) rafId = requestAnimationFrame(step); }  // re-measure fresh after returning
      else if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    });
    resize(); step();
  }

  // Cursor-driven depth on covers that have a depth map (progressive; GPU + WebGL2 gated,
  // otherwise the static image + scroll parallax remain). See src/js/depth.js.
  initDepth();
  } // end initInteractions

  if (window.__siteRendered) initInteractions();
  else document.addEventListener("site:rendered", initInteractions, { once: true });
})();
