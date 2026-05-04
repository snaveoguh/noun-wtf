/**
 * BerryOS drag-and-drop coordinator.
 *
 * Centralises the in-shell drag lifecycle so any app can publish a draggable
 * payload (a Noun, a file, a URL, a clipboard string …) and any other app can
 * register a drop target without the two needing to know about each other.
 *
 * Browser-native `HTML5 dragstart`/`drop` is intentionally NOT used here:
 * - it can't carry typed JS objects (everything round-trips as a string),
 * - drop targets have to be registered as DOM listeners which is awkward when
 *   sources / targets live in separately mounted React subtrees.
 *
 * Instead, `startDrag(payload)` flips a global flag, `useDraggable` wires up
 * pointer events to drive a follower ghost, and `useDropTarget` registers an
 * id + accept-list with the store. On pointerup the source resolves which
 * target (if any) the cursor is over and calls `endDrag` with the outcome.
 *
 * Visual contract:
 * - body cursor switches to `grabbing` while a drag is in progress
 *   (`document.body[data-berry-dragging]`);
 * - registered drop targets that accept the current drag get a subtle blue
 *   inset border (drawn by the hook via inline style);
 * - hovered + accepted target gets a stronger highlight.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

import { berryBus } from './eventBus';
import { createStore } from './externalStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BerryDragType = 'noun' | 'file' | 'text' | 'url' | 'app';

export interface BerryDragPayload {
  type: BerryDragType;
  data: unknown;
  sourceAppId?: string;
  /** Optional MIME-style hint, e.g. `image/svg+xml`, `application/x-noun`. */
  mimeHint?: string;
}

export interface BerryDropTarget {
  id: string;
  accept: BerryDragType[];
  appId: string;
  onDrop: (payload: BerryDragPayload) => void;
  /** Bounding rect updater — set by the React hook each frame while dragging. */
  getRect: () => DOMRect | null;
}

interface DndState {
  currentDrag: BerryDragPayload | null;
  /** ID of the target the cursor is currently hovering, if it accepts. */
  hoverTargetId: string | null;
  /** Live cursor position so the ghost can follow without prop-drilling. */
  cursor: { x: number; y: number } | null;
}

const initialState: DndState = {
  currentDrag: null,
  hoverTargetId: null,
  cursor: null,
};

// ---------------------------------------------------------------------------
// Store + imperative API
// ---------------------------------------------------------------------------

export const dndStore = createStore<DndState>(initialState);

const dropTargets = new Map<string, BerryDropTarget>();

export function registerDropTarget(target: BerryDropTarget): () => void {
  dropTargets.set(target.id, target);
  return () => {
    dropTargets.delete(target.id);
  };
}

export function listDropTargets(): readonly BerryDropTarget[] {
  return Array.from(dropTargets.values());
}

export function startDrag(payload: BerryDragPayload): void {
  dndStore.setState(s => ({ ...s, currentDrag: payload, hoverTargetId: null }));
  if (typeof document !== 'undefined') {
    document.body.dataset.berryDragging = payload.type;
    document.body.style.cursor = 'grabbing';
  }
  berryBus.emit('dnd:start', { payload });
}

export function endDrag(droppedOnTargetId?: string, accepted = false): void {
  const state = dndStore.getState();
  const payload = state.currentDrag;
  dndStore.setState({ ...initialState });
  if (typeof document !== 'undefined') {
    delete document.body.dataset.berryDragging;
    document.body.style.cursor = '';
  }
  berryBus.emit('dnd:end', {
    payload,
    droppedOnTargetId,
    accepted,
  });
}

function setHover(targetId: string | null): void {
  const prev = dndStore.getState().hoverTargetId;
  if (prev === targetId) return;
  dndStore.setState(s => ({ ...s, hoverTargetId: targetId }));
  if (prev) {
    const t = dropTargets.get(prev);
    if (t) berryBus.emit('dnd:targetLeave', { targetId: prev, appId: t.appId });
  }
  if (targetId) {
    const t = dropTargets.get(targetId);
    if (t)
      berryBus.emit('dnd:targetEnter', {
        targetId,
        appId: t.appId,
        accept: t.accept,
      });
  }
}

function pickTargetAtPoint(x: number, y: number, type: BerryDragType): string | null {
  // Iterate in registration order; last-registered wins on ties (top of z).
  let hit: string | null = null;
  for (const t of dropTargets.values()) {
    if (!t.accept.includes(type)) continue;
    const r = t.getRect();
    if (!r) continue;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      hit = t.id;
    }
  }
  return hit;
}

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

export interface UseDraggableOptions {
  /** Allow callers to disable temporarily without unmounting. */
  disabled?: boolean;
  /** Optional click-vs-drag threshold in px. Default 5. */
  threshold?: number;
}

export interface UseDraggableResult {
  /** Spread on the source element. */
  bind: {
    onPointerDown: (e: React.PointerEvent) => void;
    style: CSSProperties;
    draggable: false;
  };
  /** True while THIS source is the active drag. */
  isDragging: boolean;
}

/**
 * `useDraggable(payload)` — turn any element into a Berry drag source. The
 * payload is captured at pointer-down time (so callers can compute it from
 * fresh props without memoizing).
 */
export function useDraggable(
  payloadFactory: BerryDragPayload | (() => BerryDragPayload),
  options: UseDraggableOptions = {},
): UseDraggableResult {
  const { disabled, threshold = 5 } = options;
  const [isDragging, setIsDragging] = useState(false);
  const dragStartedRef = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const payloadRef = useRef<BerryDragPayload | null>(null);

  // Stable factory ref so callers can pass an inline arrow.
  const factoryRef = useRef(payloadFactory);
  factoryRef.current = payloadFactory;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return;
      if (e.button !== 0) return;
      const factory = factoryRef.current;
      const payload =
        typeof factory === 'function' ? (factory as () => BerryDragPayload)() : factory;
      payloadRef.current = payload;
      startPosRef.current = { x: e.clientX, y: e.clientY };
      dragStartedRef.current = false;

      const onMove = (ev: PointerEvent) => {
        const start = startPosRef.current;
        if (!start) return;
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!dragStartedRef.current) {
          if (Math.hypot(dx, dy) < threshold) return;
          dragStartedRef.current = true;
          setIsDragging(true);
          startDrag(payloadRef.current!);
        }
        // Live cursor for ghost + hover detection
        const cursor = { x: ev.clientX, y: ev.clientY };
        const hover = pickTargetAtPoint(
          ev.clientX,
          ev.clientY,
          payloadRef.current!.type,
        );
        dndStore.setState(s => ({ ...s, cursor }));
        setHover(hover);
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (!dragStartedRef.current) {
          // Treated as a click — ignore.
          payloadRef.current = null;
          return;
        }
        const targetId = pickTargetAtPoint(
          ev.clientX,
          ev.clientY,
          payloadRef.current!.type,
        );
        let accepted = false;
        if (targetId) {
          const t = dropTargets.get(targetId);
          if (t) {
            try {
              t.onDrop(payloadRef.current!);
              accepted = true;
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error('[berry-dnd] drop handler threw', err);
            }
          }
        }
        endDrag(targetId ?? undefined, accepted);
        payloadRef.current = null;
        setIsDragging(false);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [disabled, threshold],
  );

  const bind = useMemo(
    () => ({
      onPointerDown,
      style: {
        cursor: disabled ? 'default' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
      } satisfies CSSProperties,
      draggable: false as const,
    }),
    [onPointerDown, disabled],
  );

  return { bind, isDragging };
}

export interface UseDropTargetResult<E extends HTMLElement = HTMLDivElement> {
  ref: React.RefObject<E | null>;
  isOver: boolean;
  canAccept: boolean;
  /** Pre-computed style merging the optional accept/hover highlight. */
  highlightStyle: CSSProperties;
}

/**
 * `useDropTarget(accept, onDrop)` — register a drop zone.
 *
 * Returns a ref to attach to the target element, plus reactive `isOver` /
 * `canAccept` flags for callers that want to render their own visuals.
 */
export function useDropTarget<E extends HTMLElement = HTMLDivElement>(
  accept: BerryDragType[],
  onDrop: (payload: BerryDragPayload) => void,
  options: { appId?: string; disabled?: boolean } = {},
): UseDropTargetResult<E> {
  const { appId = 'unknown', disabled } = options;
  const ref = useRef<E | null>(null);
  const reactId = useId();
  const id = `dt-${reactId}`;

  // Stable handler ref so registration doesn't churn.
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  // Memoize accept by content so a fresh array literal each render doesn't
  // re-register the target.
  const acceptKey = useMemo(() => accept.slice().sort().join(','), [accept]);
  const acceptStable = useMemo(() => acceptKey.split(',').filter(Boolean) as BerryDragType[], [acceptKey]);

  useEffect(() => {
    if (disabled) return;
    const target: BerryDropTarget = {
      id,
      accept: acceptStable,
      appId,
      onDrop: p => onDropRef.current(p),
      getRect: () => ref.current?.getBoundingClientRect() ?? null,
    };
    return registerDropTarget(target);
  }, [id, acceptStable, appId, disabled]);

  const currentDrag = dndStore.useSelector(s => s.currentDrag);
  const hoverId = dndStore.useSelector(s => s.hoverTargetId);

  const canAccept = !!currentDrag && acceptStable.includes(currentDrag.type) && !disabled;
  const isOver = canAccept && hoverId === id;

  const highlightStyle = useMemo<CSSProperties>(() => {
    if (!canAccept) return {};
    if (isOver) {
      return {
        boxShadow: 'inset 0 0 0 2px rgba(30, 110, 230, 0.95), 0 0 16px rgba(30, 110, 230, 0.45)',
        outline: '1px solid rgba(30, 110, 230, 0.6)',
        outlineOffset: -1,
        transition: 'box-shadow 100ms ease',
      };
    }
    return {
      boxShadow: 'inset 0 0 0 1.5px rgba(60, 130, 220, 0.45)',
      transition: 'box-shadow 120ms ease',
    };
  }, [canAccept, isOver]);

  return { ref, isOver, canAccept, highlightStyle };
}

// Selector hook used by the drag-ghost overlay.
export function useCurrentDrag(): {
  drag: BerryDragPayload | null;
  cursor: { x: number; y: number } | null;
} {
  const drag = dndStore.useSelector(s => s.currentDrag);
  const cursor = dndStore.useSelector(s => s.cursor);
  return { drag, cursor };
}
