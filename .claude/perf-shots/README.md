# Noun World perf pass, 2026-10-28 (branch `claude/world-perf`)

## Method

- **Builds.** Two production builds, `vite build`, served statically by `harness/serve.cjs`:
  - **before**: the `?perf=1` probe commit only (7a27f0b);
  - **after**: the branch head.
- **Browser.** Headless Chromium, `harness/measure.cjs <url> <profile> <out.json>`. The measuring code is `world2/perf/PerfProbe.ts` (`?perf=quiet` + `window.__w2perf.snapshot()`).
- **Profiles:**

  | Profile | Viewport | Throttle | Reported GPU | Boots |
  |---|---|---|---|---|
  | **weak** | 412×915 @2.6, moto g06 UA | 6× CPU | Mali-G52, 4 GB | `low` at 0.75 render scale, texture diet |
  | **mid** | 393×852 @3, Pixel 7 UA | 4× CPU | Mali-G710, 8 GB | `low` at 1× |
  | **desktop** | 1280×800 | none | 8 cores | `high` |

- **Fairness.**
  - Each run spawns at the same plaza spot and view: (0, 14), facing +Z.
  - The adaptive controller is frozen, so both builds draw at their boot rung.
  - The run settles for 15 s, then throttling starts.
- **Scenarios:**
  - `plaza-idle`: 12 s standing still.
  - `skate-loop`: 15 s holding W + D.
  - `remotes-16`: 16 simulated riders circling you, fed through `net.ingest` like real pose blobs, after 20 s to build them.
  - `interior`: walk into the nearest plaza door, then 10 s inside; entering and leaving are measured separately.
  - `big-drop`: `missions.enterUpsideDown()`, 20 s, then 15 s riding down.
- **Read the numbers with care.** Headless WebGL is SwiftShader, which rasterises on the CPU:
  - Frame intervals (2–5 fps here) are bounded by software rendering. They aren't phone frame rates.
  - Compare CPU ms per frame (time inside `Game.step`, which is what throttling scales), draw calls, triangles, programs, heap, and long tasks / max frame.
  - A sync GL query waits for SwiftShader to finish the queued frame, so any shader first use costs about a frame of raster here.

## Causes found (ranked by measured impact)

1. **Shader programs were linked mid-play, and the boot precompile built the wrong ones.**
   - `renderer.compile` ran with no render target, so three keyed every program for sRGB screen output. The composer draws into a linear buffer, so those ~40 programs were never used, and every material still linked on first sight.
   - CPU profile, weak profile skating: `getProgramInfoLog` + `getUniforms` were 13% of all main-thread time.
   - Links per 25 s of skating: 10–15 → **0**. Programs: plaza 83–94 → **53**, in a room 158 → **55**, Big Drop 167 → **75**.
   - Fix: `Graphics.asDrawn` everywhere a compile happens, and `ShaderWarmer` for streamed content.
2. **Room entry and stairs froze.**
   - `scene.fog = null` inside a room changed every program's key, so the rider and everything else visible relinked.
   - The floor above was built synchronously 0.4 s after the fade-in. On the weak profile that was a 2.2–3.2 s long task, 65% of it in `zfight.resolveFights`.
   - Building residents spent 69% of its time in `getImageData`: the body texture read a GPU canvas back.
   - Fixes:
     - `clearFog()`;
     - the room's programs link behind the fade (`warmHidden`);
     - the floor above is built behind the fade;
     - the z-fight pass is about 2× faster with byte-identical output (checked on 30 rooms);
     - no readback in `buildBodyTexture`, and the SmoothHead canvas is `willReadFrequently`.
   - In-room p99 frame: 2233 → **517** ms (weak), 1366 → **700** ms (mid). Entry's longest task: 551 → **393** ms (weak).
3. **Draw calls on phones.**
   - From the plaza, the mountain dressing alone was 70–90 draws and 100–140k triangles on a weak phone.
   - The dressing and the nature showcase cast shadows on `low`, about 25 shadow-pass draws.
   - Fix: on `low`, dressing is drawn within 300 m and nothing but the rider casts.
   - Plaza on the weak profile: 355 → **335** draws, 267k → **234k** triangles. Remotes: 553 → **488** draws.
4. **Remote riders' name tags rewrote their `innerHTML` and style every frame.**
   - Each frame also allocated two Vector3s per rider.
   - They now write only on change, using a scratch vector and whole-pixel transforms.
5. **Big Drop entry built all nine scenery systems in one frame.**
   - Three still start on entry; the rest start one a frame.
   - Entry long task: 1886 → **1663** ms (weak); hitches during entry 55 → **54** (weak) and 51 → **43** (mid).
   - What remains is the course, the atmosphere and the terrain grid. They're needed on the first frame; slicing them is a next step.
6. **Adaptive quality.**
   - The old low-tier ladder (an fps average, down only) and the desktop DPR drop are replaced by `render/qualityController.ts`.
   - It reads median and p95 frame times, steps back up when there's headroom (scale rungs only), and stops if it flip-flops.
   - Note: dropping shadows or the ink pass relinks every lit material. Under SwiftShader the controller stepped to post-off within seconds and caused a relink storm (the programs' colour space changes too). That's why the harness freezes it.

The game's own JS was never the main cost. Unthrottled, `Game.step` minus render is about 10% of a frame. Rendering is about 90%.

## Before / after: weak phone (6× CPU)

| Scenario | Build | CPU p50 / p95 ms | Render ms (mean) | Max frame (p99) ms | Draws | Tris | Programs | Heap MB |
|---|---|---|---|---|---|---|---|---|
| plaza-idle | before | 137 / 236 | 129 | 717 | 355 | 267k | 83 | 105 |
| plaza-idle | after | 123 / 172 | 106 | 567 | 335 | 234k | 53 | 99 |
| skate-loop | before | 193 / 606 | 226 | 617 | 388 | 297k | 94 | 100 |
| skate-loop | after | 138 / 431 | 169 | 1100 | 345 | 272k | 53 | 101 |
| remotes-16 | before | 228 / 396 | 203 | 750 | 553 | 378k | 95 | 153 |
| remotes-16 | after | 214 / 361 | 186 | 733 | 488 | 340k | 53 | 149 |
| interior | before | 61 / 79 | 43 | **2233** | 53 | 44k | 158 | 207 |
| interior | after | 57 / 109 | 43 | **517** | 65 | 43k | 55 | 168 |
| big-drop | before | 98 / 177 | 86 | 450 | 328 | 103k | 167 | 225 |
| big-drop | after | 107 / 149 | 89 | 400 | 354 | 102k | 75 | 187 |

Room entry, longest task: 551 → 393 ms. Big Drop entry, longest task: 1886 → 1663 ms.

**Worst frame got worse in skate-loop** (weak 617 → 1100, mid 817 → 1217) and in Big Drop on mid (367 → 633). With ~35 frames per window, p99 is that run's single worst frame. While skating, mountain chunks stream in, and a material the warmer issued a moment earlier can still be first-used before its link is done. Under SwiftShader that first use waits for the whole queued frame. With no links happening mid-play any more (see cause 1), this is probably the queued-frame wait, not compiling. It isn't proven, and a real-phone `?perf=1` run is the check.

## Before / after: mid phone (4× CPU)

| Scenario | Build | CPU p50 / p95 ms | Render ms (mean) | Max frame (p99) ms | Draws | Tris | Programs | Heap MB |
|---|---|---|---|---|---|---|---|---|
| plaza-idle | before | 124 / 274 | 135 | 1067 | 372 | 277k | 86 | 111 |
| plaza-idle | after | 73 / 106 | 60 | 550 | 329 | 236k | 53 | 108 |
| skate-loop | before | 124 / 586 | 173 | 817 | 335 | 262k | 94 | 108 |
| skate-loop | after | 110 / 545 | 173 | 1217 | 341 | 240k | 53 | 108 |
| remotes-16 | before | 160 / 217 | 139 | 550 | 551 | 366k | 94 | 166 |
| remotes-16 | after | 123 / 186 | 99 | 750 | 461 | 326k | 53 | 163 |
| interior | before | 35 / 72 | 29 | **1366** | 53 | 44k | 157 | 211 |
| interior | after | 40 / 80 | 32 | **700** | 53 | 43k | 55 | 135 |
| big-drop | before | 72 / 131 | 64 | 367 | 338 | 105k | 166 | 232 |
| big-drop | after | 73 / 140 | 65 | 633 | 340 | 104k | 75 | 160 |

## Desktop (high, unthrottled): counts only

Software rendering at `high` runs at about 0.5 fps, which leaves 5–11 frames per window. Only the counts mean anything here.

- **Programs:** 97 → 70 (plaza), 175 → 74 (room), 185 → 91 (Big Drop).
- **Draws:** unchanged (971 vs 949 at the plaza). The desktop look is untouched; nothing desktop-visible was cut.
- **Room entry:** max frame 9.1 s → 2.8 s.

## Screenshots

- `before-*.jpg` and `after-*.jpg`: phone 390×844, tablet 1024×1366, phone landscape (after only), desktop 1280×800.
- The tablet before-shot shows the site tray over PUSH / OLLIE. After, the tray is a brand + DESK chip at bottom-left on every touch screen.
- Tray rectangles measured:

  | Device | Before | After |
  |---|---|---|
  | Tablet | (324, 1306) 686×46 | (6, 1334) 174×26 |
  | Phone | (108, 6) 174×26 | (6, 812) 174×26 |

  Desktop is unchanged.

## Re-running

```bash
S=<scratch>
cd packages/nouns-webapp
npx vite build --outDir $S/build-new
node .claude/perf-shots/harness/serve.cjs $S/build-new 5302 &
node .claude/perf-shots/harness/measure.cjs http://127.0.0.1:5302 weak $S/final-new-weak.json
python3 .claude/perf-shots/harness/table.py $S          # reads final-{base,new}-{weak,mid,desktop}.json
```

- `PROF=<scenario|int-enter|drop-enter>` saves a `.cpuprofile`.
- `topself.py`, `under.py` and `longrun.py` summarise a profile: self time, time under a function, and the longest busy run.
- `compiles.cjs` counts `linkProgram` / `getProgramInfoLog` during a skate (`THR=6` throttles).
- The scripts assume the cloud container's paths (`/opt/pw-browsers/chromium`, the repo's node_modules playwright).
- `data/` holds this run's JSON.

## Known limits / next steps

- **No real-device numbers.** Everything here is emulated. Run `?perf=1` on a Moto G06 class phone and an iPhone to get real fps, especially to confirm the warm-up helps on drivers with `KHR_parallel_shader_compile`.
- **Phone rider draws.** Per rider: the board is 15 meshes and the Noun 5–9, so 16 riders ≈ 300 draws. Merging the board's static parts, or a far LOD for remote riders, is the next draw-call win.
- **Big Drop entry** still builds the course and atmosphere in one frame (~1.6 s at 6×).
- **Quality controller rungs.** Dropping shadows or the ink pass relinks every material. Precompiling the next rung's variants in the background, or merging those two rungs, would make that step hitch-free.
- **Upper floors.** Floors above the first are still built when you climb to them (smaller now, still a hitch on phones).
