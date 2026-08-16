// Generates lab/og.html — the 1200x630 social-share card — from the live content.json
// (statement, eyebrow/domains + the uploaded site logo). Centered composition so it reads
// balanced on the wide OG ratio AND the logo survives WhatsApp's square center-crop.
// Render it in a browser at 1200x630 and screenshot to assets/og-cover.png.
import fs from "fs";

const d = JSON.parse(fs.readFileSync("content.json", "utf8"));
const L = d.landing || {};
const s = L.siteIcon || {};
const svg = s.svg || "";
const mask = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
const eyebrow = (L.eyebrow || "Product Design Lead").toUpperCase();
const domains = (L.domains || "").toUpperCase();

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="robots" content="noindex" />
<title>OG card</title>
<link rel="stylesheet" href="/css/fonts.css" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    background: #08080a; color: #ECE7E1;
    font-family: "General Sans", system-ui, -apple-system, sans-serif;
    position: relative; overflow: hidden; text-align: center;
    display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 56px 80px;
    -webkit-font-smoothing: antialiased;
  }
  body::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 5px;
    background: linear-gradient(90deg, transparent, #D8A657 50%, transparent); }
  .glow { position: absolute; top: -240px; left: 50%; transform: translateX(-50%);
    width: 820px; height: 660px; background: radial-gradient(ellipse, rgba(216,166,71,.16), transparent 66%); }
  .wrap { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; }
  .brand { width: 128px; height: 128px; position: relative; margin-bottom: 36px; }
  .brand .mark { position: absolute; inset: 0; background-color: #ECE7E1;
    -webkit-mask: url("${mask}") center / contain no-repeat; mask: url("${mask}") center / contain no-repeat; }
  .stmt { font-family: "Gambetta", Georgia, serif; font-weight: 400; font-size: 74px; line-height: 1.08; letter-spacing: -.015em; }
  .stmt b { font-weight: 600; }
  .stmt .why { color: #D8A657; font-style: italic; font-weight: 400; }
  .eyebrow { font-family: "Fragment Mono", ui-monospace, monospace; font-size: 17px; letter-spacing: .13em;
    text-transform: uppercase; color: #9a948c; margin-top: 40px; }
  .eyebrow .dot { color: #D8A657; margin-right: 10px; }
  .eyebrow .dom { color: #c9a45f; }
  .foot { margin-top: 16px; font-family: "Fragment Mono", ui-monospace, monospace; font-size: 17px; letter-spacing: .06em; color: #6f6a63; }
  .foot .site { color: #D8A657; }
</style></head>
<body>
  <div class="glow"></div>
  <div class="wrap">
    <div class="brand"><div class="mark"></div></div>
    <div class="stmt">I shape <b>what</b> gets built,<br />and <span class="why">why.</span></div>
    <div class="eyebrow"><span class="dot">&#9702;</span>${eyebrow} <span class="dom">&middot; ${domains}</span></div>
    <div class="foot">Ritesh Kumar &nbsp;&middot;&nbsp; <span class="site">riteshk.work</span></div>
  </div>
</body></html>`;

fs.writeFileSync("lab/og.html", html);
console.log("wrote lab/og.html (" + html.length + " bytes)");
