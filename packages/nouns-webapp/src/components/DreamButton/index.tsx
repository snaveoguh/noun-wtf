/**
 * DreamButton — slug-dispatched seeded dream-card buttons.
 *
 * User feedback (2026-05-10): the previous 3 styles were too uniform — same
 * height, same monospace font, same 1px border. The brief was actually
 * "different styles and colors and fonts and sizes and thickness and 3dness".
 * So this rewrite ships TWELVE wildly different button styles, dispatched
 * by FNV-1a hash of the dream slug:
 *
 *   01 Brutalist     — Impact display, 3px black border, chunky drop shadow
 *   02 Win95         — beveled gray, raised 3D bevel, Tahoma-ish system sans
 *   03 Aqua          — glossy gradient, rounded-full, white text + shine
 *   04 8-bit         — monospace, 3px hard border, no antialiasing vibes
 *   05 Neon          — black bg, neon outline + glow, italic display
 *   06 Receipt       — tiny mono on cream, dashed border, super tight
 *   07 Neumorph      — soft pillowy shadows, very rounded, light gray
 *   08 Sticker       — bright tag with peel-edge, condensed italic
 *   09 Newspaper     — Georgia serif, all caps, double border, sepia
 *   10 Vapor         — pink/cyan gradient, italic display, drop shadow
 *   11 Xerox         — black/white stripe, tilted rotate, mono italic
 *   12 Crypto Term   — green-on-black, ">" prefix, monospace
 *
 * Each style sets its own height, font, border thickness, padding, and 3D
 * treatment. Within a single dream card all the action buttons share the
 * dream's slug so they pick the same style — the card stays visually
 * coherent. ACROSS cards, every dream gets a different look.
 *
 * Hash is FNV-1a 32-bit. Stable across renders/sessions/users — the same
 * dream always renders the same button. No randomness anywhere.
 */
import { CSSProperties, FC } from 'react';

export type DreamButtonVariant = 'sponsor' | 'promote' | 'view' | 'create';

interface BaseProps {
  label: string;
  variant: DreamButtonVariant;
  dreamSlug: string;
  onClick?: (e: React.MouseEvent) => void;
  /** Override the auto-dispatch — used by the playground to render every
   *  style side by side. Production callers should leave this unset. */
  forceStyle?: StyleKey;
  className?: string;
}

// FNV-1a 32-bit. Stable across renders — no Date.now / Math.random.
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

// Variant accent colors — each style remixes these so 'sponsor' usually
// reads cool/blue, 'promote' green, 'view' gray, 'create' warm/orange. But
// every style is free to interpret the variant as it sees fit (e.g. Vapor
// uses pink/cyan regardless).
type VariantPalette<T> = Record<DreamButtonVariant, T>;

// ─── 01 Brutalist ────────────────────────────────────────────────────────────
// Heavy display font, 3px solid black border, hard drop shadow that snaps to
// the bottom-right. Hover lifts the shadow. All caps.

const BRUTALIST: VariantPalette<{ bg: string; ink: string }> = {
  sponsor: { bg: '#FFD400', ink: '#000' },
  promote: { bg: '#3CFF7C', ink: '#000' },
  view: { bg: '#FFFFFF', ink: '#000' },
  create: { bg: '#FF4D2E', ink: '#000' },
};

export const BrutalistButton: FC<BaseProps> = ({
  label,
  variant,
  onClick,
  className = '',
}) => {
  const palette = BRUTALIST[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-flex h-9 w-full items-center justify-center px-3 transition-transform active:translate-x-[2px] active:translate-y-[2px] focus-visible:outline-none ${className}`}
      style={{
        color: palette.ink,
        backgroundColor: palette.bg,
        border: '3px solid #000',
        borderRadius: 0,
        fontFamily: 'Impact, "Arial Narrow Bold", "Helvetica Neue", sans-serif',
        fontSize: 14,
        fontWeight: 900,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        boxShadow: '4px 4px 0 0 #000',
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity group-active:opacity-0"
      />
      {label}
    </button>
  );
};

// ─── 02 Win95 ────────────────────────────────────────────────────────────────
// Classic beveled raised button — light/white top-left edges, dark
// bottom-right edges. Pressed inverts the bevel.

const WIN95: VariantPalette<{ bg: string; ink: string }> = {
  sponsor: { bg: '#C3C3C3', ink: '#000' },
  promote: { bg: '#C3C3C3', ink: '#003300' },
  view: { bg: '#C3C3C3', ink: '#000' },
  create: { bg: '#C3C3C3', ink: '#7A0000' },
};

export const Win95Button: FC<BaseProps> = ({ label, variant, onClick, className = '' }) => {
  const palette = WIN95[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-flex h-7 w-full items-center justify-center px-3 focus-visible:outline-none ${className}`}
      style={{
        color: palette.ink,
        backgroundColor: palette.bg,
        borderTop: '2px solid #FFFFFF',
        borderLeft: '2px solid #FFFFFF',
        borderRight: '2px solid #404040',
        borderBottom: '2px solid #404040',
        boxShadow: 'inset -1px -1px 0 0 #828282, inset 1px 1px 0 0 #DFDFDF',
        borderRadius: 0,
        fontFamily: '"Tahoma", "MS Sans Serif", "Geneva", sans-serif',
        fontSize: 11,
        fontWeight: 400,
      }}
    >
      {label}
    </button>
  );
};

// ─── 03 Aqua ─────────────────────────────────────────────────────────────────
// Glossy iOS-2007 vibe. Top-half highlight, gradient body, full pill radius.

const AQUA: VariantPalette<{ from: string; to: string }> = {
  sponsor: { from: '#5BC0FF', to: '#0F7FCB' },
  promote: { from: '#7DE49C', to: '#1E8C45' },
  view: { from: '#D8D8D8', to: '#888' },
  create: { from: '#FFCC60', to: '#D17800' },
};

export const AquaButton: FC<BaseProps> = ({ label, variant, onClick, className = '' }) => {
  const palette = AQUA[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-flex h-8 w-full items-center justify-center overflow-hidden px-4 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${className}`}
      style={{
        background: `linear-gradient(180deg, ${palette.from} 0%, ${palette.to} 100%)`,
        borderRadius: 9999,
        border: `1px solid ${palette.to}`,
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.6), inset 0 -1px 0 rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.18)',
        fontFamily: '"SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.02em',
        textShadow: '0 -1px 0 rgba(0,0,0,0.25)',
      }}
    >
      {/* Glossy top-half highlight */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2"
        style={{
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.05) 100%)',
          borderTopLeftRadius: 9999,
          borderTopRightRadius: 9999,
        }}
      />
      <span className="relative">{label}</span>
    </button>
  );
};

// ─── 04 8-bit ────────────────────────────────────────────────────────────────
// Pixel-perfect feel. Hard 3px border, no border-radius, monospace, big text.

const EIGHTBIT: VariantPalette<{ bg: string; ink: string; border: string }> = {
  sponsor: { bg: '#3754F2', ink: '#FFF', border: '#000' },
  promote: { bg: '#28C840', ink: '#000', border: '#000' },
  view: { bg: '#2A2A2A', ink: '#9DEFAA', border: '#9DEFAA' },
  create: { bg: '#FFCC00', ink: '#000', border: '#000' },
};

export const EightBitButton: FC<BaseProps> = ({
  label,
  variant,
  onClick,
  className = '',
}) => {
  const palette = EIGHTBIT[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-flex h-8 w-full items-center justify-center px-3 transition-transform active:translate-y-[2px] focus-visible:outline-none ${className}`}
      style={{
        color: palette.ink,
        backgroundColor: palette.bg,
        border: `3px solid ${palette.border}`,
        borderRadius: 0,
        fontFamily: '"Courier New", "Press Start 2P", monospace',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        boxShadow: `0 3px 0 0 ${palette.border}`,
        imageRendering: 'pixelated',
      }}
    >
      {label}
    </button>
  );
};

// ─── 05 Neon ─────────────────────────────────────────────────────────────────
// Black bg with neon outline + glow. Italic display font.

const NEON: VariantPalette<string> = {
  sponsor: '#00E5FF',
  promote: '#39FF14',
  view: '#FFFFFF',
  create: '#FF36BA',
};

export const NeonButton: FC<BaseProps> = ({ label, variant, onClick, className = '' }) => {
  const color = NEON[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-flex h-9 w-full items-center justify-center px-4 focus-visible:outline-none ${className}`}
      style={{
        color,
        backgroundColor: '#0A0014',
        border: `1.5px solid ${color}`,
        borderRadius: 4,
        fontFamily: '"Helvetica Neue", "Arial", sans-serif',
        fontSize: 11,
        fontWeight: 700,
        fontStyle: 'italic',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        boxShadow: `0 0 10px ${color}55, inset 0 0 8px ${color}33`,
        textShadow: `0 0 6px ${color}, 0 0 10px ${color}88`,
      }}
    >
      {label}
    </button>
  );
};

// ─── 06 Receipt ──────────────────────────────────────────────────────────────
// Tiny mono on cream paper. Dashed border. Super tight.

const RECEIPT: VariantPalette<{ ink: string }> = {
  sponsor: { ink: '#1B3A5C' },
  promote: { ink: '#1F5C2E' },
  view: { ink: '#2A2A2A' },
  create: { ink: '#7A3A0E' },
};

export const ReceiptButton: FC<BaseProps> = ({
  label,
  variant,
  onClick,
  className = '',
}) => {
  const palette = RECEIPT[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-flex h-6 w-full items-center justify-center px-2 focus-visible:outline-none ${className}`}
      style={{
        color: palette.ink,
        backgroundColor: '#FBF7EC',
        border: `1px dashed ${palette.ink}`,
        borderRadius: 2,
        fontFamily: '"Courier New", monospace',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
      }}
    >
      ─&nbsp;{label}&nbsp;─
    </button>
  );
};

// ─── 07 Neumorph ─────────────────────────────────────────────────────────────
// Soft pillowy shadows, very rounded, light gray. Pressed = inset.

const NEUMORPH: VariantPalette<{ ink: string }> = {
  sponsor: { ink: '#1B3A5C' },
  promote: { ink: '#1F5C2E' },
  view: { ink: '#444' },
  create: { ink: '#7A3A0E' },
};

export const NeumorphButton: FC<BaseProps> = ({
  label,
  variant,
  onClick,
  className = '',
}) => {
  const palette = NEUMORPH[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-flex h-9 w-full items-center justify-center px-4 transition-shadow focus-visible:outline-none ${className}`}
      style={{
        color: palette.ink,
        backgroundColor: '#E6E6E9',
        borderRadius: 14,
        border: 'none',
        boxShadow:
          '6px 6px 12px rgba(166,166,180,0.55), -6px -6px 12px rgba(255,255,255,0.95)',
        fontFamily: '"SF Pro Display", "Helvetica Neue", system-ui, sans-serif',
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {label}
    </button>
  );
};

// ─── 08 Sticker ──────────────────────────────────────────────────────────────
// Loud color tag with slight rotation, condensed italic. Drop shadow makes it
// look pasted on. Each button rotates a touch differently per slug.

const STICKER: VariantPalette<{ bg: string; ink: string }> = {
  sponsor: { bg: '#21D4FD', ink: '#FFF' },
  promote: { bg: '#22DD7C', ink: '#FFF' },
  view: { bg: '#A8A8A8', ink: '#FFF' },
  create: { bg: '#FF5E62', ink: '#FFF' },
};

export const StickerButton: FC<BaseProps> = ({
  label,
  variant,
  dreamSlug,
  onClick,
  className = '',
}) => {
  const palette = STICKER[variant];
  // -2.5° to 2.5° tilt per slug — same dream always tilts the same way.
  const tilt = (hash(`${dreamSlug}::tilt`) % 50) / 10 - 2.5;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-flex h-8 w-full items-center justify-center px-3 focus-visible:outline-none ${className}`}
      style={{
        color: palette.ink,
        backgroundColor: palette.bg,
        border: '2px solid #FFFFFF',
        borderRadius: 4,
        fontFamily: '"Bebas Neue", "Oswald", "Arial Narrow", sans-serif',
        fontSize: 13,
        fontWeight: 800,
        fontStyle: 'italic',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        transform: `rotate(${tilt}deg)`,
        boxShadow: '0 3px 6px rgba(0,0,0,0.22), 0 1px 2px rgba(0,0,0,0.18)',
      }}
    >
      {label}
    </button>
  );
};

// ─── 09 Newspaper ────────────────────────────────────────────────────────────
// Georgia serif, all caps, double border, sepia.

const NEWSPAPER: VariantPalette<{ ink: string }> = {
  sponsor: { ink: '#1F2F4A' },
  promote: { ink: '#28482A' },
  view: { ink: '#2A2A2A' },
  create: { ink: '#5C2A0E' },
};

export const NewspaperButton: FC<BaseProps> = ({
  label,
  variant,
  onClick,
  className = '',
}) => {
  const palette = NEWSPAPER[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-flex h-7 w-full items-center justify-center px-3 focus-visible:outline-none ${className}`}
      style={{
        color: palette.ink,
        backgroundColor: '#F2EBD9',
        border: `3px double ${palette.ink}`,
        borderRadius: 0,
        fontFamily: '"Georgia", "Times New Roman", serif',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </button>
  );
};

// ─── 10 Vapor ────────────────────────────────────────────────────────────────
// Pink/cyan gradient, italic display.

const VAPOR: VariantPalette<{ from: string; to: string }> = {
  sponsor: { from: '#43E0F4', to: '#A24DF1' },
  promote: { from: '#7DEB9C', to: '#2E5DDF' },
  view: { from: '#D8D8D8', to: '#888888' },
  create: { from: '#FF6FB3', to: '#F1A24D' },
};

export const VaporButton: FC<BaseProps> = ({ label, variant, onClick, className = '' }) => {
  const palette = VAPOR[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-flex h-9 w-full items-center justify-center overflow-hidden px-4 text-white focus-visible:outline-none ${className}`}
      style={{
        background: `linear-gradient(135deg, ${palette.from} 0%, ${palette.to} 100%)`,
        borderRadius: 8,
        border: 'none',
        fontFamily: '"Helvetica Neue", "Arial Black", sans-serif',
        fontSize: 13,
        fontWeight: 900,
        fontStyle: 'italic',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        boxShadow: '0 4px 18px rgba(248, 87, 200, 0.4), 0 1px 0 rgba(255,255,255,0.4) inset',
        textShadow: '1px 1px 0 rgba(0,0,0,0.18)',
      }}
    >
      {label}
    </button>
  );
};

// ─── 11 Xerox ────────────────────────────────────────────────────────────────
// Black/white stripe pattern bg, slight rotate, mono italic. Lo-fi punk zine.

const XEROX: VariantPalette<{ ink: string }> = {
  sponsor: { ink: '#000' },
  promote: { ink: '#000' },
  view: { ink: '#000' },
  create: { ink: '#000' },
};

export const XeroxButton: FC<BaseProps> = ({
  label,
  variant,
  dreamSlug,
  onClick,
  className = '',
}) => {
  const palette = XEROX[variant];
  // Tilted -1.5° to 1.5° per slug.
  const tilt = (hash(`${dreamSlug}::tilt`) % 30) / 10 - 1.5;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-flex h-8 w-full items-center justify-center px-3 focus-visible:outline-none ${className}`}
      style={{
        color: palette.ink,
        backgroundColor: '#FFF',
        backgroundImage:
          'repeating-linear-gradient(45deg, rgba(0,0,0,0.08) 0 2px, transparent 2px 6px)',
        border: '1.5px solid #000',
        borderRadius: 0,
        fontFamily: '"Courier New", monospace',
        fontSize: 11,
        fontWeight: 700,
        fontStyle: 'italic',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        transform: `rotate(${tilt}deg)`,
        boxShadow: '2px 2px 0 0 #000',
      }}
    >
      {label}
    </button>
  );
};

// ─── 12 Crypto Terminal ──────────────────────────────────────────────────────
// Green-on-black, ">" prefix, monospace. Caret blink on hover.

const TERM: VariantPalette<string> = {
  sponsor: '#7CC8FF',
  promote: '#9DEFAA',
  view: '#C9C9C9',
  create: '#FFD37A',
};

export const TerminalButton: FC<BaseProps> = ({
  label,
  variant,
  onClick,
  className = '',
}) => {
  const fg = TERM[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative inline-flex h-7 w-full items-center justify-center px-2 focus-visible:outline-none ${className}`}
      style={{
        color: fg,
        backgroundColor: '#02080F',
        border: `1px solid ${fg}55`,
        borderRadius: 2,
        fontFamily: '"Courier New", "Consolas", monospace',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
      }}
    >
      <span className="opacity-70">&gt;&nbsp;</span>
      {label}
      <span className="ml-0.5 inline-block w-[5px] opacity-0 group-hover:opacity-80">_</span>
    </button>
  );
};

// ─── Slug-dispatched picker ──────────────────────────────────────────────────

export const STYLE_KEYS = [
  'brutalist',
  'win95',
  'aqua',
  'eightbit',
  'neon',
  'receipt',
  'neumorph',
  'sticker',
  'newspaper',
  'vapor',
  'xerox',
  'terminal',
] as const;

export type StyleKey = (typeof STYLE_KEYS)[number];

const COMPONENT_BY_KEY: Record<StyleKey, FC<BaseProps>> = {
  brutalist: BrutalistButton,
  win95: Win95Button,
  aqua: AquaButton,
  eightbit: EightBitButton,
  neon: NeonButton,
  receipt: ReceiptButton,
  neumorph: NeumorphButton,
  sticker: StickerButton,
  newspaper: NewspaperButton,
  vapor: VaporButton,
  xerox: XeroxButton,
  terminal: TerminalButton,
};

export const STYLE_META: Record<StyleKey, { name: string; blurb: string }> = {
  brutalist: { name: 'Brutalist', blurb: 'Impact display, 3px black border, snap drop shadow.' },
  win95: { name: 'Win95', blurb: 'Beveled raised gray. Tahoma. Pure Y2K.' },
  aqua: { name: 'Aqua', blurb: 'Glossy gradient pill, white text + top shine, iOS-2007.' },
  eightbit: { name: '8-bit', blurb: 'Monospace, 3px hard border, chunky pixel-game vibe.' },
  neon: { name: 'Neon', blurb: 'Black bg, neon outline + glow, italic display.' },
  receipt: { name: 'Receipt', blurb: 'Tiny mono on cream paper, dashed border, ─ flanks.' },
  neumorph: { name: 'Neumorph', blurb: 'Pillowy shadows, very rounded, light gray.' },
  sticker: { name: 'Sticker', blurb: 'Loud color tag, condensed italic, slight per-slug tilt.' },
  newspaper: { name: 'Newspaper', blurb: 'Georgia serif, all caps, double border, sepia.' },
  vapor: { name: 'Vapor', blurb: 'Pink/cyan gradient, italic Helvetica Black, drop shadow.' },
  xerox: { name: 'Xerox', blurb: 'Black/white stripe pattern, tilted, lo-fi zine.' },
  terminal: { name: 'Terminal', blurb: 'Green-on-black, "> " prefix, blinking caret on hover.' },
};

/**
 * Seeded button picker. FNV-1a hash of `${slug}::style` mod 12 picks one of
 * the styles; the same slug always gets the same style. Within the picked
 * style, any per-slug variation (tilt for Sticker/Xerox) seeds off the same
 * slug too. Override with `forceStyle` for the playground.
 */
export const DreamButton: FC<BaseProps> = props => {
  const styleKey: StyleKey = props.forceStyle
    ? props.forceStyle
    : STYLE_KEYS[hash(`${props.dreamSlug}::style`) % STYLE_KEYS.length];
  const Component = COMPONENT_BY_KEY[styleKey];
  return <Component {...props} />;
};

// Also export the helpers in case callers want to introspect.
export { hash, seededPick };
export type { CSSProperties };
