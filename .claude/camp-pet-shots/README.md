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

See the table below (filled in from `.claude/perf-shots/harness/measure.cjs`, `PET=1`, the same production build with `?pet=0` as the baseline).
