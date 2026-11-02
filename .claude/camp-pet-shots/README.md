# CAMP pet (MOCHI): browser shots and perf

Branch `claude/camp-pet`. Design concepts (the owner picked MOCHI) are in `concepts/`.

## Shots (headless Chromium, SwiftShader, dev build, `?offline=1`)

Desktop, 1280×800:

| File | What |
|---|---|
| `01-fridge-asleep.png` | MOCHI asleep on CAMP's fridge (the faint pink perch glow), rider across the room |
| `02-fridge-awake-close.png` | Walk up: it sits up and watches you |
| `03-adopt-prompt.png` | Within reach of the fridge: ADOPT MOCHI — E (the MURAL chip steps aside) |
| `04-adopt-card.png` | The card: name, how it follows, ADOPT |
| `05-follow-camp.png` | Adopted: running beside you in CAMP |
| `06-follow-plaza-run.png` | Running beside you across the plaza |
| `07-flying-by-board.png` | Flying by your shoulder on a board |
| `08-on-head.png` | ON HEAD: sat on top of a Noun head |
| `09-asleep-beside.png` | You stood still 25 s: curled up asleep beside you (seen from behind) |
| `10-remote-pets.png` | Other players' pets (simulated riders sending `pt`) |
| `phone-01-adopt-prompt.png` | Phone (390×844, touch, `low`): ADOPT MOCHI — TAP |
| `phone-02-adopt-card.png` | The card on a phone (tapped open, then a name typed and ADOPT tapped: saved) |
| `phone-03-following.png` | Following on the plaza, phone (the pet icon is in the right-hand column) |

The shots step the game by hand (`window.__w2.step`), moving the rider by position; the follow code reads the rider's measured speed, so this is the same as walking.

## Perf

Weak-phone profile from `.claude/perf-shots/harness/measure.cjs` (moto g06 UA, Mali-G52, 6× CPU throttle, `low` at 0.75, texture diet; SwiftShader, so compare CPU ms, draws, programs, not fps). One production build of this branch, measured twice: `PET=1` (an adopted pet; each of the 16 simulated riders sends `pt`, a third of them flying) against the same build with `EXTRA=pet=0` (no pets). Raw JSON in `perf/`.

| Scenario | Pets | CPU p50 / p95 ms | `net` lap ms (mean) | Draws | Tris | Programs | Heap MB |
|---|---|---|---|---|---|---|---|
| plaza-idle | off | 57.9 / 96.8 | 0.79 | 226 | 145k | 55 | 108 |
| plaza-idle | on (yours) | 50.2 / 87.2 | 1.34 | 226 | 156k | 57 | 107 |
| remotes-16 | off | 85.2 / 151.1 | 5.99 | 311 | 227k | 55 | 155 |
| remotes-16 | on (yours + 16) | 94.8 / 156.1 | 14.61 | 325 | 264k | 57 | 178 |

- **Your pet:** +2 programs (the skinned toon material and its shadow pass, linked once), about +11k triangles, no measurable CPU (idle p50 is within run noise).
- **16 other players' pets:** +14 draws (one each; no shadows on `low`), +37k triangles, CPU p50 +9.6 ms at 6× (about 1.6 ms of a real frame). A CPU profile of that run puts the pets' own code at ~2% of main-thread time (stepping, the head-height read, posing); most of the rest is the extra draws. Heap varies by ±20 MB between runs (GC timing).
- **Already cheap by design:** one skinned draw per pet, no textures (nothing for the texture diet or the tablet light diet), no shadows for others' pets, not drawn past 55 m, others' pets step every 2nd frame (4th past 20 m) and their `pt` is decoded only when a new blob arrives.
- **Next if needed:** read others' head height from the root instead of `getWorldPosition` (a third of their per-frame cost), and skip posing others' pets past 20 m.
