// ── Container breakpoints (responsive tokens) ──────────────────────────────
//
// Every page renders inside a NounOS window (`.nos-content`), and a window can
// be any width on any screen: a 620 px navigator on a 2560 px desktop is a
// phone layout, not a desktop one. So pages choose their layout from the width
// of their *container*, never the viewport. These are the shared tiers.
//
// Named by the band they cover, mobile first, like Tailwind's screens:
//   xs  <  400   small phones, the narrowest windows
//   sm  400–559  big phones, narrow windows
//   md  560–759  phablets, a navigator at ~2/3 of a laptop
//   lg  760–1023 tablets, a roomy window
//   xl  1024–1439 desktop
//   2xl ≥ 1440   wide windows
//
// Each value is the band's lower edge. Used by:
//   - Tailwind: `@sm:` `@md:` `@lg:` `@xl:` `@2xl:` (min-width) and
//     `@max-sm:` … `@max-2xl:` (below) — see tailwind.config.ts
//   - CSS modules: `@container page (min-width: 560px) { … }` — literal values,
//     custom properties can't be used inside a query (see docs/responsive)
//   - JS: `useContainerWidth()` / `tierFor()`
//   - the width harness (scripts/responsive), whose test checks it agrees.
//
// Plain module, no imports: tailwind.config.ts loads it in node.

export const CONTAINER_BREAKPOINTS = {
  sm: 400,
  md: 560,
  lg: 760,
  xl: 1024,
  '2xl': 1440,
} as const;

export type ContainerTier = 'xs' | keyof typeof CONTAINER_BREAKPOINTS;

/** Tiers from narrowest to widest. */
export const CONTAINER_TIERS: readonly ContainerTier[] = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];

/** The container name every page shell carries (`container: page / inline-size`). */
export const PAGE_CONTAINER = 'page';

/** The tier a container of `width` CSS px falls in. */
export function tierFor(width: number): ContainerTier {
  let tier: ContainerTier = 'xs';
  for (const t of CONTAINER_TIERS) {
    if (t === 'xs') continue;
    if (width >= CONTAINER_BREAKPOINTS[t]) tier = t;
  }
  return tier;
}

/** True when `width` is at least the lower edge of `tier` (mobile-first `@tier:`). */
export function atLeast(width: number, tier: ContainerTier): boolean {
  return tier === 'xs' ? true : width >= CONTAINER_BREAKPOINTS[tier];
}
