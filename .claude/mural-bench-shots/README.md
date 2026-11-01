# Mural bench: browser shots

Headless Chromium (SwiftShader), `/world?offline=1&skip=1&q=low&bday=0&spawn=plaza&camintro=0`, game loop stepped by hand. The driving script (scratchpad, not committed) teleports the rider and runs these steps:

1. a fixed camera on the bench and Pipe;
2. stands in front of seat 2 (SIT prompt);
3. taps SIT, 1 s into the glide;
4. 23 s after sitting (the shot);
5. stands up, 1.7 s later (camera back behind the rider).

- `desktop-*.jpg`: 1280 × 720.
- `phone-sheet.jpg`: 390 × 844, touch (bench + Pipe, SIT — TAP, the shot with STAND UP, stood up).

Draw calls at the bench (`renderer.info`, same frame, bench / Pipe toggled):
- desktop low: bench +1, Pipe +9;
- phone low: Pipe +5 (bench out of frame from that angle).

The palm crossing the mural's left third stands on the far pavement, 5 m in front of the wall. No spot on the plaza side avoids it.
