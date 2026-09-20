import { useState, type CSSProperties } from 'react';

import {
  applySiteFont,
  getSiteFont,
  getSiteFontId,
  SITE_FONT_GROUPS,
  SITE_FONTS,
} from '@/lib/siteFonts';

interface FontSwitcherProps {
  /** Terminal-feed header styling, or the abacus navbar. Mirrors ThemeSwitcher. */
  variant?: 'terminal' | 'navbar';
}

/**
 * Site-wide font picker for the header.
 *
 * The visible control is a small "Aa" button; the real <select> sits on top
 * of it at opacity 0. Tapping opens the platform's native picker (which is
 * what we want on phones — ~80 options in optgroups), but the *visible*
 * footprint is ours, not the platform's. A bare native <select> in the
 * navbar rendered at Android's minimum size and got stretched by the
 * navbar's form-control rules, crushing the V1/V2 toggle off the header.
 */
export default function FontSwitcher({ variant = 'navbar' }: FontSwitcherProps) {
  const [fontId, setFontId] = useState<string>(() => getSiteFontId());
  const isTerminal = variant === 'terminal';
  const current = getSiteFont(fontId);

  const wrap: CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    overflow: 'hidden',
    ...(isTerminal ? {} : { marginLeft: 8 }),
  };

  const face: CSSProperties = isTerminal
    ? {
        background: 'transparent',
        border: '1px solid #222',
        color: '#00ff41',
        fontSize: '11px',
        padding: '4px 8px',
        borderRadius: '2px',
        lineHeight: 1,
        height: 24,
      }
    : {
        background: 'transparent',
        border: '1px solid var(--theme-border, #e2e3e8)',
        color: 'var(--theme-text-primary, #14161b)',
        fontSize: '12px',
        padding: '0 8px',
        borderRadius: 'var(--theme-radius-sm, 6px)',
        lineHeight: 1,
        height: 30,
      };

  return (
    <span style={wrap} className="font-switcher" title={`Font: ${current.label}`}>
      {/* Presentational only — the <select> below is the interactive element. */}
      <span
        aria-hidden="true"
        style={{
          ...face,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}
      >
        <span style={{ fontWeight: 700 }}>Aa</span>
        <span className="font-switcher-name">{current.label}</span>
      </span>
      <select
        value={fontId}
        onChange={e => setFontId(applySiteFont(e.target.value).id)}
        aria-label="Site font"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          margin: 0,
          padding: 0,
          border: 0,
          opacity: 0,
          cursor: 'pointer',
          // 16px stops iOS zooming the page when the picker gets focus.
          fontSize: 16,
        }}
      >
        {SITE_FONT_GROUPS.map(g => (
          <optgroup key={g.key} label={g.label}>
            {SITE_FONTS.filter(f => f.group === g.key).map(f => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </span>
  );
}
