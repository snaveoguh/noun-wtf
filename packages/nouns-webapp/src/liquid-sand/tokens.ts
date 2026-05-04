/**
 * Liquid Sand UI — design tokens (TypeScript export)
 *
 * CC0 design system. Y2K-modern, super-minimal, glass-frosted aesthetic
 * with a slight warm sepia tone (the "sand").
 *
 * These constants mirror the CSS custom properties defined in `tokens.css`.
 * Use the CSS variables for styling whenever possible; pull from these
 * constants only when JS needs to read a token (canvas paints, motion
 * libraries, conditional class composition, etc.).
 */

// ─── Color: warm sand sepia ladder ──────────────────────────────────────────
export const SAND = {
  50: '#fbf6ee',
  100: '#f4ead6',
  200: '#e8d4ab',
  300: '#d4b67a',
  400: '#b89352',
  500: '#9a7536',
  600: '#7a5a26',
  700: '#5a4218',
  800: '#3d2c0f',
  900: '#241906',
} as const;

// ─── Color: frost-glass surface tints (for backdrop-blur) ───────────────────
export const GLASS = {
  light: 'rgba(255, 250, 240, 0.45)',
  lightStrong: 'rgba(255, 250, 240, 0.65)',
  dark: 'rgba(60, 45, 25, 0.40)',
  darkStrong: 'rgba(60, 45, 25, 0.65)',
  tint: 'rgba(184, 147, 82, 0.10)',
} as const;

// ─── Color: foreground (text/icons on glass) ────────────────────────────────
export const FG = {
  primary: '#1a1208',
  secondary: '#5a4a35',
  muted: '#8b7556',
  onDark: '#fbf6ee',
} as const;

// ─── Color: borders + accents ───────────────────────────────────────────────
export const BORDER = {
  glass: 'rgba(255, 250, 240, 0.18)',
} as const;

export const ACCENT = {
  default: '#b89352',
  danger: '#c2492f',
  success: '#7a8b3c',
} as const;

export const COLORS = {
  sand: SAND,
  glass: GLASS,
  fg: FG,
  border: BORDER,
  accent: ACCENT,
} as const;

// ─── Backdrop blur tiers ────────────────────────────────────────────────────
export const BLUR = {
  subtle: '8px',
  medium: '16px',
  heavy: '28px',
  extreme: '48px',
} as const;

export const SATURATE = '180%';

// ─── Border radius ──────────────────────────────────────────────────────────
export const RADIUS = {
  sm: '6px',
  md: '12px',
  lg: '18px',
  xl: '24px',
  full: '9999px',
} as const;

// ─── Shadows (soft sepia drops) ─────────────────────────────────────────────
export const SHADOW = {
  sm: '0 1px 2px rgba(60, 45, 25, 0.08), 0 1px 4px rgba(60, 45, 25, 0.04)',
  md: '0 4px 12px rgba(60, 45, 25, 0.10), 0 2px 6px rgba(60, 45, 25, 0.06)',
  lg: '0 12px 32px rgba(60, 45, 25, 0.14), 0 4px 12px rgba(60, 45, 25, 0.08)',
  glow: '0 0 32px rgba(184, 147, 82, 0.25)',
  insetGlass:
    'inset 0 1px 0 rgba(255, 250, 240, 0.35), inset 0 -1px 0 rgba(60, 45, 25, 0.08)',
} as const;

// ─── Spacing (4px base) ─────────────────────────────────────────────────────
export const SPACING = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  7: '28px',
  8: '32px',
  9: '36px',
  10: '40px',
  11: '44px',
  12: '48px',
} as const;

// ─── Typography ─────────────────────────────────────────────────────────────
export const FONT = {
  display: "'Silkscreen', 'Berkeley Mono', monospace",
  sans: "'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;

export const TEXT = {
  xs: '11px',
  sm: '13px',
  md: '15px',
  lg: '18px',
  xl: '22px',
  '2xl': '28px',
  '3xl': '36px',
} as const;

// ─── Motion ─────────────────────────────────────────────────────────────────
export const EASE = {
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  glide: 'cubic-bezier(0.16, 1, 0.3, 1)',
  soft: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

export const DURATION = {
  fast: '120ms',
  base: '220ms',
  slow: '380ms',
} as const;

// ─── Z-index layers ─────────────────────────────────────────────────────────
export const Z = {
  base: 1,
  window: 100,
  windowActive: 200,
  menu: 1000,
  modal: 2000,
  toast: 3000,
  spotlight: 4000,
} as const;

// ─── CSS variable name registry ─────────────────────────────────────────────
// Helpful when callers want to write `var(VAR.glassLight)` style references
// without remembering the literal string.
export const VAR = {
  // sand
  sand50: '--ls-sand-50',
  sand100: '--ls-sand-100',
  sand200: '--ls-sand-200',
  sand300: '--ls-sand-300',
  sand400: '--ls-sand-400',
  sand500: '--ls-sand-500',
  sand600: '--ls-sand-600',
  sand700: '--ls-sand-700',
  sand800: '--ls-sand-800',
  sand900: '--ls-sand-900',
  // glass
  glassLight: '--ls-glass-light',
  glassLightStrong: '--ls-glass-light-strong',
  glassDark: '--ls-glass-dark',
  glassDarkStrong: '--ls-glass-dark-strong',
  glassTint: '--ls-glass-tint',
  // fg
  fgPrimary: '--ls-fg-primary',
  fgSecondary: '--ls-fg-secondary',
  fgMuted: '--ls-fg-muted',
  fgOnDark: '--ls-fg-on-dark',
  // border + accents
  borderGlass: '--ls-border-glass',
  accent: '--ls-accent',
  danger: '--ls-danger',
  success: '--ls-success',
  // blur
  blurSubtle: '--ls-blur-subtle',
  blurMedium: '--ls-blur-medium',
  blurHeavy: '--ls-blur-heavy',
  blurExtreme: '--ls-blur-extreme',
  saturate: '--ls-saturate',
  // radius
  rSm: '--ls-r-sm',
  rMd: '--ls-r-md',
  rLg: '--ls-r-lg',
  rXl: '--ls-r-xl',
  rFull: '--ls-r-full',
  // shadow
  shadowSm: '--ls-shadow-sm',
  shadowMd: '--ls-shadow-md',
  shadowLg: '--ls-shadow-lg',
  shadowGlow: '--ls-shadow-glow',
  shadowInsetGlass: '--ls-shadow-inset-glass',
  // spacing
  s1: '--ls-s-1',
  s2: '--ls-s-2',
  s3: '--ls-s-3',
  s4: '--ls-s-4',
  s5: '--ls-s-5',
  s6: '--ls-s-6',
  s7: '--ls-s-7',
  s8: '--ls-s-8',
  s9: '--ls-s-9',
  s10: '--ls-s-10',
  s11: '--ls-s-11',
  s12: '--ls-s-12',
  // font
  fontDisplay: '--ls-font-display',
  fontSans: '--ls-font-sans',
  fontMono: '--ls-font-mono',
  // text size
  textXs: '--ls-text-xs',
  textSm: '--ls-text-sm',
  textMd: '--ls-text-md',
  textLg: '--ls-text-lg',
  textXl: '--ls-text-xl',
  text2xl: '--ls-text-2xl',
  text3xl: '--ls-text-3xl',
  // motion
  easeSpring: '--ls-ease-spring',
  easeGlide: '--ls-ease-glide',
  easeSoft: '--ls-ease-soft',
  durFast: '--ls-dur-fast',
  durBase: '--ls-dur-base',
  durSlow: '--ls-dur-slow',
  // z
  zBase: '--ls-z-base',
  zWindow: '--ls-z-window',
  zWindowActive: '--ls-z-window-active',
  zMenu: '--ls-z-menu',
  zModal: '--ls-z-modal',
  zToast: '--ls-z-toast',
  zSpotlight: '--ls-z-spotlight',
} as const;

/** Wrap a CSS variable name in `var(...)` for inline-style use. */
export const cssVar = (name: string, fallback?: string): string =>
  fallback ? `var(${name}, ${fallback})` : `var(${name})`;

// ─── Aggregate (handy default export for consumers that want one bag) ───────
export const TOKENS = {
  COLORS,
  SAND,
  GLASS,
  FG,
  BORDER,
  ACCENT,
  BLUR,
  SATURATE,
  RADIUS,
  SHADOW,
  SPACING,
  FONT,
  TEXT,
  EASE,
  DURATION,
  Z,
  VAR,
} as const;

export default TOKENS;
