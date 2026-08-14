/* Depth parallax — cursor-driven "3D photo" depth on case-study COVER images.
 *
 * Progressive enhancement: a cover gets the effect ONLY if
 *   (a) it has a depth map next to it (naming convention: <cover>.<ext> -> <cover>.depth.png), and
 *   (b) the device has a real GPU + WebGL2 + a fine pointer + motion allowed.
 * Otherwise the existing static image + scroll parallax remain untouched — nothing regresses.
 *
 * The effect is lazy: WebGL is created only when a card is first hovered, and the render loop
 * runs only while a card is hovered, so idle cards cost nothing. The scroll parallax (on
 * .case__par) is left fully intact; depth takes over on hover, parallax on scroll.
 *
 * ?depth  = force the effect on (bypasses the GPU/motion gates, still needs WebGL2) — for testing.
 * ?nodepth = force the effect off.
 */

const SOFT_RENDERER = /swiftshader|llvmpipe|software|basic render|microsoft basic|paravirtual|mesa offscreen/;

function gpuOk() {
  if ((navigator.hardwareConcurrency || 8) <= 2) return false;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
    if (!gl) return false;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || "").toLowerCase() : "";
    if (r && SOFT_RENDERER.test(r)) return false;
  } catch (e) { return false; }
  return true;
}

// Depth map lives next to the cover: <cover-base>.<ext> -> <cover-base>.depth.png. Works on the
// current /assets/uploads/<hash>.<ext> path AND the R2 origin URL after the migration flips MEDIA_BASE
// (input is the already-resolved cover src in the DOM), so depth keeps working post-migration.
function deriveDepthUrl(src) {
  if (!src) return "";
  const m = src.match(/^(.*\/[^./?#]+)\.[a-z0-9]+([?#].*)?$/i);
  return m ? m[1] + ".depth.png" : "";
}

const VERT =
  "#version 300 es\nout vec2 vUv;void main(){vec2 uv=vec2((gl_VertexID<<1)&2, gl_VertexID&2);vUv=uv;gl_Position=vec4(uv*2.0-1.0,0.0,1.0);}";
const FRAG =
  "#version 300 es\nprecision highp float;in vec2 vUv;out vec4 o;" +
  "uniform sampler2D uColor;uniform sampler2D uDepth;uniform vec2 uPointer;" +
  "uniform float uStrength,uFocus,uZoom,uImgA,uBoxA,uSoft;" +
  "vec2 fitCover(vec2 uv){float ia=uImgA,ba=uBoxA;vec2 s=vec2(1.0);if(ia>ba)s.x=ba/ia;else s.y=ia/ba;return (uv-0.5)*s+0.5;}" +
  "float dsample(vec2 uv){if(uSoft<0.0006)return texture(uDepth,uv).r;float d=texture(uDepth,uv).r*0.28;for(int i=0;i<8;i++){float a=0.7853982*float(i);vec2 o2=vec2(cos(a),sin(a))*uSoft;d+=texture(uDepth,uv+o2).r*0.09;}return d;}" +
  "void main(){vec2 st=vec2(vUv.x,1.0-vUv.y);vec2 base=fitCover(st);vec2 z=(base-0.5)/uZoom+0.5;" +
  "float d=dsample(z);float rel=d-uFocus;vec2 off=uPointer*uStrength*rel;" +
  "vec3 col=texture(uColor,z+off).rgb;o=vec4(col,1.0);}";

// The RESTING zoom (1.40) matches the static cover <img>, which fills the oversized .case__par
// (inset -20% = 140% of the media height, kept for scroll parallax) — so the canvas fades in at the
// EXACT same framing as the image = seamless handoff. On hover it eases OUT to zoomHover (1.075):
// a gentle dolly-back that reveals more of the scene and deepens the parallax; on leave it eases
// back to 1.40 before fading out. If .case__par inset changes, set zoomRest = 1 + 2*inset.
const DEFAULTS = { strength: 0.028, softness: 0.014, focus: 0.5, zoomRest: 1.40, zoomHover: 1.075 };
// Mobile (gyro) mounts the canvas over the FRAME (not the tall .case__par) so it shows the WHOLE
// scene at rest = greater depth of field. Instead of a par translate, it dollies the zoom by scroll:
// resting ZOOMED OUT when the card is centred and easing IN as it scrolls away, plus a depth-aware
// vertical parallax. Desktop is unchanged (rests at 1.40 matching the <img>, dollies out on hover).
const MOBILE_ZOOM_OUT = 1.08;   // rest: the whole scene, most depth of field
const MOBILE_ZOOM_IN = 1.30;    // scrolled off-centre: dollied in
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let activeGyro = null;   // the current device-orientation controller (torn down + rebuilt on re-render)

export function initDepth() {
  const q = new URLSearchParams(location.search);
  if (q.has("nodepth")) return;
  const preview = q.has("preview");
  if (q.has("lite") && !preview) return;                 // lite disables depth, EXCEPT the studio preview iframe
  if (activeGyro) { activeGyro.destroy(); activeGyro = null; }   // re-render replaces the DOM

  const force = q.has("depth") || preview;               // ?preview forces depth on so the studio can show it
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const gyro = coarse && typeof window.DeviceOrientationEvent !== "undefined";
  if (!force) {
    // Signature motion on this site runs regardless of OS "reduce motion" (a deliberate, site-wide
    // choice that also covers Lenis / cursor / reveals) — so depth is NOT gated on prefers-reduced-motion.
    // On touch the dolly + parallax are driven purely by scroll (see the gyro branch of frame()), so it
    // stays alive even before the iOS motion-sensor permission is granted; the tilt just layers on after.
    if (coarse && !gyro) return;                         // touch device w/o motion sensors -> nothing drives depth
    if (!gpuOk()) return;
  }
  const ctx = gyro ? createGyroCtx() : null;
  document.querySelectorAll(".case__media--photo").forEach((m) => setupCover(m, ctx));
  if (ctx) { ctx.start(); activeGyro = ctx; }
}

function setupCover(media, ctx) {
  if (media.dataset.depthOff) return;                    // per-cover off switch (studio "3D depth" menu)
  if (media.querySelector(".case__depth")) return;       // already wired (idempotent across re-renders / preview)
  const img = media.querySelector(".case__img");
  if (!img) return;
  const colorUrl = img.getAttribute("src") || img.src;
  const depthUrl = media.dataset.depthMap || deriveDepthUrl(colorUrl);
  if (!depthUrl) return;
  // WebGL textures must be CORS-clean or the cross-origin pixels taint the canvas -> it renders BLACK.
  // Covers + depth maps are served cross-origin from R2 (/media on the Worker origin) WITH an
  // Access-Control-Allow-Origin header, so we load DEDICATED crossOrigin="anonymous" images for the
  // textures (crossOrigin set BEFORE .src). The visible .case__img is left untouched, so normal display
  // never depends on CORS -- if the CORS fetch ever fails, depth just degrades to the scroll parallax.
  const cImg = new Image();
  cImg.crossOrigin = "anonymous";
  cImg.decoding = "async";
  const dImg = new Image();
  dImg.crossOrigin = "anonymous";
  dImg.decoding = "async";
  let cOk = false, dOk = false, fired = false;
  const ready = () => { if (cOk && dOk && !fired) { fired = true; attach(media, cImg, dImg, ctx); } };
  cImg.onload = () => { cOk = true; ready(); };
  dImg.onload = () => { dOk = true; ready(); };
  cImg.onerror = () => {};                               // CORS/network fail -> no depth, keep scroll parallax
  dImg.onerror = () => {};                               // no depth map for this cover -> keep scroll parallax only
  // The visible <img> loads the cover WITHOUT crossOrigin. If depth's crossOrigin texture request hits
  // the SAME url while the display request is still in flight, the browser COALESCES the two into the
  // no-CORS request (whose response carries no Access-Control-Allow-Origin) -> the crossOrigin image
  // fails -> that cover renders with no depth. LARGE covers hit this deterministically: their display
  // request stays in flight long enough that the texture request always coalesces with it. A distinct
  // url for the texture request avoids the coalesce, so it gets its own CORS response (ACAO present)
  // and stays canvas-clean. The depth map (dImg) is only ever loaded here, so it never coalesces.
  cImg.src = colorUrl + (colorUrl.indexOf("?") < 0 ? "?" : "&") + "tex=1";
  dImg.src = depthUrl;
}

function readSettings(media) {
  const d = media.dataset;
  const num = (v, dflt) => (v !== undefined && v !== "" && !isNaN(+v) ? +v : dflt);
  return {
    strength: num(d.depthStrength, DEFAULTS.strength),
    softness: num(d.depthSoftness, DEFAULTS.softness),
    focus: num(d.depthFocus, DEFAULTS.focus),
    zoomRest: DEFAULTS.zoomRest,
    zoomHover: num(d.depthZoom, DEFAULTS.zoomHover)
  };
}

function attach(media, img, depthImg, ctx) {
  const gyro = !!(ctx && ctx.gyro);
  // Always mount over the frame (16:10). Mobile shows the whole scene (zoomed out) and dollies the
  // zoom on scroll; desktop rests at 1.40 and dollies out on hover.
  const mount = media;
  const box = media;                                   // the canvas fills - and is measured against - the frame
  const REST = gyro ? MOBILE_ZOOM_OUT : DEFAULTS.zoomRest;

  const canvas = document.createElement("canvas");
  canvas.className = "case__depth";
  canvas.setAttribute("aria-hidden", "true");
  mount.appendChild(canvas);
  media.classList.add("is-depth");

  let gl = null, prog = null, U = null, colorTex = null, depthTex = null;
  let active = false, dollyOn = false, raf = 0;
  const target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
  let settleFrames = 0, zoomCur = REST;

  function makeTex(unit, src) {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    return t;
  }
  function sh(type, s) { const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o); return o; }

  function initGL() {
    if (gl) return true;
    if (!(img.complete && img.naturalWidth)) return false;   // cover not decoded yet
    gl = canvas.getContext("webgl2", { antialias: true, premultipliedAlpha: false, alpha: false });
    if (!gl) return false;
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { gl = null; return false; }
    gl.useProgram(prog);
    U = {};
    ["uColor", "uDepth", "uPointer", "uStrength", "uFocus", "uZoom", "uImgA", "uBoxA", "uSoft"].forEach((n) => { U[n] = gl.getUniformLocation(prog, n); });
    gl.uniform1i(U.uColor, 0); gl.uniform1i(U.uDepth, 1);
    gl.bindVertexArray(gl.createVertexArray());
    colorTex = makeTex(0, img);
    depthTex = makeTex(1, depthImg);
    return true;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(box.clientWidth * dpr));
    const h = Math.max(2, Math.round(box.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function frame() {
    if (!gl) return;
    cur.x += (target.x - cur.x) * 0.09;
    cur.y += (target.y - cur.y) * 0.09;
    const s = readSettings(media);
    let zoomTarget, panY = 0;
    if (gyro) {
      // Scroll drives the dolly: zoomed OUT (whole scene) when the card is centred, easing IN as it
      // scrolls toward the edges, plus a depth-aware vertical parallax (panY feeds the displacement).
      const r = media.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const t = (r.top + r.height / 2 - vh / 2) / vh;            // 0 centred, ~+/-0.5 at the edges
      const p = clamp((Math.abs(t) - 0.1) / 0.4, 0, 1);         // wide central rest band stays zoomed out
      zoomTarget = MOBILE_ZOOM_OUT + (MOBILE_ZOOM_IN - MOBILE_ZOOM_OUT) * p;
      panY = clamp(t * 1.2, -1, 1) * 0.45;
    } else {
      zoomTarget = (active && dollyOn) ? s.zoomHover : REST;     // desktop hover dollies out; else rest
    }
    zoomCur += (zoomTarget - zoomCur) * 0.06;
    resize();
    gl.uniform2f(U.uPointer, cur.x, clamp(cur.y + panY, -1, 1));
    gl.uniform1f(U.uStrength, s.strength);
    gl.uniform1f(U.uSoft, s.softness);
    gl.uniform1f(U.uFocus, s.focus);
    gl.uniform1f(U.uZoom, zoomCur);
    gl.uniform1f(U.uImgA, img.naturalWidth / img.naturalHeight);
    gl.uniform1f(U.uBoxA, box.clientWidth / Math.max(1, box.clientHeight));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const moving = Math.abs(target.x - cur.x) + Math.abs(target.y - cur.y) > 0.0008;
    const zooming = Math.abs(zoomTarget - zoomCur) > 0.0008;
    const sustain = active && !gyro;                     // desktop hover keeps the loop alive; gyro sleeps when still
    if (sustain || moving || zooming || settleFrames-- > 0) { raf = requestAnimationFrame(frame); }
    else { raf = 0; if (!gyro) canvas.classList.remove("is-on"); }
  }

  function wake() { if (!raf && gl) raf = requestAnimationFrame(frame); }
  function activate(dolly) {
    dollyOn = !!dolly;
    if (!initGL()) { if (!(img.complete && img.naturalWidth)) img.addEventListener("load", () => activate(dolly), { once: true }); return; }
    active = true;
    canvas.classList.add("is-on");
    wake();
  }
  function deactivate() {
    active = false;
    if (gyro) { canvas.classList.remove("is-on"); return; }   // leaving the viewport: just fade the canvas out
    target.x = 0; target.y = 0;
    settleFrames = 40;                 // desktop: keep rendering briefly so it eases back to centre
    wake();
  }

  const controller = { el: media, isActive: () => active, wake, setTilt(x, y) { target.x = x; target.y = y; wake(); }, activate, deactivate };
  media.__depthCtrl = controller;

  if (gyro) {
    ctx.observe(controller);                             // IntersectionObserver activates it while in view
  } else {
    media.addEventListener("pointerenter", () => activate(true));
    media.addEventListener("pointerleave", deactivate);
    media.addEventListener("pointermove", (e) => {
      const r = media.getBoundingClientRect();
      target.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      target.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    });
  }
}

// One device-orientation controller shared by every gyro cover: it tilts the pointer from the
// phone's motion sensors and activates covers only while they're in the viewport (IntersectionObserver).
function createGyroCtx() {
  const observed = [];
  let baseG = null, baseB = null;                        // calibrate to however the phone is first held
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const ctrl = e.target.__depthCtrl;
      if (!ctrl) continue;
      if (e.isIntersecting) ctrl.activate(false); else ctrl.deactivate();
    }
  }, { threshold: 0.2 });

  function onOrient(ev) {
    let g = ev.gamma, b = ev.beta;
    if (g == null && b == null) return;
    g = g || 0; b = b || 0;
    if (baseG == null) { baseG = g; baseB = b; }
    const x = clamp((g - baseG) / 22, -1, 1);            // ~22deg of tilt = full deflection (kept subtle)
    const y = clamp((b - baseB) / 22, -1, 1);
    for (let i = 0; i < observed.length; i++) if (observed[i].isActive()) observed[i].setTilt(x, y);
  }

  let started = false, tapReq = null, listening = false;
  function listen() { if (listening) return; listening = true; window.addEventListener("deviceorientation", onOrient, true); }
  function onScroll() { for (let i = 0; i < observed.length; i++) if (observed[i].isActive()) observed[i].wake(); }
  function start() {
    if (started) return; started = true;
    window.addEventListener("scroll", onScroll, { passive: true });   // drive the scroll dolly on in-view covers
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      // iOS 13+: sensor access needs a user gesture. The first touch anywhere grants it.
      tapReq = function () {
        try { DOE.requestPermission().then((s) => { if (s === "granted") listen(); }).catch(() => {}); } catch (e) {}
        document.removeEventListener("pointerdown", tapReq); document.removeEventListener("touchend", tapReq);
      };
      document.addEventListener("pointerdown", tapReq, { once: true });
      document.addEventListener("touchend", tapReq, { once: true });
    } else {
      listen();
    }
  }
  return {
    gyro: true,
    observe(ctrl) { observed.push(ctrl); io.observe(ctrl.el); },
    start,
    destroy() {
      try { io.disconnect(); } catch (e) {}
      window.removeEventListener("scroll", onScroll);
      if (listening) window.removeEventListener("deviceorientation", onOrient, true);
      if (tapReq) { document.removeEventListener("pointerdown", tapReq); document.removeEventListener("touchend", tapReq); }
    }
  };
}
