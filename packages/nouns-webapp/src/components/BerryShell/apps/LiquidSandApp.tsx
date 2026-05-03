/**
 * LiquidSandApp — built-in style-guide / component browser.
 *
 * Tabbed layout (GlassTabs) with seven sections, each in its own file
 * under `apps/liquidSand/`:
 *   - Overview       hero + philosophy + source-file pointers
 *   - Tokens         visual swatches of every CSS token
 *   - Components     every Glass primitive demoed with code snippets
 *   - Icons          grid of all 50 icons + click-to-copy import
 *   - Inversion      live <BlendIcon> + <AdaptiveColor> demo
 *   - Type           full type scale across all 3 font stacks
 *   - Recipes        worked composition examples
 *
 * Self-registers via `berryRegistry.register(...)` at module load. The
 * registry stores `icon` as a string, so we pass a sparkle emoji that
 * matches the spirit of the Sparkle monoline icon used in the app's hero.
 *
 * The app eats its own dog food — every chrome surface is a Liquid Sand
 * primitive, even the toast stack used for "Copied!" feedback.
 */

import { useState, type ReactElement } from 'react';

import {
  GlassDock,
  GlassPanel,
  GlassTabs,
  GlassToast,
} from '@/liquid-sand/glass';
import { Sparkle } from '@/liquid-sand/icons';

import { berryRegistry } from '../system/berryRegistry';

import { ComponentsSection } from './liquidSand/ComponentsSection';
import { IconsSection } from './liquidSand/IconsSection';
import { InversionSection } from './liquidSand/InversionSection';
import { OverviewSection } from './liquidSand/OverviewSection';
import { RecipesSection } from './liquidSand/RecipesSection';
import { TokensSection } from './liquidSand/TokensSection';
import { TypeScaleSection } from './liquidSand/TypeScaleSection';
import { useLiquidSandToasts } from './liquidSand/shared';

type SectionId =
  | 'overview'
  | 'tokens'
  | 'components'
  | 'icons'
  | 'inversion'
  | 'type'
  | 'recipes';

const TABS: ReadonlyArray<{ id: SectionId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'components', label: 'Components' },
  { id: 'icons', label: 'Icons' },
  { id: 'inversion', label: 'Inversion' },
  { id: 'type', label: 'Type' },
  { id: 'recipes', label: 'Recipes' },
] as const;

function LiquidSandApp(): ReactElement {
  const [tab, setTab] = useState<SectionId>('overview');
  const { toast, clear } = useLiquidSandToasts();

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        // Sand wallpaper — gives the showcase its own base surface so the
        // BerryOS desktop's Aqua gradient doesn't bleed through.
        backgroundImage:
          'radial-gradient(circle at 20% 0%, rgba(255, 250, 240, 0.85) 0%, rgba(244, 234, 214, 0.55) 40%, rgba(212, 182, 122, 0.45) 100%)',
        backgroundColor: 'var(--ls-sand-100)',
        color: 'var(--ls-fg-primary)',
        fontFamily: 'var(--ls-font-sans)',
        overflow: 'hidden',
      }}
    >
      {/* ── Sticky tab strip ───────────────────────────────────────── */}
      <GlassPanel
        blur="medium"
        tone="light"
        radius="sm"
        bordered={false}
        style={{
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          borderRadius: 0,
          borderBottom: '1px solid var(--ls-border-glass)',
        }}
      >
        <Sparkle size={16} style={{ color: 'var(--ls-accent)' }} />
        <span
          style={{
            fontFamily: 'var(--ls-font-display)',
            fontSize: 'var(--ls-text-sm)',
            color: 'var(--ls-fg-primary)',
            letterSpacing: 0.4,
            marginRight: 6,
          }}
        >
          Liquid Sand
        </span>
        <div style={{ overflowX: 'auto', flex: 1 }}>
          <GlassTabs
            value={tab}
            onValueChange={v => setTab(v as SectionId)}
            size="sm"
          >
            {TABS.map(t => (
              <GlassTabs.Item key={t.id} value={t.id}>
                {t.label}
              </GlassTabs.Item>
            ))}
          </GlassTabs>
        </div>
      </GlassPanel>

      {/* ── Section body ───────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: 16,
        }}
      >
        {tab === 'overview' && <OverviewSection />}
        {tab === 'tokens' && <TokensSection />}
        {tab === 'components' && <ComponentsSection />}
        {tab === 'icons' && <IconsSection />}
        {tab === 'inversion' && <InversionSection />}
        {tab === 'type' && <TypeScaleSection />}
        {tab === 'recipes' && <RecipesSection />}
      </div>

      {/* ── Floating toast for copy feedback ───────────────────────── */}
      {toast && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            zIndex: 50,
            // Pointer events so the user can click-dismiss; but the parent
            // window keeps focus.
            pointerEvents: 'auto',
          }}
        >
          <GlassToast tone="success" title={toast} onDismiss={clear} />
        </div>
      )}

      {/* ── Footer dock teaser — eats its own dog food ─────────────── */}
      <GlassDock
        position="absolute"
        bottom={4}
        reflection={false}
        // Smaller than the real OS dock; this is a vibe element, not nav.
        style={{ transform: 'translateX(-50%) scale(0.75)', opacity: 0.55 }}
      >
        <Sparkle size={20} style={{ color: 'var(--ls-fg-primary)' }} />
      </GlassDock>
    </div>
  );
}

/* ─── Self-registration ────────────────────────────────────────────────── */

berryRegistry.register({
  id: 'liquid-sand',
  name: 'Liquid Sand',
  // BerryAppDescriptor.icon is a string. The brief asked for the Sparkle
  // monoline icon; the closest emoji match is the four-point sparkle that
  // appears in the hero too.
  icon: '✨',
  component: LiquidSandApp,
  defaultWindow: { w: 900, h: 640 },
  capabilities: ['ui:design-system', 'ui:reference'],
});

export default LiquidSandApp;
