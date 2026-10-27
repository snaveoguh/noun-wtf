# Shot list

Every shot in `shots.mjs`: its scene, length (frames at 30 fps), what's in
it and the reels that use it. ✅ = checked frame by frame in a contact sheet;
⚠️ = written but not yet checked (look at a `--preview` before you use it).

## The Big Drop (`bigdrop`, `/world?drop=1`)

| Shot | Frames | What | Used in |
| --- | --- | --- | --- |
| `bd-summit` ✅ | 75 | Dropping in off the summit: low camera ahead of the rider, looking back up at them. | big-drop 0:00, sizzle |
| `bd-chase` ✅ | 75 | The game's own chase camera at 520 m/s, carving; ranges and the giant Noun behind. | big-drop 0:01.6, sizzle (cars placeholder) |
| `bd-speed` ✅ | 75 | Side-on at 420 m/s, the slope tilted across the frame, forest whipping past. | big-drop 0:03.4 |
| `bd-kicker` ✅ | 90 | A track kicker (lip ≥ 8 m) from the side: approach, launch, hang time. | big-drop 0:04.9 |
| `bd-loop` ✅ | 150 | Into the first rideable loop and round it (the game camera's loop rig). Last in its scene. | big-drop 0:07.1, sizzle |
| `bd-basin` ✅ | 90 | The basin under the aurora, a slow orbit round the rider. | (spare) |
| `bd-basin-air` ✅ | 90 | A basin kicker with the NPC free-ride pack round the rider, aurora overhead. | big-drop 0:09.2, sizzle (parkour placeholder) |
| `bd-herd` ✅ | 90 | Riding at a herd of noggle yaks on the basin; they bolt as the rider comes through. | big-drop 0:10.7, sizzle |

## Noun Breaks (`breaks`, the `breakDev()` battle in the plaza)

| Shot | Frames | What | Used in |
| --- | --- | --- | --- |
| `brk-intro` ✅ | 60 | The battle camera's overhead opener: the cypher, crowd, DJ, lights. | breaks 0:00 |
| `brk-toprock` ✅ | 60 | First turn, toprock in front of the NOUN BREAKS booth. | breaks |
| `brk-sixstep` ✅ | 50 | Six-step footwork, low. | breaks |
| `brk-windmill` ✅ | 60 | Windmill (held move). | breaks, sizzle |
| `brk-headspin` ✅ | 75 | Headspin (held move). | breaks (poster), sizzle |
| `brk-airflare` ✅ | 50 | Airflare (held move). | breaks |
| `brk-freeze` ✅ | 45 | Airchair freeze. | breaks |
| `brk-judges` ✅ | 70 | The judges' table raising their cards. | breaks (last) |
| `brk-crowd` ✅ | 50 | Between rounds, the wide overhead on the crowd. | (spare) |
| `brk-winner` ✅ | 50 | The result, at the DJ booth. | (spare) |

## Grand Exchange (`exchange`, `/exchange?offline=1`)

| Shot | Frames | What | Used in |
| --- | --- | --- | --- |
| `gx-descent` ✅ | 60 | The scene's own drop-in through the roof onto the floor. | exchange 0:00 |
| `gx-shout2` ✅ | 60 | Pit 3 at head height, the crowd shouting orders. | exchange |
| `gx-shout` ✅ | 75 | Pit 0, turning round the pit with the tickers above. | exchange, sizzle (pool placeholder) |
| `gx-pullout` ✅ | 165 | From pit 0 up past the GRAND EXCHANGE board, out over the walls to VAST: halls to the horizon. | exchange 0:05.1 (poster), sizzle (open + end) |
| `gx-trade` ⚠️ | 120 | Frames a fresh trade's meeting point. Often lands in an empty aisle; not used. | — |

## Noun World (`world`)

| Shot | Frames | What | Used in |
| --- | --- | --- | --- |
| `w-skate` ⚠️ | 60 | Skating with ollies and grabs, side-on. | sizzle |
| `w-skate2` ⚠️ | 60 | Skating and carving, orbit camera. | sizzle (hide-seek placeholder) |
| `w-cafe` ⚠️ | 60 | In through a cafe or bar door, orbit in the room. | — |
| `w-fountain` ⚠️ | 84 | Down the Noggles Fountain into the Grand Exchange. Last in its scene. | — |

## The reels

### hero-big-drop (12.83 s)
summit drop-in → chase at 520 m/s → side-on speed → kicker air → the loop
→ (crossfade, day into aurora) basin kicker with the NPC pack → the yak herd.

### hero-breaks (11.57 s)
overhead cypher → toprock → six-step → windmill → headspin → airflare →
freeze → judges' cards.

### hero-exchange (10.63 s)
drop through the roof → pit 3 shouting → pit 0 → (crossfade) the pull-out
past the board and over the walls to VAST.

### hero-sizzle-gameplay (26.28 s, not rendered or wired yet)
Cuts on the VO's pauses (see README). Placeholders, to be swapped for the
real thing when each game lands:

| At | Cut | Now | Becomes |
| --- | --- | --- | --- |
| 0:06.3 | 5 | `bd-chase` | cars |
| 0:13.2 | 7 | `gx-shout` | pool |
| 0:17.0 | 9 | `w-skate2` | hide & seek |
| 0:20.95 | 11 | `bd-basin-air` | parkour |
