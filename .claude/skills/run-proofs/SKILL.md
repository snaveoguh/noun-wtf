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
  - The trace never fills: at 60k samples everything older than a minute is thinned (`decimate`).
  - Raising `kmh`, `airM` or `airS` attaches the trace as a proof (a jump keeps the trace as it was on landing, with the jump's time range kept at full rate). Posts go out about 3 s later.
  - **A proved record only ever goes out in the same post as its proof.** `flush` strips every proved key from `best` and adds back only the ones whose proof is in that post. Beacons carry none. A proof bigger than `PROOF_SAMPLES` (20k samples) is trimmed with `trimTrace` (start, state changes, fastest sample and the jump kept; it re-checks with `verifyRun` before sending).
  - A proof is let go only when the server's answer says what happened (`you.best` holds it, or `rejected` names it). No answer, an error or an unreadable body keeps it for the next post.
  - Proved bests with nothing pending follow the server's `you.best`, so a value the server doesn't hold can never be re-claimed bare.
  - Unproven raises are **kept out of the saved local bests**. A pending proof is stored on page hide (`noun-world-stats-pending`, tagged per tab so tabs don't clear each other's) and re-posted on the next load.
  - A refused record rolls back to the server value and shows a "⚠ RECORD NOT SAVED: <reason>" card with REPLAY and APPEAL (`replay/Records.ts`, `replay/RecordsUi.tsx`). The ride is kept in IndexedDB (`replay/replayStore.ts`).
- **Appeals** (`netlify/lib/appeals.ts`): APPEAL first re-sends the claim with its ride (fixes any "no proof"); if still refused it's filed (one open per rider per record, 700k-char trace cap, 100 open, 200 closed). Admin review at `/world?appeals=1` with the `WORLD_ADMIN_TOKEN` Netlify env var: replay, approve (writes the record to the rider's row), reject (with a note the rider sees).
- **Server** (`netlify/functions/world-stats.ts` → `netlify/lib/runProof.ts`):
  - `verifyRun(trace, { strict })` returns `{ ok, reason, maxV, airs }`.
  - `provenCaps` turns proofs into per-key caps, and a claim above its cap is refused.
  - Every refusal is logged to Blob `noun-world-stats/rejections` (the last 40, with traces) so it can be replayed.

## The checks

| Check | Rule | Catches |
|---|---|---|
| Energy budget | `½v² + g·y` may only grow by push (below 8.6 m/s), pop (one ollie per take-off) and the streak (0.35 m/s² per minute × distance, minus 80% of the least drag + friction a rolling interval loses: tucked, dirt line, `run` = all distance so far). Budget: records `250 + 0.02·keGain`, strict `60 + 0.002·keGain` | speed hacks, steeper-hill fakes |
| Ceiling | any sample over `MAX_V` (6,000 m/s; records go to 20,000 km/h) | broken numbers |
| Start | first sample ≤ 40 m/s (strict 25) | starting fast |
| Terrain band | below `baseHeight − 140 m` fails (strict also above-band on the ground) | sinking or noclip |
| Motion (strict only) | distance ≤ `vavg·dt·1.3 + 1.5` | teleports in drop claims |
| Air fit | air samples fall at g = 12.5: one or more clean arcs (residual ≤ 0.35 m) joined at brief bumps (≤ 0.25 s), with upward kick summed over the whole air ≤ 1.5 m/s | fake hang time, hover |

Keep `PHYS` in `runProof.ts` in step with `skate/Player.ts` (`DEFAULT_TUNING`, `STREAK_ACCEL`). The game's air is pure ballistics, with no drag.

## Debugging a player report

1. **Map the reason to its cause:**
   - **"no proof sent with the claim"** (older builds: "no proof"): the claim arrived without a proof. Fixed causes: a reload before the post (pending proofs); a proof deleted on any HTTP 200 before the answer was read, leaving the best claimed bare forever; stale local bests (old builds, another tab, a browser re-linked to a new wallet) posted with every flush; a full trace (60k samples) silently stopping records. Any new case is a client bug: a proved key must never be in `best` without its proof.
   - **"proof too big" / "proof dropped":** the post carried a proof the server couldn't use (over 2M chars, or more than 3 proofs).
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
