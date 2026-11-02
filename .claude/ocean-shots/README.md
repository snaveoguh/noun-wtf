# The ocean off Puerto Noun: browser shots + perf (2026-11-02)

Headless Chromium on SwiftShader against the vite dev server (`world-browser-test`
skill), `/world?offline=1&skip=1&bday=0&play=surf`. The game loop is frozen and
stepped (`g.step(1/30)`) with `__w2.ocean.manualClock` so the waves step with the
sim; `__w2.ocean.surfAuto()` lets the line-up bot surf the rider.

| Shot | What |
|---|---|
| `1-surfer-on-a-wave.jpg` | the game's surf camera mid-ride (q=low) |
| `2-surfer-close.jpg`, `3-surfer-town-behind.jpg`, `9-two-surfers.jpg` | riding down the line, a local surfer alongside, Puerto Noun behind (q=high: the ink pass outlines the crests) |
| `4-ocean-from-the-beach.jpg` | from the ocean beach below the boardwalk: the surf zone and the line-up buoys |
| `5-sunset.jpg`, `6-dusk.jpg` | the same view at golden hour and blue hour |
| `7-surf-shop.jpg`, `8-surf-shop-panel.jpg` | the surf shop on stilts off the boardwalk, and its counter (E) |
| `phone-*.jpg` | 390×844 touch layout while riding |

Scripts: `shots.cjs` (`SP=<dir> WHICH=ride,beach,sunset,shop [PHONE=1] node shots.cjs`),
`cover.cjs` (the cover frames), `perf.cjs` (`Q=low|high`).

## Perf (`?perf=quiet`, 25 s windows, real loop, surfing / paddling at the line-up)

Phone profile (393×852 touch, `q=low`), dev build, no CPU throttle. Compare CPU ms
and draws, not fps (SwiftShader rasterises on the CPU).

| | CPU p50 / p95 | `character` lap (ocean.frame runs in it) | draws | triangles | programs |
|---|---|---|---|---|---|
| with the ocean | 9.2 / 32.4 ms | 2.98 ms (p95 7.8) | 58 | 85k | 60 |
| ocean + life hidden | 8.7 / 14.6 ms | 2.22 ms (p95 4.1) | 57 | 72k | 60 |

- The surface is one draw and ~14k triangles on `low` (78×88 grid). Buoys, boats and gulls are three instanced draws; the three local surfers are Nouns (their builds are a frame each, one a frame: the 6 long tasks, max 69 ms, in the first window).
- No new programs while playing: the surface links hidden (`warmHidden`) when it's built.
- ~0.8 ms/frame for the sea's CPU side here (the rider's water step, three locals' sims, floating 11 buoys / 3 boats on the CPU waves, 16 gulls).
