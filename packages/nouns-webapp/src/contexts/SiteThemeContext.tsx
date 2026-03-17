import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type SiteMode = 'new' | 'classic';

interface SiteThemeContextValue {
  mode: SiteMode;
  setMode: (mode: SiteMode) => void;
  isEmbedded: boolean;
}

const SiteThemeContext = createContext<SiteThemeContextValue>({
  mode: 'new',
  setMode: () => {},
  isEmbedded: false,
});

const STORAGE_KEY = 'noun-wtf-site-mode';

function getInitialMode(): { mode: SiteMode; isEmbedded: boolean } {
  // Check query params first (for miniapp embedding)
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get('mode');
    if (modeParam === 'terminal' || modeParam === 'new') {
      return { mode: 'new', isEmbedded: true };
    }
    if (modeParam === 'classic') {
      return { mode: 'classic', isEmbedded: false };
    }
  }

  // Check Telegram Mini App context
  if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
    return { mode: 'new', isEmbedded: true };
  }

  // Check Farcaster context
  if (typeof window !== 'undefined' && (window as any).farcaster) {
    return { mode: 'new', isEmbedded: true };
  }

  // Fall back to localStorage
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'classic' || stored === 'new') {
      return { mode: stored, isEmbedded: false };
    }
  }

  return { mode: 'new', isEmbedded: false };
}

export function SiteThemeProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(getInitialMode);
  const [mode, setModeState] = useState<SiteMode>(initial.mode);
  const [isEmbedded] = useState(initial.isEmbedded);

  const setMode = (newMode: SiteMode) => {
    setModeState(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);
  };

  // Persist initial mode
  useEffect(() => {
    if (!isEmbedded) {
      localStorage.setItem(STORAGE_KEY, mode);
    }
  }, []);

  return (
    <SiteThemeContext.Provider value={{ mode, setMode, isEmbedded }}>
      {children}
    </SiteThemeContext.Provider>
  );
}

export function useSiteTheme() {
  return useContext(SiteThemeContext);
}
