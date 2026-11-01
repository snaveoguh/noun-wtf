# Skydiving browser check (2026-11-01)

Dev build, `?offline=1&skip=1&q=low&bday=0&camintro=0`, headless Chromium (SwiftShader), the game
loop frozen and stepped at 1/60 from `window.__w2`. The rider is put just outside CAMP's window
(146.6 m) moving out at 3 m/s; the PULL is `skydive.ctl.pullQueued = true` once under 80 m clear.

| shot | state |
| --- | --- |
| foot-1-freefall | freefall, 105 m clear, 107 km/h down, belly pose |
| foot-2-opening | canopy opening (open 0.45), 69 m, 45 km/h |
| foot-3-canopy | full canopy, 55 m, 6.0 m/s down |
| foot-4-landed | landed on the plaza on foot, grounded, canopy gone |
| board-1-freefall | skysurfing on the board |
| board-3-canopy | under canopy on the board (landed `ground`, no bail) |
