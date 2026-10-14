---
name: run-proofs
description: How Noun World's anti-cheat for speed / air height / hang-time records works (ride traces checked against the game's physics) and how to debug a "RECORD NOT SAVED" report without letting cheats through. Use whenever a player says a real record was voided ("no proof", "gains energy from nowhere", "moves faster than its speed", "beyond its proof", "not in its ride proof"), or when touching Stats.ts, runProof.ts, world-stats.ts, Player physics, or drop claims.
---

# Run proofs (Noun World records)

## What happens

- **Client** (`src/miniapps/world2/net/Stats.ts`):
  - A `RunTrace` records the current ride as samples of `[t, x, y, z, speed, state]`, where state is 0 ground, 1 air, 2 grind, 3 manual, 4 bail.
  - It samples every 0.4 s on the ground and every 1/30 s in the air, plus on any state change, on a new top speed, and on a speed jolt over `1 + 0.1·v`.
  - A new trace starts on respawn (the `Player.respawns` counter), on a teleport, on a stop dead from speed, or on getting off the board.
  - Raising `kmh`, `airM` or `airS` attaches the trace as a proof. Posts go out about 3 s later.
  - Unproven raises are **kept out of the saved local bests**. A pending proof is stored on page hide (`noun-world-stats-pending`) and re-posted on the next load.
  - A refused record rolls back to the server value and shows a "⚠ RECORD NOT SAVED: <reason>" toast.
- **Server** (`netlify/functions/world-stats.ts` → `netlify/lib/runProof.ts`):
  - `verifyRun(trace, { strict })` returns `{ ok, reason, maxV, airs }`.
  - `provenCaps` turns proofs into per-key caps, and a claim above its cap is refused.
  - Every refusal is logged to Blob `noun-world-stats/rejections` (the last 40, with traces) so it can be replayed.

## The checks

| Check | Rule | Catches |
|---|---|---|
| Energy budget | `½v² + g·y` may only grow by push (below 8.6 m/s), pop (one ollie per take-off) and the streak (0.35 m/s² per minute × distance). Budget: records `250 + 0.02·keGain`, strict `60 + 0.002·keGain` | speed hacks, steeper-hill fakes |
| Start | first sample ≤ 40 m/s (strict 25) | starting fast |
| Terrain band | below `baseHeight − 140 m` fails (strict also above-band on the ground) | sinking or noclip |
| Motion (strict only) | distance ≤ `vavg·dt·1.3 + 1.5` | teleports in drop claims |
| Air fit | air samples fall at g = 12.5: one or more clean arcs (residual ≤ 0.35 m) joined at brief bumps (≤ 0.25 s), with upward kick summed over the whole air ≤ 1.5 m/s | fake hang time, hover |

Keep `PHYS` in `runProof.ts` in step with `skate/Player.ts` (`DEFAULT_TUNING`, `STREAK_ACCEL`). The game's air is pure ballistics, with no drag.

## Debugging a player report

1. **Map the reason to its cause:**
   - **"no proof":** the claim arrived without a proof. Usually the page reloaded or closed before the post (now fixed by pending proofs), or the trace was over 2 M chars / 60 k samples.
   - **"not in its ride proof":** the proof checked out but holds no matching jump (an air that didn't fit).
   - **"beyond its proof":** the claim is above the proof's cap.
   - **Anything else:** `verifyRun` failed on that check.
2. **Reproduce with a synthetic trace in `netlify/lib/runProof.test.ts`.** Fixtures must be physically honest: drop in from height to gain speed and keep energy, or the energy check rightly fails the fixture itself.
3. **Prove the bug:** the new test must fail on the old code (`git show HEAD:path > path`, run, restore) and pass on the new.
4. **Prove no cheat gets through:** add a cheat case next to every loosening (×1.15 speed, a spike, a sped-up tail, a hover from small kicks, starting fast) and keep them all failing.
5. Ship (`ship-noun-wtf`). Voided records can't be restored from data that was never kept. Say so, and offer a manual admin restore only if the user wants it.

## Principles

- Records mode is deliberately lenient. Players hate losing real rides more than they'd notice a marginal cheat. Strict mode is for drop claims, where a fake steals something.
- Never loosen a check without a cheat test that still fails. Never tighten one without honest rides (crash at speed, bail, rescue, phone frame hitches, tree clip) that still pass.
- Sample what matters (bails, jolts), so the server never has to infer motion it didn't see.
