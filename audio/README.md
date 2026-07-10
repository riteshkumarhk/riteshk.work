# Ambient music

The flyout ("···" menu → **Ambience**) plays a looping ambient track with
play/pause and next/previous controls.

To give it something to play, drop up to three tracks in this folder:

```
audio/1.mp3
audio/2.mp3
audio/3.mp3
```

- Any web audio format works (`.mp3`, `.m4a`, `.ogg`); keep files a few MB for fast loading.
- Use music you own or that is licensed for the web (royalty-free / Creative Commons).

## Changing titles or paths

Add a `music` array to `content.json` to override the defaults:

```json
"music": [
  { "title": "After Hours", "src": "/audio/1.mp3" },
  { "title": "Velvet",      "src": "/audio/2.mp3" },
  { "title": "Slow Burn",   "src": "/audio/3.mp3" }
]
```

## Notes

- Browsers block audio autoplay, so playback begins on the visitor's **first
  interaction** (a click, tap or key press). Their play/pause choice is remembered.
- To make the site silent by default, set `localStorage["rk:music:on"] = "0"`,
  or simply leave this folder empty (the player then shows an "add tracks" hint).
