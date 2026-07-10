/* =================================================================
   RITESH KUMAR — Digital CV
   Micro-interactions & motion (vanilla, dependency-free)
   ================================================================= */
(function () {
  "use strict";

  function initInteractions() {
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
     4. Count-up stats
  ------------------------------------------------- */
  const counts = document.querySelectorAll(".count");
  if ("IntersectionObserver" in window && counts.length) {
    const cio = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          const target = parseInt(el.dataset.count, 10);
          let cur = 0;
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
    counts.forEach((el) => cio.observe(el));
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
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  if (lenis) lenis.on("scroll", onScroll);
  onScroll();

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
  } // end initInteractions

  if (window.__siteRendered) initInteractions();
  else document.addEventListener("site:rendered", initInteractions, { once: true });
})();
