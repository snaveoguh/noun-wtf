# CAMP opening shot: style cuts (2026-11-01)

Rendered frame by frame in headless Chromium (SwiftShader) with the sizzle
pipeline's `camp-intro` shot (seed 3, `?offline=1`), 30 fps, first 7.6 s:

- `sheet-desktop.jpg` / `intro-desktop.mp4`: 960×540, quality medium.
- `sheet-phone.jpg` / `intro-phone.mp4`: 405×720, quality low (8-bit buffers, ink pass last).

Sequence (introStyles.ts; W = window crossing, 5.36–6.01 s by spawn):
TRIP 0–1.55 (anime flicker at 1.05) → ANIME 1.55–3.15 on twos (haze flicker 2.6)
→ HAZE 3.15–W (b&w flicker 4.3) → B&W from W (trip echo W+0.45) → game look at W+1.05.

Frame analysis (relative luminance, 64×36 downsample): at most 2 flashes in any
1 s window (WCAG 2.3.1 allows 3); saturated-red area ≤ 1.8 % of the frame.

Perf (dev build, 412×915 at q=low and render scale 0.75, stepped, intro window,
effects on vs `introFx` off): composer passes 3 vs 2; CPU ms per step p50
2.9 vs 3.9, p95 6.8 vs 8.2 (noise: the grade is GPU work, a few uniform sets on
CPU); programs 53 vs 52 (the pass's one program, compiled behind the loader).
Draw calls: +1 per frame by construction, +2 in the trip (trails); totals stay
within ±2 of the effects-off run (scene noise).
