/**
 * Inversion — live demo of <BlendIcon> + <AdaptiveColor> over a draggable
 * background. The slider lerps the bg color from light → dark and the icons
 * react in real time.
 *
 * Two demo lanes:
 *   1. <BlendIcon mode="difference"> — pure CSS, no JS, no sampling. The
 *      icon's color is "inverted" against the bg via mix-blend-mode.
 *   2. <AdaptiveColor> — JS samples the bg luminance, sets a data attribute,
 *      and the consumer's CSS swaps colors based on the bucket.
 */

import * as React from 'react';

import { GlassChip, GlassSlider } from '@/liquid-sand/glass';
import { Folder, Settings, Sparkle, Star } from '@/liquid-sand/icons';
import { AdaptiveColor, BlendIcon } from '@/liquid-sand/inversion';

import { Card, CodeBlock, SectionHeader } from './shared';

/** Linear-interpolate hex colors (clamped). */
function lerpHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 0xff;
  const ag = (pa >> 8) & 0xff;
  const ab = pa & 0xff;
  const br = (pb >> 16) & 0xff;
  const bg = (pb >> 8) & 0xff;
  const bb = pb & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${[r, g, bl]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function InversionSection() {
  const [t, setT] = React.useState(20);
  // Lerp from a soft sand top to a deep cocoa — the full luminance range.
  const bg = lerpHex('#f4ead6', '#241906', t / 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader
        title="Inversion"
        description="Two ways to keep icons readable over any background. Pull the slider to slide the bg from cream to cocoa and watch the icons flip."
      />

      <Card>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--ls-font-mono)',
              fontSize: 'var(--ls-text-xs)',
              color: 'var(--ls-fg-secondary)',
              minWidth: 60,
            }}
          >
            bg drag
          </div>
          <div style={{ flex: 1 }}>
            <GlassSlider value={t} onValueChange={setT} />
          </div>
          <div
            style={{
              fontFamily: 'var(--ls-font-mono)',
              fontSize: 'var(--ls-text-xs)',
              color: 'var(--ls-fg-primary)',
              minWidth: 80,
              textAlign: 'right',
            }}
          >
            {bg}
          </div>
        </div>

        {/* The shared swatch ──────────────────────────────────────────── */}
        <div
          style={{
            position: 'relative',
            // isolate creates a stacking context so mix-blend-mode only
            // composites against the swatch's own background, not the
            // entire window.
            isolation: 'isolate',
            background: bg,
            padding: 24,
            borderRadius: 'var(--ls-r-md)',
            boxShadow:
              'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass)',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            transition: 'background var(--ls-dur-fast) var(--ls-ease-soft)',
          }}
        >
          {/* Lane 1: BlendIcon */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <GlassChip tone="accent">{'<BlendIcon>'}</GlassChip>
              <span
                style={{
                  fontFamily: 'var(--ls-font-sans)',
                  fontSize: 'var(--ls-text-xs)',
                  color: 'rgba(0,0,0,0.65)',
                  mixBlendMode: 'difference',
                }}
              >
                CSS-only — mix-blend-mode: difference
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 18,
                alignItems: 'center',
                color: '#ffffff',
              }}
            >
              <BlendIcon mode="difference">
                <Folder size={32} />
              </BlendIcon>
              <BlendIcon mode="difference">
                <Settings size={32} />
              </BlendIcon>
              <BlendIcon mode="difference">
                <Sparkle size={32} />
              </BlendIcon>
              <BlendIcon mode="difference">
                <Star size={32} />
              </BlendIcon>
              <BlendIcon mode="luminosity">
                <Folder size={32} />
              </BlendIcon>
              <span
                style={{
                  fontFamily: 'var(--ls-font-mono)',
                  fontSize: 11,
                  color: '#ffffff',
                  mixBlendMode: 'difference',
                }}
              >
                last one is mode=&quot;luminosity&quot;
              </span>
            </div>
          </div>

          {/* Lane 2: AdaptiveColor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <GlassChip tone="success">{'<AdaptiveColor>'}</GlassChip>
              <span
                style={{
                  fontFamily: 'var(--ls-font-sans)',
                  fontSize: 'var(--ls-text-xs)',
                  color: 'rgba(0,0,0,0.65)',
                  mixBlendMode: 'difference',
                }}
              >
                JS samples bg luminance → swaps via classByBucket
              </span>
            </div>
            <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
              <AdaptiveColor
                as="span"
                classByBucket={{
                  light: 'ls-adaptive-light',
                  dark: 'ls-adaptive-dark',
                  mid: 'ls-adaptive-mid',
                }}
              >
                <Folder size={32} />
              </AdaptiveColor>
              <AdaptiveColor
                as="span"
                classByBucket={{
                  light: 'ls-adaptive-light',
                  dark: 'ls-adaptive-dark',
                  mid: 'ls-adaptive-mid',
                }}
              >
                <Settings size={32} />
              </AdaptiveColor>
              <AdaptiveColor
                as="span"
                classByBucket={{
                  light: 'ls-adaptive-light',
                  dark: 'ls-adaptive-dark',
                  mid: 'ls-adaptive-mid',
                }}
              >
                <Sparkle size={32} />
              </AdaptiveColor>
              <AdaptiveColor
                as="span"
                classByBucket={{
                  light: 'ls-adaptive-light',
                  dark: 'ls-adaptive-dark',
                  mid: 'ls-adaptive-mid',
                }}
              >
                <Star size={32} />
              </AdaptiveColor>
              <SampleProbe />
            </div>
          </div>
        </div>

        {/* Tiny inline stylesheet for the AdaptiveColor classes — keeps
            the demo self-contained without registering global CSS. */}
        <style>{`
          .ls-adaptive-light { color: #1a1208; }
          .ls-adaptive-dark  { color: #fbf6ee; }
          .ls-adaptive-mid   { color: #b89352; }
        `}</style>
      </Card>

      <Card title="Snippet — BlendIcon" subtitle="Pure CSS, no JS cost">
        <CodeBlock
          language="tsx"
          code={`import { BlendIcon } from '@/liquid-sand/inversion';
import { Folder } from '@/liquid-sand/icons';

// 'difference' flips against any bg
<BlendIcon mode="difference">
  <Folder size={24} />
</BlendIcon>`}
        />
      </Card>

      <Card title="Snippet — AdaptiveColor" subtitle="JS sampling, more accurate over images">
        <CodeBlock
          language="tsx"
          code={`import { AdaptiveColor } from '@/liquid-sand/inversion';

<AdaptiveColor
  classByBucket={{
    light: 'text-sand-900',
    dark:  'text-sand-50',
    mid:   'text-sand-500',
  }}
>
  <Folder size={24} />
</AdaptiveColor>

// or read the value yourself:
const ref = useRef<HTMLElement | null>(null);
const { bucket, value } = useBackgroundLuminance(ref);`}
        />
      </Card>
    </div>
  );
}

/* ─── Live luminance probe ─────────────────────────────────────────────── */

function SampleProbe() {
  // The probe uses an empty span as its sampling point inside the same
  // backdrop as the AdaptiveColor icons, then displays the bucket + value.
  // Avoids re-implementing the hook by piggy-backing on AdaptiveColor's
  // onSample callback.
  //
  // AdaptiveColor fires onSample synchronously *during* render — calling
  // setState directly from there triggers React's "setState in render"
  // warning. We defer with a microtask so the state update lands on the
  // next render pass.
  const [info, setInfo] = React.useState<{ bucket: string; value: number }>({
    bucket: 'mid',
    value: 0.5,
  });
  const handleSample = React.useCallback(
    (bucket: string, value: number) => {
      queueMicrotask(() => {
        setInfo(prev =>
          prev.bucket === bucket && prev.value === value
            ? prev
            : { bucket, value },
        );
      });
    },
    [],
  );
  return (
    <AdaptiveColor as="span" onSample={handleSample}>
      <span
        style={{
          fontFamily: 'var(--ls-font-mono)',
          fontSize: 11,
          color: '#ffffff',
          mixBlendMode: 'difference',
          marginLeft: 8,
        }}
      >
        bucket={info.bucket} L={info.value.toFixed(2)}
      </span>
    </AdaptiveColor>
  );
}
