import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type SiteMode = 'new' | 'classic';
export type ThemeName = 'pro' | 'terminal' | 'classic' | 'game' | 'berry' | 'catalogue' | 'abacus';

export const THEME_NAMES: ThemeName[] = [
  'pro',
  'terminal',
  'classic',
  'game',
  'berry',
  'catalogue',
  'abacus',
];

/**
 * Each theme decides what home layout it uses. Today only Terminal has a
 * non-auction home (the terminal feed). The others reuse the auction page
 * for `/`, but each can grow its own bespoke home layout later by changing
 * the value here — the rest of the app routes through `mode`.
 */
const THEME_TO_MODE: Record<ThemeName, SiteMode> = {
  pro: 'classic',
  terminal: 'new',
  classic: 'classic',
  game: 'classic',
  berry: 'classic',
  catalogue: 'classic',
  abacus: 'classic',
};

/**
 * Themes sunset but kept on disk in case we want to revive them. Stored values
 * matching this list are migrated to a sane default rather than crashing the
 * theme picker / shell-router.
 */
const SUNSET_THEME_FALLBACK: Record<string, ThemeName> = {
  camp: 'pro',
};

interface SiteThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  /** Derived from theme — kept for backwards compatibility with existing layout switches. */
  mode: SiteMode;
  /** Setting mode directly is supported but maps to a theme: 'new' → terminal, 'classic' → last non-terminal theme (or pro). */
  setMode: (mode: SiteMode) => void;
  isEmbedded: boolean;
}

const SiteThemeContext = createContext<SiteThemeContextValue>({
  theme: 'terminal',
  setTheme: () => {},
  mode: 'new',
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
 * `getInitialState` so a hard-load of `/game` boots straight into the game
 * theme — without this the page would briefly render the localStorage theme
 * before the route-level effect kicks in and switches.
 */
function readThemeFromPath(pathname: string): ThemeName | null {
  const segment = pathname.split('/').filter(Boolean)[0];
  if (!segment) return null;
  return isThemeName(segment) ? segment : null;
}

function getInitialState(): { theme: ThemeName; isEmbedded: boolean } {
  if (typeof window === 'undefined') {
    return { theme: 'terminal', isEmbedded: false };
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
    return { theme: 'pro', isEmbedded: false };
  }

  // Telegram / Farcaster contexts — terminal-feed home is the embedded surface.
  if ((window as any).Telegram?.WebApp || (window as any).farcaster) {
    return { theme: 'terminal', isEmbedded: true };
  }

  // localStorage — read the new key first, fall back to the legacy mode key.
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  // Migrate legacy 'hectic' label → 'pro' (renamed in-place; same theme).
  if (storedTheme === 'hectic') {
    return { theme: 'pro', isEmbedded: false };
  }
  // Sunset themes (e.g. 'camp') gracefully fall back to a default rather than
  // sticking the user on a theme that no longer renders.
  if (typeof storedTheme === 'string' && storedTheme in SUNSET_THEME_FALLBACK) {
    return { theme: SUNSET_THEME_FALLBACK[storedTheme], isEmbedded: false };
  }
  if (isThemeName(storedTheme)) {
    return { theme: storedTheme, isEmbedded: false };
  }
  const legacyMode = localStorage.getItem(LEGACY_MODE_STORAGE_KEY);
  if (legacyMode === 'classic') {
    return { theme: 'pro', isEmbedded: false };
  }
  if (legacyMode === 'new') {
    return { theme: 'terminal', isEmbedded: false };
  }

  return { theme: 'terminal', isEmbedded: false };
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
    // Switching to 'classic' from terminal — pick the last non-terminal theme
    // the user had, falling back to pro.
    if (theme === 'terminal') {
      const stored = typeof window !== 'undefined' ? localStorage.getItem(THEME_STORAGE_KEY) : null;
      if (isThemeName(stored) && stored !== 'terminal') {
        setTheme(stored);
        return;
      }
      setTheme('pro');
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

  return <SiteThemeContext.Provider value={value}>{children}</SiteThemeContext.Provider>;
}

export function useSiteTheme() {
  return useContext(SiteThemeContext);
}
