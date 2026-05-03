import { useSiteTheme } from '@/contexts/SiteThemeContext';

// HIG 8pt grid: 16pt content padding, 11pt caption, 17pt body
const sectionStyle: React.CSSProperties = {
  padding: 16,
  borderBottom: '1px solid var(--theme-border)',
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--ls-font-sans, var(--theme-font-display))',
  fontSize: 11,
  lineHeight: 1.4,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  fontWeight: 600,
  color: 'var(--theme-text-muted)',
  marginBottom: 8,
};

const bodyStyle: React.CSSProperties = {
  fontFamily: 'var(--ls-font-sans, var(--theme-font-display))',
  fontSize: 15,
  lineHeight: 1.4,
  color: 'var(--theme-text-primary)',
};

/**
 * SettingsApp — minimal port of Berry's settings panel. Shows the active era
 * (Berry only ships "classic" right now in noun.wtf — multi-era is Day 2),
 * the theme switch back to a different shell, and a stub "About" section.
 */
export default function SettingsApp() {
  const { theme, setTheme } = useSiteTheme();

  return (
    <div style={{ fontFamily: 'var(--ls-font-sans, var(--theme-font-display))', color: 'var(--theme-text-primary)' }}>
      <div style={sectionStyle}>
        <div style={labelStyle}>Era</div>
        <div style={bodyStyle}>
          <strong>Classic</strong>{' '}
          <span style={{ color: 'var(--theme-text-muted)', fontSize: 13 }}>
            (Aqua / Big Sur / Liquid Glass — coming soon)
          </span>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>Active Theme</div>
        <div style={{ ...bodyStyle, marginBottom: 12 }}>{theme}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(['classic', 'berry'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              aria-pressed={theme === t}
              style={{
                padding: '8px 16px',
                fontFamily: 'var(--ls-font-sans, var(--theme-font-display))',
                fontSize: 13,
                lineHeight: 1.3,
                fontWeight: theme === t ? 600 : 500,
                background:
                  theme === t ? 'var(--theme-accent)' : 'var(--theme-bg-secondary)',
                color: theme === t ? '#fff' : 'var(--theme-text-primary)',
                border: '1px solid var(--theme-border-strong)',
                borderRadius: 6,
                boxShadow:
                  'inset 1px 1px 0 var(--theme-bevel-light), inset -1px -1px 0 var(--theme-bevel-dark)',
                cursor: 'pointer',
                // HIG: 32pt min mouse target
                minHeight: 32,
                textTransform: 'capitalize',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>About</div>
        <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--theme-text-secondary)' }}>
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
