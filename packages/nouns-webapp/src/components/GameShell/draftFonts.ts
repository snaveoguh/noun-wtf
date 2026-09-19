/**
 * Fonts for the proposal draft window.
 *
 * The site forces Pip3 onto every element via `[data-theme] * { font-family …
 * !important }` (index.css). Pip3 is an uppercase-only display face, which
 * makes a long pasted proposal hard to read. The draft panel scopes a
 * user-chosen face over itself instead — see the `.proposal-draft-font-scope`
 * block in index.css, which out-specifies the theme rules.
 *
 * Figtree is the default. Google faces are injected on first selection only,
 * so nobody downloads a font they never picked; Comic Neue, JetBrains Mono
 * and Pip3 are already on the page (index.html / index.css).
 */
export type DraftFontGroup = 'nouns' | 'sans' | 'serif' | 'display' | 'hand' | 'mono';

export interface DraftFont {
  id: string;
  label: string;
  /** CSS font-family stack. */
  stack: string;
  /** Google Fonts family to lazy-load. Omitted for system / already-loaded faces. */
  google?: { family: string; weights?: string };
  /** Pip3 has no lowercase glyphs — keep the site's uppercase transform for it. */
  uppercase?: boolean;
  group: DraftFontGroup;
}

export const DRAFT_FONT_GROUPS: readonly { key: DraftFontGroup; label: string }[] = [
  { key: 'nouns', label: 'Nouns' },
  { key: 'sans', label: 'Sans' },
  { key: 'serif', label: 'Serif' },
  { key: 'display', label: 'Display' },
  { key: 'hand', label: 'Handwriting' },
  { key: 'mono', label: 'Mono' },
];

const FALLBACK: Record<DraftFontGroup, string> = {
  nouns: 'system-ui, sans-serif',
  sans: 'system-ui, -apple-system, sans-serif',
  serif: 'Georgia, serif',
  display: "'Comic Sans MS', cursive",
  hand: 'cursive',
  mono: "'JetBrains Mono', monospace",
};

/**
 * Google Fonts entry. `weights` is the `wght@` axis to request; leave it off
 * for single-weight faces — asking Google for a weight a family lacks 400s
 * the whole stylesheet, so bold is synthesised for those instead.
 */
function gf(label: string, group: DraftFontGroup, weights?: string): DraftFont {
  return {
    id: label.toLowerCase().replace(/[^\da-z]+/g, '-'),
    label,
    group,
    stack: `'${label}', ${FALLBACK[group]}`,
    google: { family: label, weights },
  };
}

export const DRAFT_FONTS: readonly DraftFont[] = [
  // ── Nouns ── the default, the site font, and the house options
  gf('Figtree', 'nouns', '400;600;700'),
  {
    id: 'comic',
    label: 'Comic Sans',
    group: 'nouns',
    stack: "'Comic Sans MS', 'Comic Sans', 'Comic Neue', cursive",
  },
  {
    id: 'pip3',
    label: 'Pip3',
    group: 'nouns',
    stack: "'Pip3', 'JetBrains Mono', monospace",
    uppercase: true,
  },
  {
    ...gf('Londrina Solid', 'nouns', '400;900'),
    stack: "'Londrina Solid', 'Comic Sans MS', cursive",
  },

  // ── Sans ──
  gf('Inter', 'sans', '400;600;700'),
  gf('Poppins', 'sans', '400;600;700'),
  gf('Outfit', 'sans', '400;600;700'),
  gf('DM Sans', 'sans', '400;600;700'),
  gf('Manrope', 'sans', '400;600;700'),
  gf('Space Grotesk', 'sans', '400;600;700'),
  gf('Plus Jakarta Sans', 'sans', '400;600;700'),
  gf('Nunito', 'sans', '400;600;700'),
  gf('Rubik', 'sans', '400;600;700'),
  gf('Work Sans', 'sans', '400;600;700'),
  gf('Karla', 'sans', '400;700'),
  gf('Lexend', 'sans', '400;600;700'),
  gf('Sora', 'sans', '400;600;700'),
  gf('Urbanist', 'sans', '400;600;700'),
  gf('Public Sans', 'sans', '400;600;700'),
  gf('IBM Plex Sans', 'sans', '400;600;700'),
  gf('Source Sans 3', 'sans', '400;600;700'),
  gf('Montserrat', 'sans', '400;600;700'),
  gf('Raleway', 'sans', '400;600;700'),
  gf('Lato', 'sans', '400;700'),
  gf('Open Sans', 'sans', '400;600;700'),
  gf('Roboto', 'sans', '400;700'),
  gf('Quicksand', 'sans', '400;600;700'),
  gf('Barlow', 'sans', '400;600;700'),
  gf('Archivo', 'sans', '400;600;700'),
  gf('Red Hat Display', 'sans', '400;600;700'),
  {
    id: 'system',
    label: 'System UI',
    group: 'sans',
    stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },

  // ── Serif ──
  gf('Playfair Display', 'serif', '400;700'),
  gf('Lora', 'serif', '400;700'),
  gf('Merriweather', 'serif', '400;700'),
  gf('EB Garamond', 'serif', '400;700'),
  gf('Libre Baskerville', 'serif', '400;700'),
  gf('Fraunces', 'serif', '400;700'),
  gf('DM Serif Display', 'serif'),
  gf('Crimson Pro', 'serif', '400;700'),
  gf('Newsreader', 'serif', '400;700'),
  gf('Cormorant Garamond', 'serif', '400;700'),
  gf('Bitter', 'serif', '400;700'),

  // ── Display ──
  gf('Bangers', 'display'),
  gf('Press Start 2P', 'display'),
  gf('Silkscreen', 'display', '400;700'),
  gf('VT323', 'display'),
  gf('Pixelify Sans', 'display', '400;700'),
  gf('Bungee', 'display'),
  gf('Righteous', 'display'),
  gf('Fredoka', 'display', '400;600;700'),
  gf('Baloo 2', 'display', '400;700'),
  gf('Lilita One', 'display'),
  gf('Luckiest Guy', 'display'),
  gf('Rubik Mono One', 'display'),
  gf('Monoton', 'display'),
  gf('Unbounded', 'display', '400;700'),
  gf('Bebas Neue', 'display'),
  gf('Anton', 'display'),

  // ── Handwriting ──
  { ...gf('Comic Neue', 'hand', '400;700'), google: undefined }, // already loaded via index.html
  gf('Caveat', 'hand', '400;700'),
  gf('Patrick Hand', 'hand'),
  gf('Kalam', 'hand', '400;700'),
  gf('Indie Flower', 'hand'),
  gf('Shadows Into Light', 'hand'),
  gf('Gloria Hallelujah', 'hand'),
  gf('Architects Daughter', 'hand'),
  gf('Gochi Hand', 'hand'),
  gf('Permanent Marker', 'hand'),
  gf('Schoolbell', 'hand'),
  gf('Short Stack', 'hand'),

  // ── Mono ──
  { ...gf('JetBrains Mono', 'mono', '400;700'), google: undefined }, // already loaded via index.html
  gf('Fira Code', 'mono', '400;700'),
  gf('IBM Plex Mono', 'mono', '400;700'),
  gf('Space Mono', 'mono', '400;700'),
  gf('Roboto Mono', 'mono', '400;700'),
  gf('Source Code Pro', 'mono', '400;700'),
  gf('Inconsolata', 'mono', '400;700'),
  gf('DM Mono', 'mono', '400;500'),
  gf('Ubuntu Mono', 'mono', '400;700'),
];

export const DEFAULT_DRAFT_FONT_ID = 'figtree';
const STORAGE_KEY = 'nounwtf:draft-font';

export function getDraftFont(id: string | null | undefined): DraftFont {
  return DRAFT_FONTS.find(f => f.id === id) ?? DRAFT_FONTS[0];
}

export function loadDraftFontId(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_DRAFT_FONT_ID;
  } catch {
    return DEFAULT_DRAFT_FONT_ID;
  }
}

export function saveDraftFontId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private mode / blocked storage — the choice just won't persist.
  }
}

/** Inject the Google Fonts stylesheet for a face, once per page load. */
export function ensureDraftFontLoaded(font: DraftFont): void {
  if (font.google === undefined || typeof document === 'undefined') return;
  const id = `draft-font-${font.id}`;
  if (document.getElementById(id) !== null) return;
  const family = font.google.family.replace(/ /g, '+');
  const axis = font.google.weights === undefined ? '' : `:wght@${font.google.weights}`;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family}${axis}&display=swap`;
  document.head.appendChild(link);
}
