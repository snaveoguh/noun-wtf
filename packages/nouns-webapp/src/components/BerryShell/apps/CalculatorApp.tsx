/**
 * CalculatorApp — Mac-style 4×4 calculator.
 *
 * Display shows up to 12 digits; numbers that would overflow are formatted in
 * scientific notation (1.23456789e+12). Keyboard input is wired both via the
 * window-level keydown listener (so it works whether or not the window itself
 * is focused) and via the global hotkey registry — same handlers either way
 * so behaviour is consistent.
 *
 * Self-registers on module import via `berryRegistry.register(...)`.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { berryRegistry } from '../system/berryRegistry';
import { useHotkey } from '../system/hotkeys';

type Op = '+' | '-' | '×' | '÷';

interface CalcState {
  /** What's currently shown on screen. */
  display: string;
  /** Last committed operand. */
  acc: number | null;
  /** Pending operator. */
  op: Op | null;
  /** True after operator press — next digit replaces display. */
  awaitingNext: boolean;
}

const INITIAL: CalcState = {
  display: '0',
  acc: null,
  op: null,
  awaitingNext: false,
};

const MAX_DIGITS = 12;

function format(n: number): string {
  if (!Number.isFinite(n)) return 'Error';
  // Integers that fit get a clean decimal-free render.
  const abs = Math.abs(n);
  // Scientific notation thresholds — anything with more than 12 sig digits
  // or smaller than 1e-6 spills into exponent form so the display never wraps.
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-6)) {
    return n.toExponential(6).replace('e+', 'e+').replace('e-', 'e-');
  }
  // Cap to MAX_DIGITS significant digits when above 1; otherwise trim
  // trailing zeros from the fractional part.
  let s = n.toPrecision(MAX_DIGITS);
  if (s.includes('.') && !s.includes('e')) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  // Last guard — if the rendered string still exceeds MAX_DIGITS chars
  // (negative sign + leading digits), drop into exponential notation.
  if (s.replace('-', '').replace('.', '').length > MAX_DIGITS) {
    return n.toExponential(6);
  }
  return s;
}

function applyOp(a: number, b: number, op: Op): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? NaN : a / b;
  }
}

function reduce(state: CalcState, action: string): CalcState {
  // ---- digits ----
  if (/^[0-9]$/.test(action)) {
    if (state.awaitingNext || state.display === '0') {
      return { ...state, display: action, awaitingNext: false };
    }
    if (state.display.replace('-', '').replace('.', '').length >= MAX_DIGITS) return state;
    return { ...state, display: state.display + action };
  }

  // ---- decimal ----
  if (action === '.') {
    if (state.awaitingNext) return { ...state, display: '0.', awaitingNext: false };
    if (state.display.includes('.')) return state;
    return { ...state, display: state.display + '.' };
  }

  // ---- AC / clear ----
  if (action === 'AC') return { ...INITIAL };

  // ---- sign flip ----
  if (action === '+/-') {
    const n = parseFloat(state.display);
    return { ...state, display: format(-n) };
  }

  // ---- percent ----
  if (action === '%') {
    const n = parseFloat(state.display);
    return { ...state, display: format(n / 100) };
  }

  // ---- operators ----
  if (action === '+' || action === '-' || action === '×' || action === '÷') {
    const current = parseFloat(state.display);
    if (state.op && state.acc !== null && !state.awaitingNext) {
      // Chain: commit pending op first, then queue new one with the result.
      const result = applyOp(state.acc, current, state.op);
      return {
        display: format(result),
        acc: result,
        op: action,
        awaitingNext: true,
      };
    }
    return {
      ...state,
      acc: current,
      op: action,
      awaitingNext: true,
    };
  }

  // ---- equals ----
  if (action === '=') {
    if (state.op === null || state.acc === null) return state;
    const current = parseFloat(state.display);
    const result = applyOp(state.acc, current, state.op);
    return {
      display: format(result),
      acc: null,
      op: null,
      awaitingNext: true,
    };
  }

  return state;
}

interface KeyDef {
  label: string;
  action: string;
  variant: 'fn' | 'op' | 'num' | 'eq';
  span?: 1 | 2;
}

// 4×4 grid laid out as Mac calc:
// AC   +/-   %    ÷
//  7    8    9    ×
//  4    5    6    -
//  1    2    3    +
//  0 (span 2)  .    =
const KEYS: KeyDef[][] = [
  [
    { label: 'AC', action: 'AC', variant: 'fn' },
    { label: '+/−', action: '+/-', variant: 'fn' },
    { label: '%', action: '%', variant: 'fn' },
    { label: '÷', action: '÷', variant: 'op' },
  ],
  [
    { label: '7', action: '7', variant: 'num' },
    { label: '8', action: '8', variant: 'num' },
    { label: '9', action: '9', variant: 'num' },
    { label: '×', action: '×', variant: 'op' },
  ],
  [
    { label: '4', action: '4', variant: 'num' },
    { label: '5', action: '5', variant: 'num' },
    { label: '6', action: '6', variant: 'num' },
    { label: '−', action: '-', variant: 'op' },
  ],
  [
    { label: '1', action: '1', variant: 'num' },
    { label: '2', action: '2', variant: 'num' },
    { label: '3', action: '3', variant: 'num' },
    { label: '+', action: '+', variant: 'op' },
  ],
  [
    { label: '0', action: '0', variant: 'num', span: 2 },
    { label: '.', action: '.', variant: 'num' },
    { label: '=', action: '=', variant: 'eq' },
  ],
];

/**
 * Liquid Sand styled key — solid sand-tint for num/fn, accent for op/eq.
 * HIG visionOS: no nested glass — calculator window already sits on glass,
 * so buttons here are SOLID surfaces (sand fills, opaque accent), not
 * additional backdrop-blur layers.
 */
function keyStyle(variant: KeyDef['variant']): React.CSSProperties {
  const base: React.CSSProperties = {
    border: 'none',
    borderRadius: 'var(--ls-r-md)',
    fontFamily: 'var(--ls-font-mono)',
    // HIG: 17pt body for buttons (per-app spec calls for 17pt SF Mono w/ tabular-nums)
    fontSize: 17,
    lineHeight: 1.3,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'transform var(--ls-dur-fast) var(--ls-ease-spring), filter var(--ls-dur-fast) var(--ls-ease-soft)',
    boxShadow:
      'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass), var(--ls-shadow-sm)',
    fontVariantNumeric: 'tabular-nums',
    // HIG min touch target — 44pt minimum, even on mouse/trackpad surfaces
    minHeight: 44,
  };
  if (variant === 'op' || variant === 'eq') {
    return {
      ...base,
      background: 'var(--ls-accent)',
      color: 'var(--ls-fg-on-dark)',
      boxShadow:
        'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass), var(--ls-shadow-sm), var(--ls-shadow-glow)',
    };
  }
  if (variant === 'fn') {
    return {
      ...base,
      // Solid sand surface — no backdrop-blur since we're already on glass
      background: 'var(--ls-sand-200)',
      color: 'var(--ls-fg-primary)',
    };
  }
  // num
  return {
    ...base,
    background: 'var(--ls-sand-100)',
    color: 'var(--ls-fg-primary)',
  };
}

function CalculatorApp(): ReactElement {
  const [state, setState] = useState<CalcState>(INITIAL);
  const stateRef = useRef(state);
  stateRef.current = state;

  const dispatch = useCallback((action: string) => {
    setState(s => reduce(s, action));
  }, []);

  // -- Keyboard input via plain DOM listener.
  // We attach to the document (capture phase) but bail when the focus is in a
  // text input so we don't grab keystrokes from other apps.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target;
      if (t instanceof HTMLElement) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return;
      }
      const k = e.key;
      if (/^[0-9]$/.test(k)) { dispatch(k); e.preventDefault(); return; }
      if (k === '.') { dispatch('.'); e.preventDefault(); return; }
      if (k === '+') { dispatch('+'); e.preventDefault(); return; }
      if (k === '-') { dispatch('-'); e.preventDefault(); return; }
      if (k === '*' || k === 'x' || k === 'X') { dispatch('×'); e.preventDefault(); return; }
      if (k === '/') { dispatch('÷'); e.preventDefault(); return; }
      if (k === 'Enter' || k === '=') { dispatch('='); e.preventDefault(); return; }
      if (k === '%') { dispatch('%'); e.preventDefault(); return; }
      if (k === 'Escape' || k === 'Delete' || k === 'c' || k === 'C') {
        dispatch('AC'); e.preventDefault(); return;
      }
      if (k === 'Backspace') {
        // Mac calc has no backspace; treat as AC if display is short, else trim.
        setState(s => {
          if (s.display.length <= 1 || s.display === '0') return INITIAL;
          return { ...s, display: s.display.slice(0, -1) };
        });
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dispatch]);

  // Hotkey registry — scoped to the calculator app id. The DOM listener above
  // covers the typical case; this entry is mostly for the help / conflicts UI
  // that other agents render off the `hotkeyManager.list()` snapshot.
  useHotkey('escape', () => dispatch('AC'), [dispatch], {
    description: 'Calculator: clear (AC)',
    scope: 'calculator',
  });

  // Display sizing — shrink font once we're past 9 chars so digits never clip.
  // HIG: 28pt+ for headlines; baseline 34pt large-title for the display.
  const displaySize = state.display.length > 9 ? 22 : state.display.length > 6 ? 28 : 34;

  return (
    <div
      // HIG 8pt grid: 16pt content padding from window edges, 8pt section gaps
      className="flex flex-col h-full w-full box-border"
      style={{
        fontFamily: 'var(--ls-font-sans)',
        padding: 16,
        gap: 8,
      }}
    >
      {/* Display — solid surface (no nested glass over text per visionOS) */}
      <div
        aria-label="Calculator display"
        role="status"
        aria-live="polite"
        style={{
          textAlign: 'right',
          padding: '12px 16px',
          fontSize: displaySize,
          minHeight: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          fontFamily: 'var(--ls-font-mono)',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 0.5,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: 'var(--ls-fg-primary)',
          fontWeight: 700,
          // Solid sand surface, no backdrop blur (glass over text rule)
          background: 'var(--ls-sand-50)',
          borderRadius: 'var(--ls-r-md)',
          boxShadow:
            'var(--ls-shadow-inset-glass), 0 0 0 1px var(--ls-border-glass)',
          lineHeight: 1.2,
        }}
      >
        {state.display}
      </div>

      {/* Buttons grid — 8pt gap matches HIG spacing */}
      <div
        className="grid flex-1"
        style={{
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
        }}
      >
        {KEYS.flat().map((k, i) => (
          <button
            key={`${k.label}-${i}`}
            type="button"
            onClick={() => dispatch(k.action)}
            style={{
              ...keyStyle(k.variant),
              gridColumn: k.span === 2 ? 'span 2' : undefined,
            }}
            onMouseDown={e => {
              e.currentTarget.style.transform = 'scale(0.96)';
              e.currentTarget.style.filter = 'brightness(0.94)';
            }}
            onMouseUp={e => {
              e.currentTarget.style.transform = '';
              e.currentTarget.style.filter = '';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = '';
              e.currentTarget.style.filter = '';
            }}
            aria-label={k.action}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}

berryRegistry.register({
  id: 'calculator',
  name: 'Calculator',
  icon: '🧮',
  component: CalculatorApp,
  defaultWindow: { w: 280, h: 380 },
  capabilities: [],
});

export default CalculatorApp;
