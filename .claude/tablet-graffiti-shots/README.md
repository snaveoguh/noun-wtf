# Mural mode on an emulated iPad (headless Chromium)

`mural-ipad.cjs` drives `/world?offline=1&skip=1&q=low&bday=0&spawn=plaza&camintro=0` (offline: never the live store or room) as an iPad (`isMobile`, `hasTouch`). Landscape is 1180×820 (`land-*`); portrait is `W=820 H=1180 TAG=port` (`port-*`). It needs the non-HMR vite on :5196 (see the world-browser-test skill).

- It finds a flat wall whose visible face is its collider, checked on a 3×3 grid. Many shopfronts are facade boxes in front of their collider, and paint lands behind them. It stands the rider 2.2 m from that wall and opens mural mode.
- Pen strokes go through CDP `Input.dispatchMouseEvent` with `pointerType: 'pen'`, `force` (pressure) and `tiltX`:
  - red: light → hard → light;
  - yellow: swell then fade;
  - blue: steady 0.5.
- Fingers go through `Input.dispatchTouchEvent`: a pinch out, a one-finger pan, a two-finger tap (undo) and a three-finger tap (redo).
- Then FIT, the grid, the colour picker (a pen drag on the SV square), PEN feel, the SIZE pad held with a hard pen, and DONE.

| shot | what |
| --- | --- |
| `*-0-before` | the game, MURAL chip up top |
| `*-1-mural` | squared up to the wall, HUD gone, sidebar / top bar / brushes |
| `*-2-pressure` | the three strokes: width follows pressure (red / yellow), steady (blue) |
| `*-3-zoomed` | pinched to 400 %: the joined runs are one smooth soft stroke, no beads at the joins |
| `*-4-picker-grid` | colour picker + the wall grid (cell seams dashed) |
| `*-5-feel` | PEN FEEL: curve preview, lightest, tilt, smooth, finger pressure |
| `*-6-sizepad` | holding the SIZE pad's top half (lit), nozzle growing |
| `*-7-after` | DONE: the rider's back where they stood, game HUD back |
| `seam-wave.png` | a pen wave across a cell seam (u = −78 on the wall at x = −4.9). Before the fix in `Graffiti.capture`, the part before the seam collapsed to a straight line. `Graffiti.pen.test.ts` now covers it. |

Numbers measured on 2026-11-01 (SwiftShader, so timings are CPU only):

- **Wire:** the three pen strokes went out as 23 g3 strokes, 20 of them joined runs, in one tag. Across a seam they made 31 strokes (25 joined) in two tags.
- **Pinch:** 120 → 480 px between the fingers gave zoom 4.0.
- **Taps:** the two-finger tap undid; the three-finger tap redid.
- **Pen sample:** one sample (raycast + capture) costs 0.02–0.09 ms in the page. The live redraw happens once a frame.
- **Size pad:** about 0.9 s at pressure 0.95 took the radius from 40 to roughly 200–260 mm.
- **DONE:** player position identical before and after, `cam.rig` null, rider visible.

Under software rendering a slow frame can push a three-finger tap past the 320 ms window, so that check has missed once or twice.
