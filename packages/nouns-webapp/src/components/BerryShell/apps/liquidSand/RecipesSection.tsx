/**
 * Recipes — small worked examples that compose multiple primitives.
 *
 * Each recipe ships a live preview + a copy-able snippet so a dev can lift
 * the pattern wholesale.
 */

import {
  GlassButton,
  GlassChip,
  GlassPanel,
  GlassToast,
} from '@/liquid-sand/glass';
import { Coin, Diamond, Heart, Sparkle } from '@/liquid-sand/icons';

import { Card, CodeBlock, SectionHeader } from './shared';

/* ─── Recipe 1: Glass card ─────────────────────────────────────────────── */

function GlassCardRecipe() {
  return (
    <Card title="How to build a glass card" subtitle="Panel + chip + button">
      <div
        style={{
          padding: 16,
          backgroundImage:
            'linear-gradient(135deg, #d4b67a 0%, #b89352 100%)',
          borderRadius: 'var(--ls-r-md)',
        }}
      >
        <GlassPanel
          padded
          blur="medium"
          radius="lg"
          glow
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            maxWidth: 360,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Sparkle size={20} style={{ color: 'var(--ls-accent)' }} />
            <h3
              style={{
                margin: 0,
                fontFamily: 'var(--ls-font-display)',
                fontSize: 'var(--ls-text-lg)',
              }}
            >
              Noun #1234
            </h3>
            <GlassChip tone="success" size="sm" style={{ marginLeft: 'auto' }}>
              live
            </GlassChip>
          </div>
          <p
            style={{
              margin: 0,
              fontFamily: 'var(--ls-font-sans)',
              fontSize: 'var(--ls-text-sm)',
              color: 'var(--ls-fg-secondary)',
              lineHeight: 1.5,
            }}
          >
            One Noun, every day, forever. Highest bid currently 2.5 ETH.
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <GlassButton variant="primary" size="sm">
              Place bid
            </GlassButton>
            <GlassButton variant="ghost" size="sm">
              Details
            </GlassButton>
          </div>
        </GlassPanel>
      </div>
      <CodeBlock
        language="tsx"
        code={`<GlassPanel padded blur="medium" radius="lg" glow>
  <div className="flex items-center gap-2">
    <Sparkle size={20} style={{ color: 'var(--ls-accent)' }} />
    <h3>Noun #1234</h3>
    <GlassChip tone="success" size="sm">live</GlassChip>
  </div>
  <p>One Noun, every day, forever.</p>
  <div className="flex gap-1.5">
    <GlassButton variant="primary" size="sm">Place bid</GlassButton>
    <GlassButton variant="ghost" size="sm">Details</GlassButton>
  </div>
</GlassPanel>`}
      />
    </Card>
  );
}

/* ─── Recipe 2: Frosted dialog ─────────────────────────────────────────── */

function FrostedDialogRecipe() {
  return (
    <Card title="How to build a frosted dialog" subtitle="Modal scrim + heavy-blur body">
      <div
        style={{
          position: 'relative',
          padding: 16,
          backgroundImage:
            'linear-gradient(135deg, #5a4218 0%, #b89352 100%)',
          borderRadius: 'var(--ls-r-md)',
          minHeight: 220,
          overflow: 'hidden',
        }}
      >
        {/* Inline mock — render the body without the GlassModal wrapper so
            it sits inside the recipe instead of taking over the viewport. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(60, 45, 25, 0.32)',
            backdropFilter: 'blur(var(--ls-blur-subtle))',
            WebkitBackdropFilter: 'blur(var(--ls-blur-subtle))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              padding: 18,
              maxWidth: 360,
              width: '90%',
              backgroundColor: 'var(--ls-glass-light-strong)',
              backdropFilter:
                'blur(var(--ls-blur-extreme)) saturate(var(--ls-saturate))',
              WebkitBackdropFilter:
                'blur(var(--ls-blur-extreme)) saturate(var(--ls-saturate))',
              borderRadius: 'var(--ls-r-lg)',
              boxShadow:
                'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass), var(--ls-shadow-lg)',
              color: 'var(--ls-fg-primary)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <h3
              style={{
                margin: 0,
                fontFamily: 'var(--ls-font-display)',
                fontSize: 'var(--ls-text-lg)',
              }}
            >
              Confirm
            </h3>
            <p
              style={{
                margin: 0,
                fontFamily: 'var(--ls-font-sans)',
                fontSize: 'var(--ls-text-sm)',
                color: 'var(--ls-fg-secondary)',
                lineHeight: 1.5,
              }}
            >
              This will burn the noun. Burning is permanent.
            </p>
            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
                marginTop: 4,
              }}
            >
              <GlassButton variant="ghost" size="sm">
                Cancel
              </GlassButton>
              <GlassButton variant="danger" size="sm">
                Burn it
              </GlassButton>
            </div>
          </div>
        </div>
      </div>
      <CodeBlock
        language="tsx"
        code={`<GlassModal open={open} onScrimClick={() => setOpen(false)}>
  <h3>Confirm</h3>
  <p>This will burn the noun. Burning is permanent.</p>
  <div className="flex gap-2 justify-end">
    <GlassButton variant="ghost" onClick={() => setOpen(false)}>
      Cancel
    </GlassButton>
    <GlassButton variant="danger" onClick={burn}>
      Burn it
    </GlassButton>
  </div>
</GlassModal>`}
      />
    </Card>
  );
}

/* ─── Recipe 3: Color-coded stats ──────────────────────────────────────── */

function StatTile({
  label,
  value,
  delta,
  tone,
  Icon,
}: {
  label: string;
  value: string;
  delta: string;
  tone: 'success' | 'danger' | 'accent';
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}) {
  const TONE_COLOR = {
    success: 'var(--ls-success)',
    danger: 'var(--ls-danger)',
    accent: 'var(--ls-accent)',
  } as const;
  return (
    <div
      style={{
        flex: 1,
        minWidth: 140,
        padding: 12,
        backgroundColor: 'var(--ls-glass-light-strong)',
        backdropFilter: 'blur(var(--ls-blur-medium))',
        WebkitBackdropFilter: 'blur(var(--ls-blur-medium))',
        borderRadius: 'var(--ls-r-md)',
        boxShadow:
          'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: TONE_COLOR[tone],
        }}
      >
        <Icon size={14} />
        <span
          style={{
            fontFamily: 'var(--ls-font-sans)',
            fontSize: 'var(--ls-text-xs)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            fontWeight: 600,
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          fontFamily: 'var(--ls-font-display)',
          fontSize: 'var(--ls-text-2xl)',
          color: 'var(--ls-fg-primary)',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      <GlassChip tone={tone} size="xs" style={{ alignSelf: 'flex-start' }}>
        {delta}
      </GlassChip>
    </div>
  );
}

function ColorCodedStatsRecipe() {
  return (
    <Card title="How to color-code stats" subtitle="GlassChip + accent palette + monospace numbers">
      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          padding: 14,
          background: 'rgba(244, 234, 214, 0.4)',
          borderRadius: 'var(--ls-r-md)',
          boxShadow: '0 0 0 1px var(--ls-border-glass)',
        }}
      >
        <StatTile
          label="Treasury"
          value="$28.4M"
          delta="+1.2%"
          tone="success"
          Icon={Coin}
        />
        <StatTile
          label="Floor"
          value="2.5 Ξ"
          delta="-0.4%"
          tone="danger"
          Icon={Diamond}
        />
        <StatTile
          label="Voters"
          value="1,488"
          delta="active"
          tone="accent"
          Icon={Heart}
        />
      </div>
      <CodeBlock
        language="tsx"
        code={`<div className="flex gap-2.5">
  <StatTile label="Treasury" value="$28.4M" delta="+1.2%" tone="success" />
  <StatTile label="Floor"    value="2.5 Ξ"   delta="-0.4%" tone="danger"  />
  <StatTile label="Voters"   value="1,488"   delta="active" tone="accent" />
</div>

// each tile composes a Glass surface + a GlassChip in the matching tone:
<div style={{ background: 'var(--ls-glass-light-strong)' }}>
  <GlassChip tone={tone}>{delta}</GlassChip>
</div>`}
      />
    </Card>
  );
}

/* ─── Recipe 4: Stacked toast notifications ────────────────────────────── */

function ToastStackRecipe() {
  return (
    <Card title="How to stack toasts" subtitle="Vertical column, top-right anchor">
      <div
        style={{
          padding: 18,
          background: 'rgba(244, 234, 214, 0.4)',
          borderRadius: 'var(--ls-r-md)',
          boxShadow: '0 0 0 1px var(--ls-border-glass)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            alignItems: 'flex-end',
          }}
        >
          <GlassToast tone="success" title="Bid placed" body="2.5 ETH on #1234" />
          <GlassToast tone="accent" title="Block 21,492,008" body="Auction extended 5min" />
          <GlassToast tone="danger" title="Wallet rejected" body="User cancelled" />
        </div>
      </div>
      <CodeBlock
        language="tsx"
        code={`function ToastStack({ toasts }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 'var(--ls-z-toast)',
      }}
    >
      {toasts.map(t => (
        <GlassToast
          key={t.id}
          tone={t.tone}
          title={t.title}
          body={t.body}
          autoDismissMs={3000}
          onDismiss={() => dismiss(t.id)}
        />
      ))}
    </div>
  );
}`}
      />
    </Card>
  );
}

export function RecipesSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader
        title="Recipes"
        description="Worked examples that compose multiple primitives. Each recipe ships a live preview and a copy-able snippet — lift them whole."
      />
      <GlassCardRecipe />
      <FrostedDialogRecipe />
      <ColorCodedStatsRecipe />
      <ToastStackRecipe />
    </div>
  );
}
