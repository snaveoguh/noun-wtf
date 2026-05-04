/**
 * Components — every glass primitive shown with all variants + sizes,
 * plus a copy-able snippet underneath each demo.
 *
 * Modal/Window are tricky to show inline — for those we render a static
 * preview frame that mimics the visual without full overlay machinery.
 */

import * as React from 'react';

import {
  GlassButton,
  GlassChip,
  GlassDock,
  GlassInput,
  GlassMenuBar,
  GlassModal,
  GlassPanel,
  GlassSlider,
  GlassSwitch,
  GlassTabs,
  GlassToast,
  GlassToolbar,
  GlassWindow,
} from '@/liquid-sand/glass';
import { Folder, MagnifyingGlass, Settings, Sparkle } from '@/liquid-sand/icons';

import { Card, CodeBlock, DemoRow, SectionHeader } from './shared';

/* ─── Per-component demos ──────────────────────────────────────────────── */

function PanelDemo() {
  return (
    <Card title="GlassPanel" subtitle="The base frosted-glass surface">
      <DemoRow label="blur">
        {(['subtle', 'medium', 'heavy', 'extreme'] as const).map(b => (
          <GlassPanel
            key={b}
            blur={b}
            padded
            radius="md"
            style={{ minWidth: 100, textAlign: 'center', fontSize: 12 }}
          >
            {b}
          </GlassPanel>
        ))}
      </DemoRow>
      <DemoRow label="tone">
        {(['light', 'dark', 'auto'] as const).map(t => (
          <GlassPanel
            key={t}
            tone={t}
            padded
            radius="md"
            style={{ minWidth: 100, textAlign: 'center', fontSize: 12 }}
          >
            {t}
          </GlassPanel>
        ))}
      </DemoRow>
      <DemoRow label="radius">
        {(['sm', 'md', 'lg', 'xl', 'full'] as const).map(r => (
          <GlassPanel
            key={r}
            radius={r}
            padded
            style={{ minWidth: 70, textAlign: 'center', fontSize: 12 }}
          >
            {r}
          </GlassPanel>
        ))}
      </DemoRow>
      <DemoRow label="glow">
        <GlassPanel padded radius="md" style={{ fontSize: 12 }}>
          off
        </GlassPanel>
        <GlassPanel padded radius="md" glow style={{ fontSize: 12 }}>
          glow
        </GlassPanel>
      </DemoRow>
      <CodeBlock
        language="tsx"
        code={`<GlassPanel
  blur="medium"
  tone="auto"
  padded
  radius="md"
  bordered
  glow
>
  Hello.
</GlassPanel>`}
      />
    </Card>
  );
}

function ButtonDemo() {
  return (
    <Card title="GlassButton" subtitle="Springy hover-lift, depressed :active">
      <DemoRow label="variant">
        {(['default', 'primary', 'ghost', 'danger'] as const).map(v => (
          <GlassButton key={v} variant={v}>
            {v}
          </GlassButton>
        ))}
      </DemoRow>
      <DemoRow label="size">
        {(['sm', 'md', 'lg'] as const).map(s => (
          <GlassButton key={s} size={s}>
            size {s}
          </GlassButton>
        ))}
      </DemoRow>
      <DemoRow label="states">
        <GlassButton>idle</GlassButton>
        <GlassButton disabled>disabled</GlassButton>
        <GlassButton variant="primary">
          <Sparkle size={14} /> with icon
        </GlassButton>
      </DemoRow>
      <CodeBlock
        language="tsx"
        code={`<GlassButton variant="primary" size="md" onClick={...}>
  <Sparkle size={14} /> Save
</GlassButton>`}
      />
    </Card>
  );
}

function ChipDemo() {
  return (
    <Card title="GlassChip" subtitle="Inline tag for status, counts, labels">
      <DemoRow label="tone">
        {(['neutral', 'accent', 'success', 'danger'] as const).map(t => (
          <GlassChip key={t} tone={t}>
            {t}
          </GlassChip>
        ))}
      </DemoRow>
      <DemoRow label="size">
        {(['xs', 'sm', 'md'] as const).map(s => (
          <GlassChip key={s} size={s}>
            size {s}
          </GlassChip>
        ))}
      </DemoRow>
      <CodeBlock
        language="tsx"
        code={`<GlassChip tone="success" size="sm">live</GlassChip>`}
      />
    </Card>
  );
}

function ToolbarDemo() {
  return (
    <Card title="GlassToolbar" subtitle="Cluster of controls in one glass strip">
      <DemoRow label="contents">
        <GlassToolbar>
          <GlassButton size="sm" variant="ghost">
            File
          </GlassButton>
          <GlassButton size="sm" variant="ghost">
            Edit
          </GlassButton>
          <GlassButton size="sm" variant="ghost">
            View
          </GlassButton>
        </GlassToolbar>
      </DemoRow>
      <DemoRow label="size">
        {(['sm', 'md', 'lg'] as const).map(s => (
          <GlassToolbar key={s} size={s}>
            <GlassButton size={s} variant="ghost">
              {s}
            </GlassButton>
            <GlassButton size={s} variant="ghost">
              tool
            </GlassButton>
          </GlassToolbar>
        ))}
      </DemoRow>
      <CodeBlock
        language="tsx"
        code={`<GlassToolbar size="md">
  <GlassButton variant="ghost" size="sm">File</GlassButton>
  <GlassButton variant="ghost" size="sm">Edit</GlassButton>
</GlassToolbar>`}
      />
    </Card>
  );
}

function InputDemo() {
  const [v, setV] = React.useState('');
  return (
    <Card title="GlassInput" subtitle="Pressed-into-glass field with focus glow">
      <DemoRow label="basic">
        <div style={{ width: 220 }}>
          <GlassInput
            value={v}
            onChange={e => setV(e.target.value)}
            placeholder="type something"
          />
        </div>
      </DemoRow>
      <DemoRow label="prefix">
        <div style={{ width: 220 }}>
          <GlassInput
            prefix={<MagnifyingGlass size={12} />}
            placeholder="Search…"
          />
        </div>
      </DemoRow>
      <DemoRow label="states">
        <div style={{ width: 220 }}>
          <GlassInput placeholder="invalid" invalid />
        </div>
        <div style={{ width: 220 }}>
          <GlassInput placeholder="disabled" disabled />
        </div>
      </DemoRow>
      <DemoRow label="size">
        {(['sm', 'md', 'lg'] as const).map(s => (
          <div key={s} style={{ width: 200 }}>
            <GlassInput inputSize={s} placeholder={`size ${s}`} />
          </div>
        ))}
      </DemoRow>
      <CodeBlock
        language="tsx"
        code={`<GlassInput
  prefix={<MagnifyingGlass size={12} />}
  placeholder="Search…"
  inputSize="md"
/>`}
      />
    </Card>
  );
}

function SwitchDemo() {
  const [on, setOn] = React.useState(true);
  return (
    <Card title="GlassSwitch" subtitle="Glass thumb glides between states">
      <DemoRow label="size">
        {(['sm', 'md', 'lg'] as const).map(s => (
          <GlassSwitch key={s} size={s} defaultChecked={s === 'md'} />
        ))}
      </DemoRow>
      <DemoRow label="controlled">
        <GlassSwitch
          checked={on}
          onCheckedChange={setOn}
          label={on ? 'on' : 'off'}
        />
      </DemoRow>
      <CodeBlock
        language="tsx"
        code={`<GlassSwitch
  checked={on}
  onCheckedChange={setOn}
  label="Enable"
/>`}
      />
    </Card>
  );
}

function SliderDemo() {
  const [v, setV] = React.useState(42);
  return (
    <Card title="GlassSlider" subtitle="Native range underneath, glass track on top">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <GlassSlider value={v} onValueChange={setV} />
          </div>
          <div
            style={{
              fontFamily: 'var(--ls-font-mono)',
              fontSize: 'var(--ls-text-sm)',
              color: 'var(--ls-fg-primary)',
              minWidth: 30,
              textAlign: 'right',
            }}
          >
            {v}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, opacity: 0.6 }}>
          <div style={{ flex: 1 }}>
            <GlassSlider defaultValue={75} disabled />
          </div>
          <div
            style={{
              fontFamily: 'var(--ls-font-mono)',
              fontSize: 'var(--ls-text-xs)',
              color: 'var(--ls-fg-muted)',
              minWidth: 60,
            }}
          >
            disabled
          </div>
        </div>
      </div>
      <CodeBlock
        language="tsx"
        code={`<GlassSlider
  value={value}
  onValueChange={setValue}
  min={0}
  max={100}
/>`}
      />
    </Card>
  );
}

function TabsDemo() {
  const [tab, setTab] = React.useState('one');
  return (
    <Card title="GlassTabs" subtitle="Segmented selector with glass active pill">
      <DemoRow label="size sm">
        <GlassTabs value={tab} onValueChange={setTab} size="sm">
          <GlassTabs.Item value="one">One</GlassTabs.Item>
          <GlassTabs.Item value="two">Two</GlassTabs.Item>
          <GlassTabs.Item value="three">Three</GlassTabs.Item>
        </GlassTabs>
      </DemoRow>
      <DemoRow label="size md">
        <GlassTabs value={tab} onValueChange={setTab} size="md">
          <GlassTabs.Item value="one">One</GlassTabs.Item>
          <GlassTabs.Item value="two">Two</GlassTabs.Item>
          <GlassTabs.Item value="three">Three</GlassTabs.Item>
        </GlassTabs>
      </DemoRow>
      <DemoRow label="size lg">
        <GlassTabs value={tab} onValueChange={setTab} size="lg">
          <GlassTabs.Item value="one">One</GlassTabs.Item>
          <GlassTabs.Item value="two">Two</GlassTabs.Item>
          <GlassTabs.Item value="three">Three</GlassTabs.Item>
        </GlassTabs>
      </DemoRow>
      <CodeBlock
        language="tsx"
        code={`<GlassTabs value={tab} onValueChange={setTab}>
  <GlassTabs.Item value="overview">Overview</GlassTabs.Item>
  <GlassTabs.Item value="tokens">Tokens</GlassTabs.Item>
</GlassTabs>`}
      />
    </Card>
  );
}

function ToastDemo() {
  return (
    <Card title="GlassToast" subtitle="Slides in from the right (animation runs once on mount)">
      <DemoRow label="tone">
        {(['neutral', 'success', 'danger', 'accent'] as const).map(t => (
          <GlassToast
            key={t}
            tone={t}
            title={`Tone: ${t}`}
            body="Built-in slide-in keyframe runs on first mount."
          />
        ))}
      </DemoRow>
      <DemoRow label="with action">
        <GlassToast
          tone="accent"
          icon={<Sparkle size={18} />}
          title="Bid placed"
          body="2.5 ETH on Noun #1234"
          action={
            <GlassButton size="sm" variant="ghost">
              View
            </GlassButton>
          }
        />
      </DemoRow>
      <CodeBlock
        language="tsx"
        code={`<GlassToast
  tone="success"
  icon={<Sparkle size={18} />}
  title="Saved"
  body="Your settings have been written."
  onDismiss={() => setOpen(false)}
/>`}
      />
    </Card>
  );
}

function MenuBarDemo() {
  return (
    <Card title="GlassMenuBar" subtitle="Sticky top bar with start/center/end slots">
      <div
        style={{
          position: 'relative',
          height: 28,
          borderRadius: 'var(--ls-r-sm)',
          overflow: 'hidden',
          backgroundImage:
            'linear-gradient(135deg, #d4b67a 0%, #b89352 100%)',
        }}
      >
        <GlassMenuBar
          sticky={false}
          height={28}
          start={
            <>
              <Sparkle size={12} />
              <span>Liquid Sand</span>
            </>
          }
          end={<span style={{ fontSize: 11 }}>3:14 PM</span>}
        />
      </div>
      <CodeBlock
        language="tsx"
        code={`<GlassMenuBar
  start={<Logo />}
  center={<MenuItems />}
  end={<StatusIcons />}
/>`}
      />
    </Card>
  );
}

function DockDemo() {
  return (
    <Card title="GlassDock" subtitle="Floating bottom dock — also great as a free-standing pill">
      <div
        style={{
          position: 'relative',
          height: 90,
          borderRadius: 'var(--ls-r-sm)',
          overflow: 'hidden',
          backgroundImage:
            'linear-gradient(135deg, #5a4218 0%, #b89352 100%)',
        }}
      >
        <GlassDock position="absolute" bottom={10} reflection>
          <Folder size={22} style={{ color: '#1a1208' }} />
          <Settings size={22} style={{ color: '#1a1208' }} />
          <Sparkle size={22} style={{ color: '#1a1208' }} />
        </GlassDock>
      </div>
      <CodeBlock
        language="tsx"
        code={`<GlassDock>
  <DockIcon><Folder /></DockIcon>
  <DockIcon><Settings /></DockIcon>
</GlassDock>`}
      />
    </Card>
  );
}

function WindowDemo() {
  return (
    <Card title="GlassWindow" subtitle="Pure visual chrome — drag/resize lives in the consumer">
      <div
        style={{
          backgroundImage:
            'linear-gradient(135deg, #d4b67a 0%, #b89352 100%)',
          padding: 16,
          borderRadius: 'var(--ls-r-sm)',
        }}
      >
        <GlassWindow titlebar="Sample Window" footer={<span>1 item</span>}>
          <div
            style={{
              padding: 16,
              fontSize: 'var(--ls-text-sm)',
              color: 'var(--ls-fg-secondary)',
              minHeight: 80,
            }}
          >
            Window content goes here. Traffic lights are real glass orbs.
          </div>
        </GlassWindow>
      </div>
      <CodeBlock
        language="tsx"
        code={`<GlassWindow
  titlebar="My App"
  active
  onClose={...}
  onMinimize={...}
  onMaximize={...}
  footer={<span>1 item</span>}
>
  ...
</GlassWindow>`}
      />
    </Card>
  );
}

function ModalDemo() {
  const [open, setOpen] = React.useState(false);
  return (
    <Card title="GlassModal" subtitle="Sepia scrim + heavy-blur body. No portal, no scroll-lock — wrap if you need them.">
      <DemoRow label="trigger">
        <GlassButton variant="primary" onClick={() => setOpen(true)}>
          Open modal
        </GlassButton>
      </DemoRow>
      <GlassModal open={open} onScrimClick={() => setOpen(false)} size="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3
            style={{
              margin: 0,
              fontFamily: 'var(--ls-font-display)',
              fontSize: 'var(--ls-text-lg)',
            }}
          >
            <Sparkle size={18} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            Hello from glass
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
            Click the scrim or press Escape to close. Both behaviours are
            wired by default.
          </p>
          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
              marginTop: 8,
            }}
          >
            <GlassButton variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </GlassButton>
            <GlassButton variant="primary" onClick={() => setOpen(false)}>
              OK
            </GlassButton>
          </div>
        </div>
      </GlassModal>
      <CodeBlock
        language="tsx"
        code={`<GlassModal
  open={open}
  onScrimClick={() => setOpen(false)}
  closeOnEscape
  size="md"
>
  <h3>Hello from glass</h3>
  <p>...</p>
</GlassModal>`}
      />
    </Card>
  );
}

/* ─── The section ──────────────────────────────────────────────────────── */

export function ComponentsSection() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader
        title="Components"
        description="13 glass primitives. Each one composes the same backdrop-blur + inset-highlight + hairline-border recipe — so you can mix and match without surfaces fighting each other."
      />
      <PanelDemo />
      <ButtonDemo />
      <ChipDemo />
      <ToolbarDemo />
      <InputDemo />
      <SwitchDemo />
      <SliderDemo />
      <TabsDemo />
      <ToastDemo />
      <MenuBarDemo />
      <DockDemo />
      <WindowDemo />
      <ModalDemo />
    </div>
  );
}
