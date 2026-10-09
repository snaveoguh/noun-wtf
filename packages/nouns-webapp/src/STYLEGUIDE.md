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
| cyan       | `#5ef1ff`               | MARKET section (OS shell only)        |
| blue       | `#0000ff`               | executed status pill (white label)    |

No outlines on surfaces: separation comes from the glass tint and shadow.
No hard-coded light backgrounds (`#fff`, `bg-white`, `#f4f4f8`); use
`var(--theme-bg-card)` / `var(--theme-bg-tertiary)`.

### Surface and text tokens (`[data-theme='abacus']` in `index.css`)

Surfaces step **up** in lightness from the black ground. A card inside a
window is a lighter tint, never a darker hole, so it reads without a border.

| token                  | value                   | use                                        |
| ---------------------- | ----------------------- | ------------------------------------------ |
| `--theme-bg-primary`   | `#000000`               | ground                                     |
| `--theme-glass`        | `rgba(20,21,25,.74)`    | windows, modals, floating panels (blurred) |
| `--theme-bg-card`      | `#1b1c21`               | opaque card / popover inside a window      |
| `--theme-bg-tertiary`  | `#24252b`               | hover / pressed / chip                     |
| `--theme-surface`      | `rgba(255,255,255,.05)` | inset tint: tips, callouts, table rows     |
| `--theme-glass-fill`   | `rgba(255,255,255,.14)` | default buttons, chips                     |
| `--theme-bg-input`     | `rgba(255,255,255,.08)` | inputs, selects, textareas                 |
| `--theme-divider`      | `rgba(255,255,255,.08)` | the only allowed line: row dividers        |
| `--theme-text-primary` | `#ecebe4`               | body                                       |
| `--theme-text-muted`   | `#8d8c84`               | captions (4.5:1 on black, keep ≥ 12px)     |
| `--theme-text-link`    | `#d4ff3a`               | links                                      |
| `--theme-free`         | `#3dff8a`               | FREEDOM pages (nounv2, grants, hackathons) |
| `--theme-negative`     | `#ff3b5c`               | errors, against, destructive               |

Rules that follow from the tokens:

- Never write a dark grey as a text colour (`#111`…`#475569`, `#1e293b`,
  `#374151`, `text-gray-900`). On the black ground it fails contrast. Use
  `--theme-text-primary` / `--theme-text-muted`.
- `border: 1px solid #e2e3e8` style outlines are gone; write
  `border: 1px solid transparent` to keep the box size, or
  `var(--theme-divider)` for a row divider.
- A tinted callout (warning, info) is `--theme-surface` with normal text,
  not an amber `#fef3c7` box with brown text.
- Cyan `#22d3ee` / `#0891b2` belongs to the MARKET section of the OS shell
  only. FREEDOM pages use `--theme-free`.

## Type

- Font: the platform's native UI font, always (`var(--site-font)`:
  SF / Segoe UI / Roboto). Never ship a webfont for UI text.
- Weights: body 450–500, labels/buttons 600, headings 700.
- Sizes: body 15px, small 13px, never below 12px for anything readable
  (`0.75rem` is the floor; `0.6rem` / `10px` captions were raised app-wide).
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
- Chips/inputs: radius 12px, glass fill, no border. `--theme-radius-sm/md`
  are 12px and `--theme-radius-lg` is 18px; use them instead of literal px.
- Inputs: `index.css` forces every `input`, `select`, `textarea` and
  `.form-control` onto `--theme-bg-input` with white text, so an inline
  `background: '#fff'` on a field is dead code; delete it rather than add to it.
- Depth: the front window sits at z=0; others recede. Don't fight it with
  z-index hacks inside pages.

## Cursor

The E.T. finger (`/cursor-et-idle.png`, `/cursor-et-hot.png` over clickable
things), hotspot on the glowing tip (12, 14).
