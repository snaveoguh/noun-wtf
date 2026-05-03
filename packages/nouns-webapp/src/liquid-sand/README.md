# Liquid Sand UI

> Y2K-modern, super-minimal, frosted-glass design system with a warm sepia tone. CC0.

A small, self-contained React component library built around three ideas:

1. **Frosted glass surfaces.** `backdrop-filter: blur()` over warm sepia tints.
2. **Monoline icons.** A 50-icon set drawn on a 24x24 grid with a single 1.75px stroke and `currentColor` fills.
3. **Background-aware contrast.** Three approaches (CSS `mix-blend-mode`, JS luminance sampling, optional Houdini paint worklet) for keeping foreground legible over arbitrary surfaces.

## Philosophy

Most "glass" component kits ship a chrome-blue Apple impression. Liquid Sand is what frosted glass looks like when you set it on a desert floor at golden hour: warm, low-contrast, and a little nostalgic — the y2k iMac and the early-2000s skinned media-player UIs filtered through Sonoma-era visionOS rounded geometry. The tokens commit to one palette (a 10-step sand sepia ladder) and one motion language (three easings, three durations), so designs built on top stay coherent without a config layer. Components are unstyled-friendly: every primitive accepts `className` and `style`, every icon inherits color via `currentColor`, and every token is mirrored as both a CSS custom property (`--ls-*`) and a TypeScript constant. There is no theme provider, no CSS-in-JS runtime, no required build step. Drop the folder in, import the CSS, ship.

## Steal it

Just drop the `liquid-sand/` folder into your project. Import the global CSS once. That's it.

```ts
// in your app entry (main.tsx, App.tsx, etc.)
import 'path/to/liquid-sand/tokens.css';
```

```tsx
import { GlassPanel, GlassButton } from 'path/to/liquid-sand';
import { Folder } from 'path/to/liquid-sand/icons';

export function Demo() {
  return (
    <GlassPanel>
      <Folder size={20} />
      <GlassButton>Open</GlassButton>
    </GlassPanel>
  );
}
```

Public domain. No attribution required, no license file to ship, no LLC to contact. See [`LICENSE`](./LICENSE) and [`EXTRACTING.md`](./EXTRACTING.md) for details.

## File structure

```
liquid-sand/
├── LICENSE                  CC0 1.0 Universal — full text
├── README.md                you are here
├── MANIFEST.md              file-by-file inventory
├── EXTRACTING.md            lift-out guide for non-noun.wtf projects
├── package.json             stub for future standalone publish
├── index.ts                 root barrel — re-exports everything
├── tokens.ts                design tokens as TS constants (SAND, GLASS, …)
├── tokens.css               same tokens as CSS custom properties (--ls-*)
├── glass/                   13 frosted-glass primitive components
│   ├── index.ts
│   ├── Panel.tsx            GlassPanel  — generic frosted surface
│   ├── Button.tsx           GlassButton — primary/secondary/ghost
│   ├── Chip.tsx             GlassChip   — small pill / tag
│   ├── Toolbar.tsx          GlassToolbar
│   ├── Window.tsx           GlassWindow — draggable chrome with title bar
│   ├── MenuBar.tsx          GlassMenuBar
│   ├── Dock.tsx             GlassDock   — visionOS-style app dock
│   ├── Toast.tsx            GlassToast
│   ├── Modal.tsx            GlassModal
│   ├── Tabs.tsx             GlassTabs + GlassTabsItem
│   ├── Input.tsx            GlassInput  — text input
│   ├── Switch.tsx           GlassSwitch — boolean toggle
│   └── Slider.tsx           GlassSlider — range input
├── icons/                   50 monoline icons, 24×24 viewBox, currentColor
│   ├── index.ts
│   ├── types.ts             shared IconProps
│   └── *.tsx                one component per icon (Folder, Settings, …)
└── inversion/               background-aware color inversion utilities
    ├── README.md            picking guide
    ├── index.ts
    ├── blendMode.tsx        <BlendIcon> — CSS mix-blend-mode wrapper
    ├── sampleLuminance.ts   useBackgroundLuminance() rAF-debounced sampler
    ├── AdaptiveColor.tsx    <AdaptiveColor> — wraps children with bucketed class
    └── houdiniWorklet.ts    optional Houdini paint worklet registration
```

## Quick start

After adding `import './path/to/liquid-sand/tokens.css'` to your app entry:

```tsx
import { GlassPanel } from 'path/to/liquid-sand';
import { Sparkle } from 'path/to/liquid-sand/icons';

<GlassPanel blur="medium" radius="lg">
  <Sparkle size={24} /> hello, sand.
</GlassPanel>
```

## API reference

### Tokens — `tokens.ts` / `tokens.css`

Use the CSS variables (`var(--ls-glass-light)`, `var(--ls-r-md)`, etc.) for styling. Pull from the TS constants only when JS needs a token value (canvas paints, conditional class composition, motion libraries).

Aggregates: `COLORS`, `SAND`, `GLASS`, `FG`, `BORDER`, `ACCENT`, `BLUR`, `SATURATE`, `RADIUS`, `SHADOW`, `SPACING`, `FONT`, `TEXT`, `EASE`, `DURATION`, `Z`, `VAR`, `cssVar()`, default export `TOKENS`.

### Glass — `glass/`

13 primitives. Every component accepts `className` + `style` and forwards extra HTML props to its root element. Most accept a `blur` (`subtle` | `medium` | `heavy` | `extreme`), `tone` (`light` | `dark`), and `radius` (`sm` | `md` | `lg` | `xl` | `full`) prop.

### Icons — `icons/`

50 components, all sharing `IconProps` (`SVGProps<SVGSVGElement> & { size?: number | string }`). Default size is `1em` so they inherit the surrounding `font-size`. Color is the surrounding `color` because every stroke is `currentColor`.

### Inversion — `inversion/`

Three approaches, ranked by cost:

1. `<BlendIcon>` — zero JS, GPU-accelerated CSS `mix-blend-mode`. Best for monochrome icons over varied surfaces.
2. `useBackgroundLuminance()` + `<AdaptiveColor>` — DOM walk + canvas sample, rAF-debounced. Best for text and multi-color content that needs proper light/dark switching.
3. `registerHoudiniWorklet()` — optional progressive enhancement; no-ops on Safari/Firefox.

See [`inversion/README.md`](./inversion/README.md) for the picking guide.

## Browser support

Glass surfaces depend on `backdrop-filter`, which is supported in all modern browsers (Chrome 76+, Firefox 103+, Safari 9+ with `-webkit-` prefix). For older browsers without backdrop-filter:

```css
/* feature query in your global CSS */
@supports not (backdrop-filter: blur(1px)) {
  .ls-glass {
    /* fall back to a solid sepia tint */
    background: var(--ls-sand-100) !important;
  }
}
```

Houdini paint worklet (`inversion/houdiniWorklet.ts`) requires `CSS.paintWorklet` (Chromium-only as of 2026) — it's a pure progressive enhancement and silently no-ops elsewhere.

## Inspiration / acknowledgments

Liquid Sand grew out of the desktop emulator inside [noun.wtf](https://noun.wtf) — a Nouns DAO governance hub run by a CC0 art collective. The aesthetic is a remix of:

- early-2000s Aqua/Aero glass and y2k iMac translucency,
- visionOS rounded surfaces and the warm-tinted glass language Apple shipped in Sonoma,
- the desert-modernist palette of the original Nouns specs (sandy, sun-bleached).

It is contributed back to the design ecosystem under CC0 in the same spirit Nouns publishes its art: free for anyone to copy, fork, modify, sell, sample, ignore, or improve. No credit required, but acknowledgments are always welcome.

## License

[CC0 1.0 Universal](./LICENSE) — public domain, no rights reserved. Do whatever you want.
