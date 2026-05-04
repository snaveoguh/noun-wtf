/**
 * Type scale — every --ls-text-* size with sample text rendered at that
 * size in each of the three font stacks.
 */

import { FONT, TEXT } from '@/liquid-sand/tokens';

import { Card, CodeBlock, SectionHeader } from './shared';

const SAMPLE = 'Liquid Sand';
const SUB_SAMPLE = 'The quick brown noun jumps over 1234.';

export function TypeScaleSection() {
  const sizes = Object.entries(TEXT);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader
        title="Type scale"
        description="Seven sizes from 11px caption to 36px hero. Each size demoed in every font stack so you can see how the display, sans, and mono families pair."
      />

      <Card title="At a glance" subtitle="Display font (Silkscreen)">
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '12px 14px',
            background: 'rgba(255, 250, 240, 0.5)',
            borderRadius: 'var(--ls-r-md)',
            boxShadow:
              'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass)',
          }}
        >
          {sizes.map(([key, value]) => (
            <div
              key={`row-${key}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '60px 60px 1fr',
                alignItems: 'baseline',
                gap: 12,
                padding: '4px 0',
                borderTop: key === 'xs' ? 'none' : '1px solid var(--ls-border-glass)',
              }}
            >
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
              <div
                style={{
                  fontFamily: 'var(--ls-font-display)',
                  fontSize: value,
                  color: 'var(--ls-fg-primary)',
                  lineHeight: 1.1,
                }}
              >
                {SAMPLE}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {(['display', 'sans', 'mono'] as const).map(family => (
        <Card
          key={family}
          title={`Family: ${family}`}
          subtitle={FONT[family]}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '12px 14px',
              background: 'rgba(255, 250, 240, 0.45)',
              borderRadius: 'var(--ls-r-md)',
              boxShadow: '0 0 0 1px var(--ls-border-glass)',
            }}
          >
            {sizes.map(([key, value]) => (
              <div
                key={`${family}-${key}`}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 12,
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--ls-font-mono)',
                    fontSize: 10,
                    color: 'var(--ls-fg-muted)',
                    minWidth: 80,
                  }}
                >
                  text.{key} / {value}
                </div>
                <div
                  style={{
                    fontFamily: FONT[family],
                    fontSize: value,
                    color: 'var(--ls-fg-primary)',
                    lineHeight: 1.2,
                  }}
                >
                  {SUB_SAMPLE}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      <Card title="How to use" subtitle="Inline style or class">
        <CodeBlock
          language="tsx"
          code={`// Inline (TS exports map 1:1 to the CSS vars)
<h1 style={{ fontSize: 'var(--ls-text-3xl)' }}>Hero</h1>

// Or read the typed export
import { TEXT, FONT } from '@/liquid-sand/tokens';

<h1 style={{
  fontSize: TEXT['3xl'],
  fontFamily: FONT.display,
}}>Hero</h1>`}
        />
      </Card>
    </div>
  );
}
