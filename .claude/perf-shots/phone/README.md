# Noun World phone pass 2, 2026-10-29 (branch `claude/world-perf-phone`)

The owner's report after the first pass: "Still slow AF on my Motorola" (Moto G06: Helio G81, Mali-G52 MC2, 4 GB). Their `?perf=1` on production at the plaza:

```
5 fps  frame p50 149.9  p95 516.3  p99 965.8  max 1599 ms  hitches 330
cpu p50 57.6  p95 188.8 ms   long tasks 360 (max 6294 ms)
draws 577  tris 175k  progs 54  tex 1382  geo 1641   411×817 @1.00
quality: low            (not "low (weak)", and no adaptive line)
render 53.15 | other 15.88 | graffiti 6.61 p95 46.00 | ...
```

## Method

- **Builds.** `vite build` of the base (`claude/world-perf-desktop` head, 8fa987b) and of this branch, served by `harness/serve.cjs`.
- **What's new in the harness:**
  - `Q=low` saves Low in Settings before boot, which is what the owner's phone had.
  - `GRAFFITI=<store.json>` paints the live wall store as offline tags. The store was read once, read-only: `GET /.netlify/functions/world-graffiti?level=plaza`. That's 2,528 cells and 7,004 tags (~1 MB); the index is in `data/graffiti-index.json`.
  - The offline harness used to have no paint at all, which is why the first pass never saw graffiti's cost.
  - `BREAKDOWN=1` counts one frame's draw calls and triangles per scene branch, with the shadow pass apart.
  - `probe.cjs` lists what each Noun draws and what casts.
  - `wallshot.cjs` shoots the most-painted wall, or (with `PLAZA=1`) the plaza view.
- **Profiles:** as before.
  - `weak`: Moto G06 UA, Mali-G52 string, 4 GB, 412×915 @2.6, 6× CPU, run with `Q=low` and the graffiti.
  - `mid`: Pixel 7, 4× CPU, auto quality, graffiti.
  - `desktop`: `high`, graffiti.
  - SEED=1, same spawn and view, adaptive controller frozen.
- **SwiftShader can't show Mali GPU cost.** Frame intervals here are software-raster bound. Compare draws, triangles, textures, programs, CPU ms and heap; the owner's next `?perf=1` screenshot is the ground truth for fps.

## Causes, ranked by what they cost

1. **Graffiti: ~2,500 painted cells, one mesh, one material and one canvas texture each.** At the plaza on the weak profile (saved Low):
   - **~516 of 838 draw calls** were graffiti cells, transparent, so they're sorted every frame too.
   - **~1,300 of the textures** were cell textures. The owner's 1,382 is the same thing.
   - **~340 cells sit within 35 m** of the plaza's centre, and every one became a sharp 512×256 canvas (some 1024 / 2048 wide). That's ~180 MB of canvases plus their mipmapped GPU copies, on a 4 GB phone.
   - Promoting 12 cells every 0.2 s (every frame at 5 fps) redrew all their strokes: graffiti was 40 ms a frame in the harness (owner: p95 46 ms).
   - Every cell mesh also rebuilt its matrix every frame.
2. **A saved Low switched off every phone protection.** `Game.ts` only ran the weak check, the 0.75 boot scale, the texture diet, the 512 shadow map, the context-loss watch and the adaptive ladder when quality was `low` **and auto**. The owner had picked Low, so the phone drew at 1.00 scale, with no diet, and never stepped down even at 5 fps. That's why their screenshot said `quality: low` and had no `adaptive` line.
3. **The shadow pass drew everything that set `castShadow` itself**, ~40–55 draws at the plaza:
   - the van, cars and props;
   - NPC heads that load after `setCastShadows(false)`;
   - the board's 12 truck and wheel primitives.

   To find them, it walked the whole scene graph every frame.
4. **Static NPC props are dozens of primitives.** The Keymaker's board of keys is 39 meshes, the Oracle's table about 25: one draw each, every frame.
5. **Mountain dressing** in view from the plaza: ~70 draws (300 m on `low`).

The brief's guess that phones draw the scene twice was wrong. On `low` the ink pass already reads depth only (no NormalPass), and the clamps don't get a pass of their own. It's RenderPass, then one full-screen ink pass.

## What changed

- **`bootPlan`** (`render/deviceTier.ts`, tested). A phone that picked Low gets everything auto gets: the weak check, boot scale, texture diet, 512 shadow map, context-loss watch and the **full** phone ladder.
  - Why the full ladder: Low is a request for speed. Every rung is lighter than Low, so stepping down never undoes the choice.
  - `?q=low` on a desktop stays as chosen (scripts, comparisons).
  - No settings migration: with this, a saved Low on a phone behaves exactly as auto does. Migrating it would only throw the player's choice away.
- **Graffiti on `low`** (`graffitiOptions`). Desktop / medium / high are unchanged; the desktop run's draws and breakdown are identical to before.
  - **Far cells become tiles in atlas pages,** one mesh of quads per page: **~516 draws → 5**.
    - `graffiti/atlas.ts` is the pure layout. Tiles are power-of-two sized and aligned, so mips stay inside a tile. It's tested, including the flipY UV / GL-row maths.
    - `graffiti/farBatch.ts` copies a cell's small canvas into its tile with a straight `texSubImage2D` (one bind and one `generateMipmap` per page per frame, at most 48 tiles a frame). three's `copyTextureToTexture` reads five GL parameters per call: ~12 ms a tile at 6×. All 2,528 tiles now copy in ~120 ms in total.
    - Pages stay zero-filled until tiles are copied in, and a restored context re-copies them.
  - **Sharp cells are close in and capped** (`lodTuning`, tested). Weak: within 12 m (kept to 18), at most 16, 256 px, no bigger tiers. Other phones: 20 m / 28 m, at most 40, 512 px, 1024 ×6, 2048 ×1. Over the cap the nearest win, with a little hysteresis so two cells at the edge don't swap.
  - Cell meshes don't rebuild their matrices (`matrixAutoUpdate = false`, desktop too: same pixels).
- **Weak phones:**
  - The shadow map is drawn from the rider's subtree alone (`gfx.shadowRoot`, a wrapper on `shadowMap.render`, only for the game's scene).
  - The board casts by its deck only. The shadow pass is now ~14 draws.
  - Dressing is drawn within 180 m.
  - The ladder ends on a 0.5 render-scale rung (`WEAK_LAST_SCALE`), after shadows and ink. Before them, 0.5 on a ~410 px wide phone would be a ~205 px picture to save less than the features cost.
- **`render/mergeStatic.ts`** (tested) merges a static prop group per material and shadow flags. On `low` it's used on the plaza NPCs' props. Same materials, same triangles.
- **`?perf=1`** now shows, for the owner's next screenshot:
  - `quality: low (weak) picked`;
  - `device: WEAK · <GPU string> · 4 GB · 8 cores · mobile` (the weak verdict and what it was judged on);
  - `render: scale 0.75  ink on  post on  shadows 512`;
  - `adaptive: rung 0/4`;
  - `graffiti: 2528 cells, 16 sharp, far: 5 pages, 0 queued, 2519 copies 121 ms`;
  - draws / tris / textures as before.

## Before / after: weak phone, saved Low, live graffiti (6× CPU)

| scenario | build | frame p50 / p95 / p99 ms | CPU p50 / p95 ms | render ms | graffiti ms | draws | tris | textures | programs | heap MB | long tasks (max ms) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| plaza-idle | before | 633 / 1667 / 1667 | 330 / 1288 | 330 | 11.4 | 855 | 235k | 780 | 51 | 191 | 17 (1301) |
| plaza-idle | after | 583 / 1483 / 1483 | 186 / 1430 | 202 | 10.7 | 275 | 170k | 202 | 54 | 123 | 19 (1469) |
| skate-loop | before | 850 / 1600 / 1600 | 494 / 1179 | 520 | 22.7 | 718 | 202k | 1371 | 52 | 147 | 17 (1048) |
| skate-loop | after | 533 / 733 / 766 | 169 / 631 | 163 | 9.2 | 236 | 165k | 223 | 54 | 122 | 29 (763) |
| remotes-16 | before | 733 / 1117 / 1117 | 364 / 606 | 311 | 16.6 | 733 | 332k | 1747 | 53 | 233 | 17 (786) |
| remotes-16 | after | 617 / 933 / 933 | 307 / 490 | 219 | 4.2 | 469 | 241k | 364 | 54 | 172 | 18 (632) |
| interior | before | 417 / 850 / 1933 | 80 / 265 | 59 | 31.7 | 57 | 41k | 2130 | 57 | 196 | 20 (465) |
| interior | after | 333 / 700 / 717 | 60 / 133 | 45 | 6.0 | 53 | 35k | 371 | 56 | 167 | 31 (172) |
| big-drop | before | 333 / 983 / 1233 | 120 / 285 | 96 | 12.9 | 292 | 86k | 2043 | 73 | 221 | 36 (327) |
| big-drop | after | 233 / 383 / 417 | 128 / 190 | 99 | 3.5 | 344 | 102k | 395 | 76 | 178 | 59 (237) |

- Room entry: 19.7 s → 11.0 s, worst frame 983 → 417 ms, longest task 947 → 374 ms.
- Big Drop entry: longest task 2126 → 1516 ms (hitches 39 → 56).
- An earlier, shorter run of the same profile, before the shadow and NPC changes, had CPU p50 443 → 145 ms at the plaza.
- Under SwiftShader at 6×, nearly every frame is over 50 ms, so the long-task *count* means little here. The max is the useful number.
- The texture count before is whatever had loaded so far: it climbs as you look round, because every cell's texture uploads the first time it's drawn.

## Mid phone (Pixel 7 profile, auto Low, live graffiti, 4× CPU)

| scenario | build | CPU p50 / p95 ms | render ms | draws | tris | textures | heap MB |
|---|---|---|---|---|---|---|---|
| plaza-idle | before | 234 / 542 | 204 | 852 | 214k | 698 | 152 |
| plaza-idle | after | 116 / 256 | 82 | 326 | 217k | 189 | 129 |
| skate-loop | before | 268 / 1197 | 361 | 683 | 193k | 1489 | 179 |
| skate-loop | after | 125 / 1168 | 245 | 282 | 195k | 212 | 151 |
| remotes-16 | before | 238 / 357 | 192 | 741 | 329k | 1785 | 250 |
| remotes-16 | after | 252 / 456 | 206 | 472 | 329k | 365 | 156 |

The mid profile isn't weak, so it keeps its full shadows and 300 m dressing. The gain is graffiti alone.

## Desktop (high, live graffiti): unchanged

Plaza draws are 1,666 before and after, and the per-branch breakdown matches (graffiti 227 draws both). Textures are 902 both. The batch, the LOD caps, the shadow root and the prop merge are all phone-only. The one desktop change is `matrixAutoUpdate = false` on graffiti cells, which gives the same pixels.

## Screenshots

- `before-plaza.jpg` / `after-plaza.jpg` / `before-after-plaza.jpg`: weak profile, saved Low, live graffiti, plaza spawn.
  - Before: 1.00 scale. After: 0.75 (the weak boot scale), so it's a bit softer.
  - The riders differ: this script doesn't fix the seed.
  - The rider's shadow is drawn in both. It was checked separately with the shadow-root path on and off: the same frame.
- `wall-atlas-vs-cells.jpg`: the most-painted wall (372 tags), from 30 m through a 12° lens.
  - Left: the phone atlas (a 64 px tile, weak). Right: `q=medium`, per-cell textures.
  - The same art lands in the same place and the right way up. The atlas is softer at this zoom.
  - The wall behind differs because phones don't draw the facades' fine detail.
- `before-after-bigdrop.jpg`: the harness's last frame (the Big Drop start), for the look.

## Tests

- `npx vitest run src/miniapps/world2`: 146 files, 1,476 tests, all green.
- New or extended tests:
  - `render/deviceTier.test.ts`: `bootPlan`, `deviceLine`;
  - `render/qualityController.test.ts`: the weak ladder's last rung;
  - `graffiti/lod.test.ts`: tuning, the cap, hysteresis, a pinned cell;
  - `graffiti/atlas.test.ts`;
  - `render/mergeStatic.test.ts`.
- Typecheck (`NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`): 0 errors. `@nouns/sdk` / `@nouns/assets` were built in this container.

## Known limits

- **No real-device numbers.** The headless runs show the CPU, draw and texture side. They can't show whether the Mali is still fill-bound at 0.75 with the ink pass. If it is, the ladder steps down to 0.6, then shadows off, then ink off, then 0.5. The picked Low now lets it.
- **The Big Drop draws more on the weak profile** (292 → 344). Not explained yet: the breakdown was only taken at the plaza. Its frame times and textures improved.
- **The rider is still ~26 draws** (the board alone is 15 primitives: animated wheels, swappable deck materials), and other Nouns are 11–50 each. Merging a Noun's static parts per bone is the next draw-call win.
- **Online, graffiti arrives in 40-cell store batches** and PartyKit messages; the harness paints all 2,528 cells in one go. The steady state is the same; the arrival hitches online weren't measured. Each batch now paints small canvases and queues tile copies (48 a frame), with no texture uploads per cell.
- **The owner's 6.3 s long task and the 16 ms `other` bucket weren't reproduced here.** Every step lap in `Game.step` is accounted for in the harness. The likeliest source of both is the first draw of hundreds of graffiti textures (a burst of uploads), which is gone on phones. If `other` is still large on the G06, the early-return paths (showroom, hoops, freestyle, cutscene) don't lap and are the next place to look.

## What to check on the G06

Open `noun.wtf/world?perf=1` (keep Low saved), skate round the plaza for ~20 s and screenshot the overlay.

1. `quality: low (weak) picked` and `device: WEAK · Mali-G52 …`. If it says `not weak`, the GPU string or memory isn't what we expect, and the screenshot shows what it is.
2. `render: scale 0.75 …` at first. If fps is still under ~26, `adaptive: rung` should climb over the next ~10 s (0.6 → shadows off → ink off → 0.5) and `render:` changes with it.
3. `graffiti: … far: 5 pages, 0 queued …`, with draws around 250–350 and tex around 200–400. The old numbers were 577 and 1,382.
4. fps, frame p50 / p95, `long tasks (max …)`, and the `graffiti` / `render` / `other` rows. Send it over.

## Re-running

```bash
S=<scratch>
cd packages/nouns-webapp && NODE_OPTIONS=--max-old-space-size=10000 npx vite build --outDir $S/build-new
node .claude/perf-shots/harness/serve.cjs $S/build-new 5302 &
curl -s 'https://noun.wtf/.netlify/functions/world-graffiti?level=plaza' > $S/gidx.json   # then fetch ?ids= batches of 40 into gstore.json
SEED=1 Q=low GRAFFITI=$S/gstore.json BREAKDOWN=1 node .claude/perf-shots/harness/measure.cjs http://127.0.0.1:5302 weak $S/final-new-weak.json
python3 .claude/perf-shots/harness/phone_table.py $S
```
