/**
 * Tokens — visual swatches of every CSS token in the system.
 *
 * Pulls values from the typed exports in `tokens.ts` so this never falls
 * out of sync with the CSS file.
 */

import {
  ACCENT,
  BLUR,
  DURATION,
  EASE,
  FG,
  FONT,
  GLASS,
  RADIUS,
  SAND,
  SHADOW,
  SPACING,
  TEXT,
  Z,
} from '@/liquid-sand/tokens';

import { Card, SectionHeader } from './shared';

/* ─── Generic swatch grid ──────────────────────────────────────────────── */

function Swatch({
  name,
  value,
  bg,
  fg,
  hint,
  height = 56,
}: {
  name: string;
  value: string;
  bg: string;
  fg?: string;
  hint?: string;
  height?: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        style={{
          height,
          background: bg,
          borderRadius: 'var(--ls-r-sm)',
          boxShadow:
            'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass)',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'flex-end',
          padding: 4,
          color: fg ?? 'var(--ls-fg-primary)',
          fontFamily: 'var(--ls-font-mono)',
          fontSize: 9,
        }}
      >
        {hint && <span style={{ opacity: 0.85 }}>{hint}</span>}
      </div>
      <div
        style={{
          fontFamily: 'var(--ls-font-mono)',
          fontSize: 'var(--ls-text-xs)',
          color: 'var(--ls-fg-primary)',
          lineHeight: 1.2,
        }}
      >
        {name}
      </div>
      <div
        style={{
          fontFamily: 'var(--ls-font-mono)',
          fontSize: 10,
          color: 'var(--ls-fg-muted)',
          lineHeight: 1.2,
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function Grid({
  cols,
  children,
}: {
  cols: number;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

/* ─── The section ──────────────────────────────────────────────────────── */

export function TokensSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader
        title="Tokens"
        description="Every value the system knows about. The CSS variables (--ls-*) are the source of truth — these typed exports just mirror them for JS code that needs to read a token."
      />

      {/* Sand ladder */}
      <Card title="Sand palette" subtitle="10-step warm sepia ladder">
        <Grid cols={5}>
          {Object.entries(SAND).map(([step, hex]) => (
            <Swatch
              key={step}
              name={`sand-${step}`}
              value={hex}
              bg={hex}
              hint={hex}
              fg={Number(step) >= 500 ? '#fbf6ee' : '#1a1208'}
            />
          ))}
        </Grid>
      </Card>

      {/* Glass tints */}
      <Card title="Glass tints" subtitle="Translucent surfaces designed for backdrop-blur">
        <Grid cols={3}>
          {Object.entries(GLASS).map(([key, value]) => (
            <Swatch
              key={key}
              name={`glass.${key}`}
              value={value}
              // Layer over a sand swatch so the translucency is visible.
              bg={`${SAND[300]}; background-image: linear-gradient(135deg, ${SAND[300]} 0%, ${SAND[500]} 100%)`}
              hint=""
              height={56}
            />
          ))}
        </Grid>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 12,
            marginTop: -8,
          }}
        >
          {Object.entries(GLASS).map(([key, value]) => (
            <div
              key={`glass-overlay-${key}`}
              style={{
                position: 'relative',
                height: 56,
                borderRadius: 'var(--ls-r-sm)',
                overflow: 'hidden',
                boxShadow:
                  'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass)',
                backgroundImage: `linear-gradient(135deg, ${SAND[300]} 0%, ${SAND[500]} 100%)`,
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 8,
                  background: value,
                  backdropFilter: 'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
                  WebkitBackdropFilter:
                    'blur(var(--ls-blur-medium)) saturate(var(--ls-saturate))',
                  borderRadius: 6,
                  boxShadow:
                    'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 10,
                  color: '#1a1208',
                }}
              >
                {key}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Foreground & accents */}
      <Card title="Foreground + accents">
        <Grid cols={4}>
          {Object.entries(FG).map(([key, hex]) => (
            <Swatch
              key={key}
              name={`fg.${key}`}
              value={hex}
              bg={hex}
              hint={hex}
              fg={key === 'onDark' ? '#1a1208' : '#fbf6ee'}
            />
          ))}
          {Object.entries(ACCENT).map(([key, hex]) => (
            <Swatch
              key={key}
              name={`accent.${key}`}
              value={hex}
              bg={hex}
              hint={hex}
              fg="#fbf6ee"
            />
          ))}
        </Grid>
      </Card>

      {/* Blur tiers */}
      <Card title="Backdrop blur tiers">
        <Grid cols={4}>
          {Object.entries(BLUR).map(([key, value]) => (
            <div
              key={key}
              style={{
                position: 'relative',
                height: 80,
                borderRadius: 'var(--ls-r-sm)',
                overflow: 'hidden',
                backgroundImage: `linear-gradient(135deg, ${SAND[200]} 0%, ${SAND[600]} 100%)`,
                boxShadow: '0 0 0 1px var(--ls-border-glass)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  inset: 10,
                  background: 'rgba(255, 250, 240, 0.45)',
                  backdropFilter: `blur(${value}) saturate(180%)`,
                  WebkitBackdropFilter: `blur(${value}) saturate(180%)`,
                  borderRadius: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 11,
                  color: '#1a1208',
                  gap: 2,
                  boxShadow:
                    'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass)',
                }}
              >
                <div>{key}</div>
                <div style={{ fontSize: 9, color: 'var(--ls-fg-muted)' }}>
                  {value}
                </div>
              </div>
            </div>
          ))}
        </Grid>
      </Card>

      {/* Shadow recipes */}
      <Card title="Shadow recipes">
        <Grid cols={3}>
          {Object.entries(SHADOW).map(([key, recipe]) => (
            <div
              key={key}
              style={{
                height: 80,
                borderRadius: 'var(--ls-r-md)',
                background: 'var(--ls-glass-light-strong)',
                backdropFilter: 'blur(var(--ls-blur-medium))',
                WebkitBackdropFilter: 'blur(var(--ls-blur-medium))',
                boxShadow: recipe,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--ls-font-mono)',
                fontSize: 11,
                color: '#1a1208',
                gap: 2,
              }}
            >
              <div>shadow.{key}</div>
              <div
                style={{
                  fontSize: 9,
                  color: 'var(--ls-fg-muted)',
                  maxWidth: '90%',
                  textAlign: 'center',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {recipe.split(',')[0]}…
              </div>
            </div>
          ))}
        </Grid>
      </Card>

      {/* Radius */}
      <Card title="Border radius">
        <Grid cols={5}>
          {Object.entries(RADIUS).map(([key, value]) => (
            <div
              key={key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                alignItems: 'center',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: 56,
                  background: 'var(--ls-glass-light-strong)',
                  backdropFilter: 'blur(var(--ls-blur-subtle))',
                  WebkitBackdropFilter: 'blur(var(--ls-blur-subtle))',
                  borderRadius: value,
                  boxShadow:
                    'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass)',
                }}
              />
              <div
                style={{
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 'var(--ls-text-xs)',
                  color: 'var(--ls-fg-primary)',
                }}
              >
                r.{key}
              </div>
              <div
                style={{
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 10,
                  color: 'var(--ls-fg-muted)',
                }}
              >
                {value}
              </div>
            </div>
          ))}
        </Grid>
      </Card>

      {/* Spacing */}
      <Card title="Spacing scale" subtitle="4px base">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            background: 'rgba(255,250,240,0.45)',
            padding: '8px 10px',
            borderRadius: 'var(--ls-r-sm)',
            boxShadow: '0 0 0 1px var(--ls-border-glass)',
          }}
        >
          {Object.entries(SPACING).map(([step, value]) => (
            <div
              key={step}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 60,
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 'var(--ls-text-xs)',
                  color: 'var(--ls-fg-primary)',
                }}
              >
                s.{step}
              </div>
              <div
                style={{
                  height: 12,
                  width: value,
                  background: 'var(--ls-accent)',
                  borderRadius: 2,
                  boxShadow: 'var(--ls-shadow-sm)',
                }}
              />
              <div
                style={{
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 10,
                  color: 'var(--ls-fg-muted)',
                }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Type scale (preview only — full scale lives in TypeSection) */}
      <Card title="Type sizes" subtitle="See the Type scale tab for live samples">
        <Grid cols={4}>
          {Object.entries(TEXT).map(([key, value]) => (
            <div
              key={key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '6px 8px',
                background: 'rgba(255,250,240,0.5)',
                borderRadius: 'var(--ls-r-sm)',
                boxShadow: '0 0 0 1px var(--ls-border-glass)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--ls-font-display)',
                  fontSize: value,
                  color: 'var(--ls-fg-primary)',
                  lineHeight: 1,
                }}
              >
                Aa
              </div>
              <div
                style={{
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 'var(--ls-text-xs)',
                  color: 'var(--ls-fg-secondary)',
                }}
              >
                text.{key}
              </div>
              <div
                style={{
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 10,
                  color: 'var(--ls-fg-muted)',
                }}
              >
                {value}
              </div>
            </div>
          ))}
        </Grid>
      </Card>

      {/* Easings */}
      <Card title="Easing + duration">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 12,
          }}
        >
          {Object.entries(EASE).map(([key, curve]) => (
            <div
              key={key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '8px 10px',
                background: 'rgba(255,250,240,0.45)',
                borderRadius: 'var(--ls-r-sm)',
                boxShadow: '0 0 0 1px var(--ls-border-glass)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 'var(--ls-text-xs)',
                  color: 'var(--ls-fg-primary)',
                }}
              >
                ease.{key}
              </div>
              <div
                style={{
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 10,
                  color: 'var(--ls-fg-muted)',
                  wordBreak: 'break-all',
                }}
              >
                {curve}
              </div>
            </div>
          ))}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 12,
          }}
        >
          {Object.entries(DURATION).map(([key, ms]) => (
            <div
              key={key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '8px 10px',
                background: 'rgba(255,250,240,0.45)',
                borderRadius: 'var(--ls-r-sm)',
                boxShadow: '0 0 0 1px var(--ls-border-glass)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 'var(--ls-text-xs)',
                  color: 'var(--ls-fg-primary)',
                }}
              >
                dur.{key}
              </div>
              <div
                style={{
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 10,
                  color: 'var(--ls-fg-muted)',
                }}
              >
                {ms}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Fonts */}
      <Card title="Font stacks">
        {Object.entries(FONT).map(([key, stack]) => (
          <div
            key={key}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '8px 10px',
              background: 'rgba(255,250,240,0.45)',
              borderRadius: 'var(--ls-r-sm)',
              boxShadow: '0 0 0 1px var(--ls-border-glass)',
            }}
          >
            <div
              style={{
                fontFamily: stack,
                fontSize: 'var(--ls-text-lg)',
                color: 'var(--ls-fg-primary)',
                lineHeight: 1.1,
              }}
            >
              The quick brown noun jumps over 0123 — font.{key}
            </div>
            <div
              style={{
                fontFamily: 'var(--ls-font-mono)',
                fontSize: 10,
                color: 'var(--ls-fg-muted)',
              }}
            >
              {stack}
            </div>
          </div>
        ))}
      </Card>

      {/* Z-index */}
      <Card title="Z-index layers">
        <Grid cols={4}>
          {Object.entries(Z).map(([key, value]) => (
            <div
              key={key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                padding: '8px 10px',
                background: 'rgba(255,250,240,0.45)',
                borderRadius: 'var(--ls-r-sm)',
                boxShadow: '0 0 0 1px var(--ls-border-glass)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 'var(--ls-text-xs)',
                  color: 'var(--ls-fg-primary)',
                }}
              >
                z.{key}
              </div>
              <div
                style={{
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 10,
                  color: 'var(--ls-fg-muted)',
                }}
              >
                {value}
              </div>
            </div>
          ))}
        </Grid>
      </Card>
    </div>
  );
}
