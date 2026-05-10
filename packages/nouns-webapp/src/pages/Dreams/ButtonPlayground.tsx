import { FC } from 'react';

/**
 * Playground for futur-minimalistic-retro dream-card button styles.
 *
 * Routed at /dreams/buttons-playground. Not wired into OnChainDreamCard yet —
 * this is a comparison surface so the user can pick a base style.
 *
 * All three base styles share:
 *  - Mono typography, hairline 1px borders, no drop shadows.
 *  - Identical button shape, size, label text, position, focus ring per variant.
 *  - Procedural variation (fill tint, border accent, decorative corner glyph)
 *    seeded deterministically by `dreamSlug` — never random per render.
 *  - Variant semantics preserved: sponsor / promote / view / create.
 */

type Variant = 'sponsor' | 'promote' | 'view' | 'create';

type Props = {
  label: string;
  variant: Variant;
  dreamSlug: string;
  onClick?: () => void;
};

// Decorative glyphs for seeded corner accent. Geometric, retro-tech feel —
// kept small so they read as marks, not icons.
const GLYPHS = ['◇', '▲', '◐', '◈', '▣', '⬡', '◆', '▰', '◍', '◢', '◣', '◤'] as const;

// Tiny deterministic hash (FNV-1a 32-bit). Stable across renders — no randomness.
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function seededPick<T>(slug: string, salt: string, list: readonly T[]): T {
  const h = hash(`${slug}::${salt}`);
  return list[h % list.length] as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Style 1: Terminal
// Green-phosphor CRT vibe. Pure black backdrop, one accent hue per variant,
// scanline overlay, hairline border, hover lifts a 1px glow.
// ─────────────────────────────────────────────────────────────────────────────

const TERMINAL_VARIANT: Record<
  Variant,
  { fg: string; bg: string; border: string; ring: string }
> = {
  sponsor: { fg: '#7CC8FF', bg: '#02080F', border: '#1F4863', ring: '#7CC8FF' },
  promote: { fg: '#9DEFAA', bg: '#020A05', border: '#1F5C2E', ring: '#9DEFAA' },
  view:    { fg: '#C9C9C9', bg: '#0A0A0A', border: '#3A3A3A', ring: '#FFFFFF' },
  create:  { fg: '#FFD37A', bg: '#0B0805', border: '#5C401F', ring: '#FFD37A' },
};

// Per-slug seeded tint accents (subtle hue shift on the bg) and glyph.
const TERMINAL_TINTS = [
  'rgba(124, 200, 255, 0.04)',
  'rgba(157, 239, 170, 0.04)',
  'rgba(255, 211, 122, 0.04)',
  'rgba(232, 121, 249, 0.04)',
  'rgba(192, 192, 192, 0.05)',
] as const;

export const TerminalButton: FC<Props> = ({ label, variant, dreamSlug, onClick }) => {
  const palette = TERMINAL_VARIANT[variant];
  const tint = seededPick(dreamSlug, 'tint', TERMINAL_TINTS);
  const glyph = seededPick(dreamSlug, 'glyph', GLYPHS);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative inline-flex h-7 w-full items-center justify-center overflow-hidden border px-2 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-black"
      style={{
        color: palette.fg,
        backgroundColor: palette.bg,
        backgroundImage: `linear-gradient(${tint}, ${tint}), repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px)`,
        borderColor: palette.border,
      }}
    >
      {/* Hover glow — 1px inset that fakes a CRT bloom without using box-shadow.  */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ boxShadow: `inset 0 0 0 1px ${palette.fg}` }}
      />
      {/* Seeded glyph — top-right, decorative only.  */}
      <span
        aria-hidden
        className="absolute right-1 top-0 text-[8px] leading-[1] opacity-60"
        style={{ color: palette.fg }}
      >
        {glyph}
      </span>
      <span className="relative">{label}</span>
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Style 2: Neo-Bauhaus
// Restricted muted palette, chamfered corner via clip-path, hairline border,
// flat fill. Glyph rendered as a small filled square in the seeded accent hue.
// ─────────────────────────────────────────────────────────────────────────────

const BAUHAUS_VARIANT: Record<
  Variant,
  { fill: string; ink: string; border: string; ring: string }
> = {
  sponsor: { fill: '#E8EEF5', ink: '#1A2C3D', border: '#1A2C3D', ring: '#1A2C3D' },
  promote: { fill: '#E8EFE9', ink: '#1F3D26', border: '#1F3D26', ring: '#1F3D26' },
  view:    { fill: '#F1EFEA', ink: '#2A2A2A', border: '#2A2A2A', ring: '#2A2A2A' },
  create:  { fill: '#F4ECDC', ink: '#3D2C0E', border: '#3D2C0E', ring: '#3D2C0E' },
};

// Seeded accent strip color (left edge) and seeded glyph.
const BAUHAUS_ACCENTS = ['#C44536', '#E8A23C', '#5B7DB1', '#3F8B6C', '#7A5C9E', '#1A2C3D'] as const;

// Clip a 4px chamfer off two opposing corners — keeps shape consistent across
// variants, just rotates which corners are clipped per-slug for variation.
const CHAMFER_CLIPS = [
  'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)',
  'polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 4px 100%, 0 calc(100% - 4px))',
  'polygon(4px 0, calc(100% - 4px) 0, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) 100%, 4px 100%, 0 calc(100% - 4px), 0 4px)',
] as const;

export const BauhausButton: FC<Props> = ({ label, variant, dreamSlug, onClick }) => {
  const palette = BAUHAUS_VARIANT[variant];
  const accent = seededPick(dreamSlug, 'accent', BAUHAUS_ACCENTS);
  const clip = seededPick(dreamSlug, 'clip', CHAMFER_CLIPS);
  const glyph = seededPick(dreamSlug, 'glyph', GLYPHS);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative inline-flex h-7 w-full items-center justify-center overflow-hidden border px-2 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      style={
        {
          color: palette.ink,
          backgroundColor: palette.fill,
          borderColor: palette.border,
          clipPath: clip,
          // CSS variable so focus-visible:ring-[--ring] picks up the per-variant color.
          ['--tw-ring-color' as string]: palette.ring,
        } as React.CSSProperties
      }
    >
      {/* Left accent strip — 3px wide, seeded color. Shape is constant.  */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-[3px]"
        style={{ backgroundColor: accent }}
      />
      {/* Seeded glyph — bottom-right, fills with accent on hover.  */}
      <span
        aria-hidden
        className="absolute bottom-0 right-1 text-[8px] leading-none opacity-50 transition-colors group-hover:opacity-100"
        style={{ color: accent }}
      >
        {glyph}
      </span>
      <span className="relative ml-1">{label}</span>
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Style 3: Decay
// Cream/paper palette with grainy overlay (repeating-linear-gradient at 2%),
// ink-stamp ring, faded letterforms. Hover sharpens contrast — mimics dust
// brushed off old hardware.
// ─────────────────────────────────────────────────────────────────────────────

const DECAY_VARIANT: Record<
  Variant,
  { fill: string; ink: string; border: string; ring: string }
> = {
  sponsor: { fill: '#F2EFE6', ink: '#243B53', border: '#7E8A98', ring: '#243B53' },
  promote: { fill: '#EFEEE2', ink: '#2C4A33', border: '#7E8A75', ring: '#2C4A33' },
  view:    { fill: '#EAE8DD', ink: '#3A3A36', border: '#9A968A', ring: '#3A3A36' },
  create:  { fill: '#F2E9D2', ink: '#5C4316', border: '#9F8A5E', ring: '#5C4316' },
};

// Seeded grain rotation angle (1° increments — barely perceptible) and glyph.
const DECAY_GRAIN_ANGLES = [0, 22, 45, 67, 90, 112, 135, 157] as const;

export const DecayButton: FC<Props> = ({ label, variant, dreamSlug, onClick }) => {
  const palette = DECAY_VARIANT[variant];
  const angle = seededPick(dreamSlug, 'grain', DECAY_GRAIN_ANGLES);
  const glyph = seededPick(dreamSlug, 'glyph', GLYPHS);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative inline-flex h-7 w-full items-center justify-center overflow-hidden border px-2 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      style={
        {
          color: palette.ink,
          backgroundColor: palette.fill,
          backgroundImage: `repeating-linear-gradient(${angle}deg, rgba(0,0,0,0.02) 0 1px, transparent 1px 4px), repeating-linear-gradient(${angle + 90}deg, rgba(0,0,0,0.015) 0 1px, transparent 1px 5px)`,
          borderColor: palette.border,
          ['--tw-ring-color' as string]: palette.ring,
        } as React.CSSProperties
      }
    >
      {/* Inner hairline — gives the "ink stamp" double-border look.  */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-[2px] border opacity-40 transition-opacity group-hover:opacity-70"
        style={{ borderColor: palette.border }}
      />
      {/* Seeded glyph — top-left, faded.  */}
      <span
        aria-hidden
        className="absolute left-1 top-0 text-[8px] leading-[1] opacity-40"
        style={{ color: palette.ink }}
      >
        {glyph}
      </span>
      <span className="relative">{label}</span>
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Playground page
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_SLUGS = [
  'nounwtf-dream-1234',
  'nounwtf-dream-5678',
  'nounwtf-dream-9012',
  'nounwtf-dream-3456',
  'nounwtf-dream-7890',
  'nounwtf-dream-2468',
] as const;

const STYLES = [
  {
    key: 'terminal' as const,
    name: 'Terminal',
    blurb: 'CRT phosphor on black. Scanline overlay, hairline border, hover bloom. Glyph top-right.',
    Component: TerminalButton,
  },
  {
    key: 'bauhaus' as const,
    name: 'Neo-Bauhaus',
    blurb: 'Muted paper fills, chamfered corners, 3px seeded accent strip on the left edge.',
    Component: BauhausButton,
  },
  {
    key: 'decay' as const,
    name: 'Decay',
    blurb: 'Cream stock with crosshatched grain, double-hairline ink-stamp border, faded glyph.',
    Component: DecayButton,
  },
];

const VARIANT_SET: Array<{ variant: Variant; label: string }> = [
  { variant: 'sponsor', label: 'Sponsor' },
  { variant: 'promote', label: 'Promote' },
  { variant: 'view', label: 'View' },
  { variant: 'create', label: '+ Create Dream' },
];

const ButtonPlayground: FC = () => {
  return (
    <div className="mx-auto max-w-6xl px-6 py-10 font-mono">
      <header className="mb-10 border-b border-neutral-300 pb-6">
        <p className="text-[10px] uppercase tracking-[0.3em] text-neutral-500">
          dreams · buttons · playground
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Dream-card buttons</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-600">
          Three base styles, each rendered against six mock dream slugs so the seeded
          procedural variation is visible side by side. Shape, size, label, and focus ring
          stay constant — only fill, border accent, and a decorative corner glyph vary
          per slug. Pick one to wire into OnChainDreamCard.
        </p>
      </header>

      {STYLES.map(({ key, name, blurb, Component }) => (
        <section key={key} className="mb-14">
          <header className="mb-4">
            <h2 className="text-base font-bold tracking-tight">
              <span className="text-neutral-400">{key === 'terminal' ? '01' : key === 'bauhaus' ? '02' : '03'}</span>{' '}
              {name}
            </h2>
            <p className="mt-1 max-w-xl text-xs text-neutral-600">{blurb}</p>
          </header>

          {/* Header row labels for the 4 variant columns.  */}
          <div className="mb-2 grid grid-cols-[110px_repeat(4,1fr)] gap-3 text-[10px] uppercase tracking-[0.18em] text-neutral-500">
            <div>slug</div>
            <div>sponsor</div>
            <div>promote</div>
            <div>view</div>
            <div>+ create</div>
          </div>

          {/* One row per mock slug, four buttons across.  */}
          <div className="space-y-2">
            {MOCK_SLUGS.map(slug => (
              <div
                key={slug}
                className="grid grid-cols-[110px_repeat(4,1fr)] items-center gap-3 rounded-sm border border-neutral-200 bg-neutral-50 px-3 py-2"
              >
                <div className="truncate text-[10px] text-neutral-500">{slug}</div>
                {VARIANT_SET.map(({ variant, label }) => (
                  <Component
                    key={variant}
                    label={label}
                    variant={variant}
                    dreamSlug={slug}
                    onClick={() => {
                      // No-op; clicks here are illustrative only.
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </section>
      ))}

      <footer className="mt-16 border-t border-neutral-300 pt-6 text-[10px] uppercase tracking-[0.3em] text-neutral-500">
        playground · not wired · pick one to ship
      </footer>
    </div>
  );
};

export default ButtonPlayground;
