# NOUN LINKS view: shots + perf (2026-11-02)

Headless Chromium, SwiftShader (software GL), port 5320,
`/world?offline=1&skip=1&q=<high|low>&bday=0&perf=quiet&camintro=0`, driven by
`golfshots.cjs` (in this folder): the loop is stopped and stepped by hand
(`perf.frameStart` → `warmer.tick` → `game.step` → `perf.frameEnd`), the rider is
teleported with `game.golfView.pose(shot)` and the camera pinned through
`game.camHook`. Time of day `afternoon`. The `air` / `top` shots thin the fog to
a quarter (dev shots only). Phone = 390 × 844, `isMobile`, `q=low`.

SwiftShader frame times are GPU bound and meaningless: compare CPU ms, draws,
triangles, and the course's own lap.

## Numbers (90 stepped frames after the course had finished building)

`golf draws / tris` = the frame with the course's group in the scene minus the
same frame with it removed (renderer.info, shadow pass included).
`lap` = Game's `towns` perf lap, which holds `golfView.update` (towns +
landmarks + golf), mean / max ms.

| spot | q | CPU p50 / p95 ms | all draws | all tris | golf draws | golf tris | programs | lap mean / max | trees drawn | overlay verts |
|---|---|---|---|---|---|---|---|---|---|---|
| clubhouse | high | 7.7 / 12.2 | 341 | 1.06 M | 32 | 710 k | 73 | 0.10 / 0.3 | 1009 | 180 k |
| mid (7th tee) | high | 5.4 / 10.6 | 250 | 1.19 M | 36 | 652 k | 73 | 0.10 / 0.3 | 908 | 139 k |
| clubhouse | low (phone) | 2.9 / 7.6 | 137 | 200 k | 10 | 89 k | 57 | 0.10 / 0.8 | 411 | 152 k |
| mid (7th tee) | low (phone) | 2.3 / 6.5 | 79 | 178 k | 13 | 126 k | 57 | 0.18 / 7.4 | 340 | 111 k |

Worst CPU frame in each window was a SwiftShader render frame (the `render`
lap, 2–13 s, the first frame after the teleport), never the course.

### Building

- Unit test (node, unloaded): the whole course (21 far overlays, 7 near, the
  scenery, ponds, trees) builds in ~340–400 frames at the 3 ms budget, ~1.3 s
  of CPU in all; median slice ≈ 3 ms, worst single step ≈ 10 ms (the scenery).
- Browser (SwiftShader, CPU shared with the software GPU): worst single build
  step 9–11 ms in most runs (`golfView.stats.worstStep`, e.g. `h18:0` 9.3 ms,
  `h14:1` 11.1 ms). Two high runs each logged one outlier step of 108 / 183 ms
  in a different near-overlay job each time (`h9:0`, `h17:0`), consistent with
  a GC pause on the ~1 GB SwiftShader heap rather than the job itself (the same
  jobs take < 10 ms in the other runs). Worth a look on a real phone with
  `?perf=1` before calling it fixed.
- Far away (> 1.2 km in the course's own frame, e.g. the plaza) update() is one
  distance test; nothing is allocated.

## Shots

| file | what |
|---|---|
| `air-high.jpg` | from the air over the clubhouse (fog thinned) |
| `top-high.jpg` | straight down on the 1st's fairway (stripes, bunker, path) |
| `tee1-high.jpg`, `tee1-phone-low.jpg` | the 1st tee (noggle tee markers) |
| `green-high.jpg`, `green-phone-low.jpg` | the 1st green, flag 1 |
| `clubhouse-high.jpg`, `clubhouse-phone-low.jpg` | clubhouse: glass front, terrace, NOUN LINKS board, giant noggles |
| `island-high.jpg`, `island-phone-low.jpg` | the 15th, ISLAND |
| `noggle-high.jpg` | the 19th, THE NOGGLE green, and its pond |
| `range-high.jpg` | driving range: bays, canopy, distance boards, targets |
| `entrance-high.jpg` | the NOUN LINKS entrance arch at the −u end |
| `air-phone-low.jpg`, `perf-*.jpg` | phone aerial, the perf spots |
| `perf-high.json`, `perf-low-phone.json` | raw snapshots |
