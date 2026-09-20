import { useState, type CSSProperties } from 'react';

import { applySiteFont, getSiteFontId, SITE_FONT_GROUPS, SITE_FONTS } from '@/lib/siteFonts';

interface FontSwitcherProps {
  /** Terminal-feed header styling, or the abacus navbar. Mirrors ThemeSwitcher. */
  variant?: 'terminal' | 'navbar';
}

/**
 * Site-wide font picker for the header. A native <select> on purpose: it
 * works on phones, needs no outside-click plumbing, and the ~80 options
 * stay navigable via optgroups. Applies immediately via applySiteFont, which
 * also persists the choice for the pre-paint bootstrap in index.html.
 */
export default function FontSwitcher({ variant = 'navbar' }: FontSwitcherProps) {
  const [fontId, setFontId] = useState<string>(() => getSiteFontId());
  const isTerminal = variant === 'terminal';

  const style: CSSProperties = isTerminal
    ? {
        background: 'transparent',
        border: '1px solid #222',
        color: '#00ff41',
        cursor: 'pointer',
        fontSize: '11px',
        padding: '4px 6px',
        borderRadius: '2px',
        lineHeight: 1,
        maxWidth: 120,
      }
    : {
        background: 'transparent',
        border: '1px solid var(--theme-border, #e2e3e8)',
        color: 'var(--theme-text-primary, #14161b)',
        cursor: 'pointer',
        fontSize: '12px',
        padding: '4px 6px',
        borderRadius: 'var(--theme-radius-sm, 6px)',
        lineHeight: 1.2,
        maxWidth: 140,
        marginLeft: 8,
      };

  return (
    <select
      value={fontId}
      onChange={e => {
        const next = applySiteFont(e.target.value).id;
        setFontId(next);
      }}
      aria-label="Site font"
      title="Site font"
      style={style}
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
  );
}
