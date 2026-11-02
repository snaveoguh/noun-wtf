# Sizzle reels

The homepage hero's clips (`public/home/hero-*.{webm,mp4}` + `-poster.jpg`)
are cut from real gameplay, rendered frame by frame in headless Chromium.
Everything here is re-runnable: change a shot or an edit list, render, cut.

| File | What |
| --- | --- |
| `shots.mjs` | Every shot: its scene, frame count, and a page-side `setup(arg)` that stages the moment and installs `window.__sizzleFrame` (advance one 1/30 s frame, leave it drawn). |
| `scenes.mjs` | Scene openers: Noun World (`world`), NOUNS CAMP (`camp`: the CAMP spawn, its opening shot replayed seeded via `__camp.intro(seed)`), the plaza on a missingnoun (`missingnoun`), the Big Drop (`bigdrop`), a Noun Breaks battle (`breaks`), Noun Hoops (`hoops`), the 3D Grand Exchange (`exchange`), the pool hall (`pool`), NOUN PARKOUR (`parkour`), Noun Warfare (`warfare`, `__wf`: slow motion via `frame(speed)`). They stop the game loop and install `__sz` / `__bd` / `__d` / `__gx` / `__pl` / `__pk` helpers. |
| `edits/*.json` | Edit lists: which shots, in and out points, crossfades, grade, exact length, poster time. One per clip. |
| `render.mjs` | Renders the shots an edit list (or `--shots a,b`) needs into `.frames/<shot>/f0000.jpg…` (git-ignored), opening each scene once. |
| `cut.mjs` | Cuts the frames into `<name>.webm` (VP9) + `<name>.mp4` (H.264, faststart) + `<name>-poster.jpg` in `public/home/` (or the edit list's `out`), at 1920×1080 (or its `size`), with a bitrate ceiling (`maxrate`, default 2.4 Mbit/s) so a 12 s clip stays under ~4 MB. |
| `SHOTLIST.md` | The shot list: every shot, what's in it, and which reel uses it. |
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
- `--limit N` renders only each shot's first N frames (a quick framing check).
- `--skip-done` leaves shots that already have all their frames.
- `SIZZLE_W=960 SIZZLE_H=540` renders smaller (4× faster) for previews; the default is 1920×1080.
- The dev server needs `@nouns/assets` and `@nouns/sdk` built (`pnpm build` in each), or the app won't load.
- Its type-checker plugin can run the dev server out of memory; drop it from your local config (filter plugins whose name matches `checker`).
- `SIZZLE_Q=low|medium|high` sets Noun World's quality (default `medium`).
- `SIZZLE_CHROMIUM` points at a Chromium binary (default `/opt/pw-browsers/chromium`).

Without a GPU, Chromium renders with SwiftShader: 1.2–2 s a frame at
1080p on 4 cores (Noun World ~1.2 s, the exchange ~1.9 s), and Noun World takes
1–2 minutes to load. A 12 s reel is about 360–450 frames once in/out
handles are counted, so budget 10–15 minutes a reel. Run one render at a
time.

## The reels

| Clip | Edit list | Slide (`home/rows.ts`) |
| --- | --- | --- |
| `hero-sizzle-gameplay` | `edits/sizzle.json` | not wired yet: the future brand slide, under `vo-intro.mp3` (cut to a new name so it can't overwrite the current `hero-sizzle`) |
| `hero-big-drop` | `edits/big-drop.json` | `big-drop` |
| `hero-breaks` | `edits/breaks.json` | `breaks` |
| `hero-exchange` | `edits/exchange.json` | `exchange` |
| `hero-parkour` | `edits/parkour.json` | `parkour` |
| `hero-pool` | `edits/pool.json` | `pool` |
| `hero-warfare` | `edits/warfare.json` | `warfare` |

### Social clips (`public/clips/`)

Short clips for socials, each in vertical 1080×1920 (`-v`) and horizontal
1920×1080 (`-h`), not wired into the homepage. Their edit lists carry
`"size"`, `"out": "public/clips"` and `"frames"` (`.frames-v` for the
vertical renders, so they never mix with the 1920×1080 frames of the same
shots); `render.mjs --edit` renders at the edit's `size`
(`SIZZLE_SCALE=0.5` for a half-size preview). A vertical frame gets a
wider lens than the game's (`sz.fovK`, a shot's `portraitK`, default
≈1.4): the game's fov is vertical, so 9:16 at the same fov sees a sliver.

| Clip | Edit lists | What |
| --- | --- | --- |
| `camp-flyin-{v,h}` | `edits/camp-flyin-{v,h}.json` | CAMP's opening shot (seed 3): over the plaza, in through the window, into the rider's eyes, flicking through MEME VALUE. Ends before the pull-out (the camera passes through the rider's head there). |
| `camp-jump-{v,h}` | `edits/camp-jump-{v,h}.json` | Run at CAMP's window, leap, 146 m down the tower, roll the landing. |
| `missingnoun-skate-{v,h}` | `edits/missingnoun-skate-{v,h}.json` | A missingnoun rider (`?seed=1-13-31-138-7-m`) skating the plaza with flip tricks: side, orbit, chase. |

```bash
node scripts/sizzle/render.mjs --base http://127.0.0.1:5321 --edit scripts/sizzle/edits/camp-flyin-v.json --edit scripts/sizzle/edits/camp-jump-v.json
node scripts/sizzle/cut.mjs scripts/sizzle/edits/camp-flyin-v.json
```

### Music

A reel can carry a soundtrack: add `"music": { "file":
"scripts/sizzle/music/<track>.mp3", "in": 0 }` to its edit list and
`cut.mjs` muxes it in (AAC in the mp4, Opus in the webm, faded out over
the last 0.9 s, loudness-normalised to −16 LUFS). Set `audio: true` on the
slide's clip in `home/rows.ts`: the hero plays it only once the visitor
turns sound on. `music/` holds excerpts of the owner's Suno tracks, each
already starting where it should (the Drop from 0:59.3 of the full song,
Breaks, Grand Exchange and Sink the Eight (pool) from 0:00, Beat Your Ghost (parkour, the second take) from 0:30, Imperial March to the Core (warfare) from 0:00). To add music to a clip whose frames
are gone, `sh scripts/sizzle/mux.sh public/home/<clip> scripts/sizzle/music/<track>.mp3`
swaps the audio in without touching the video.

After cutting, set the slide's `ms` in `rows.ts` to the clip's real length
(`ffprobe -v error -show_entries format=duration -of csv=p=0 public/home/<name>.mp4`):
the carousel moves on when the clip ends.

### The main sizzle (`edits/sizzle.json`)

It plays once under the voice-over, so it must be **exactly** the VO's
length: `"length": 26.28` (VO_SECONDS is 26.26 in `home/voiceOver.ts`;
`cut.mjs` holds the last frame to pad). Its cuts sit on the VO's phrase
breaks, found with a speech-band (300–3400 Hz) energy envelope of
`vo-intro.mp3` (the spooky bed defeats plain `silencedetect`): pauses at
1.3, 3.6, 6.3, 8.0, 9.75, 13.2, 15.4, 17.0, 18.5, 20.95, 23.2 and 25.0 s.
The cut durations are the gaps between them. The last shot (the
exchange pulling out to VAST) runs under "...Welcome to Noun." at about
25.4 s and holds.

To swap it in: cut it, check it, then point `CLIPS.sizzle` in `home/rows.ts`
at `hero-sizzle-gameplay.*` (or rename the files). `VO_SECONDS` stays.

Cuts marked `"placeholder": "cars"` (or `pool`, `hide-seek`) stand in for
features still being built; they use existing shots for now. When a
feature lands: add its shots to `shots.mjs`, point the placeholder cut's
`shot` at them, drop the `placeholder` key, then render and cut again.
Keep the durations, so the cuts stay on the VO.

### NOUN POOL (`edits/pool.json`)

Every pool shot starts from a table worked out offline with the pure pool
sim (`POOL` in `shots.mjs`): rack seed 56's break drops six, then a straight
pot, a 35° cut into a corner and a staged finish on the 8. The sim is
bit-deterministic, so the page plays exactly those shots. To find new
ones, run the sim from Node (`tsx`) over `pool/sim/rules.ts` `playShot`
and `pool/sim/cpu.ts` `candidates` / `powerFor`. `__pl.cam` places the
camera in the table's frame; the aiming guide is switched off (it's the
shooter's HUD), the called pocket stays.

### NOUN PARKOUR (`edits/parkour.json`)

The parkour shots are scripted runs of the three routes (`PK_RUNS`):
pilot phases that hold the stick, sprint, jump and duck like a player
would, each ending on a condition (`until`) over the rider and the move
the engine is in. Every move is the engine's own. The pilot pins the
control yaw to 0 so a run never depends on where the chase camera was
left, which makes it deterministic across shots. A shot runs its route
silently for `from` s, then rolls. `pk-ghost` runs LAMP LINE once to set a
best, then starts 0.5 s behind its ghost. To tune a run, trace it in a
live page (`__pk.pilot(phases)`, then `__pk.trace(n)` lists the moves with
the step each began on).

## Adding a game (cars, pool, hide & seek, parkour…)

1. **Scene.** If the game opens from Noun World, reuse `world` (or write an
   opener in `scenes.mjs` like `openBigDrop`: `openWorld`, then a page-side
   `install…` that stops the game's own loop and leaves helpers on
   `window`). A standalone page gets its own opener like `openExchange`:
   go to it, wait for its dev handle, cancel its rAF loop, and give it a
   `step()` that advances 1/30 s and draws.
2. **Shots.** Add a setup function and entries to `SHOTS` in `shots.mjs`.
   A setup stages the moment (place the player, pin a move, pick a camera)
   and installs `window.__sizzleFrame` (advance one frame, draw) and,
   if it can, `window.__sizzleSkip` (advance without drawing, for previews).
   Each shot should stand alone: shots in a scene share one page, so a shot
   that leaves the game changed for good gets `{ last: true }`.
3. **Look before you render.** `render.mjs --shots <yours> --preview` with
   `SIZZLE_W=960 SIZZLE_H=540`, then a contact sheet of the frames.
4. **Cut.** Add the shots to an edit list (`edits/<game>.json`, or the
   placeholder cuts in `edits/sizzle.json`), render at full size, cut.
5. **Wire.** A new hero slide is a `CLIPS` entry plus a `HERO_SLIDES` entry
   in `home/rows.ts` (`clip`, `focus`, `game` or `href` + `cta`), with `ms`
   = the clip's length in ms.
