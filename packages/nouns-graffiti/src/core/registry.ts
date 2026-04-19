// Registry — lookup Surface by id; emits events on mount/unmount.
// Single global instance per window; consumers interact via getSurface / createSurface.

import { Surface } from './surface.js';

type Listener = (surfaceId: string) => void;

class SurfaceRegistry {
  private readonly map = new Map<string, Surface>();
  private readonly addListeners = new Set<Listener>();
  private readonly removeListeners = new Set<Listener>();

  get(id: string): Surface | undefined {
    return this.map.get(id);
  }

  /** Return an existing surface or create one at the given resolution. */
  getOrCreate(id: string, width: number, height: number): Surface {
    let s = this.map.get(id);
    if (!s) {
      s = new Surface({ id, width, height });
      this.map.set(id, s);
      for (const fn of this.addListeners) fn(id);
    }
    return s;
  }

  remove(id: string): void {
    if (this.map.delete(id)) {
      for (const fn of this.removeListeners) fn(id);
    }
  }

  all(): Surface[] {
    return Array.from(this.map.values());
  }

  onAdd(fn: Listener): () => void {
    this.addListeners.add(fn);
    return () => this.addListeners.delete(fn);
  }

  onRemove(fn: Listener): () => void {
    this.removeListeners.add(fn);
    return () => this.removeListeners.delete(fn);
  }
}

export const surfaces = new SurfaceRegistry();
