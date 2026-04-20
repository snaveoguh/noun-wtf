// A tiny reactive store for paint session state. Not tied to React.
// React adapter exposes this via useSyncExternalStore.

import type { BrushKind, HexColor, PaintSessionState } from './types.js';

type Listener = (s: PaintSessionState) => void;

export const DEFAULT_PRESETS: HexColor[] = [
  // neon graf palette
  '#ff0044',
  '#ff8800',
  '#ffee00',
  '#00ff88',
  '#00c8ff',
  '#8b5cff',
  '#ff44e0',
  // classic
  '#ffffff',
  '#000000',
  '#888888',
  // earth
  '#8b5a2b',
  '#4caf50',
];

class PaintSessionStore {
  private state: PaintSessionState = {
    brush: 'spray',
    color: '#ff0044',
    size: 22,
    activeSurfaceId: null,
  };

  private recent: HexColor[] = [];

  private readonly listeners = new Set<Listener>();
  private readonly recentListeners = new Set<() => void>();

  get(): PaintSessionState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  subscribeRecent(fn: () => void): () => void {
    this.recentListeners.add(fn);
    return () => this.recentListeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }

  private emitRecent(): void {
    for (const fn of this.recentListeners) fn();
  }

  setBrush(brush: BrushKind): void {
    if (this.state.brush === brush) return;
    this.state = { ...this.state, brush };
    this.emit();
  }

  setColor(color: HexColor): void {
    if (this.state.color === color) return;
    this.state = { ...this.state, color };
    // push to front of recent, dedupe, cap at 8
    this.recent = [color, ...this.recent.filter(c => c !== color)].slice(0, 8);
    this.emit();
    this.emitRecent();
  }

  setSize(size: number): void {
    const s = Math.max(1, Math.min(128, size));
    if (this.state.size === s) return;
    this.state = { ...this.state, size: s };
    this.emit();
  }

  setActive(surfaceId: string | null): void {
    if (this.state.activeSurfaceId === surfaceId) return;
    this.state = { ...this.state, activeSurfaceId: surfaceId };
    this.emit();
  }

  getRecent(): readonly HexColor[] {
    return this.recent;
  }
}

export const paintSession = new PaintSessionStore();
