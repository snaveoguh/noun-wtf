# NOUNS CAMP shots + perf (2026-10-31, branch `claude/camp-spawn`)

Shots: dev server, headless Chromium (SwiftShader), `?offline=1&skip=1&q=low&bday=0`, HUD hidden.

| File | What |
|---|---|
| `1-spawn-desktop.png` / `1b-spawn-phone.png` | The first spawn: inside CAMP facing the window, at sunset |
| `2-book-on-the-table.png` | MEME VALUE on the coffee table: a stack (cover up) and an open copy |
| `3-room-from-window.png` | The room from the window: whiteboard (van plans), poster, NOUNS CAMP tag, the ramp |
| `4-ramp-and-pool.png` | The mini ramp across the back, the pool table |
| `5-back-wall.png` | Boarded door, CONDEMNED notice, tape, the tag |
| `6-through-the-window.png` | At the window: the walkway, the stair head, the city |
| `7-on-the-stairs.png` | About halfway down the scissor stair |
| `8-landed-on-the-roof.png` | Off the exit deck, over the parapet, on the ring roof |
| `9-camp-from-the-plaza.png` | The tower from the plaza |

## Perf: weak phone profile (moto g06 / Mali-G52 / 4 GB, 6× CPU), production build

`.claude/perf-shots/harness/measure.cjs <url> weak <out> idle,interior,camp`. Raw JSON in `.claude/perf-shots/data/camp/`.

| Scenario | Draws | Tris | CPU p50 / p95 ms |
|---|---|---|---|
| plaza-idle (`?spawn=plaza`) | 229 | 150k | 50.5 / 99.7 |
| pocket room (nearest plaza door) | 49 | 43k | 29.0 / 44.3 |
| CAMP spawn, no portal cull | 163 | 176k | 47.8 / 81.7 |
| CAMP at the window, no portal cull | 183 | 197k | 43.7 / 106.5 |
| **CAMP spawn, portal cull** | **32** | **39k** | **31.7** / 101.9 |
| **CAMP at the window, portal cull** | **65** | **71k** | **34.9 / 63.1** |

CAMP itself is 5 draws (solid, glow, art, glass, the stair) and ~23k triangles. Frame times under SwiftShader are bounded by software rasterising, so compare draws, triangles and CPU ms (see `.claude/perf-shots/README.md`).
