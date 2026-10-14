---
name: game-covers
description: Make cover art / poster cards for noun.wtf games (Noun World, Noun Hoops, Noun Warfare, any new mini-game) in the house poster style, from real HUD-free in-game shots, and wire a new game into the NounOS homescreen game deck. Use when the user asks for a game cover, poster, card art, "brand it", a new homescreen entrance, or to restyle the covers.
---

# Game covers + the homescreen game deck

## House style (match the Noun World cover)

- **Size:** 1200×960 (5:4, the card's aspect). Export webp at quality 82 to `public/world2/<game>-cover.webp` or `public/<game>/cover.webp`.
- **Title:** `Pip3` font (the noun.wtf display face, `pip3.woff2`), uppercase, about 200 px, two lines (line 2 in the accent colour).
  - Style: white fill, `-webkit-text-stroke: 9px #0b0b0f`, `paint-order: stroke fill`, chromatic offset `text-shadow: 8px 8px 0 #ff2f8e, 15px 15px 0 #20d6ff, 22px 22px 0 #0b0b0f`, rotated −4°.
- **Background:**
  - A bold two-tone gradient per game: Hoops orange→purple, Warfare red|blue split.
  - Sun-ray `repeating-conic-gradient` and a halftone dot layer.
  - Two ink-outlined blobs (cyan top-right, pink bottom-left).
- **Shot panel:** the in-game screenshot as a tilted sticker.
  - Frame: 10 px white border, 7 px ink outline, 22/26 px hard ink shadow, rotated about ±3°.
  - Grade: `filter: brightness(1.5) saturate(1.3)` for dusk shots, about 1.05 for bright ones.
- **Prop:** one big ink-outlined SVG prop in the empty left area (a basketball, paint splats), with a hard drop-shadow.
- **Furniture:**
  - Tagline strip: Rubik Mono One, accent text on ink, with a pink offset shadow.
  - URL tag: pink fill.
  - A round badge bottom-left with pixel noggles plus a Permanent Marker label ("3 ON 3").
  - A Permanent Marker caption placed inside a prop or in clear space, never over the title.
- **Don't** put the card's PLAY button over the tagline. It sits at bottom-centre of the card.

Render the HTML with Playwright on `file://`. Pass the browser the `HTTPS_PROXY` creds so Google Fonts load. Check that `document.fonts` lists Pip3, Bowlby One, Rubik Mono One and Permanent Marker. Then screenshot at 1200×960 and convert with PIL.

## Getting the in-game shot

Use the `world-browser-test` skill: offline flags, step the game, hide the DOM except the canvas.
- **Golden-hour frames come out muddy.** Prefer afternoon light, or crop a vivid existing first-person shot clear of the HUD.
- **Third person** works only if the scene is lit. A night alley reads as a black blob.
- **Take 8–16 frames,** build a contact sheet, pick the best.

## Wiring a game into the homescreen deck

- **`src/components/NounOS/AgentHome.tsx`:**
  - add an entry to `GAMES` (`id`, `name`, `cover`, `cta`, `loading` line);
  - a `GameId`;
  - an `onEnter<Game>` prop;
  - chat verbs (`hoops`, `bball`, …) plus their reply lines;
  - the branch in the card `onClick`.
- **`NounOS.tsx`:**
  - a `go<Game>` callback;
  - **world-based shortcuts** (Hoops): navigate to `/world?play=...`. The game reads the query when it starts, so if it's already mounted, use `window.location.assign`;
  - **standalone games** (Warfare): set `arena` and navigate to the route.
- **`styles.ts`:** back cards use `.nos-poster-card.is-back` with depth `--d` (translate3d up/right and back). On phones the back cards are hidden and the `.nos-game-tabs` chips switch games.
- **Bug seen once:** the class string lost its space (`nos-poster-cardis-back`), so the back cards rendered unstyled. Build class names as whole strings.
- **Verify in a browser:** the deck renders, back cards peek, the chips switch games, and the front-card click lands on the right URL. Restart vite after adding files to `public/`.

## Template files (this folder)

- **`cover.html`:** the poster.
  - Pick the game with `?k=hoops|warfare&img=file:///abs/shot.png`.
  - Add a game by adding a key to the `K` map: `bg`, `accent`, `badge`, `t1`/`t2`, `tag`, `url`, `bdg`, shot box, caption, `prop`.
  - Pip3 loads from `packages/nouns-webapp/public/fonts/`.
- **`render.cjs`:** `node render.cjs <kind> <abs-shot.png> <out.png>`. It renders through the proxy so Google Fonts load.
