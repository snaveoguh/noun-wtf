/**
 * Site-wide font registry + switcher state.
 *
 * The site used to hard-code Pip3 into every theme rule (`[data-theme] * {
 * font-family: 'Pip3' … !important }`). Those rules now read `--site-font`
 * and `--site-transform` off `<html>`, which this module sets — and which
 * index.html's anti-flash bootstrap sets *before first paint* from the same
 * localStorage key, so a stored choice never flashes through Pip3.
 *
 * Default is Figtree. Pip3 stays available and, when picked, restores the
 * uppercase + single-weight treatment it was designed around (it has no
 * lowercase glyphs). Google faces inject on first selection only.
 *
 * Consumers: FontSwitcher (terminal header + navbar), and the draft window's
 * own picker, which defaults to whatever the site font is.
 */
export type SiteFontGroup = 'nouns' | 'sans' | 'serif' | 'display' | 'hand' | 'mono';

export interface SiteFont {
  id: string;
  label: string;
  /** CSS font-family stack. */
  stack: string;
  /** Google Fonts family to lazy-load. Omitted for system / already-loaded faces. */
  google?: { family: string; weights?: string };
  /** Pip3 has no lowercase glyphs — keep the site's uppercase transform for it. */
  uppercase?: boolean;
  group: SiteFontGroup;
}

export const SITE_FONT_GROUPS: readonly { key: SiteFontGroup; label: string }[] = [
  { key: 'nouns', label: 'Nouns' },
  { key: 'sans', label: 'Sans' },
  { key: 'serif', label: 'Serif' },
  { key: 'display', label: 'Display' },
  { key: 'hand', label: 'Handwriting' },
  { key: 'mono', label: 'Mono' },
];

const FALLBACK: Record<SiteFontGroup, string> = {
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
function gf(label: string, group: SiteFontGroup, weights?: string): SiteFont {
  return {
    id: label.toLowerCase().replace(/[^\da-z]+/g, '-'),
    label,
    group,
    stack: `'${label}', ${FALLBACK[group]}`,
    google: { family: label, weights },
  };
}

export const SITE_FONTS: readonly SiteFont[] = [
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

export const DEFAULT_SITE_FONT_ID = 'figtree';

/**
 * Single JSON key. Storing the *resolved* stack/transform/google params (not
 * just the id) is what lets the pre-paint bootstrap in index.html apply the
 * choice without knowing this registry.
 */
export const SITE_FONT_STORAGE_KEY = 'noun-wtf-font';

interface StoredSiteFont {
  id: string;
  stack: string;
  transform: 'none' | 'uppercase';
  google: string | null;
}

export function getSiteFont(id: string | null | undefined): SiteFont {
  return SITE_FONTS.find(f => f.id === id) ?? SITE_FONTS[0];
}

export function getSiteFontId(): string {
  try {
    const raw = localStorage.getItem(SITE_FONT_STORAGE_KEY);
    if (raw === null) return DEFAULT_SITE_FONT_ID;
    const parsed = JSON.parse(raw) as Partial<StoredSiteFont>;
    return typeof parsed.id === 'string' && SITE_FONTS.some(f => f.id === parsed.id)
      ? parsed.id
      : DEFAULT_SITE_FONT_ID;
  } catch {
    return DEFAULT_SITE_FONT_ID;
  }
}

function googleParam(font: SiteFont): string | null {
  if (font.google === undefined) return null;
  const family = font.google.family.replace(/ /g, '+');
  return font.google.weights === undefined ? family : `${family}:wght@${font.google.weights}`;
}

/** Inject the Google Fonts stylesheet for a face, once per page load. */
export function ensureFontLoaded(font: SiteFont): void {
  const param = googleParam(font);
  if (param === null || typeof document === 'undefined') return;
  const id = `site-font-${font.id}`;
  if (document.getElementById(id) !== null) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${param}&display=swap`;
  document.head.appendChild(link);
}

/** Apply a font site-wide: CSS vars + data attribute on <html>, persist, load. */
export function applySiteFont(id: string): SiteFont {
  const font = getSiteFont(id);
  const transform: StoredSiteFont['transform'] = font.uppercase === true ? 'uppercase' : 'none';
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.style.setProperty('--site-font', font.stack);
    root.style.setProperty('--site-transform', transform);
    root.setAttribute('data-font', font.id);
  }
  ensureFontLoaded(font);
  try {
    const stored: StoredSiteFont = {
      id: font.id,
      stack: font.stack,
      transform,
      google: googleParam(font),
    };
    localStorage.setItem(SITE_FONT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode / blocked storage — applies for this page load only.
  }
  return font;
}
