// ── Landmarks at runtime: discoveries, compass, map pins ─────────────────
//
// Exposed on Game as `game.landmarks`. Twice a second it checks whether
// you're at a landmark you haven't found yet; finding one marks it in this
// browser (localStorage) and toasts "LANDMARK FOUND · 3/8". The compass
// shows landmarks within 1.5 km; the map pins every landmark it knows the
// spot of (found ones in colour, unfound ones grey).

import type * as THREE from 'three';

import { LANDMARKS, landmarkPlace } from './sites';

const STORE = 'noun-world-landmarks-v1';

export interface LandmarkHost {
  player: { pos: THREE.Vector3 };
  controlYaw(): number;
  toast(text: string, tag: string): void;
}

export interface LandmarkPin {
  x: number;
  z: number;
  name: string;
  icon: string;
  found: boolean;
}

function load(): Set<string> {
  try {
    const raw = localStorage.getItem(STORE);
    const list = raw === null ? [] : (JSON.parse(raw) as unknown);
    return new Set(
      Array.isArray(list) ? list.filter((q): q is string => typeof q === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

export class LandmarkSystem {
  readonly found = load();
  private checkT = 0;
  private listeners = new Set<() => void>();

  constructor(private host: LandmarkHost) {}

  get total(): number {
    return LANDMARKS.length;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  update(dt: number) {
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = 0.5;
    const p = this.host.player.pos;
    for (const def of LANDMARKS) {
      if (this.found.has(def.id)) continue;
      const pl = landmarkPlace(def);
      if (pl === null) continue;
      const R = pl.r + 30;
      if ((p.x - pl.x) ** 2 + (p.z - pl.z) ** 2 > R * R) continue;
      this.found.add(def.id);
      try {
        localStorage.setItem(STORE, JSON.stringify([...this.found]));
      } catch {
        // private window: found for this visit only
      }
      this.host.toast(
        `${def.icon} ${def.name.toUpperCase()}`,
        `LANDMARK FOUND · ${this.found.size}/${LANDMARKS.length}`,
      );
      for (const fn of this.listeners) fn();
    }
  }

  /** Compass entries for landmarks within reach. */
  compass(lm: { name: string; dist: number; bearing: number }[]) {
    const p = this.host.player.pos;
    for (const def of LANDMARKS) {
      const pl = landmarkPlace(def);
      if (pl === null) continue;
      const dx = pl.x - p.x;
      const dz = pl.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 1500 && d > pl.r + 20)
        lm.push({
          name: `${def.icon} ${def.name}`,
          dist: Math.round(d),
          bearing: Math.atan2(dx, dz) - this.host.controlYaw(),
        });
    }
  }

  /** Map pins. `grow`: place landmarks whose line hasn't grown that far yet (full map only). */
  mapPoints(grow = false): LandmarkPin[] {
    const out: LandmarkPin[] = [];
    for (const def of LANDMARKS) {
      const pl = landmarkPlace(def, grow);
      if (pl === null) continue;
      out.push({ x: pl.x, z: pl.z, name: def.name, icon: def.icon, found: this.found.has(def.id) });
    }
    return out;
  }
}
