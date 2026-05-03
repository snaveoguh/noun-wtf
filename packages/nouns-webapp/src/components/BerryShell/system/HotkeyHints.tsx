/**
 * HotkeyHints — Mac-style cheat sheet that fades in when the user holds
 * `cmd` (or `meta`) for >1s without pressing another key.
 *
 * Auto-dismisses on key release or after 4s, whichever comes first.
 *
 * Lists every currently-registered global hotkey via `hotkeyManager.list()`.
 * App-scoped hotkeys are excluded — they're contextual to whatever app is
 * focused and showing them would clutter the overlay.
 */

import { useEffect, useState } from 'react';

import { hotkeyManager, type BerryHotkey } from './hotkeys';

const HOLD_DELAY_MS = 1000;
const AUTO_HIDE_MS = 4000;

function comboLabel(combo: string): string {
  return combo
    .split('+')
    .map(part => part.trim())
    .map(part => {
      const lower = part.toLowerCase();
      if (lower === 'meta' || lower === 'cmd' || lower === 'command') return '⌘';
      if (lower === 'shift') return '⇧';
      if (lower === 'alt' || lower === 'opt' || lower === 'option') return '⌥';
      if (lower === 'ctrl' || lower === 'control') return '⌃';
      if (lower === 'esc' || lower === 'escape') return 'Esc';
      if (lower === 'space') return 'Space';
      if (lower === 'enter' || lower === 'return') return '↵';
      return part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

export default function HotkeyHints() {
  const [visible, setVisible] = useState(false);
  const [hotkeys, setHotkeys] = useState<BerryHotkey[]>([]);

  useEffect(() => {
    let holdTimer: number | undefined;
    let autoHideTimer: number | undefined;
    let metaHeld = false;
    let consumed = false;

    function clearTimers() {
      if (holdTimer !== undefined) {
        window.clearTimeout(holdTimer);
        holdTimer = undefined;
      }
      if (autoHideTimer !== undefined) {
        window.clearTimeout(autoHideTimer);
        autoHideTimer = undefined;
      }
    }

    function show() {
      setHotkeys(hotkeyManager.list().filter(h => h.scope === 'global'));
      setVisible(true);
      autoHideTimer = window.setTimeout(() => setVisible(false), AUTO_HIDE_MS);
    }

    function onKeyDown(e: KeyboardEvent) {
      // Any non-meta key cancels the pending hold and any visible overlay.
      if (e.key !== 'Meta' && e.key !== 'Control') {
        consumed = true;
        clearTimers();
        setVisible(false);
        return;
      }
      if (metaHeld) return; // ignore key-repeats
      metaHeld = true;
      consumed = false;
      clearTimers();
      holdTimer = window.setTimeout(() => {
        if (!consumed) show();
      }, HOLD_DELAY_MS);
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'Meta' || e.key === 'Control') {
        metaHeld = false;
        clearTimers();
        setVisible(false);
      }
    }

    function onBlur() {
      metaHeld = false;
      consumed = true;
      clearTimers();
      setVisible(false);
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      clearTimers();
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Keyboard shortcuts"
      style={{
        position: 'fixed',
        bottom: 90,
        right: 24,
        zIndex: 4500,
        width: 280,
        background: 'rgba(28, 28, 32, 0.82)',
        color: '#f5f5f7',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 10,
        boxShadow: '0 12px 36px rgba(0, 0, 0, 0.45)',
        padding: '12px 14px',
        fontFamily: 'system-ui, -apple-system, "SF Pro Display", "Helvetica Neue", sans-serif',
        fontSize: 12,
        animation: 'berry-hk-fade-in 200ms ease-out',
      }}
    >
      <style>{`@keyframes berry-hk-fade-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'rgba(245, 245, 247, 0.55)',
          marginBottom: 8,
        }}
      >
        Keyboard Shortcuts
      </div>
      {hotkeys.length === 0 && (
        <div style={{ color: 'rgba(245,245,247,0.55)' }}>No shortcuts registered.</div>
      )}
      {hotkeys.map(h => (
        <div
          key={h.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '4px 0',
            gap: 12,
          }}
        >
          <span style={{ flex: 1, color: 'rgba(245,245,247,0.85)' }}>{h.description}</span>
          <span
            style={{
              fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              fontSize: 11,
              padding: '2px 6px',
              background: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 4,
              whiteSpace: 'nowrap',
            }}
          >
            {comboLabel(h.combo)}
          </span>
        </div>
      ))}
    </div>
  );
}
