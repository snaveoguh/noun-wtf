# Noun World on tablets: "my kid says it stalls a lot", 2026-11-01 (branch `claude/tablet-stalls`)

The device isn't known yet (probably an iPad, maybe an Android tablet). "Stalls" was read as freezes of a second or more, and possibly reloads from a lost WebGL context or a memory kill.

## Method

- **Builds.** Two production builds (`vite build` with a config minus `vite-plugin-checker`), served by `../harness/serve.cjs`:
  - **before**: `main` plus the probe's hitch log (aed8ef4);
  - **after**: the branch head.
- **Browsers:**

  | Profile | Engine | Viewport | Notes |
  |---|---|---|---|
  | `ipad-land` | Playwright WebKit (WPE, iPad Safari's engine) | 1180×820 @2 | iPadOS UA (Mac UA + 5 touch points) |
  | `ipad-port` | WebKit | 820×1180 @2 | same |
  | `droid-tab` | Chromium, 4× CPU throttle | 1280×800 @1.5 | Android tablet UA, Adreno 618, 6 GB |

- **The session** (`session.cjs`) is what a kid does:
  - the real first load: CAMP spawn, fly-in, reading;
  - walking out of CAMP's window (the fall);
  - 16 riders arriving at the plaza;
  - skating;
  - the mountain;
  - entering and leaving a room;
  - a car;
  - NOUN BREAKS vs CPU;
  - mural mode with 12 strokes;
  - 4 minutes of skating about, with a sample every 20 s.
- **What's recorded.** Each scenario saves `window.__w2perf.snapshot()` (`?perf=quiet`) plus process RSS from `/proc`.
  - The probe now keeps a **hitch log**: every frame whose own work took over 50 ms, or whose gap was over 3× the running median and 100 ms. Each entry lists the systems that ran in that frame, so a stall names its cause.
  - The adaptive controller is frozen, as in the earlier passes.
- **`ladder.cjs`** leaves the controller running on an iPad. Software GL is slow, so it walks all the way down. It records each rung change and the worst frame around it.
- **Profiles.** `PROF=1` saves Chromium `.cpuprofile`s, read with `../harness/topself.py` / `under.py`. WebKit has no CDP profiler here; its numbers come from the hitch log.
- **Reading the numbers.** Both engines rasterise WebGL on the CPU here, so frame intervals and the `render` lap include software raster and mean nothing about a real GPU. Compare the CPU max (one frame's own work), what ran in it, programs, draws, heap and RSS.

## What a tablet got (before)

- iPads and Android tablets already boot `low`; `isMobile` knows iPadOS. They do **not** land on desktop High.
- But `low` drew at render scale 1: ~1 MP a frame (1180×820, 1280×800), 3× a phone's ~0.33 MP, on a phone-class GPU, through the scene plus a full-screen ink pass. Not "weak", so no texture diet; 1024 shadow map.
- A tablet whose GPU can't keep up walks the adaptive ladder down. The last two rungs (shadows off, ink off) relinked every lit material.

## Causes found (by size of the freeze)

| # | Stall | Where (measured) | Cause |
|---|---|---|---|
| 1 | Adaptive ladder's shadows-off / ink-off steps | iPad: programs 55→79 then 85→122; frames of **0.6 s and 3.4 s** | `castShadow = false` changes every lit program's shadow count; post-off rendered straight to the screen, changing the output colour space. Every material relinked. |
| 2 | Riders arriving (joining a busy room, a crowd) | iPad `net` **952 ms** in one frame; Android **4.3 s**, then `decks` 1.2 s | Every new rider's Noun built in the same frame. Each new head's texture used a canvas `filter: blur()` + `getImageData`: in Chrome ~40 ms a head unthrottled, 550 ms the first. A rider with no custom deck cloned their deck materials, and every clone of a toon material serialised its source material's textures (`toDataURL`) through three's `JSON.stringify` userData copy (`userData.toonSrc`). |
| 3 | Entering a room (black screen) | iPad `interiors` **3.4 s** + a 4.4 s gap; Android 3.1 s + 0.9 s | Room + floor above built in one frame (the z-fight pass tests ~300k face pairs a pass on a floor plane); residents' head textures as in 2. |
| 4 | NOUN BREAKS starting | iPad 1.2 s; Android 1.8 s, then 1 s frames | The crowd's Nouns (head textures, as in 2); the stage's 7 new programs linked on first sight. |
| 5 | Mountain teleport / fast streaming | iPad `mountain` 0.3–0.5 s; car ~0.1 s at 4× | Chunk props + ring cull at speed. Not changed; a teleport isn't how anyone arrives. |

Checked and **not** a cause:
- **Memory growth.** 4 min soak, after GC: Android heap 161 → 162 MB; textures, geometries and programs flat. iPad web process RSS swings 2.50–2.78 GB with GC, no trend. RSS includes software GL's copies, so it's only comparable to itself.
- **Reloads.** One page load per run, no lost contexts.
- **The 63 MB house voice.** Touch devices never auto-load it (`autoVoicesOk`).
- **YouTube / audio.** Nothing in the hitch log.

## Changes

1. **No rung relinks** (`render/Graphics.ts` `applyLite`):
   - Shadows off keeps `castShadow`; the sun's map is cleared once (depth 1, all lit) and frozen (`shadow.autoUpdate = false`), so the shadow pass stops drawing.
   - Ink off sets the ink effect's blend to `DST`: its pass only copies to the screen and rebuilds just its own full-screen shader.
   - Screenshots: `shots/after-on.jpg`, `after-noshadow.jpg`, `after-noink.jpg`.
2. **A phone's pixel budget on `low`** (`render/deviceTier.ts` `budgetScale`, tested). Boot scale ≤ √(0.6 MP / CSS area), in 0.05 steps, never under the 0.6 floor. Tablets boot at ~0.75 (iPad 9th gen 0.8, iPad Pro 12.9 0.65); every phone stays at 1.
3. **Head texture in JS** (`character/softenAtlas.ts`, tested). Bilinear upscale + the same Gaussian σ + posterise, folded into one few-tap filter per axis: ~7–10 ms warm in V8, no readback. Against Chrome's canvas output: mean 3.6/255, never more than 2 posterise steps; crisp art identical.
4. **`toToon`'s `userData.toonSrc` is non-enumerable** (`render/Toon.ts`, tested). Clones no longer serialise textures. On a clone it used to be a JSON husk, which would have crashed `dispose()`.
5. **One new remote rider a frame** (`Game.updateNetwork`, `REMOTE_BUILDS_PER_FRAME`). `setDeckGraphic` returns early for a stock deck.
6. **Rooms:**
   - The floor above is built on the next frame, still behind the black fade (`upperPending`).
   - `findFights` bins each plane cell along one in-plane axis and tests candidates in the original order. Output is byte-identical (hash of every vertex, 80 rooms of every kind); `buildKit` total 6.1 → 4.9 s over 80 rooms.
7. **Breaks:** the battle stage links hidden during the 3 s countdown (`warmHidden`, 1.5 s cap). Needs `KHR_parallel_shader_compile`: WebKit has it, headless Chromium's SwiftShader doesn't, real Android GPUs usually do.
8. **Probe:** `hitchLog` in the snapshot (`perf/perfStats.ts` `isHitch` / `topSystems`, tested).

## Before / after

"CPU max" is the single worst frame's own work: the freeze. The system named is the biggest one in that frame.

### iPad (WebKit), landscape 1180×820

- Before: `low` @1, buffer 1180×820.
- After: `low` @0.75, buffer 885×615.

| scenario | CPU max before → after (ms) | worst frame, before → after |
|---|---|---|
| CAMP intro | 1072 → **236** | render 911 → render 190 |
| walk out of the window | 293 → 139 | render |
| 16 riders arrive | 1153 → **493** | net 952 → net 239 (one Noun) |
| skate | 234 → 216 | render |
| mountain (teleport) | 473 → 503 | mountain 317 → 382 (unchanged) |
| enter a room | 3728 → **1688** | interiors 3367 → 1618 (gap 4449 → 2298) |
| leave a room | 166 → 152 | |
| car | 160 → 157 | |
| NOUN BREAKS | 1192 → **419** | |
| mural | 287 → 237 | |

**Adaptive ladder, iPad** (`ladder.cjs`, skating, controller live):

| step | before: programs, worst frame | after: programs, worst frame |
|---|---|---|
| shadows off | 55 → 79, **587 ms** | 55 → 55, 92 ms |
| ink off | 85 → 122, **3352 ms** | 55 → 56, 89 ms |

### iPad (WebKit), portrait 820×1180 (shorter session)

| scenario | CPU max before → after (ms) |
|---|---|
| CAMP intro | 474 → 474 |
| 16 riders arrive | 1080 → **284** (net 993 → 189) |
| enter a room | 1017 → 1047 (a lighter room than landscape's; unchanged) |
| NOUN BREAKS | 318 → 279 |

### Android tablet (Chromium, 4× CPU), 1280×800 @1.5

- Before: `low` @1, buffer 1280×800.
- After: `low` @0.75, buffer 960×600.

| scenario | CPU max before → after (ms) | worst frame, before → after |
|---|---|---|
| 16 riders arrive | 4441 → **449** | net 4322 → net 372 |
| enter a room | 3156 → **1051** | interiors 3091 → 991 |
| NOUN BREAKS | 1763 → 1519 | shader links (no parallel compile in SwiftShader) |
| mountain (teleport) | 708 → 602 | |
| car | 177 → 166 | mountain 125 → 63 |
| CAMP intro / escape / skate | 1232–1293 → 1036–1443 | render: SwiftShader first-use waits, in both builds |
| soak (after only), heap after GC | 161 → 162 MB over 4 min, flat | |

Full tables (frame p50 / p95, draws, programs, heap): `python3 table.py data/` (it reads `{base,new}-<profile>.json`).

### Phones and desktop (no regression; `../harness/measure.cjs`, `SEED=1`)

- **mid phone** (`low` @1 both builds):
  - plaza / skate / remotes / interior frame p50s match `main`;
  - remotes CPU p95 158 → 101 ms;
  - room entry's longest task **2888 → 682 ms**.
- **desktop** (`high`):
  - draws and programs unchanged (plaza 700 / 710, programs 72 / 73);
  - room entry's max frame 5117 → 1917 ms.
  - The after plaza-idle window caught one 1.8 s frame; the base run has the same ~1.7 s long task.
- Data: `data/final-{base,new}-{mid,desktop}.json`.

## Re-running

```bash
S=<scratch>; T=.claude/perf-shots/tablet
# WebKit for Playwright 1.54 (outside /opt/pw-browsers, which is read-only for this):
PLAYWRIGHT_BROWSERS_PATH=/tmp/claude-0/pw node packages/nouns-webapp/node_modules/playwright/cli.js install webkit
node packages/nouns-webapp/node_modules/playwright/cli.js install-deps webkit
# build (see ../desktop/README.md for the checker-free vite config), serve, run
node .claude/perf-shots/harness/serve.cjs $S/build 5302 &
node $T/session.cjs http://127.0.0.1:5302 ipad-land $S/new-ipad-land.json      # all scenarios, ~8 min
node $T/session.cjs http://127.0.0.1:5302 droid-tab $S/new-droid-tab.json camp,remotes,room,breaks
PROF=1 node $T/session.cjs ...                     # Chromium .cpuprofile per scenario
node $T/ladder.cjs http://127.0.0.1:5302 $S/ladder.json 90
node $T/rungshots.cjs http://127.0.0.1:5302 $T/shots after
python3 $T/table.py $S
```

- `WEBKIT=<pw_run.sh>` points at another WebKit.
- Profiles: `ipad-land`, `ipad-port`, `droid-tab`, `droid-weak` (the same tablet at 4 GB / Mali-G52, which takes the weak path and the texture diet).

## Known limits / next steps

- **No real tablet yet.** When the device is known, run `?perf=1` on it:
  - the overlay's `adaptive: rung n/m` should settle without long freezes;
  - `__w2perf.snapshot().hitchLog` names whatever still stalls.
- **Room entry** is still ~1–1.7 s of black on an iPad here: the room's kit (~60 ms a floor unthrottled), its art atlas, window views and residents. Slicing `goIn` across frames behind the fade is the next step.
- **A new Noun** still costs ~40 ms unthrottled: smooth-head distance field + normals, voxel merge, body texture. One a frame keeps it to one hitch per Noun. A worker or a per-head geometry cache across sessions would remove it.
- **NOUN BREAKS without parallel compile** (headless Chromium) still links its 7 programs on start. Pre-warming them when you walk up to the cypher would cover that.
- **Stepping back up** across the shadow / ink rungs is now hitch-free too. The controller still only steps up across scale rungs.
