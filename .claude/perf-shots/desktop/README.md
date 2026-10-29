# Noun World on desktop: heat and freezes, 2026-10-28 (branch `claude/world-perf-desktop`)

Report: desktop machines ran hot (fans, heat, battery) and froze in `/world`.

## Method

- **Builds.** Production `vite build` of `main` (a9a64c1, "before") and of this branch ("after"), served by `../harness/serve.cjs`.
- **Browser.** Headless Chromium, `../harness/desktop.cjs <url> retina <out.json> [scenarios]`. Profile **retina**: 1440×900 @2, reports an Apple M2 GPU and 8 cores, so it boots `high` like a MacBook.
- **What the numbers mean.** Headless WebGL is SwiftShader: it rasterises on the CPU, about 0.4 fps at `high`. So real frame rates can't be read here. What can:
  - **Frames rendered per second on a given display.** `Game.frame` is called with the timestamps of a virtual 60 / 120 / 144 / 240 Hz display, with rendering stubbed, so the game's own loop decides what it renders. This is what scales GPU and CPU load on a real machine.
  - **Megapixels drawn per frame** (viewport area of every framebuffer a frame draws into) and **SwiftShader raster ms per frame** (a 1-px `readPixels` waits for the raster; `gl.finish` doesn't). Raster ms is a relative cost, not a GPU time.
  - **CPU per browser thread** from `/proc` (per state, 12 s) and main-thread task ms/s from CDP `Performance.getMetrics`. Under SwiftShader the GPU process is the rasteriser, so totals saturate at ~365% (4 cores) whenever anything renders.
  - **Memory over time**: JS heap after a forced GC, `renderer.info` geometries / textures / programs, DOM nodes.

## Causes, ranked

1. **No frame-rate cap.** `Game.frame` ran the whole sim + render on every `requestAnimationFrame`: 120 renders/s on a 120 Hz ProMotion MacBook, 144 on a gaming monitor, 240 on a 240 Hz one. That is 2-4× the GPU and CPU work of a 60 Hz screen.
2. **Pixel ratio 2 on Retina** (`high`). 5.2 MP through every pass: scene, normals (the whole scene again), ink, grade, 3 SMAA passes, plus the water pre-pass. 47.9 MP drawn per frame at the plaza (16.8 of it the 4096² shadow map). Raster ablation, one plaza frame: 2.0 → **2300 ms**, 1.5 → **1507-1755 ms**, 1.0 → 1027 ms; SMAA off −13-17%; shadow map 2048 no measurable change in SwiftShader.
3. **Work that never stops.**
   - Giphy billboards: every screen's MP4 decoded all the time, seen or not, paused or not: **~10% of a core** (`renderer/Media` thread) in every state, desk and hidden tab included.
   - The minimap redrew its 2D canvas on every vsync, also behind the NounOS desk while the game was paused (base "paused": 168% total CPU, the compositor redrawing for it).
   - The full-screen map is opaque, but the 3D world kept rendering under it at full rate.
   - The NounOS desk parallax wrote `--rx/--ry` on the root on every vsync while the cursor moved, game up or not. Custom properties inherit, so every HUD element restyled.
4. **Freezes.** No leak found, and nothing desktop-specific beyond the load above:
   - enter + leave a room ×10: heap, geometries, textures, programs flat in both builds;
   - 20 min soak skating and respawning around the plaza: heap after GC 120 → 133 MB in **both** builds (~0.6 MB/min, pre-existing, see limits), geometries plateau at ~530, programs 71 → 73, no long tasks after the first 30 s.
   - The long task on entering a room is raster-bound here (7.0-10.8 s before, 5.4-8.6 s after: fewer pixels). The earlier phone pass already measured its CPU side.
   - The most likely freeze on a real machine is the GPU saturated at 120-144 renders/s × 48 MP plus thermal throttling, which (1) and (2) remove.
5. Checked and not a cause: the house TTS (a worker, single-threaded WASM since the page isn't cross-origin isolated; the rider's bank is pre-synthesised one line at a time); the NOUN BEATS / radio AudioWorklet (~2.5% of a core); rendering in a hidden tab (rAF stops); the settings panel (a 515 ms/s reading in one early run didn't reproduce: 13.8 ms/s).

## Changes

- **Frame cap** (`world2/render/framePacer.ts`, pure, tested; `Game.frame`). Default **60 fps**; Settings → Frame rate: 30 / 60 / max.
  - A tick is skipped if it's early. The schedule moves on by exactly one interval, so a 144 Hz display averages 60 (2-3 vsyncs a frame) and 120 Hz takes every other vsync.
  - A display at about the cap or slower runs every tick, and a late frame never causes a catch-up burst.
  - The sim gets the interval since the last run frame, as it always did. A capped 144 Hz screen steps physics exactly as a 60 Hz screen does (sim seconds per second stay 1.00), so run proofs and records are unchanged.
- **Blurred window → 30 fps; a menu over the game → 30 fps** (`game.coverGame(reason, opaque)`). Settings uses it. The full map (opaque) stops drawing the world (`Graphics.hold`); the sim, network and audio carry on.
- **Render scale:** `high` boots at **1.5** on Retina instead of 2 (`bootScale`); Settings → **Sharp** brings back 2. The ink outline is scaled with the render scale so it keeps its on-screen width (same crop: before at 2, after at 1.5, Sharp at 2, see `crop-1to1-before-after-sharp.jpg`). Phones (`low`) untouched.
- **Desktop quality ladder** (`desktopRungs`): render scale down to the floor, then **SMAA off**, then a **2048 shadow map**. None relinks a material, so the controller steps back up through all of them. A 1× monitor had no rungs at all; now it has two. Frame times are judged against the cap (`pacedTuning`: holding the cap is headroom, a 30 cap isn't "slow"), and not while blurred or covered.
- **Billboard videos** pause past 160 m from every screen (indoors = 4 km up = all paused), while the game is paused, and in a hidden tab.
- **Minimap** redraws at 30 fps (the full map at 60), never while paused.
- **NounOS parallax** loop sleeps while the game is up and once the desk settles.

## Before / after (retina profile)

### Frames rendered per second

| display | before | after | after: sim s per s | after: CPU ms per step |
|---|---|---|---|---|
| 60 Hz | 60 | 60 | 1.006 | 2.15 |
| 120 Hz | 120 | **60** | 1.007 | 2.07 |
| 144 Hz | 144 | **60** | 1.005 | 1.89 |
| 144 Hz, window blurred | 144 | **30** | 1.003 | 2.37 |
| 144 Hz, menu over the game | 144 | **30** | 0.995 | 2.12 |
| 240 Hz | 240 | **60** | 0.999 | 2.08 |

### Pixels

| | before | after |
|---|---|---|
| pixel ratio / drawing buffer | 2 / 2880×1800 | 1.5 / 2160×1350 |
| megapixels drawn per frame (plaza) | 47.9 | 34.3 |
| megapixels per second, 144 Hz screen | 6.9 G | **2.1 G (−70%)** |
| megapixels per second, 60 Hz screen | 2.9 G | 2.1 G (−28%) |
| SwiftShader raster ms per frame | 2300 | 1755 (−24%) |
| draw calls | 971 | 961-1027 (same scene; NPCs move) |

### Background work by state (12 s each)

| state | video decode before → after (% of a core) | main thread ms/s before → after | browser total before → after |
|---|---|---|---|
| playing (plaza) | 9.7 → 6-8 | 38 → 45 (0.4 fps, noise) | 366 → 306-366 (saturated) |
| paused (NounOS desk) | 10.7 → **0** | 29 → 22 | 168 → **107** |
| tab hidden | 10.0 → **0** | 19 → **9** | 258 → 161 |
| window blurred | 9.1 → 6-8 | 20 → 25 | 362 → 233 |
| settings open | 9.2 → 6-8 | 22 → 23-27 | 366 → 224 |
| full map open | 8.8 → 2.4 | 74 → 20-50 | 362 → 200 |

### Memory

| | before | after |
|---|---|---|
| rooms ×10: heap MB | 120 → 124 | 122 → 126 |
| rooms ×10: geometries / textures / programs | 395→485 / 222→238 / 74→75 | 372→476 / 218→235 / 72→72 |
| 20 min soak: heap MB after GC | 120 → 133 | 118 → 133 |
| 20 min soak: geometries / programs | 434→535 / 71→73 | 451→532 / 72→73 |

## Screenshots (same spot, same rider)

- `before-retina.jpg`, `after-retina.jpg`, `after-retina-sharp.jpg` (1440×900 downscales of the 2880×1800 shots).
- `crop-1to1-before-after-sharp.jpg`: a native-resolution crop of the rider, left to right before (2), after (1.5), after + Sharp (2). Outline width matches.
- The coloured facades in the before shot are facade streaming at that moment, not a render change. The Sharp shot (the after build) matches the after one.

## Phones

See the table appended below (weak and mid profiles, `../harness/measure.cjs`, before vs after).

## Re-running

```bash
S=<scratch>; H=.claude/perf-shots/harness
node $H/serve.cjs $S/build 5302 &
node $H/desktop.cjs http://127.0.0.1:5302 retina $S/new.json boot,passes,pacing,threads,rooms
SOAK_STUB=30 SOAK_MIN=20 node $H/desktop.cjs http://127.0.0.1:5302 retina $S/soak.json boot,soak
SHOT=$S/shot.png [SHARP=1] node $H/desktop.cjs http://127.0.0.1:5302 retina $S/x.json boot
REPL=$S/repl node $H/desktop.cjs http://127.0.0.1:5302 retina $S/x.json boot,repl   # drop N.js in $S/repl, read N.js.out
python3 $H/desktop_table.py before.json after.json
```

The perf builds use a vite config without `vite-plugin-checker` (it typechecks workspace packages without node_modules here).

## Known limits / what a real machine should check

- **No GPU here.** Read `?perf=1` on a real 120/144 Hz laptop:
  - **fps** should sit at ~60;
  - **frame p95** should be ≤ ~21 ms;
  - **adaptive** should stay at `rung 0` when there's headroom;
  - **draws**, **programs** and **heap** should stay flat over 20 min.
  
  Also watch fan noise and temperature over 10 min with the defaults, then with Sharp on and Frame rate at max.
- **A cap of 60 on a 144 Hz screen** alternates 14 and 21 ms frames, the usual 60-on-144 cadence. Players who prefer smoothness pick `max`.
- **Heap creep** of ~0.6 MB/min after GC in both builds (20 min soak). It isn't a freeze cause at that rate; a heap snapshot diff over an hour would find it.
- **Room entry** still builds the room in one long task; on desktop it is mostly CPU plus first-frame raster. Slicing it (as the phone pass did for the floor above) is the next step.
- **Video billboards** still decode while you're on the plaza (8% of a core). That's by design: they're on screen.
