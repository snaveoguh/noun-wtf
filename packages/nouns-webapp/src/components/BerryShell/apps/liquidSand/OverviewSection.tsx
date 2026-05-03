/**
 * Overview — hero + design-philosophy paragraph + source-file pointers.
 *
 * Source pointers are plain text references (no internal navigation —
 * BerryOS shell is in the read-only theme set) so the user / dev can
 * paste them straight into their editor.
 */

import { GlassChip, GlassPanel } from '@/liquid-sand/glass';
import { Sparkle } from '@/liquid-sand/icons';

import { Card, CodeBlock } from './shared';

const SOURCE_FILES: ReadonlyArray<{ path: string; what: string }> = [
  {
    path: 'src/liquid-sand/glass/',
    what: '13 glass primitives (Panel, Button, Chip, Toolbar, Window, MenuBar, Dock, Toast, Modal, Tabs, Input, Switch, Slider)',
  },
  {
    path: 'src/liquid-sand/icons/',
    what: '50 monoline 24×24 SVG icons, all driven by currentColor',
  },
  {
    path: 'src/liquid-sand/inversion/',
    what: 'Background-aware color flipping — <BlendIcon>, <AdaptiveColor>, useBackgroundLuminance',
  },
  {
    path: 'src/liquid-sand/tokens.ts',
    what: 'Typed token exports — COLORS, BLUR, SHADOW, RADIUS, SPACING, FONT, TEXT, EASE, DURATION, Z',
  },
  {
    path: 'src/liquid-sand/tokens.css',
    what: 'CSS custom properties — auto-imported by src/index.css, available everywhere',
  },
] as const;

export function OverviewSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <GlassPanel
        blur="heavy"
        tone="light"
        radius="lg"
        bordered
        glow
        style={{
          padding: '28px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          // Sand wash so the hero reads as the brand surface, not just any
          // panel further down the doc.
          backgroundImage:
            'linear-gradient(135deg, rgba(212,182,122,0.18) 0%, rgba(232,212,171,0.10) 50%, rgba(184,147,82,0.14) 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Sparkle size={28} style={{ color: 'var(--ls-accent)' }} />
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--ls-font-display)',
              fontSize: 'var(--ls-text-3xl)',
              letterSpacing: 0.5,
              color: 'var(--ls-fg-primary)',
            }}
          >
            Liquid Sand UI
          </h1>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <GlassChip tone="accent">CC0</GlassChip>
          <GlassChip tone="success">v1</GlassChip>
          <GlassChip tone="neutral">steal everything</GlassChip>
          <GlassChip tone="neutral">no attribution required</GlassChip>
        </div>
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--ls-font-sans)',
            fontSize: 'var(--ls-text-md)',
            color: 'var(--ls-fg-secondary)',
            lineHeight: 1.55,
            maxWidth: 580,
          }}
        >
          A Y2K-modern, glass-frosted design system with a warm sepia tilt — the
          &ldquo;sand&rdquo; in Liquid Sand. Drop the primitives into anything
          that needs to feel like an OS surface without the iOS rip vibe.
        </p>
      </GlassPanel>

      {/* ── Philosophy ────────────────────────────────────────────────── */}
      <Card title="Design philosophy" subtitle="Five rules">
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            fontFamily: 'var(--ls-font-sans)',
            fontSize: 'var(--ls-text-sm)',
            color: 'var(--ls-fg-secondary)',
            lineHeight: 1.65,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <li>
            <strong style={{ color: 'var(--ls-fg-primary)' }}>Glass is mandatory.</strong>{' '}
            Every surface uses{' '}
            <code style={{ fontFamily: 'var(--ls-font-mono)' }}>backdrop-filter</code>{' '}
            with blur + saturate; no flat opaque cards.
          </li>
          <li>
            <strong style={{ color: 'var(--ls-fg-primary)' }}>Sepia, not cool gray.</strong>{' '}
            The sand palette is warm. It plays nicer with skin, photography,
            and emoji than slate or zinc.
          </li>
          <li>
            <strong style={{ color: 'var(--ls-fg-primary)' }}>Inset highlight always.</strong>{' '}
            The 1px top white-tint inset on every panel is what makes glass
            read as glass instead of a translucent rectangle.
          </li>
          <li>
            <strong style={{ color: 'var(--ls-fg-primary)' }}>currentColor everywhere.</strong>{' '}
            All 50 icons stroke <code style={{ fontFamily: 'var(--ls-font-mono)' }}>currentColor</code>{' '}
            so you can swap them with a single CSS{' '}
            <code style={{ fontFamily: 'var(--ls-font-mono)' }}>color</code> property.
          </li>
          <li>
            <strong style={{ color: 'var(--ls-fg-primary)' }}>Tokens before classes.</strong>{' '}
            CSS variables (<code style={{ fontFamily: 'var(--ls-font-mono)' }}>--ls-*</code>)
            are the source of truth; primitives just compose them.
          </li>
        </ul>
      </Card>

      {/* ── Source files ──────────────────────────────────────────────── */}
      <Card
        title="Where everything lives"
        subtitle="Plain text — paste into your editor"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SOURCE_FILES.map(file => (
            <div
              key={file.path}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                padding: '8px 10px',
                backgroundColor: 'rgba(255, 250, 240, 0.45)',
                borderRadius: 'var(--ls-r-sm)',
                boxShadow: '0 0 0 1px var(--ls-border-glass)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 'var(--ls-text-sm)',
                  color: 'var(--ls-fg-primary)',
                }}
              >
                {file.path}
              </div>
              <div
                style={{
                  fontFamily: 'var(--ls-font-sans)',
                  fontSize: 'var(--ls-text-xs)',
                  color: 'var(--ls-fg-muted)',
                  lineHeight: 1.45,
                }}
              >
                {file.what}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Quick start snippet ───────────────────────────────────────── */}
      <Card
        title="Quick start"
        subtitle="One import for the whole system"
      >
        <CodeBlock
          language="tsx"
          code={`import {
  GlassPanel,
  GlassButton,
  GlassChip,
  GlassTabs,
} from '@/liquid-sand/glass';
import { Folder, Settings, Sparkle } from '@/liquid-sand/icons';
import { COLORS, RADIUS, SHADOW } from '@/liquid-sand/tokens';

// Tokens drive themselves through CSS vars — no provider needed,
// just import 'src/liquid-sand/tokens.css' once at app boot.

export function MyCard() {
  return (
    <GlassPanel padded blur="medium" radius="lg">
      <Sparkle /> Hello sand.
    </GlassPanel>
  );
}`}
        />
      </Card>
    </div>
  );
}
