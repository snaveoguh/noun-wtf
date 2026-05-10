/**
 * DreamButton — slug-dispatched seeded dream-card buttons.
 *
 * The user wanted "loads of different button designs at the same time"
 * rather than picking one winner. So we keep all three base styles
 * (Terminal / Neo-Bauhaus / Decay) and dispatch one per dream by hashing
 * the dream's slug. Within each style, the existing per-slug procedural
 * variation (tint / glyph / accent / clip) still applies, so two dreams
 * routed to the same style still render visually distinct.
 *
 * All three styles share:
 *  - Identical button shape, height (28px / h-7), label position, focus ring
 *  - 1px hairline border, mono typography, no drop shadow
 *  - 4 semantic variants: sponsor / promote / view / create
 *
 * Stable across renders — the dispatch is FNV-1a of the slug, no Date.now()
 * or Math.random() anywhere. The same dream always gets the same button.
 */
import { FC } from 'react';

export type DreamButtonVariant = 'sponsor' | 'promote' | 'view' | 'create';

interface BaseProps {
  label: string;
  variant: DreamButtonVariant;
  dreamSlug: string;
  onClick?: (e: React.MouseEvent) => void;
  /** When provided, overrides the auto-dispatch — useful for the
   *  /dreams/buttons-playground page which needs to render all three side
   *  by side regardless of slug. */
  forceStyle?: 'terminal' | 'bauhaus' | 'decay';
  className?: string;
}

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

// ─── Style 1: Terminal ───────────────────────────────────────────────────────
// Green-phosphor CRT vibe. Pure black backdrop, one accent hue per variant,
// scanline overlay, hairline border, hover lifts a 1px glow.

const TERMINAL_VARIANT: Record<
  DreamButtonVariant,
  { fg: string; bg: string; border: string; ring: string }
> = {
  sponsor: { fg: '#7CC8FF', bg: '#02080F', border: '#1F4863', ring: '#7CC8FF' },
  promote: { fg: '#9DEFAA', bg: '#020A05', border: '#1F5C2E', ring: '#9DEFAA' },
  view: { fg: '#C9C9C9', bg: '#0A0A0A', border: '#3A3A3A', ring: '#FFFFFF' },
  create: { fg: '#FFD37A', bg: '#0B0805', border: '#5C401F', ring: '#FFD37A' },
};

const TERMINAL_TINTS = [
  'rgba(124, 200, 255, 0.04)',
  'rgba(157, 239, 170, 0.04)',
  'rgba(255, 211, 122, 0.04)',
  'rgba(232, 121, 249, 0.04)',
  'rgba(192, 192, 192, 0.05)',
] as const;

export const TerminalButton: FC<BaseProps> = ({
  label,
  variant,
  dreamSlug,
  onClick,
  className = '',
}) => {
  const palette = TERMINAL_VARIANT[variant];
  const tint = seededPick(dreamSlug, 'tint', TERMINAL_TINTS);
  const glyph = seededPick(dreamSlug, 'glyph', GLYPHS);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-flex h-7 w-full items-center justify-center overflow-hidden border px-2 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-black ${className}`}
      style={{
        color: palette.fg,
        backgroundColor: palette.bg,
        backgroundImage: `linear-gradient(${tint}, ${tint}), repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px)`,
        borderColor: palette.border,
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ boxShadow: `inset 0 0 0 1px ${palette.fg}` }}
      />
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

// ─── Style 2: Neo-Bauhaus ────────────────────────────────────────────────────

const BAUHAUS_VARIANT: Record<
  DreamButtonVariant,
  { fill: string; ink: string; border: string; ring: string }
> = {
  sponsor: { fill: '#E8EEF5', ink: '#1A2C3D', border: '#1A2C3D', ring: '#1A2C3D' },
  promote: { fill: '#E8EFE9', ink: '#1F3D26', border: '#1F3D26', ring: '#1F3D26' },
  view: { fill: '#F1EFEA', ink: '#2A2A2A', border: '#2A2A2A', ring: '#2A2A2A' },
  create: { fill: '#F4ECDC', ink: '#3D2C0E', border: '#3D2C0E', ring: '#3D2C0E' },
};

const BAUHAUS_ACCENTS = ['#C44536', '#E8A23C', '#5B7DB1', '#3F8B6C', '#7A5C9E', '#1A2C3D'] as const;

const CHAMFER_CLIPS = [
  'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)',
  'polygon(0 0, calc(100% - 4px) 0, 100% 4px, 100% 100%, 4px 100%, 0 calc(100% - 4px))',
  'polygon(4px 0, calc(100% - 4px) 0, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) 100%, 4px 100%, 0 calc(100% - 4px), 0 4px)',
] as const;

export const BauhausButton: FC<BaseProps> = ({
  label,
  variant,
  dreamSlug,
  onClick,
  className = '',
}) => {
  const palette = BAUHAUS_VARIANT[variant];
  const accent = seededPick(dreamSlug, 'accent', BAUHAUS_ACCENTS);
  const clip = seededPick(dreamSlug, 'clip', CHAMFER_CLIPS);
  const glyph = seededPick(dreamSlug, 'glyph', GLYPHS);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-flex h-7 w-full items-center justify-center overflow-hidden border px-2 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${className}`}
      style={
        {
          color: palette.ink,
          backgroundColor: palette.fill,
          borderColor: palette.border,
          clipPath: clip,
          ['--tw-ring-color' as string]: palette.ring,
        } as React.CSSProperties
      }
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-[3px]"
        style={{ backgroundColor: accent }}
      />
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

// ─── Style 3: Decay ──────────────────────────────────────────────────────────

const DECAY_VARIANT: Record<
  DreamButtonVariant,
  { fill: string; ink: string; border: string; ring: string }
> = {
  sponsor: { fill: '#F2EFE6', ink: '#243B53', border: '#7E8A98', ring: '#243B53' },
  promote: { fill: '#EFEEE2', ink: '#2C4A33', border: '#7E8A75', ring: '#2C4A33' },
  view: { fill: '#EAE8DD', ink: '#3A3A36', border: '#9A968A', ring: '#3A3A36' },
  create: { fill: '#F2E9D2', ink: '#5C4316', border: '#9F8A5E', ring: '#5C4316' },
};

const DECAY_GRAIN_ANGLES = [0, 22, 45, 67, 90, 112, 135, 157] as const;

export const DecayButton: FC<BaseProps> = ({
  label,
  variant,
  dreamSlug,
  onClick,
  className = '',
}) => {
  const palette = DECAY_VARIANT[variant];
  const angle = seededPick(dreamSlug, 'grain', DECAY_GRAIN_ANGLES);
  const glyph = seededPick(dreamSlug, 'glyph', GLYPHS);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-flex h-7 w-full items-center justify-center overflow-hidden border px-2 font-mono text-[10px] uppercase tracking-[0.18em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${className}`}
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
      <span
        aria-hidden
        className="pointer-events-none absolute inset-[2px] border opacity-40 transition-opacity group-hover:opacity-70"
        style={{ borderColor: palette.border }}
      />
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

// ─── Slug-dispatched picker ──────────────────────────────────────────────────

const STYLE_KEYS = ['terminal', 'bauhaus', 'decay'] as const;

/**
 * Seeded button picker. Hashes the dream slug to dispatch one of the three
 * styles, then renders that style with the same slug so its internal
 * variation (tint / glyph / accent) also seeds off the dream. Result: every
 * dream gets a visually unique button, but the same dream always gets the
 * same button across renders / sessions / users.
 */
export const DreamButton: FC<BaseProps> = props => {
  const styleKey = props.forceStyle
    ? props.forceStyle
    : STYLE_KEYS[hash(`${props.dreamSlug}::style`) % STYLE_KEYS.length];
  const Component =
    styleKey === 'terminal'
      ? TerminalButton
      : styleKey === 'bauhaus'
        ? BauhausButton
        : DecayButton;
  return <Component {...props} />;
};
