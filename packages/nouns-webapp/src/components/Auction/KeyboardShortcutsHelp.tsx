/**
 * KeyboardShortcutsHelp — Frosted glass overlay showing all keyboard shortcuts.
 */
import { FC, useEffect } from 'react';

import classes from './Auction.module.css';

interface Props {
  onClose: () => void;
}

const VIEWING = [
  ['← / →', 'Prev / next Noun'],
  ['1 / 2 / 3', 'Real / 3D / ASCII'],
  ['E', 'Enter edit mode'],
  ['] / [', 'Zoom in / out'],
  ['R', 'Reset view'],
  ['F', 'Toggle fullscreen'],
  ['S', 'Screenshot'],
  ['?', 'This help'],
  ['Esc', 'Close overlays'],
];

const EDITING = [
  ['B / P', 'Pencil tool'],
  ['E', 'Eraser tool'],
  ['G', 'Fill bucket'],
  ['I', 'Eyedropper'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Y', 'Redo'],
  ['Esc', 'Exit editor'],
];

const KeyboardShortcutsHelp: FC<Props> = ({ onClose }) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.3)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        className={classes.heroFormOverlay}
        style={{ maxWidth: 560, width: '90vw' }}
        onClick={e => e.stopPropagation()}
      >
        <div
          style={{
            fontFamily: "'PT Root UI', sans-serif",
            fontSize: '0.75rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--theme-text-secondary)',
            marginBottom: 12,
            textAlign: 'center',
          }}
        >
          Keyboard Shortcuts
        </div>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Column title="Viewing" shortcuts={VIEWING} />
          <Column title="Editing" shortcuts={EDITING} />
        </div>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: 'var(--theme-bg-tertiary)',
              borderRadius: 'var(--theme-radius-md)',
              padding: '6px 20px',
              fontSize: '0.65rem',
              fontWeight: 700,
              fontFamily: "'PT Root UI', sans-serif",
              cursor: 'pointer',
              color: 'var(--theme-text-secondary)',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const Column: FC<{ title: string; shortcuts: string[][] }> = ({ title, shortcuts }) => (
  <div style={{ minWidth: 200 }}>
    <div
      style={{
        fontFamily: "'PT Root UI', sans-serif",
        fontSize: '0.6rem',
        fontWeight: 800,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--theme-text-muted)',
        marginBottom: 6,
      }}
    >
      {title}
    </div>
    {shortcuts.map(([key, desc]) => (
      <div
        key={key}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '3px 0',
          fontFamily: "'PT Root UI', sans-serif",
          fontSize: '0.65rem',
        }}
      >
        <kbd
          style={{
            background: 'var(--theme-bg-tertiary)',
            borderRadius: 'var(--theme-radius-sm)',
            padding: '2px 6px',
            fontFamily: "'Courier New', monospace",
            fontSize: '0.6rem',
            fontWeight: 700,
            color: 'var(--theme-text-primary)',
            minWidth: 60,
            textAlign: 'center',
          }}
        >
          {key}
        </kbd>
        <span style={{ color: 'var(--theme-text-secondary)', marginLeft: 12 }}>{desc}</span>
      </div>
    ))}
  </div>
);

export default KeyboardShortcutsHelp;
