# Noun Football browser shots (2026-11-02, headless SwiftShader)

Scripts lived in the session scratchpad: load `/world?offline=1&skip=1&q=low|high&bday=0&camintro=0&perf=quiet&play=football`,
wait for `__w2.football.ui.phase === 'menu'`, then `football.vsCpu()` / `football.watch()`, wait for `football.view.pending === 0`.

- `game-menu-low.png`: the menu over the CPU v CPU attract match.
- `game-kickoff-low.png`, `game-shot-low.png`: VS CPU at kick-off, and a free kick waiting for the human (HUD, radar, player tag, set-piece hint).
- `watch-kickoff-low.png`, `watch-shot-low.png`: WATCH (22 CPU footballers), a shot in the air, broadcast camera.
- `perf-cpu-phone-low.png`: phone (390 px) touch layout (the A/B/X/Y cluster was raised afterwards so the radar doesn't cover it).
- `gameplay-playercam-high.png`: the cover's source frame (`public/world2/football-cover.webp`, `public/home/covers/football.webp`).
- `stadium-*.png`: NOUN STADIUM alone (stadium agent). `view-*.png`: the match view on its mock match (view agent).
- The roof shadows in some low-sun shots are gone now (the stadium shell no longer casts shadows).

## Perf, 11-a-side, 22 footballers, real-time loop for 25 s after building (`perf-*.json`)

| run | CPU p50 / p95 | view | render | sim | draws | triangles |
|---|---|---|---|---|---|---|
| desktop 1280×800 `q=low`, WATCH | 23.4 / 40.4 ms | 12.7 ms | 9.5 ms | 1.2 ms | 224 | 379k |
| phone 390×844 `q=low`, VS CPU | 17.0 / 35.5 ms | 7.3 ms | 9.5 ms | 1.6 ms | 156 | 320k |

Stadium build: 21 slices, ~74 ms in all (longest ~17–25 ms). Headless frame intervals are GPU-bound
(software GL), so compare CPU ms and draws, not fps.
