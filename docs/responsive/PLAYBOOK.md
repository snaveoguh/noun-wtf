# Responsive page playbook

How to make one noun.wtf page excellent at every width, in a NounOS window and
full-page. The worked example is the Noun page (`/noun/:id`, `/v2/noun/:id`),
fixed in the `claude/responsive-foundation` branch. Pick your page from
[`pages.md`](./pages.md).

## Why pages broke

Every route renders inside the NounOS navigator window (`.nos-content`). A
window can be 320 px wide on a 2560 px screen, but pages picked their layout
from the **viewport**: Tailwind `sm:`/`md:`/`lg:`, CSS-module `@media`,
react-bootstrap's `Col lg=`, `window.innerWidth` checks. So a 620 px window on
a desktop got the desktop layout, and the heading, bid and buttons were cut off.

The fix is to lay out from the **container**: `.nos-content` (and the app shell
outside a window) is a size container named `page`.

## The tokens

`src/lib/responsive/breakpoints.ts`, mobile first, each value is a band's lower edge:

| tier | container width | typically |
| --- | --- | --- |
| xs | < 400 | small phones, the narrowest windows |
| sm | 400–559 | big phones, narrow windows |
| md | 560–759 | phablets, a navigator at ~2/3 of a laptop |
| lg | 760–1023 | tablets, a roomy window |
| xl | 1024–1439 | desktop |
| 2xl | ≥ 1440 | wide windows |

## The three tools

**Tailwind** (new code): `@sm:` `@md:` `@lg:` `@xl:` `@2xl:` apply from that
tier up; `@max-md:` etc. apply below it. They query the nearest container.
`@container` makes an element a container itself.

```tsx
<div className="grid gap-4 @lg:grid-cols-[3fr_2fr]">…</div>
<button className="w-full @md:w-auto">Bid</button>
```

**CSS modules**: name the container, use the literal token values (custom
properties can't go inside a query):

```css
@container page (max-width: 559.98px) { .row { flex-wrap: wrap; } }   /* below md */
@container page (min-width: 760px)    { .grid { grid-template-columns: 3fr 2fr; } } /* lg+ */
```

Fluid type: `font-size: clamp(30px, 12cqi, 42px)`; `cqi` is 1 % of the nearest
container's width. Make a column its own container
(`container: auction / inline-size`) when its type should follow the column,
not the page.

**JS** (instead of `window.innerWidth`):

```tsx
const { ref, width, tier, atLeast, below } = useContainerWidth<HTMLDivElement>();
return <div ref={ref}>{atLeast('lg') ? <SideBySide /> : <Stacked />}</div>;
```

It measures the nearest `[data-container]` with a ResizeObserver (live while a
window is dragged) and falls back to the viewport outside any container.

**Device, not width:** hover vs touch and tap sizes are about the pointer, so use
`@media (pointer: coarse)` / `(hover: none)`, not a width.

## Step by step

1. **Baseline.** Start the dev server (below), then
   `node scripts/responsive/harness.mjs --route <url> --label before --scroll 2`.
   Open `.claude/responsive-shots/<slug>/before/contact-sheet.jpg` and
   `report.json`. Each shot lists overflow offenders, clipped text, covered
   controls, controls on artwork, overlapping controls and small tap targets
   (touch shots only), with selectors.
2. **Find the components.** The route's element in `src/App.tsx`, then grep
   its imports. List every stylesheet and `className` with viewport rules:
   `rg -n "@media|innerWidth|matchMedia|\b(sm|md|lg|xl):" <files>`.
3. **Convert viewport rules to container rules**, choosing the tier by what the
   content needs (not the old pixel value). For the Noun page:
   - `@media (min-width: 992px)` (two columns) → `@container page (min-width: 760px)`;
   - `@media (max-width: 640px)` (phone tweaks) → `@container page (max-width: 559.98px)`;
   - `@media (min-width: 1180px)` (classic sidebar) → `@container page (min-width: 1024px)`.
   Leave `prefers-reduced-motion` and pointer queries alone.
4. **Fix what the conversion doesn't.** Usually:
   - fixed font sizes on headings / numbers → `clamp(min, Ncqi, max)`;
   - `white-space: nowrap` rows that can't fit → `flex-wrap: wrap` with
     `nowrap` on the units that must stay together ("Auction ends in");
   - controls floating over art → give them their own row or a gutter;
   - action rows → full-width primary button below md;
   - tab rows → `overflow-x: auto` + scroll snap + an edge fade;
   - `<div onClick>` → `<button type="button">` (keyboard + the harness sees it).
5. **Re-run** with `--label after` until every shot is `clean`
   (`--fail-on-issues` exits 1 otherwise). Look at the sheet too: the checks
   find breakage, not ugliness.
6. **Regressions:** `npx tsc --noEmit -p .`, `npx vitest run <your tests>`, and
   the page at 1440 / 1920 in a window should look as it did before (wide
   layouts are not the target of the change).
7. **Commit** the before/after `contact-sheet.jpg` + `report.json` with
   `git add -f .claude/responsive-shots/<slug>/{before,after}/{contact-sheet.jpg,report.json}`
   (the PNGs stay local), update your row in `pages.md`.

## The Noun page, as done

Files: `components/Auction/{index.tsx,Auction.module.css}`,
`pages/Auction/AuctionPage.module.css`, `AuctionActivityNounTitle`,
`CurrentBid`, `AuctionTimer`, `Bid`, `BidHistoryBtn`, `AuctionActivityWrapper`,
`AuctionActivity/BidHistory.module.css`, `HomeCustomise`.

- Art above the auction info below lg (760); two columns from lg (classic: from xl).
- The auction column is a container; "Noun" `clamp(30px, 12cqi, 42px)`, the
  number `clamp(44px, 18cqi, 62px)`, the bid `clamp(32px, 14cqi, 48px)`.
- The timer wraps as a unit; the label never breaks.
- Below lg the stage is a column: the art as a square (max 28rem), then a row
  with Scroll / Grab / Save on the left and ‹ › on the right. From lg the art
  frame is inset so the arrows sit in side gutters and the rail in a top gutter.
- Tabs scroll sideways with snap and a fade below lg; 40 px tall on touch.
- Below md, Bid is full width with "View all bids" (now a button) centred under it.
- The viewport `max-lg:mx-4` on the auction column is gone (it pushed the bid
  16 px out of line with the title on phones).

Result: 0 / 26 clean shots before, 26 / 26 after, for `/noun/2062` with the
default hero and with hero tools on (`?sections=heroTools`).

## Running the harness

```bash
# dev server without HMR or the type-checker plugin (see the world-browser-test skill)
cat > /tmp/nohmr.config.mjs <<'EOF'
import base from '/home/user/noun-wtf/packages/nouns-webapp/vite.config.ts';
export default async env => {
  const cfg = typeof base === 'function' ? await base(env) : base;
  const plugins = (cfg.plugins ?? []).flat(5).filter(p => p && !String(p.name ?? '').includes('checker'));
  return { ...cfg, plugins, root: '/home/user/noun-wtf/packages/nouns-webapp',
    server: { ...(cfg.server ?? {}), hmr: false, watch: null, port: 5196, strictPort: true, host: '127.0.0.1' } };
};
EOF
cd packages/nouns-webapp
VITE_CHAIN_ID=1 NODE_OPTIONS=--max-old-space-size=4096 npx vite --config /tmp/nohmr.config.mjs &   # restart after every edit

node scripts/responsive/harness.mjs --route /noun/2062                 # 26 shots, ~4 min
node scripts/responsive/harness.mjs --route /noun/2062 --mode window --widths 390,640
node scripts/responsive/harness.mjs --group governance --jobs 2
node scripts/responsive/harness.mjs --all --jobs 3                     # the inventory
```

- **Window mode**: a 1440 × 1000 desktop (2600 × 1440 for windows ≥ 1440), the
  navigator resized live through the dev-only `window.__nos` handle, so it also
  catches components that don't follow a resize.
- **Page mode**: the route opened at that viewport, as a visitor sees it (phones
  get the full-screen window; from 760 the navigator opens at ~66 % of the
  screen, so `contentWidth` in the report is what the page really had).
  Viewports under 768 are touch devices (`isMobile`, `hasTouch`, `pointer: coarse`).
- `VITE_CHAIN_ID=1` gives real mainnet data; without it the auction pages render empty.
- The vite type-checker plugin runs out of memory in a 16 GB container; the config drops it.
