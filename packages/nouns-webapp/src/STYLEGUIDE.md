# noun.wtf style guide

One theme. Black ground, white type, glass surfaces, one acid accent.
The theme lives in `src/index.css` under `[data-theme='abacus']` (name kept
for compatibility). The OS shell lives in `src/components/NounOS/styles.ts`.

## Colour

| token      | value                   | use                                   |
| ---------- | ----------------------- | ------------------------------------- |
| ground     | `#000000`               | page background                       |
| text       | `#ecebe4`               | body text                             |
| text-muted | `#a9a8a0` / `#8d8c84`   | secondary text, captions              |
| glass      | `rgba(20,21,25,.74)`    | windows, tray, cards                  |
| glass-fill | `rgba(255,255,255,.14)` | default buttons, chips                |
| acid       | `#d4ff3a`               | the ONE accent: focus, key CTA, links |
| red        | `#ff3b5c`               | destructive, "captured"               |
| green      | `#3dff8a`               | FREEDOM section                       |
| cyan       | `#5ef1ff`               | MARKET section                        |

No outlines on surfaces: separation comes from the glass tint and shadow.
No hard-coded light backgrounds (`#fff`, `bg-white`, `#f4f4f8`); use
`var(--theme-bg-card)` / `var(--theme-bg-tertiary)`.

## Type

- Font: the platform's native UI font, always (`var(--site-font)`:
  SF / Segoe UI / Roboto). Never ship a webfont for UI text.
- Weights: body 450–500, labels/buttons 600, headings 700.
- Sizes: body 15px, small 13px, never below 12px for anything readable.
- Lowercase, plain, short. No middots (·) or em-dashes as decoration.
- Display exceptions: Pip3 for the NOUN WORLD title only, Londrina Solid
  for game buttons (PRESS START) and the manifesto headline.

## Buttons

Use `<Button>` from `@/components/ui/button`. Every button is a pill,
semibold, white text.

| variant       | look                      | when                                          |
| ------------- | ------------------------- | --------------------------------------------- |
| `default`     | glass fill, white text    | almost everything                             |
| `secondary`   | fainter glass, white text | less important actions                        |
| `outline`     | transparent, faint ring   | toggles, filters                              |
| `ghost`       | text only, glass on hover | icon buttons, toolbars                        |
| `destructive` | red, white text           | burn / delete / cancel bids                   |
| `cta`         | acid, **black** text      | the single key action on a screen (PLAY, BID) |
| `link`        | acid text                 | inline links                                  |

Legacy Bootstrap `.btn-*` and filled Tailwind buttons (`bg-blue-500` etc.)
are mapped onto this look by global rules in `index.css`, so they get white
text and pill shape automatically. New code should not hand-roll buttons.

## Surfaces

- Windows/cards: `border-radius: 18px`, glass background, soft shadow,
  `backdrop-filter: blur(8px)`, slightly see-through.
- Chips/inputs: radius 12px, glass fill, no border.
- Depth: the front window sits at z=0; others recede. Don't fight it with
  z-index hacks inside pages.

## Cursor

The E.T. finger (`/cursor-et-idle.png`, `/cursor-et-hot.png` over clickable
things), hotspot on the glowing tip (12, 14).
