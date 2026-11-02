# CAMP pet: design concepts

Design only, no game code yet. Four variations of one original mascot, a
hairless flying mouse, for the owner to pick from (or mix).

- `overview.png`: all four to scale next to a Noun rider (182 cm), 3/4 view + happy pose, one-line pitch each.
- `fridge.png`: before you adopt it, each variant up on CAMP's fridge (the one already in
  `world/camp/layout.ts`), shot in the live game, offline, in the room's own light.
- `mochi.png`, `nub.png`, `zip.png`, `bean.png`: per variant, a turnaround (front / 3/4 / side / back),
  the three follow modes on a real rider (on your head, running beside you, flying alongside while you skate),
  and idle / happy / asleep.

How they're made (reproducible):
- Models: `packages/nouns-webapp/scripts/camp-pet/concepts.ts` (voxel parts with joints, procedural poses).
  Colours come from the Nouns palette; the noggles are `glasses-hip-rose.png` from
  `packages/nouns-assets/images/v0/4-glasses/`, read pixel for pixel at runtime (public/sprites' copy is a
  different, upscaled file, so it isn't used).
- Rendered with Noun World's own `toonify` materials, `InkOutlineEffect` (+ normal pass) and a real
  `NounCharacter` (seed: box head, hip-rose glasses).
- `node scripts/camp-pet/render.cjs <framesDir>` (needs the vite dev server on 5196), and
  `node scripts/camp-pet/fridge.cjs <fridgeDir>` (loads /world?offline=1), then
  `python3 scripts/camp-pet/sheets.py <framesDir> ../../.claude/camp-pet-shots/concepts <fridgeDir>`.
- Needs `@nouns/assets` and `@nouns/sdk` built (`pnpm --filter @nouns/sdk build`) for the game to load.
