import { createContext, use, useEffect, useMemo, useState, type ReactNode } from 'react';

export type SiteMode = 'new' | 'classic';
export type ThemeName = 'terminal' | 'abacus';

export const THEME_NAMES: ThemeName[] = ['abacus', 'terminal'];

/**
 * Each theme decides what home layout it uses. Terminal has a non-auction
 * home (the terminal feed); Abacus reuses the auction page for `/`. The rest
 * of the app routes through `mode`.
 */
const THEME_TO_MODE: Record<ThemeName, SiteMode> = {
  terminal: 'new',
  abacus: 'classic',
};

/**
 * Themes sunset but kept on disk in case we want to revive them. Stored values
 * matching this list are migrated to a sane default rather than crashing the
 * theme picker / shell-router.
 */
const SUNSET_THEME_FALLBACK: Record<string, ThemeName> = {
  camp: 'abacus',
  pro: 'abacus',
  hectic: 'abacus',
  classic: 'abacus',
  game: 'abacus',
  berry: 'abacus',
  catalogue: 'abacus',
};

interface SiteThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  /** Derived from theme — kept for backwards compatibility with existing layout switches. */
  mode: SiteMode;
  /** Setting mode directly is supported but maps to a theme: 'new' → terminal, 'classic' → abacus. */
  setMode: (mode: SiteMode) => void;
  isEmbedded: boolean;
}

const SiteThemeContext = createContext<SiteThemeContextValue>({
  theme: 'abacus',
  setTheme: () => {},
  mode: 'classic',
  setMode: () => {},
  isEmbedded: false,
});

const THEME_STORAGE_KEY = 'noun-wtf-theme';
const LEGACY_MODE_STORAGE_KEY = 'noun-wtf-site-mode';

function isThemeName(value: unknown): value is ThemeName {
  return typeof value === 'string' && (THEME_NAMES as readonly string[]).includes(value);
}

/**
 * Read a `/<theme>/...` prefix from the current pathname. Returns the theme
 * name when the first path segment is a known theme, otherwise null. Used by
 * `getInitialState` so a hard-load of `/terminal` boots straight into the
 * terminal theme — without this the page would briefly render the localStorage
 * theme before the route-level effect kicks in and switches.
 */
function readThemeFromPath(pathname: string): ThemeName | null {
  const segment = pathname.split('/').filter(Boolean)[0];
  if (!segment) return null;
  return isThemeName(segment) ? segment : null;
}

function getInitialState(): { theme: ThemeName; isEmbedded: boolean } {
  if (typeof window === 'undefined') {
    return { theme: 'abacus', isEmbedded: false };
  }

  // URL path takes precedence over everything else. Visiting `/berry` should
  // boot in the berry theme regardless of localStorage / query params, so
  // share links Just Work.
  const pathTheme = readThemeFromPath(window.location.pathname);
  if (pathTheme) {
    return { theme: pathTheme, isEmbedded: false };
  }

  // Query params next — for miniapp / embedded contexts. Honour both `?theme=`
  // (new) and `?mode=` (legacy) so existing share links keep working.
  const params = new URLSearchParams(window.location.search);
  const themeParam = params.get('theme');
  if (typeof themeParam === 'string' && themeParam in SUNSET_THEME_FALLBACK) {
    return { theme: SUNSET_THEME_FALLBACK[themeParam], isEmbedded: false };
  }
  if (isThemeName(themeParam)) {
    return { theme: themeParam, isEmbedded: false };
  }
  const modeParam = params.get('mode');
  if (modeParam === 'terminal' || modeParam === 'new') {
    return { theme: 'terminal', isEmbedded: true };
  }
  if (modeParam === 'classic') {
    return { theme: 'abacus', isEmbedded: false };
  }

  // Telegram / Farcaster contexts — terminal-feed home is the embedded surface.
  const embedHost = window as unknown as { Telegram?: { WebApp?: unknown }; farcaster?: unknown };
  if (embedHost.Telegram?.WebApp != null || embedHost.farcaster != null) {
    return { theme: 'terminal', isEmbedded: true };
  }

  // localStorage — read the new key first, fall back to the legacy mode key.
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  // Sunset themes (e.g. 'pro', 'berry') gracefully fall back to a default
  // rather than sticking the user on a theme that no longer renders.
  if (typeof storedTheme === 'string' && storedTheme in SUNSET_THEME_FALLBACK) {
    return { theme: SUNSET_THEME_FALLBACK[storedTheme], isEmbedded: false };
  }
  if (isThemeName(storedTheme)) {
    return { theme: storedTheme, isEmbedded: false };
  }
  const legacyMode = localStorage.getItem(LEGACY_MODE_STORAGE_KEY);
  if (legacyMode === 'classic') {
    return { theme: 'abacus', isEmbedded: false };
  }
  if (legacyMode === 'new') {
    return { theme: 'terminal', isEmbedded: false };
  }

  return { theme: 'abacus', isEmbedded: false };
}

function applyThemeAttribute(theme: ThemeName) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

export function SiteThemeProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(getInitialState);
  const [theme, setThemeState] = useState<ThemeName>(initial.theme);
  const [isEmbedded] = useState(initial.isEmbedded);

  useEffect(() => {
    applyThemeAttribute(theme);
  }, [theme]);

  // Persist initial theme + sync the legacy mode key for any code still reading it.
  useEffect(() => {
    if (isEmbedded) return;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    localStorage.setItem(LEGACY_MODE_STORAGE_KEY, THEME_TO_MODE[theme]);
  }, [theme, isEmbedded]);

  const setTheme = (next: ThemeName) => {
    setThemeState(next);
    applyThemeAttribute(next);
    if (!isEmbedded) {
      localStorage.setItem(THEME_STORAGE_KEY, next);
      localStorage.setItem(LEGACY_MODE_STORAGE_KEY, THEME_TO_MODE[next]);
    }
  };

  const setMode = (mode: SiteMode) => {
    if (mode === 'new') {
      setTheme('terminal');
      return;
    }
    // Switching to 'classic' from terminal — abacus is the only classic-layout theme.
    if (theme === 'terminal') {
      setTheme('abacus');
      return;
    }
    // Already in a classic-layout theme — no-op.
  };

  const value = useMemo<SiteThemeContextValue>(
    () => ({
      theme,
      setTheme,
      mode: THEME_TO_MODE[theme],
      setMode,
      isEmbedded,
    }),
    [theme, isEmbedded],
  );

  return <SiteThemeContext value={value}>{children}</SiteThemeContext>;
}

export function useSiteTheme() {
  return use(SiteThemeContext);
}
