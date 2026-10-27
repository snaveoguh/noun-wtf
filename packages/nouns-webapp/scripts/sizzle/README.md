# Sizzle reels

The homepage hero's clips (`public/home/hero-*.{webm,mp4}` + `-poster.jpg`)
are cut from real gameplay, rendered frame by frame in headless Chromium.
Everything here is re-runnable: change a shot or an edit list, render, cut.

| File | What |
| --- | --- |
| `shots.mjs` | Every shot: its scene, frame count, and a page-side `setup(arg)` that stages the moment and installs `window.__sizzleFrame` (advance one 1/30 s frame, leave it drawn). |
| `scenes.mjs` | Scene openers: Noun World (`world`), the Big Drop (`bigdrop`), a Noun Breaks battle (`breaks`), Noun Hoops (`hoops`), the 3D Grand Exchange (`exchange`). They stop the game loop and install `__sz` / `__bd` / `__d` / `__gx` helpers. |
| `edits/*.json` | Edit lists: which shots, in and out points, crossfades, grade, exact length, poster time. One per clip. |
| `render.mjs` | Renders the shots an edit list (or `--shots a,b`) needs into `.frames/<shot>/f0000.jpg…` (git-ignored), opening each scene once. |
| `cut.mjs` | Cuts the frames into `<name>.webm` (VP9) + `<name>.mp4` (H.264, faststart) + `<name>-poster.jpg` in `public/home/`. |
| `lib.mjs` | Browser launch, the clean-frame CSS, the frame loop. |

## Run it

The shots use dev-only handles (`window.__w2`, `__gx3d`, `__w2.breakDev()`),
so they need the **dev server**, not a build. In this container use your own
vite with HMR and file watching off (`.claude/skills/world-browser-test`):

```bash
# from packages/nouns-webapp, vite on 5318 with hmr:false, watch:null
node scripts/sizzle/render.mjs --base http://127.0.0.1:5318 --edit scripts/sizzle/edits/big-drop.json
node scripts/sizzle/cut.mjs scripts/sizzle/edits/big-drop.json
```

- `--preview` renders every 6th frame only, for a contact sheet before the real render.
- `--skip-done` leaves shots that already have all their frames.
- `SIZZLE_Q=low|medium|high` sets Noun World's quality (default `medium`).
- `SIZZLE_CHROMIUM` points at a Chromium binary (default `/opt/pw-browsers/chromium`).

Without a GPU, Chromium renders with SwiftShader: 1–3 s a frame, and Noun
World takes minutes to load. A 12 s reel is about 360 frames, so budget
10–20 minutes a scene. Run one render at a time.

## The reels

| Clip | Edit list | Slide (`home/rows.ts`) |
| --- | --- | --- |
| `hero-sizzle` | `edits/sizzle.json` | `sizzle` (the brand slide, under `vo-intro.mp3`) |
| `hero-big-drop` | `edits/big-drop.json` | `big-drop` |
| `hero-breaks` | `edits/breaks.json` | `breaks` |
| `hero-exchange` | `edits/exchange.json` | `exchange` |

After cutting, set the slide's `ms` in `rows.ts` to the clip's real length
(`ffprobe -v error -show_entries format=duration -of csv=p=0 public/home/<name>.mp4`):
the carousel moves on when the clip ends.

### The main sizzle (`edits/sizzle.json`)

It plays once under the voice-over, so it must be **exactly** the VO's
length: `"length": 26.28` (VO_SECONDS is 26.26 in `home/voiceOver.ts`;
`cut.mjs` holds the last frame to pad). Its cuts sit on the VO's phrase
breaks (found with a speech-band energy envelope of `vo-intro.mp3`; the
spooky bed defeats plain `silencedetect`), and the last shot lands on
"...Welcome to Noun." at about 25.4 s and holds.

Cuts marked `"placeholder": "cars"` (or `pool`, `hide-seek`) stand in for
features still being built; they use existing shots for now. When a
feature lands: add its shots to `shots.mjs`, point the placeholder cut's
`shot` at them, drop the `placeholder` key, then render and cut again.
Keep the durations, so the cuts stay on the VO.
