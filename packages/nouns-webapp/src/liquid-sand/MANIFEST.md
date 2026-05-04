# Liquid Sand UI — Manifest

A file-by-file inventory for someone who just dropped this folder into their project.

## Root

| File              | What it is                                                                            |
| ----------------- | ------------------------------------------------------------------------------------- |
| `LICENSE`         | Full CC0 1.0 Universal text. Public domain. No rights reserved.                       |
| `README.md`       | Pitch, philosophy, steal-it instructions, file tree, quick start, browser support.    |
| `MANIFEST.md`     | This file.                                                                            |
| `EXTRACTING.md`   | Step-by-step lift-out guide for projects that don't share noun.wtf's tsconfig setup.  |
| `package.json`    | Stub with `name: liquid-sand-ui`, `license: CC0-1.0`. `private: true` until extracted.|
| `index.ts`        | Root barrel — `export * from './tokens' / './glass' / './icons' / './inversion'`.     |
| `tokens.ts`       | Design tokens as TS constants (SAND, GLASS, FG, BLUR, RADIUS, SHADOW, SPACING, FONT, …)|
| `tokens.css`      | Same tokens as CSS custom properties (`--ls-*`). Import this once at app entry.       |

## `glass/` — 13 frosted-glass primitives

| File          | Component(s)                                  | Purpose                                        |
| ------------- | --------------------------------------------- | ---------------------------------------------- |
| `index.ts`    | (barrel)                                      | Re-exports every component + Props type.       |
| `Panel.tsx`   | `GlassPanel` / default `Panel`                | Generic frosted surface. Base of most others.  |
| `Button.tsx`  | `GlassButton` / default `Button`              | Primary / secondary / ghost variants.          |
| `Chip.tsx`    | `GlassChip` / default `Chip`                  | Small pill / tag.                              |
| `Toolbar.tsx` | `GlassToolbar` / default `Toolbar`            | Horizontal action bar.                         |
| `Window.tsx`  | `GlassWindow` / default `Window`              | Draggable window with title bar + traffic lights. |
| `MenuBar.tsx` | `GlassMenuBar` / default `MenuBar`            | Top-of-screen menu strip.                      |
| `Dock.tsx`    | `GlassDock` / default `Dock`                  | visionOS-style app dock with hover scaling.    |
| `Toast.tsx`   | `GlassToast` / default `Toast`                | Transient notification.                        |
| `Modal.tsx`   | `GlassModal` / default `Modal`                | Centered dialog with backdrop.                 |
| `Tabs.tsx`    | `GlassTabs` + `GlassTabsItem`                 | Tabbed navigation.                             |
| `Input.tsx`   | `GlassInput` / default `Input`                | Text input field.                              |
| `Switch.tsx`  | `GlassSwitch` / default `Switch`              | Boolean toggle.                                |
| `Slider.tsx`  | `GlassSlider` / default `Slider`              | Range input.                                   |

## `icons/` — 50 monoline icons

All icons share: 24×24 viewBox, `fill="none"`, `stroke="currentColor"`, `strokeWidth="1.75"`, rounded line caps + joins, default `size="1em"`.

| File          | Purpose                                                                          |
| ------------- | -------------------------------------------------------------------------------- |
| `index.ts`    | Re-exports every icon, grouped (System, Files, Window controls, Apps, …).        |
| `types.ts`    | Shared `IconProps` type (`SVGProps<SVGSVGElement> & { size?: number \| string }`).|

### System (8)
`Power.tsx`, `Lock.tsx`, `Settings.tsx`, `Shutdown.tsx`, `Restart.tsx`, `Sleep.tsx`, `Boot.tsx`, `Eject.tsx`

### Files & Finder (8)
`Folder.tsx`, `FolderOpen.tsx`, `Document.tsx`, `DocumentText.tsx`, `DocumentImage.tsx`, `DocumentMusic.tsx`, `DocumentVideo.tsx`, `FileGeneric.tsx`

### Window controls (3)
`Close.tsx`, `Minimize.tsx`, `Maximize.tsx`

### Apps (10)
`Joystick.tsx`, `Calculator.tsx`, `Clock.tsx`, `Calendar.tsx`, `StickyNote.tsx`, `Brush.tsx`, `Bell.tsx`, `Key.tsx`, `CpuChip.tsx`, `Console.tsx`

### Communication (4)
`ChatBubble.tsx`, `Mail.tsx`, `MagnifyingGlass.tsx`, `Megaphone.tsx`

### Status & menu bar (6)
`Wifi.tsx`, `Battery.tsx`, `BatteryLow.tsx`, `BatteryCharging.tsx`, `VolumeHigh.tsx`, `VolumeMuted.tsx`

### Wallet / Web3 (3)
`Wallet.tsx`, `Coin.tsx`, `Diamond.tsx`

### Misc (8)
`Sparkle.tsx`, `Heart.tsx`, `Star.tsx`, `Sandglass.tsx`, `Clipboard.tsx`, `Info.tsx`, `Globe.tsx`, `Trash.tsx`

## `inversion/` — background-aware contrast utilities

| File                  | Export(s)                                                              | Approach                                                                  |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `README.md`           | (docs)                                                                 | Picking guide.                                                            |
| `index.ts`            | (barrel)                                                               |                                                                           |
| `blendMode.tsx`       | `BlendIcon`, `BLEND_CLASSES`, `blendStyle()`, `tailwindPluginConfig`   | CSS `mix-blend-mode` — zero JS, GPU.                                      |
| `sampleLuminance.ts`  | `useBackgroundLuminance`, `sampleBackgroundLuminance`, `rgbToLuminance`, `bucketize` | DOM walk → canvas sample → rAF debounce → bucket {dark, mid, light}. |
| `AdaptiveColor.tsx`   | `<AdaptiveColor>`                                                      | Wrapper that applies a class per luminance bucket.                        |
| `houdiniWorklet.ts`   | `registerHoudiniWorklet`, `HOUDINI_PAINT_NAME`                         | Optional CSS Paint API worklet — Chromium only.                           |
