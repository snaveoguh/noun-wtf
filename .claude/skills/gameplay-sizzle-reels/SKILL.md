---
name: gameplay-sizzle-reels
description: Make homepage / store "sizzle" reels from real gameplay of a web 3D game, rendered frame by frame in headless Chromium (deterministic stepping, HUD hidden), cut and encoded to webm + mp4 + poster under ~4 MB, with an optional music bed, and wired into a clip carousel. Use when the user asks for a sizzle reel, trailer, hero video, store preview video or a reel for a new game.
---

# Gameplay sizzle reels

On noun.wtf the pipeline lives in `packages/nouns-webapp/scripts/sizzle/` (README + SHOTLIST). Read it first; this is the method behind it.

## Capture

- **Deterministic and frame by frame:** stop the game loop, script inputs, step `1/fps` per frame, screenshot each frame. Real time at software-rendering fps is useless.
- **Hide everything but the canvas:** `body *{visibility:hidden!important} canvas{visibility:visible!important}`.
- **1920×1080 at a fixed seed / time of day.** Golden-hour frames come out muddy, so prefer bright light.
- **Drive the game's own systems for the action** (the parkour engine's moves, the pool sim's shots), so what's on screen is what players get.
- **Shot list first:** each reel is ~8–14 s of 3–6 beats (establish → the signature move → a payoff), e.g.:
  - parkour: wall run, climb, lamppost slide, rooftop gap;
  - pool: a break scattering the rack, a clean pot, the 8 to win.

## Cut and encode

- An edit list per reel (JSON) → `cut.mjs` → webm (VP9) + mp4 (H.264) + a poster jpg in `public/home/`.
- Keep the mp4 around 4 MB or less; check sizes before committing.

## Music

- `"music": { "file": "scripts/sizzle/music/<track>.mp3", "in": <start s> }` in the edit list. It's muxed as AAC / Opus, faded over the last 0.9 s, normalised to −16 LUFS.
- `mux.sh` swaps audio into an existing clip without re-rendering.
- **Only use music the owner owns or licensed.** Check provenance before shipping: a file named `imperial-march.mp3` was the owner's own Suno track "Imperial March to the Core", but confirm, don't assume.
- **The page plays reel audio only after the visitor turns sound on** (`audio: true` on the clip).

## Wire it in

- **A clip slide per reel:** `key`, title, eyebrow, tagline, teaser, accent, `clip`, `focus`, `game` / `href`, `cta`.
- **Each slide's `ms` must equal the clip's real length** (`ffprobe -v error -show_entries format=duration -of csv=p=0 file.mp4`): the carousel advances when the clip ends.
- **Respect the owner's order** (on noun.wtf: intro sizzle first, Noun World second, then the game reels), and keep the order test in `rows.test.ts` in step.
- **Verify:**
  - the files serve (200, expected sizes);
  - the homepage loads with no errors;
  - each slide plays and advances on desktop and phone.

Renders are long and heavy, so give them their own cloud session (`cloud-session-fanout`).
