# Liquid Sand — Inversion

Three ways to keep icons / text legible over arbitrary backgrounds. Pick the cheapest one that holds up visually.

## 1. `<BlendIcon>` — CSS `mix-blend-mode`

Zero JS, GPU-accelerated. Use for static dock icons in pure white/black on glass surfaces.

```tsx
<BlendIcon><Folder /></BlendIcon>            // mode='difference' default
<BlendIcon mode="luminosity"><Folder /></BlendIcon>
```

Caveat: blends every color in the glyph; multi-color icons will look weird.

## 2. `<AdaptiveColor>` + `useBackgroundLuminance`

Walks up the DOM, parses the nearest opaque ancestor's background (color, gradient, or image), computes ITU-R BT.709 luminance, and writes `data-bg-luminance="dark|mid|light"` onto the wrapper. Re-samples on scroll/resize via rAF debounce. Image sampling uses a 16×16 canvas (cached per URL) and silently fails on cross-origin taint.

```tsx
<AdaptiveColor classByBucket={{ dark: 'text-white', light: 'text-black' }}>
  <button>Hi</button>
</AdaptiveColor>

const sample = useBackgroundLuminance(ref);   // { bucket, value, fallback }
```

## 3. `registerHoudiniWorklet()` — optional Houdini

Registers a paint worklet that reads `--ls-bg-color` on the element and fills accordingly. Pure progressive enhancement; no-ops on browsers without `CSS.paintWorklet` (Safari, Firefox).
