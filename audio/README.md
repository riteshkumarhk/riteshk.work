# Ambient music

The flyout ("···" menu → **Ambience**) plays a looping ambient soundscape with
play/pause and next/previous controls.

## Built-in synth (no files needed)

By default the player generates its own deep ambient pad in the browser with the
Web Audio API — nothing to download or host. Three moods ship in:

| Track      | Mood | Auto-plays in |
| ---------- | ---- | ------------- |
| Midnight   | dark | dark theme    |
| Ember Glow | warm | light theme   |
| Undertow   | deep | manual only   |

The mood follows the appearance: switching the theme (Light / Dark / System /
Local) swaps the track automatically. Switching the track by hand never changes
the theme. **Undertow** is only reached via next / previous.

## Using your own tracks instead

Add a `music` array to `content.json` and the player uses your files instead of
the synth (order is preserved; the theme still picks track 1 for dark and track 2
for light):

```json
"music": [
  { "title": "Midnight",   "src": "/audio/1.mp3" },
  { "title": "Ember Glow", "src": "/audio/2.mp3" },
  { "title": "Undertow",   "src": "/audio/3.mp3" }
]
```

Then drop the files here (`audio/1.mp3`, …). Any web audio format works
(`.mp3`, `.m4a`, `.ogg`); keep files a few MB for fast loading, and only use
music you own or that is licensed for the web (royalty-free / Creative Commons).

## Notes

- Browsers block audio autoplay, so playback begins on the visitor's **first
  interaction** (a click, tap or key press). Their play/pause choice is remembered.
- To make the site silent by default, set `localStorage["rk:music:on"] = "0"`.
