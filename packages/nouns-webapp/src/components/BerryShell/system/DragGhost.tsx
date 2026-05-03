/**
 * DragGhost — fixed-position follower rendered above every window.
 *
 * Reads the live cursor + payload from `dndStore` and shows a small chip
 * describing what's being dragged. Pointer-events:none so it never eats
 * clicks. Also paints the global `[data-berry-dragging]` body cursor —
 * this component is the *visual*, the body cursor flip happens in dnd.ts.
 *
 * Mount once near the top of the BerryShell tree.
 */

import { type CSSProperties } from 'react';

import { useCurrentDrag } from './dnd';

const chipStyle: CSSProperties = {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: 5_000,
  padding: '4px 8px',
  borderRadius: 6,
  fontFamily: 'var(--theme-font-display)',
  fontSize: 11,
  fontWeight: 700,
  color: '#fff',
  background:
    'linear-gradient(180deg, rgba(60, 130, 220, 0.96) 0%, rgba(30, 100, 200, 0.96) 100%)',
  boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.4)',
  whiteSpace: 'nowrap',
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  transform: 'translate(-50%, -130%)',
  userSelect: 'none',
};

function describe(type: string, data: unknown): string {
  if (type === 'noun') {
    const idLike =
      typeof data === 'string' || typeof data === 'number'
        ? String(data)
        : (data as { nounId?: unknown })?.nounId !== undefined
          ? String((data as { nounId: unknown }).nounId)
          : '?';
    return `Noun ${idLike}`;
  }
  if (type === 'file' && data && typeof data === 'object') {
    const name = (data as { name?: unknown }).name;
    if (typeof name === 'string') return name;
  }
  if (type === 'url' && typeof data === 'string') return data.slice(0, 32);
  if (type === 'text' && typeof data === 'string') return data.slice(0, 24);
  return type;
}

export function DragGhost() {
  const { drag, cursor } = useCurrentDrag();
  if (!drag || !cursor) return null;
  return (
    <div style={{ ...chipStyle, left: cursor.x, top: cursor.y }} aria-hidden="true">
      {describe(drag.type, drag.data)}
    </div>
  );
}
