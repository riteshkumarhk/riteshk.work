/* =================================================================
   RITESH KUMAR — Digital CV
   Micro-interactions & motion (vanilla, dependency-free)
   ================================================================= */
import { initDepth } from "./depth.js";
import { initNodeWeb } from "./particles.js";

(function () {
  "use strict";

  /* Preserve the scroll position across reloads ourselves: the site renders its content
     asynchronously (and can reorder sections), which defeats the browser's built-in "auto"
     scroll restoration, so a refresh could land you mid-page. Take manual control, remember
     the position per page on the way out, and restore it once the content is on screen. */
  try { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; } catch (e) {}
  var RK_SCROLL_KEY = "rk:scrollY:";
  function rkSaveScroll() {
    try { sessionStorage.setItem(RK_SCROLL_KEY + location.pathname, String(Math.round(window.scrollY || window.pageYOffset || 0))); } catch (e) {}
  }
  addEventListener("pagehide", rkSaveScroll);
  addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") rkSaveScroll(); });

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

  const smoothTo = (target, offset = 0) => {
    if (lenis) lenis.scrollTo(target, { offset, duration: 1.2 });
    else {
      const y = target.getBoundingClientRect().top + window.scrollY + offset;
      window.scrollTo({ top: y, behavior: reduceMotion ? "auto" : "smooth" });
    }
  };

  // The hero "Selected work" cue tucks the brand marquee up behind the nav and lands on the
  // stat highlights (which flow into the work section). Land the stat chips just below the nav,
  // with a gap of HALF the horizontal space between the chips, for a tight, deliberate seam.
  // Scroll so an element's top sits just below the nav. The nav compacts (smaller padding)
  // once scrolled and WILL be scrolled at the landing, so measure THAT compact height without
  // animating or committing the class: kill the transition, toggle is-scrolled on, read the
  // height, toggle back, restore -- all before the next paint (no visual flicker).
  const scrollBelowNav = (el, gap) => {
    const nav = document.getElementById("nav");
    let navH = 60;
    if (nav) {
      const inline = nav.style.transition;
      const wasScrolled = nav.classList.contains("is-scrolled");
      nav.style.transition = "none";
      nav.classList.add("is-scrolled");
      navH = nav.offsetHeight;
      if (!wasScrolled) nav.classList.remove("is-scrolled");
      nav.style.transition = inline;
    }
    const topDoc = el.getBoundingClientRect().top + window.scrollY;
    const y = Math.max(0, Math.round(topDoc - navH - (gap || 0)));
    if (lenis) lenis.scrollTo(y, { duration: 1.2 });
    else window.scrollTo({ top: y, behavior: reduceMotion ? "auto" : "smooth" });
  };

  // Smooth-scroll for in-page anchor links (menu links handled separately)
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    if (a.closest("#menu")) return;
    a.addEventListener("click", (e) => {
      const hash = a.getAttribute("href");
      if (!hash || hash.length < 2) return;
      // The hero "Selected work" cue lands right where the Selected Work section starts,
      // just below the nav (scrolling past both marquees).
      if (a.classList.contains("hero__cue") || a.classList.contains("workcue")) {
        const work = document.querySelector("#work");
        if (work) { e.preventDefault(); scrollBelowNav(work); return; }
      }
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

  // Marquee chip chrome fades in as the second (stats) marquee scrolls into view: in the
  // hero (only the brand marquee showing) the chips are invisible — just the floating logos
  // and numbers — then they fade to full by the time both marquees sit in view. Scroll-linked
  // via a --chrome (0..1) custom prop the card backgrounds/borders read through color-mix.
  const updateMarqueeChrome = () => {
    const logosEl = document.querySelector(".logos");
    const himarqEl = document.querySelector(".himarq");
    if (!logosEl || !himarqEl || himarqEl.hidden) return;
    const vh = window.innerHeight;
    const top = himarqEl.getBoundingClientRect().top;
    let p = (vh - top) / (vh * 0.55);   // 0 as m2's top touches the fold, 1 after ~0.55vh of scroll
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    const v = p.toFixed(3);
    logosEl.style.setProperty("--chrome", v);
    himarqEl.style.setProperty("--chrome", v);
  };

  // "Jump to work" bait (fixed bottom-right): visible only while the work tiles are still below the
  // fold, so on tall desktops / phones where the grid is already on screen at load it never appears.
  const workCueEl = document.querySelector(".workcue");
  const updateWorkCue = () => {
    if (!workCueEl) return;
    const RK = window.RK;
    const enabled = !(RK && RK.data && RK.data.landing && RK.data.landing.show && RK.data.landing.show.cue === false);
    const cases = document.getElementById("cases");
    const wsec = document.getElementById("wsec-work");
    let show = false;
    if (enabled && cases && cases.children.length && !(wsec && wsec.hidden)) {
      const r = cases.getBoundingClientRect();
      show = r.top > window.innerHeight - 60; // tiles still below the fold
    }
    workCueEl.classList.toggle("is-in", show);
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
    updateMarqueeChrome();
    updateWorkCue();
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  if (lenis) lenis.on("scroll", onScroll);
  onScroll();
  window.addEventListener("resize", () => { updateParallax(); updateMarqueeChrome(); updateWorkCue(); }, { passive: true });

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
    // Fractional set stride (getBoundingClientRect delta is sub-pixel + transform-invariant, unlike
    // the integer offsetLeft) so the wrap lands EXACTLY on a repeat and never micro-jumps.
    function computeSetW() {
      const a = track.children[0], b = track.children[baseCount];
      if (!a || !b) return 0;
      return (b.getBoundingClientRect().left - a.getBoundingClientRect().left) || 0;
    }
    // Refresh the cached geometry WITHOUT resetting the scroll position (off) - used when the track
    // reflows after build (fonts loading, counts settling) so the loop seam stays exact.
    function remeasure() {
      if (!baseCount || !track.children[baseCount]) return;
      const s = computeSetW();
      if (s > 0) setW = s;
      measure();
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
      setW = computeSetW() || oneW;
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
    // Cached geometry can go stale when the track reflows AFTER build - e.g. web fonts finishing
    // loading (the big numbers shift; bigger on desktop = a bigger jump) or the count-up settling.
    // That made the loop seam (the first chip) jerk every cycle. Refresh on any track resize + once
    // fonts land, without resetting the scroll position.
    if ("ResizeObserver" in window) {
      let rmz = 0;
      new ResizeObserver(function () { clearTimeout(rmz); rmz = setTimeout(remeasure, 120); }).observe(track);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { remeasure(); });
    mo.observe(track, { childList: true });
    onSource();                                          // render already populated the track
  }

  // Brands & products — right-to-left, subtle smooth scale-in (no elastic overshoot).
  marquee(document.getElementById("logoMarquee"), document.getElementById("logoTrack"), {
    // onBuild re-points the hover lift at the fresh .logo chips after the track (re)builds, so the
    // brand/product strip lifts on hover exactly like the At-a-glance numbers (same ltCollectCards).
    onBuild: function () { ltCollectCards(); }
  });

  // Highlights numbers — left-to-right, softer scale-in. Count up on the first pass,
  // then hold: a later width-change rebuild just restores the final values (no re-count).
  (function () {
    let counted = false;
    marquee(document.getElementById("hiMarquee"), document.getElementById("hiTrack"), {
      dir: -1,
      onBuild: function (track) {
        if (counted) { track.querySelectorAll(".count").forEach((el) => { el.textContent = el.dataset.count; }); }
        else { counted = true; observeCounts(track); }
        // The track was just (re)built with fresh .hi chips — re-point the living-type card lift at
        // them so the highlight chips actually rise on hover (they otherwise lift detached nodes).
        ltCollectCards();
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
      work: "Ritesh Kumar — Product Design Lead",
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
      // The big "Let's build" contact headline is landing-clutter on Work -- keep it for About only.
      const contactEl = document.getElementById("contact");
      if (contactEl) contactEl.classList.toggle("contact--nohead", name === "work");
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

    // Deep-link helper: jump to the Capabilities section on the About page (used by the hero
    // "View all capabilities" CTA and by clicking a capability chip in the node-web).
    function goToCapabilities() {
      showPage("about", { push: true, scroll: false });
      requestAnimationFrame(function () {
        const el = document.getElementById("sec-capabilities");
        if (!el) return;
        if (lenis) lenis.scrollTo(el, { offset: -24 });
        else el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    window.__rkGoCapabilities = goToCapabilities;
    // The CTA stays hidden until a capability chip is clicked; the chip reveals it, then it deep-links.
    function revealCapsCta() {
      const el = document.getElementById("heroCapsCta");
      if (!el || el.classList.contains("is-revealed")) return;
      el.classList.add("is-shown");
      requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add("is-revealed"); }); });
    }
    window.__rkRevealCapsCta = revealCapsCta;
    const capsCta = document.getElementById("heroCapsCta");
    if (capsCta) capsCta.addEventListener("click", function (e) { e.preventDefault(); goToCapabilities(); });

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
    // Restore where you were before the reload (saved by rkSaveScroll on the way out); the
    // browser's own restore can't, since our content renders after load. No saved value = top.
    function rkRestoreScroll() {
      if (location.hash && location.hash.length > 1) return; // let an in-page anchor win
      var y = 0;
      try { y = parseInt(sessionStorage.getItem(RK_SCROLL_KEY + location.pathname), 10) || 0; } catch (e) {}
      var apply = function () { if (lenis) lenis.scrollTo(y, { immediate: true }); else window.scrollTo(0, y); };
      apply();
      requestAnimationFrame(function () {
        apply();
        var vh = window.innerHeight || 800;
        document.querySelectorAll(".page.is-active [data-reveal]").forEach(function (el) {
          if (el.getBoundingClientRect().top < vh * 0.92) el.classList.add("is-in");
        });
      });
    }
    showPage(initial, { push: false, scroll: false, force: true });
    rkRestoreScroll();
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
  if (ltCfg().nodes !== false) initNodeWeb({
    lite: lite,
    force: new URLSearchParams(location.search).has("nodes"),
    getData: function () { return (window.RK && window.RK.data) || null; },
  });

  } // end initInteractions

  /* -------------------------------------------------
     Living type — cursor-reactive variable weight on the statement (#workHeading)
     + an ambient "whisper of work" layer behind the visual-top hero. Config from
     data.heroMotion (defaults below); prototyped in lab/hero.html. The node-web
     constellation (particles.js, anchored lower at #wsec-hero) is left untouched.
  ------------------------------------------------- */
  var LT_DEF = { on: true, field: "word", radius: 190, peak: 660, base: 350, lift: 7, breath: 24, ambient: "aurora", ambientAmt: 0.55, nodes: true, scope: "heading" };
  var LT = { units: [], cards: [], cfg: LT_DEF, mx: window.innerWidth / 2, my: window.innerHeight * 0.4, pointer: false, frame: 0, started: false };
  var LT_GENTLE_RANGE = 150;   // weight a small-text (mono/sans) unit can gain above its resting weight
  var LT_HOVER = matchMedia("(hover: hover) and (pointer: fine)").matches;
  var LT_TOUCH = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
  var LT_REACT = LT_HOVER || LT_TOUCH; // desktop hover OR a resting/swiping finger drives the letters
  var LT_PREVIEW = new URLSearchParams(location.search).has("preview");
  function ltLite() { return document.documentElement.classList.contains("lite"); }
  function ltCfg() {
    var m = (window.RK && window.RK.data && window.RK.data.heroMotion) || {};
    var c = {}; for (var k in LT_DEF) c[k] = (m[k] == null ? LT_DEF[k] : m[k]);
    return c;
  }
  function ltEnc(u) { return !u || /^vault:/i.test(u) || /\.enc(\b|$)/i.test(u); }
  function mediaUrl(ref) { try { return (window.RK && window.RK.mediaUrl) ? window.RK.mediaUrl(ref) : ref; } catch (e) { return ref; } }
  function ltMediaSrcs() {
    var w = (window.RK && window.RK.data && window.RK.data.work) || [], out = [];
    w.filter(function (x) { return x && x.featured && !x.hidden; }).forEach(function (x) {
      var s = x.image || (x.study && x.study.cover);
      if (s && !ltEnc(s)) out.push(s);
    });
    return out.slice(0, 5);
  }
  var ltMediaTimer = 0, ltMediaIdx = 0;
  function ltStartMediaFade() {
    if (ltMediaTimer) return;
    ltMediaTimer = setInterval(function () {
      if (document.body.dataset.heroAmb !== "media") return;
      var imgs = document.querySelectorAll("#lt-media img"); if (imgs.length < 2) return;
      imgs[ltMediaIdx].classList.remove("on");
      ltMediaIdx = (ltMediaIdx + 1) % imgs.length; imgs[ltMediaIdx].classList.add("on");
    }, 4600);
  }
  function ltBuildAmbient(cfg, onLanding) {
    var amb = document.getElementById("lt-amb");
    if (!amb) {
      amb = document.createElement("div"); amb.id = "lt-amb"; amb.className = "lt-amb"; amb.setAttribute("aria-hidden", "true");
      amb.innerHTML = '<div class="lt-aura"><b></b><b></b><b></b><b></b></div><div class="lt-media" id="lt-media"></div>';
      document.body.insertBefore(amb, document.body.firstChild);
      var scrim = document.createElement("div"); scrim.className = "lt-scrim"; scrim.setAttribute("aria-hidden", "true");
      document.body.insertBefore(scrim, amb.nextSibling);
    }
    var media = document.getElementById("lt-media");
    if (media && onLanding && cfg.ambient === "media" && !media.dataset.built) {
      media.innerHTML = ltMediaSrcs().map(function (s) { return '<img src="' + mediaUrl(s) + '" alt="" />'; }).join("");
      media.dataset.built = "1";
      var imgs = media.querySelectorAll("img"); if (imgs[0]) imgs[0].classList.add("on");
      ltStartMediaFade();
    }
    document.body.dataset.heroAmb = onLanding ? cfg.ambient : "off";
    document.body.dataset.heroNodes = (cfg.nodes === false ? "off" : "on");
    document.documentElement.style.setProperty("--lt-amb", String(cfg.ambientAmt));
  }
  function ltWrapText(text, field, strong, frag, p) {
    // p = { base, peak, lift, breath, gentle } for this target
    var w0 = strong ? Math.min(700, p.base + (p.gentle ? 90 : 250)) : p.base;
    var mk = function (el) { LT.units.push({ el: el, w0: w0, wMax: p.peak, lift: p.lift, breath: p.breath, cur: w0, phase: LT.units.length * 0.6 }); };
    text.split(/(\s+)/).forEach(function (tok) {
      if (tok === "") return;
      if (/^\s+$/.test(tok)) { frag.appendChild(document.createTextNode(tok)); return; }
      if (field === "letter" && !p.gentle) {   // per-letter only for the big headings; small text stays per-word
        var word = document.createElement("span"); word.className = "lt-word";
        tok.split("").forEach(function (ch) {
          var s = document.createElement("span"); s.className = "lt-u"; s.textContent = ch;
          s.style.fontVariationSettings = "'wght' " + w0;
          word.appendChild(s); mk(s);
        });
        frag.appendChild(word);
      } else {
        var s2 = document.createElement("span"); s2.className = "lt-u"; s2.textContent = tok;
        s2.style.fontVariationSettings = "'wght' " + w0;
        frag.appendChild(s2); mk(s2);
      }
    });
  }
  // The reaction targets. #workHeading is the anchor; scope "hero" extends it to the statement +
  // eyebrow/domains (a flex run) + description, gentler, so the whole hero breathes with the cursor.
  function ltTargets(cfg) {
    var out = [{ el: document.getElementById("workHeading"), lines: ".section-head__line", gentle: false, lift: cfg.lift }];
    if (cfg.scope === "hero") {
      out.push({ el: document.getElementById("heroTitle"), lines: ".line > span", gentle: false, lift: 0 });   // lift 0: .line clips overflow (reveal)
      out.push({ el: document.getElementById("heroLabel"), lines: null, gentle: true, lift: cfg.lift * 0.45, flex: true });
      out.push({ el: document.getElementById("heroIntro"), lines: null, gentle: true, lift: cfg.lift * 0.45 });
    }
    return out.filter(function (t) { return t.el && !ltHidden(t.el); });
  }
  function ltSplitTarget(t, cfg) {
    var el = t.el;
    if (el.querySelector(".lt-u")) return;   // already split (a re-render un-splits first) -> never double-wrap
    var p;
    if (t.gentle) { var w = parseInt(getComputedStyle(el).fontWeight, 10) || 400; p = { base: w, peak: Math.min(700, w + LT_GENTLE_RANGE), lift: t.lift, breath: cfg.breath * 0.5, gentle: true }; }
    else { p = { base: cfg.base, peak: cfg.peak, lift: t.lift, breath: cfg.breath, gentle: false }; }
    var containers = t.lines ? Array.prototype.slice.call(el.querySelectorAll(t.lines)) : [el];
    containers.forEach(function (line) {
      var kids = Array.prototype.slice.call(line.childNodes), frag = document.createDocumentFragment();
      kids.forEach(function (node) {
        if (node.nodeType === 3) {
          if (t.flex) { var seg = document.createElement("span"); seg.className = "lt-seg"; var sf = document.createDocumentFragment(); ltWrapText(node.textContent, cfg.field, false, sf, p); seg.appendChild(sf); frag.appendChild(seg); }
          else { ltWrapText(node.textContent, cfg.field, false, frag, p); }
        } else if (node.nodeType === 1) {
          if (node.classList && (node.classList.contains("tick") || node.classList.contains("hero__label-sep"))) { frag.appendChild(node.cloneNode(true)); return; }
          var strong = node.tagName === "STRONG";
          var clone = node.cloneNode(false), inner = document.createDocumentFragment();
          ltWrapText(node.textContent, cfg.field, strong, inner, p); clone.appendChild(inner); frag.appendChild(clone);
        } else { frag.appendChild(node.cloneNode(true)); }
      });
      line.innerHTML = ""; line.appendChild(frag);
    });
    el.classList.add("lt-on");
  }
  function ltMeasure() {
    for (var i = 0; i < LT.units.length; i++) {
      var r = LT.units[i].el.getBoundingClientRect();
      LT.units[i].cx = r.left + r.width / 2; LT.units[i].cy = r.top + r.height / 2;
    }
  }
  function ltHidden(h) { return !h || h.offsetParent === null; }
  // Collect the highlights-marquee chips (.himarq .hi) as lift targets. Kept SEPARATE from the text
  // split: the marquee engine REBUILDS its track (innerHTML.repeat) on first build + on width resize,
  // which DESTROYS the .hi nodes this first grabbed. The marquee re-calls this from its onBuild so
  // LT.cards always points at the LIVE chips — otherwise the lift lands on detached nodes and nothing
  // moves (the bug that made the card lift appear only when livingTypeApply was re-fired by hand).
  function ltCollectCards() {
    if (LT.cards) LT.cards.forEach(function (c) { if (c.el) c.el.style.transform = ""; });
    LT.cards = [];
    var cfg = LT.cfg || (LT.cfg = ltCfg());
    var anchor = document.getElementById("workHeading");
    if (!(anchor && !ltHidden(anchor) && cfg.on && cfg.scope === "hero" && LT_REACT && (!ltLite() || LT_PREVIEW))) return;
    var chips = document.querySelectorAll(".himarq .hi, .logos .logo, .contact__pill");   // both marquees + the contact pills lift on cursor proximity
    for (var i = 0; i < chips.length; i++) LT.cards.push({ el: chips[i], cur: 0, applied: false });
  }
  function livingTypeApply() {
    var cfg = LT.cfg = ltCfg();
    var anchor = document.getElementById("workHeading");
    var onLanding = !!(anchor && !ltHidden(anchor));
    ltBuildAmbient(cfg, onLanding);
    var runFeature = onLanding && cfg.on && LT_REACT && (!ltLite() || LT_PREVIEW);
    if (LT.cards) LT.cards.forEach(function (c) { if (c.el) c.el.style.transform = ""; });
    LT.units = []; LT.cards = [];
    if (runFeature) {
      if (cfg.scope !== "hero") ["heroTitle", "heroLabel", "heroIntro"].forEach(function (id) { var e = document.getElementById(id); if (e) e.classList.remove("lt-on"); });
      ltTargets(cfg).forEach(function (t) { ltSplitTarget(t, cfg); });
      ltCollectCards();
      ltMeasure();
    } else {
      ["workHeading", "heroTitle", "heroLabel", "heroIntro"].forEach(function (id) { var e = document.getElementById(id); if (e) e.classList.remove("lt-on"); });
    }
  }
  function ltLoop(now) {
    var cfg = LT.cfg, units = LT.units, cards = LT.cards;
    if (units.length || (cards && cards.length)) {
      var twoSig = 2 * cfg.radius * cfg.radius, t = now / 1000;
      var breathK = LT_HOVER ? (LT.pointer ? 0.28 : 1) : 0;
      if (LT.frame % 6 === 0) ltMeasure();
      for (var i = 0; i < units.length; i++) {
        var u = units[i], target = u.w0, g = 0;
        if (LT.pointer && LT_REACT) { var dx = u.cx - LT.mx, dy = u.cy - LT.my; g = Math.exp(-(dx * dx + dy * dy) / twoSig); target += (u.wMax - u.w0) * g; }
        target += Math.sin(t * 0.8 + u.phase) * u.breath * breathK;
        if (target < 300) target = 300; else if (target > 700) target = 700;
        u.cur += (target - u.cur) * 0.16;
        if (Math.abs(u.cur - (u.lastW || 0)) > 0.8) { u.el.style.fontVariationSettings = "'wght' " + (u.cur | 0); u.lastW = u.cur; }
        if (u.lift) { var ly = (LT.pointer && LT_REACT) ? -(u.lift * g) : 0; u.el.style.transform = ly ? "translate3d(0," + ly.toFixed(2) + "px,0)" : ""; }
      }
      if (cards && cards.length) {
        var cSig = 2 * 260 * 260;
        for (var c = 0; c < cards.length; c++) {
          var cd = cards[c], gg = 0;
          if (LT.pointer && LT_REACT) { var r = cd.el.getBoundingClientRect(); if (r.width) { var mdx = r.left + r.width / 2 - LT.mx, mdy = r.top + r.height / 2 - LT.my; gg = Math.exp(-(mdx * mdx + mdy * mdy) / cSig); } }
          cd.cur += (gg - cd.cur) * 0.16;
          if (cd.cur < 0.005) { if (cd.applied) { cd.el.style.transform = ""; cd.applied = false; } }
          else { cd.el.style.transform = "translate3d(0," + (-12 * cd.cur).toFixed(2) + "px,0) scale(" + (1 + 0.09 * cd.cur).toFixed(4) + ")"; cd.applied = true; }
        }
      }
      LT.frame++;
    }
    requestAnimationFrame(ltLoop);
  }
  function ltScrollFade() {
    var f = 1 - (window.pageYOffset || 0) / (window.innerHeight * 0.8);
    document.documentElement.style.setProperty("--lt-amb-fade", (f < 0 ? 0 : f > 1 ? 1 : f).toFixed(3));
  }
  function livingTypeInit() {
    if (LT.started) return; LT.started = true;
    // Mouse / pen hover drives the reaction on desktop (touch pointer events are handled below).
    addEventListener("pointermove", function (e) {
      if (e.pointerType === "touch") return;
      LT.mx = e.clientX; LT.my = e.clientY; LT.pointer = true;
    }, { passive: true });
    // Touch: while a finger rests on / swipes across the page, treat its position like a hover so the
    // hero letters react to it, then relax when it lifts. Passive listeners — never block scrolling.
    if (LT_TOUCH) {
      var ltTouch = function (e) {
        var t = e.touches && e.touches[0]; if (!t) return;
        LT.mx = t.clientX; LT.my = t.clientY; LT.pointer = true;
      };
      addEventListener("touchstart", ltTouch, { passive: true });
      addEventListener("touchmove", ltTouch, { passive: true });
      var ltTouchEnd = function (e) {
        if (e.touches && e.touches.length) { LT.mx = e.touches[0].clientX; LT.my = e.touches[0].clientY; }
        else { LT.pointer = false; }
      };
      addEventListener("touchend", ltTouchEnd, { passive: true });
      addEventListener("touchcancel", ltTouchEnd, { passive: true });
    }
    addEventListener("resize", ltMeasure, { passive: true });
    addEventListener("scroll", ltScrollFade, { passive: true });
    ltScrollFade();
    requestAnimationFrame(ltLoop);
  }
  window.__rkLivingType = livingTypeApply;
  window.__rkLivingTypeCards = ltCollectCards;
  document.addEventListener("site:rendered", function () { livingTypeInit(); livingTypeApply(); });
  if (window.__siteRendered) { livingTypeInit(); livingTypeApply(); }

  if (window.__siteRendered) initInteractions();
  else document.addEventListener("site:rendered", initInteractions, { once: true });

  // Cursor / gyroscope depth on covers that have a depth map (progressive; GPU + WebGL2 gated,
  // otherwise the static image + scroll parallax remain). See src/js/depth.js. It runs on the live
  // site AND re-runs after every render (idempotent per cover) so the studio preview reflects live
  // depth edits; exposed as __rkInitDepth so the studio can refresh it after RK.render().
  window.__rkInitDepth = initDepth;
  if (window.__siteRendered) initDepth();
  document.addEventListener("site:rendered", initDepth);
})();
