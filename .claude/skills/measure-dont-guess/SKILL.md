---
name: measure-dont-guess
description: Turn a player's "it feels broken" report (can't walk upstairs, board hovers, camera too close, tags don't load, toast keeps popping up, crash on my phone) into a measured browser repro with numbers, find the cause from the numbers, fix it, and re-measure. Use for any game / 3D / UI bug report where reading the code alone isn't conclusive.
---

# Measure, don't guess

Reading code produces plausible stories; numbers from the running thing find the actual bug. Every fix below came from a probe, and several first guesses were wrong.

## The loop

1. **Restate the report as something measurable:** "can't go upstairs" → the rider's height along the stairs' run.
2. **Drive the real app headless** (Playwright + dev handles like `window.__w2`):
   - stop the loop (`g.running = false`) and step it (`g.step(1/60)`) so results are deterministic;
   - place the subject exactly (teleport to the foot of the flight) and feed inputs (`g.input.keys.add('KeyW')`).
3. **Log a few numbers every few frames,** as JSON: position, state, height over the ground, camera distance, which floor / level.
4. **Read the shape of the numbers,** not just the end state:
   - stops at exactly one body radius before an object → an invisible collider is there;
   - drop per frame growing 0.03 → 0.18 → 0.44 m → free fall, not a slope;
   - the same 6.3 cm everywhere on flat ground → a constant offset in the model, not physics.
5. **Probe the suspect directly.** Cast rays into the physics world at the spot; dump what the world actually holds (triangle counts, bounding boxes); compare against what the code thinks it holds.
6. **Fix, restart the dev server** (no watcher means old code), **re-run the same script** and show before / after numbers.
7. **When a tightened rule breaks other tests,** read what those tests protect before "fixing" them. Usually: keep the old behaviour, add the new one behind a flag or quieter path.

## Cases worth remembering (noun.wtf, 2026-10-27)

| Report | Probe | Cause | Fix |
|---|---|---|---|
| Can't walk upstairs | Rider z/y along the flight | Stopped 0.32 m (body radius) before step 1: the stairs item was `solid`, so it got a full-height collision box | No box for walk-through items; the ramp is the collider |
| Then: fall back down at the top | Rays down onto the landing; dump the world's dynamic collider | Only floor 0's 246 tris. MeshBVH indexes geometry in place, so `mergeGeometries` got indexed + non-indexed parts and returned null, silently | `toNonIndexed()` before merging; warn on a null merge |
| Snowboard hovers | Board mesh's lowest vertex vs the terrain height | 6.3 cm: built at the skateboard deck height, which includes wheels | Lower rider + board by the base height |
| Camera too close / line across the screen | Camera distance and height while riding | Pulled-back camera sat under the slope behind; the obstruction check yanked it in | Lift it over the slope first, then check obstruction |
| "NEW RECORD" 10× for the same 471 | Stored best vs shown value | 471.31 beat 471.29; both display "471" | Announce only when the shown number rises; still save quietly |
| My graffiti didn't load | Count stored walls, time one batch | 2,041 walls, 40 per batch, sequential, unordered | Nearest-first, 4 batches in flight |
| Tag floats off to one side | Where the label anchor is vs where the characters stand | Anchored at the NPC's spawn point, not the characters | Anchor at the characters' centroid |
| X opens missions in the car | Which listener sees the key | Missions listened regardless of driving | Ignore it while driving |
| Black square in the fountain | What's drawn there | An invisible hitbox; the outline pass ignores `material.visible` | `mesh.visible = false` (raycasts still hit) |

## Gotchas

- **Kill dev servers by PID** from a separate command. `pkill -f` / `pgrep -f` with a pattern that appears in your own command line kills your shell (exit 144).
- **A first probe that measures the wrong thing:** e.g. a locked feature never activated. Check the precondition before reading numbers.
- **Screenshots can be useless** if an overlay covers them: hide UI first.
- **Headless WebGL is software (SwiftShader):** slow, so give scripts long timeouts and run them one at a time.
