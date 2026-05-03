/**
 * Shared bits for the Liquid Sand showcase app.
 *
 * - <CodeBlock> renders a styled <pre> with JetBrains Mono on a sand-tinted
 *   glass surface. Click anywhere on the block to copy its source to the
 *   clipboard; a `setToast()` helper from the parent surfaces feedback.
 * - <SectionHeader> renders the section title + description.
 * - <Card> is a thin glass-on-sand wrapper for content groupings.
 *
 * The toast helper is a tiny store so any sub-section can fire one without
 * having to thread a callback down through props.
 */

import * as React from 'react';

import { GlassChip, GlassPanel } from '@/liquid-sand/glass';

/* ─── Toast bridge — module-level so any section can fire one ─────────────── */

type ToastListener = (message: string) => void;
const toastListeners = new Set<ToastListener>();

export function fireToast(message: string): void {
  toastListeners.forEach(l => l(message));
}

export function useLiquidSandToasts(): {
  toast: string | null;
  clear: () => void;
} {
  const [toast, setToast] = React.useState<string | null>(null);
  React.useEffect(() => {
    const listener: ToastListener = msg => {
      setToast(msg);
      // Auto-clear after 1.6s — a touch longer than GlassToast's slide.
      window.setTimeout(() => {
        setToast(prev => (prev === msg ? null : prev));
      }, 1600);
    };
    toastListeners.add(listener);
    return () => {
      toastListeners.delete(listener);
    };
  }, []);
  return { toast, clear: () => setToast(null) };
}

/* ─── CodeBlock — sand-tinted glass <pre> with click-to-copy ──────────────── */

export interface CodeBlockProps {
  code: string;
  language?: string;
  /** Optional one-line caption shown above the block. */
  caption?: string;
}

export function CodeBlock({ code, language, caption }: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      fireToast('Copied to clipboard');
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      fireToast('Copy failed — clipboard blocked');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {caption && (
        <div
          style={{
            fontSize: 'var(--ls-text-xs)',
            color: 'var(--ls-fg-muted)',
            fontFamily: 'var(--ls-font-sans)',
            letterSpacing: 0.2,
          }}
        >
          {caption}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            padding: '2px 8px',
            fontSize: 10,
            fontFamily: 'var(--ls-font-sans)',
            color: copied ? 'var(--ls-success)' : 'var(--ls-fg-secondary)',
            backgroundColor: 'rgba(255, 250, 240, 0.7)',
            border: 'none',
            borderRadius: 'var(--ls-r-sm)',
            boxShadow:
              'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass)',
            cursor: 'pointer',
            backdropFilter: 'blur(var(--ls-blur-subtle))',
            WebkitBackdropFilter: 'blur(var(--ls-blur-subtle))',
            transition: 'color var(--ls-dur-fast) var(--ls-ease-soft)',
            zIndex: 1,
          }}
        >
          {copied ? 'copied' : 'copy'}
        </button>
        <pre
          onClick={copy}
          style={{
            margin: 0,
            padding: '12px 14px',
            fontFamily: 'var(--ls-font-mono)',
            fontSize: 'var(--ls-text-xs)',
            lineHeight: 1.55,
            color: 'var(--ls-fg-primary)',
            // Sand-tinted glass body — gives the snippet a softer surface than
            // pure white IDE chrome and matches the rest of the showcase.
            backgroundColor: 'rgba(244, 234, 214, 0.55)',
            backdropFilter: 'blur(var(--ls-blur-subtle))',
            WebkitBackdropFilter: 'blur(var(--ls-blur-subtle))',
            borderRadius: 'var(--ls-r-md)',
            boxShadow:
              'inset 0 1px 2px rgba(60,45,25,0.10), 0 0 0 1px var(--ls-border-glass)',
            overflow: 'auto',
            cursor: 'copy',
            whiteSpace: 'pre',
            // Reserve space at the right so the copy chip doesn't overlap
            // the first long line.
            paddingRight: 64,
          }}
          aria-label={`Code snippet${language ? ` in ${language}` : ''} — click to copy`}
        >
          {code}
        </pre>
      </div>
    </div>
  );
}

/* ─── Section header ──────────────────────────────────────────────────────── */

export interface SectionHeaderProps {
  title: string;
  description?: string;
  badge?: string;
}

export function SectionHeader({
  title,
  description,
  badge,
}: SectionHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        paddingBottom: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--ls-font-display)',
            // HIG: 28pt+ headlines
            fontSize: 'var(--ls-text-2xl)',
            lineHeight: 1.2,
            fontWeight: 700,
            color: 'var(--ls-fg-primary)',
            letterSpacing: 0.4,
          }}
        >
          {title}
        </h2>
        {badge && (
          <GlassChip tone="accent" size="sm">
            {badge}
          </GlassChip>
        )}
      </div>
      {description && (
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--ls-font-sans)',
            // HIG body: 17pt
            fontSize: 'var(--ls-text-lg)',
            color: 'var(--ls-fg-secondary)',
            lineHeight: 1.5,
            maxWidth: 640,
          }}
        >
          {description}
        </p>
      )}
    </div>
  );
}

/* ─── Card — subtle glass surface for grouping ────────────────────────────── */

export interface CardProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function Card({ title, subtitle, children }: CardProps) {
  return (
    <GlassPanel
      blur="subtle"
      tone="light"
      radius="md"
      bordered
      padded
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {(title || subtitle) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {title && (
            <div
              style={{
                fontFamily: 'var(--ls-font-display)',
                fontSize: 'var(--ls-text-sm)',
                color: 'var(--ls-fg-primary)',
                letterSpacing: 0.3,
              }}
            >
              {title}
            </div>
          )}
          {subtitle && (
            <div
              style={{
                fontFamily: 'var(--ls-font-sans)',
                fontSize: 'var(--ls-text-xs)',
                color: 'var(--ls-fg-muted)',
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      )}
      {children}
    </GlassPanel>
  );
}

/* ─── Row of demo controls + their props label ────────────────────────────── */

export interface DemoRowProps {
  label: string;
  children: React.ReactNode;
}

export function DemoRow({ label, children }: DemoRowProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        padding: '8px 10px',
        backgroundColor: 'rgba(255,250,240,0.35)',
        borderRadius: 'var(--ls-r-sm)',
        boxShadow: '0 0 0 1px var(--ls-border-glass)',
      }}
    >
      <div
        style={{
          minWidth: 90,
          fontFamily: 'var(--ls-font-mono)',
          fontSize: 'var(--ls-text-xs)',
          color: 'var(--ls-fg-secondary)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {children}
      </div>
    </div>
  );
}
