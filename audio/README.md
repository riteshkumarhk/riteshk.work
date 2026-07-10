# Ambient music

The flyout ("···" menu → **Ambience**) plays a looping ambient soundscape with
play/pause and next/previous controls.

## Tracks that ship with the site

Two calm, immersive tracks by **Chris Zabriskie**, licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (free to use with
attribution — the player shows "Chris Zabriskie · CC BY" and links back):

| File                | Track         | Album (year)     | Plays in    |
| ------------------- | ------------- | ---------------- | ----------- |
| `cylinder-two.mp3`  | Cylinder Two  | Cylinders (2014) | dark theme  |
| `oxygen-garden.mp3` | Oxygen Garden | Divider (2011)   | light theme |

Source: [chriszabriskie.com](https://chriszabriskie.com) · downloaded from the
[Internet Archive](https://archive.org/details/Cylinders-15736) and re-encoded to
128 kbps. The mood follows the appearance: switching the theme swaps the track
(dark → Cylinder Two, light → Oxygen Garden).

## Swapping tracks

Edit the `music` array in `content.json` — each entry takes `title`, `artist`,
`license`, `url` (credit link) and `src`:

```json
"music": [
  { "title": "Cylinder Eight", "artist": "Chris Zabriskie", "license": "CC BY", "url": "https://chriszabriskie.com", "src": "/audio/cylinder-eight.mp3" }
]
```

Any web audio format works (`.mp3`, `.m4a`, `.ogg`). Keep files small (a few MB)
and only use music that's licensed for the web (CC BY / CC0 / royalty-free). If
`content.json` has no `music` array, the player falls back to a built-in Web
Audio synth (three moods: Midnight / Ember Glow / Undertow) so it still works
with no files.

## Notes

- The track begins **muted** on load (YouTube-style) and unmutes on the visitor's
  first interaction — a click/tap, key press, or dragging the scrollbar — because
  browsers block *audible* autoplay until then (a plain mouse-wheel scroll does
  not count as an unlock gesture). A small "♪ now playing" toast names the track
  the moment sound starts, and the play/pause choice is remembered.
- The bronze particles around the ··· button loop while music is audibly playing
  and stop when it's muted/paused.
- To make the site silent by default, set `localStorage["rk:music:on"] = "0"`.
