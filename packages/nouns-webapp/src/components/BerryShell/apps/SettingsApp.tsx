/**
 * SettingsApp — preferences pane for the Berry shell.
 *
 * HIG / Liquid Sand notes:
 *   - Sections render as <GlassPanel> blocks with 16pt internal padding,
 *     12pt vertical gap. Each section has a Silkscreen 11pt label header.
 *   - Rows are `label-left, control-right`, 44pt min height (HIG touch
 *     target). Controls are GlassTabs / GlassButton / GlassSwitch / etc.
 *   - The theme picker uses <GlassTabs> so the active theme reads as a
 *     selected segment, and the Wallpaper preview row links to the
 *     dedicated app rather than duplicating its grid here.
 *   - Body copy is 17pt SF (`--ls-text-lg`); captions 13pt
 *     (`--ls-text-sm`); section labels 11pt Silkscreen.
 */

import type { CSSProperties, ReactNode } from 'react';

import { useSiteTheme, type ThemeName } from '@/contexts/SiteThemeContext';
import { GlassButton, GlassPanel, GlassTabs } from '@/liquid-sand/glass';
import { Sparkle } from '@/liquid-sand/icons';

import { windowStore } from '../store/windowStore';
import { useCurrentWallpaper, useWallpaperList, wallpaperStore } from '../system/wallpaper';

// HIG 8pt grid: 16pt content padding, 11pt section label, 17pt body
const sectionLabelStyle: CSSProperties = {
  // Silkscreen 11pt per app brief — pushed-back chrome label.
  fontFamily: 'var(--ls-font-display)',
  fontSize: 11,
  lineHeight: 1.4,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  fontWeight: 400,
  color: 'var(--ls-fg-muted)',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  minHeight: 44, // HIG touch target
  padding: '6px 0',
};

const rowLabelStyle: CSSProperties = {
  fontFamily: 'var(--ls-font-sans)',
  fontSize: 'var(--ls-text-lg)', // 17pt body
  lineHeight: 1.3,
  color: 'var(--ls-fg-primary)',
  fontWeight: 500,
};

const rowHelpStyle: CSSProperties = {
  fontFamily: 'var(--ls-font-sans)',
  fontSize: 'var(--ls-text-sm)', // 13pt caption
  lineHeight: 1.4,
  color: 'var(--ls-fg-muted)',
  marginTop: 2,
};

interface SectionProps {
  label: string;
  children: ReactNode;
}

function Section({ label, children }: SectionProps) {
  return (
    <GlassPanel
      blur="subtle"
      tone="light"
      radius="md"
      bordered
      style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={sectionLabelStyle}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>{children}</div>
    </GlassPanel>
  );
}

interface RowProps {
  label: string;
  help?: string;
  control: ReactNode;
}

function Row({ label, help, control }: RowProps) {
  return (
    <div style={rowStyle}>
      <div className="min-w-0 flex-1">
        <div style={rowLabelStyle}>{label}</div>
        {help && <div style={rowHelpStyle}>{help}</div>}
      </div>
      <div className="flex-shrink-0">{control}</div>
    </div>
  );
}

const THEME_OPTIONS: ReadonlyArray<{ id: ThemeName; label: string }> = [
  { id: 'abacus', label: 'Dice' },
  { id: 'terminal', label: 'Terminal' },
];

export default function SettingsApp() {
  const { theme, setTheme } = useSiteTheme();
  const wallpapers = useWallpaperList();
  const currentWp = useCurrentWallpaper();

  const openWallpaperApp = () => {
    windowStore.open({
      appId: 'wallpaper',
      title: 'Desktop & Screensaver',
      icon: '🖼️',
      width: 560,
      height: 380,
    });
  };

  return (
    <div
      style={{
        fontFamily: 'var(--ls-font-sans)',
        color: 'var(--ls-fg-primary)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        overflowY: 'auto',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Era — informational only for now. */}
      <Section label="Era">
        <Row
          label="Classic"
          help="Aqua / Big Sur / Liquid Glass eras coming soon."
          control={
            <span
              aria-hidden
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontFamily: 'var(--ls-font-display)',
                fontSize: 11,
                letterSpacing: 0.6,
                color: 'var(--ls-accent)',
                textTransform: 'uppercase',
              }}
            >
              <Sparkle size={12} /> active
            </span>
          }
        />
      </Section>

      {/* Theme picker — the GlassTabs is wider than the row so it wraps to
          its own line on narrow windows. Each segment is HIG-sized via the
          tabs primitive (md = 36pt). */}
      <Section label="Active Theme">
        <Row
          label="Shell"
          help="Switch between BerryOS, Classic Mac, and the other shells."
          control={null}
        />
        <div style={{ paddingTop: 4 }}>
          <GlassTabs
            size="md"
            value={theme}
            onValueChange={v => setTheme(v as ThemeName)}
            aria-label="Shell theme"
            className="flex-wrap"
          >
            {THEME_OPTIONS.map(t => (
              <GlassTabs.Item key={t.id} value={t.id}>
                {t.label}
              </GlassTabs.Item>
            ))}
          </GlassTabs>
        </div>
      </Section>

      {/* Wallpaper — small swatch + button to open the dedicated picker. */}
      <Section label="Wallpaper">
        <Row
          label={currentWp.name}
          help={`${wallpapers.length} wallpaper${wallpapers.length === 1 ? '' : 's'} available`}
          control={
            <div className="flex items-center" style={{ gap: 10 }}>
              <span
                aria-hidden
                style={{
                  display: 'inline-block',
                  width: 36,
                  height: 36,
                  borderRadius: 'var(--ls-r-md)',
                  background: currentWp.thumb ?? currentWp.src,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  boxShadow:
                    'inset 0 1px 0 rgba(255,250,240,0.6), 0 0 0 1px var(--ls-border-glass)',
                }}
              />
              <GlassButton variant="default" size="sm" onClick={openWallpaperApp}>
                Change…
              </GlassButton>
            </div>
          }
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 6 }}>
          {wallpapers.map(w => {
            const active = w.id === currentWp.id;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => wallpaperStore.setWallpaper(w.id)}
                aria-label={`Set wallpaper to ${w.name}`}
                aria-pressed={active}
                style={{
                  width: 44,
                  height: 28,
                  padding: 0,
                  border: 'none',
                  background: w.thumb ?? w.src,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  borderRadius: 'var(--ls-r-md)',
                  cursor: 'pointer',
                  outline: active ? '2px solid var(--ls-accent)' : '2px solid transparent',
                  outlineOffset: 1,
                  boxShadow: active ? 'var(--ls-shadow-glow)' : '0 0 0 1px var(--ls-border-glass)',
                  transition:
                    'outline-color var(--ls-dur-base) var(--ls-ease-soft), box-shadow var(--ls-dur-base) var(--ls-ease-soft)',
                }}
              />
            );
          })}
        </div>
      </Section>

      {/* About — copy lives in a non-glass body so links pass contrast. */}
      <Section label="About">
        <div
          style={{
            fontFamily: 'var(--ls-font-sans)',
            fontSize: 'var(--ls-text-sm)',
            lineHeight: 1.5,
            color: 'var(--ls-fg-secondary)',
          }}
        >
          Berry shell on noun.wtf — a deep port of the retro-Mac desktop UI from{' '}
          <a
            href="https://berryos.wtf"
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--ls-accent)', fontWeight: 600 }}
          >
            berryos.wtf
          </a>
          . Click any dock icon to launch an app.
        </div>
      </Section>
    </div>
  );
}
