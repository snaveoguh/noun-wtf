import { useEffect, useRef, useState } from 'react';

import { useNavigate } from 'react-router';

import { THEME_NAMES, useSiteTheme, type ThemeName } from '@/contexts/SiteThemeContext';

interface ThemeMeta {
  id: ThemeName;
  label: string;
  emoji: string;
}

const THEMES: readonly ThemeMeta[] = [
  { id: 'terminal', label: 'Terminal', emoji: '🍆' },
  { id: 'pro', label: 'Pro', emoji: '🧮' },
  { id: 'classic', label: 'Classic', emoji: '🏛️' },
  { id: 'game', label: 'Game', emoji: '🕹️' },
  { id: 'berry', label: 'Berry', emoji: '🫐' },
  { id: 'catalogue', label: 'Catalogue', emoji: '🗂️' },
] as const;

// Sanity check at import — if THEME_NAMES grows without us adding a meta entry,
// surface it loudly during dev rather than silently rendering an incomplete dropdown.
const __metaIds = new Set(THEMES.map(t => t.id));
for (const id of THEME_NAMES) {
  if (!__metaIds.has(id)) {
    // eslint-disable-next-line no-console
    console.warn(`[ThemeSwitcher] no meta entry for theme "${id}"`);
  }
}

interface ThemeSwitcherProps {
  /** When true, defaults to the terminal-feed visual styling (used inside TerminalFeedShell). */
  variant?: 'terminal' | 'navbar';
  onChange?: (theme: ThemeName) => void;
}

export default function ThemeSwitcher({ variant = 'navbar', onChange }: ThemeSwitcherProps) {
  const { theme, setTheme } = useSiteTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + escape
  useEffect(() => {
    if (!open) return;
    const handlePointer = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const current = THEMES.find(t => t.id === theme) ?? THEMES[0];
  const isTerminalVariant = variant === 'terminal';

  const triggerStyle: React.CSSProperties = isTerminalVariant
    ? {
        background: 'transparent',
        border: '1px solid #222',
        color: '#00ff41',
        cursor: 'pointer',
        fontSize: '11px',
        padding: '4px 8px',
        borderRadius: '2px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        lineHeight: 1,
      }
    : {
        background: 'transparent',
        border: '1px solid var(--theme-border, #ccc)',
        color: 'var(--theme-text-primary, #14161b)',
        cursor: 'pointer',
        fontSize: '12px',
        padding: '4px 8px',
        borderRadius: 'var(--theme-radius-sm, 4px)',
        fontFamily: 'inherit',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        lineHeight: 1,
      };

  const menuStyle: React.CSSProperties = isTerminalVariant
    ? {
        position: 'absolute',
        top: 'calc(100% + 4px)',
        right: 0,
        background: '#000',
        border: '1px solid #222',
        borderRadius: '2px',
        zIndex: 10000,
        padding: '4px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      }
    : {
        position: 'absolute',
        top: 'calc(100% + 4px)',
        right: 0,
        background: 'var(--theme-bg-card, #fff)',
        border: '1px solid var(--theme-border, #ccc)',
        borderRadius: 'var(--theme-radius-md, 6px)',
        zIndex: 10000,
        padding: '4px',
        boxShadow: 'var(--theme-shadow, 0 4px 12px rgba(0, 0, 0, 0.15))',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      };

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={`Switch theme — currently ${current.label}`}
        aria-label={`Switch theme — currently ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        style={triggerStyle}
      >
        <span style={{ fontSize: '16px', lineHeight: 1 }}>{current.emoji}</span>
        <span style={{ opacity: 0.6, fontSize: '10px' }}>▾</span>
      </button>

      {open && (
        <div role="menu" style={menuStyle}>
          {THEMES.map(t => {
            const active = t.id === theme;
            return (
              <button
                key={t.id}
                role="menuitemradio"
                aria-checked={active}
                title={t.label}
                aria-label={t.label}
                onClick={() => {
                  setTheme(t.id);
                  onChange?.(t.id);
                  setOpen(false);
                  // Sync URL to the new theme so the address bar always
                  // reflects a shareable link. Preserve query string so
                  // miniapp/embed flags survive the switch.
                  if (typeof window !== 'undefined') {
                    const search = window.location.search ?? '';
                    navigate(`/${t.id}${search}`);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '32px',
                  height: '32px',
                  padding: 0,
                  background: active
                    ? isTerminalVariant
                      ? '#0a1a0a'
                      : 'var(--theme-bg-hover, #f4f4f8)'
                    : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  borderRadius: isTerminalVariant ? '2px' : 'var(--theme-radius-sm, 4px)',
                  outline: active ? '1px solid var(--theme-border, #aaa)' : 'none',
                }}
                onMouseEnter={e => {
                  if (active) return;
                  e.currentTarget.style.background = isTerminalVariant
                    ? '#050505'
                    : 'var(--theme-bg-hover, #f4f4f8)';
                }}
                onMouseLeave={e => {
                  if (active) return;
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{ fontSize: '18px', lineHeight: 1 }}>{t.emoji}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
