// ── PlacedProps — reactive store + wire protocol for BuildMode ────────
//
// A shared, tiny, framework-agnostic store for Fortnite-style placed
// building pieces. The BuildMode component mutates this store; the
// <PlacedProps /> renderer subscribes to it and draws the current list.
//
// Coordinates are Three.js units (same as CityBlock). Conversion to
// tile-world happens inside buildPieces.tsx via useStructure (×10).
//
// Network protocol mirrors the graffiti one:
//   - `world:build:place`     client → server → all: place a new piece
//   - `world:build:update`    client → server → all: patch existing piece
//   - `world:build:remove`    client → server → all: delete a piece by id
//   - `world:build:snapshot`  server → client on join: bulk restore
//
// Remote-sourced messages should call applyRemote* so we don't re-broadcast
// and create message loops.

export type BuildPieceKind = 'wall' | 'floor' | 'ramp' | 'lamp' | 'car' | 'dumpster' | 'bodega';

export interface PlacedProp {
  /** Unique instance id (uuid-like, cheap). */
  id: string;
  kind: BuildPieceKind;
  /** Three.js world x. */
  x: number;
  /** Three.js world z. */
  z: number;
  /** Optional three.js y-offset for stacking (default = ground). */
  y?: number;
  /** Rotation around world-up axis (radians). */
  rotationY: number;
  /** Uniform scale (default 1). */
  scale?: number;
  /** Optional author id for network attribution. */
  authorId?: string;
  /** Epoch ms when placed — used for stable sort in UI. */
  placedAt: number;
}

export interface PlacedPropsStore {
  list(): PlacedProp[];
  subscribe(fn: () => void): () => void;
  add(prop: PlacedProp): void;
  update(id: string, patch: Partial<PlacedProp>): void;
  remove(id: string): void;
  /** Apply from a network message without re-broadcasting. */
  applyRemote(prop: PlacedProp): void;
  applyRemoteRemove(id: string): void;
}

// ── Factory ──────────────────────────────────────────────────────────
//
// We keep the store as a closure over a Map so React's useSyncExternalStore
// works cleanly — getSnapshot returns a stable array reference per version,
// and the subscribe hook only fires listeners on actual mutations.

export function createPlacedPropsStore(): PlacedPropsStore {
  const props = new Map<string, PlacedProp>();
  const listeners = new Set<() => void>();
  // Cached snapshot so useSyncExternalStore doesn't spam re-renders.
  let snapshot: PlacedProp[] = [];
  let snapshotDirty = false;

  const emit = () => {
    snapshotDirty = true;
    for (const fn of listeners) fn();
  };

  const list = (): PlacedProp[] => {
    if (snapshotDirty) {
      snapshot = Array.from(props.values()).sort((a, b) => a.placedAt - b.placedAt);
      snapshotDirty = false;
    }
    return snapshot;
  };

  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };

  const add = (prop: PlacedProp): void => {
    props.set(prop.id, { ...prop });
    emit();
  };

  const update = (id: string, patch: Partial<PlacedProp>): void => {
    const cur = props.get(id);
    if (!cur) return;
    props.set(id, { ...cur, ...patch, id: cur.id });
    emit();
  };

  const remove = (id: string): void => {
    if (!props.delete(id)) return;
    emit();
  };

  const applyRemote = (prop: PlacedProp): void => {
    // Last-writer-wins on the same id.
    props.set(prop.id, { ...prop });
    emit();
  };

  const applyRemoteRemove = (id: string): void => {
    if (!props.delete(id)) return;
    emit();
  };

  return { list, subscribe, add, update, remove, applyRemote, applyRemoteRemove };
}

// ── Wire protocol ────────────────────────────────────────────────────

export type PlacedPropsMessage =
  | { type: 'world:build:place'; prop: PlacedProp }
  | { type: 'world:build:update'; id: string; patch: Partial<PlacedProp> }
  | { type: 'world:build:remove'; id: string }
  | { type: 'world:build:snapshot'; props: PlacedProp[] };

/** Minimal interface so PartySocket & raw WebSocket both fit. */
interface WsSendable {
  readyState: number;
  send(data: string): void;
}

/**
 * Broadcast a build message over the given socket. No-ops if the socket
 * is null or not OPEN — callers shouldn't have to guard.
 */
export function sendPlaced(ws: WebSocket | WsSendable | null, msg: PlacedPropsMessage): void {
  if (!ws) return;
  if (ws.readyState !== 1 /* WebSocket.OPEN */) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // swallow — socket likely closed between the readyState check and send
  }
}

/**
 * Parse an incoming message and narrow it to a PlacedPropsMessage if
 * applicable. Returns null for anything else (graffiti, chat, etc).
 */
export function parseBuildMessage(data: string): PlacedPropsMessage | null {
  try {
    const msg = JSON.parse(data) as { type?: unknown };
    if (
      msg &&
      (msg.type === 'world:build:place' ||
        msg.type === 'world:build:update' ||
        msg.type === 'world:build:remove' ||
        msg.type === 'world:build:snapshot')
    ) {
      return msg as PlacedPropsMessage;
    }
  } catch {
    // not JSON, or not ours
  }
  return null;
}

// ── Tiny id helper ───────────────────────────────────────────────────
//
// Not cryptographic — just unique-ish per client. Good enough for the
// "who placed what" view and for the server to dedupe by id.

export function makePropId(authorId?: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const stamp = Date.now().toString(36);
  const who = authorId ? authorId.slice(0, 6) : 'anon';
  return `b_${who}_${stamp}_${rand}`;
}
