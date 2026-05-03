import { useSiteTheme } from '@/contexts/SiteThemeContext';

const sectionStyle: React.CSSProperties = {
  padding: 12,
  borderBottom: '1px solid var(--theme-border)',
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--theme-font-display)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color: 'var(--theme-text-muted)',
  marginBottom: 6,
};

/**
 * SettingsApp — minimal port of Berry's settings panel. Shows the active era
 * (Berry only ships "classic" right now in noun.wtf — multi-era is Day 2),
 * the theme switch back to a different shell, and a stub "About" section.
 */
export default function SettingsApp() {
  const { theme, setTheme } = useSiteTheme();

  return (
    <div style={{ fontFamily: 'var(--theme-font-display)', color: 'var(--theme-text-primary)' }}>
      <div style={sectionStyle}>
        <div style={labelStyle}>Era</div>
        <div style={{ fontSize: 13 }}>
          <strong>Classic</strong>{' '}
          <span style={{ color: 'var(--theme-text-muted)', fontSize: 11 }}>
            (Aqua / Big Sur / Liquid Glass — coming soon)
          </span>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>Active Theme</div>
        <div style={{ fontSize: 13, marginBottom: 8 }}>{theme}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['classic', 'berry'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              style={{
                padding: '4px 10px',
                fontFamily: 'var(--theme-font-display)',
                fontSize: 12,
                background:
                  theme === t ? 'var(--theme-accent)' : 'var(--theme-bg-secondary)',
                color: theme === t ? '#fff' : 'var(--theme-text-primary)',
                border: '1px solid var(--theme-border-strong)',
                boxShadow:
                  'inset 1px 1px 0 var(--theme-bevel-light), inset -1px -1px 0 var(--theme-bevel-dark)',
                cursor: 'pointer',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>About</div>
        <div style={{ fontSize: 12, color: 'var(--theme-text-secondary)', lineHeight: 1.5 }}>
          Berry shell on noun.wtf — a deep port of the retro-Mac desktop UI from{' '}
          <a
            href="https://berryos.wtf"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--theme-text-link)' }}
          >
            berryos.wtf
          </a>
          . Click any dock icon to launch an app.
        </div>
      </div>
    </div>
  );
}
