# Slide Lab

An isolated Excalidraw 0.18.1 compatibility study, not a replacement for the slideshow editor.

Open `/studio/slide-lab/` through the site's HTTP server. It has four synthetic scenes: product flow, content fidelity, 200 objects, and 1,000 objects. No existing decks, studio drafts, authentication state, publishing endpoints, or content files are read or modified. Drafts and library items live in a separate browser IndexedDB database, `rk-slide-lab-v1`. Storage is local to this browser and origin, not a backup or roaming service.

## Development

```sh
npm ci
npm run build:slide-lab
node --test slide-lab.test.mjs slideshow-interactions.test.cjs
```

The static distribution is committed for branch-based GitHub Pages. The lab is not imported by either production entry point. Rebuild the lab after changing its source. Generated license notices and fonts remain alongside the bundle. The complete uncompressed distribution is about 22 MB, including lazy chunks and fonts; this is not the initial network transfer size.

## What Was Verified

Select a shape with bound text to show Text colour in the shape properties, between Background and Fill. Uncheck **Link text to outline** to preserve its current text colour, then use a swatch or six-digit hex value independently of the outline. Rechecking adopts the current outline colour. This remains a text binding: moving/resizing the shape still carries its label. The setting persists in the lab draft and supports undo/redo.

The inline control uses a React portal into the pinned engine's desktop/mobile `.panelColumn`, before its first property fieldset. A scoped MutationObserver reattaches it when the engine replaces the properties panel. Recheck placement, selection dismissal and mobile panel reopening when upgrading Excalidraw; this is an internal DOM integration, not a public engine extension API.

- Bound connectors follow a pointer-dragged node; one undo restores its position.
- Double-click edits a shape's bound label and creates text on empty canvas. Labels can wrap, so compare `originalText` or normalized whitespace rather than display `text` alone.
- Text and freehand strokes persist across a full page reload.
- A 2560 x 1440 synthetic PNG survives save/read with identical SHA-256 bytes and dimensions. The custom image importer retains original bytes and only changes display geometry.
- Native bold/italic text and a case-study section render through the existing slide renderer in same-origin embeds.
- SVG preview is clipped to a 1280 x 720 frame and its modal owns focus.
- Desktop and 390 px mobile screenshots, nonblank canvas pixels and horizontal-overflow checks passed.
- Five lab unit tests and ten production slideshow interaction tests passed; both builds passed.

## Adoption Gates Still Open

Native rich HTML, case-study sections and video are embedded surfaces, not editable Excalidraw document objects. Resizing an embed scales its native layout rather than converting it. The SVG preview explicitly warns that these embeds do not have export parity. Existing deck conversion, full presentation parity and library reinsertion workflows have not been proven. Do not migrate production decks or flatten these types to images on the strength of this prototype.

The synthetic VP9 video file validates with ffprobe, but the test browser rejected it with a demuxer error. Playback remains unverified on supported real browsers. The fixture shows an explicit unavailable state instead of silently passing. No portfolio media was re-encoded. The fixture can be regenerated with:

```sh
ffmpeg -f lavfi -i "testsrc2=size=640x320:rate=24:duration=2" -c:v libvpx-vp9 -lossless 1 -an motion.webm
```

Dependency overrides remove reported nanoid/lodash-es advisories. The Mermaid dependency's nanoid override crosses a major version; Mermaid conversion is not an acceptance-tested feature of this study.

## Performance Method

`Run benchmark` moves the camera through the same four-second sine path, records requestAnimationFrame intervals and long tasks, then restores the camera. It does not measure pointer latency, export speed or startup cost. Run in a visible foreground tab, with the same viewport/zoom and no competing workload. Report results together with hardware, browser, DPR and refresh rate. Repeat on a GPU-equipped machine before making a smoothness claim.

Observed on a software-rendered Windows test environment at a 1264 x 806 editor viewport, DPR 1, full motion:

| Scene | Objects including frame | Median interval | P95 interval | Long tasks |
| --- | ---: | ---: | ---: | ---: |
| Flow after text/freehand tests | 15 | 31.2 ms | 31.3 ms | 0 |
| Dense | 201 | 31.3 ms | 31.3 ms | 0 |
| Stress | 1001 | 31.3 ms | 31.3 ms | 0 |

All three runs had 128 samples. The similar cadence suggests an environment ceiling and does not establish 60 fps performance. This is evidence for continued evaluation, not approval to replace the production engine.