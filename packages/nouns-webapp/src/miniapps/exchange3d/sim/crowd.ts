// ── 3D Grand Exchange: the crowd (pure, seeded) ──────────────────────────
//
// Hundreds of traders on the floor. Each has a home pit and mills on its
// tiers, now and then walks to another pit; floaters roam pit to pit all the
// time, spectators pace the balcony. The trade scheduler can take a trader
// over ("held": walk to this spot, face that way) and hand it back.
// Separation uses a uniform grid, so a step is O(n).
//
// No three.js and no clock: `step(dt)` is all there is, so tests drive it.

import type { Seed } from './looks';

import { rngFrom, type Rng } from '../../exchange/engine/rng';

import {
  BALCONY_LEN,
  BALCONY_Y,
  balconyPoint,
  clampToFloor,
  DOOR,
  floorHeight,
  HALL_D,
  HALL_W,
  PIT_OUTER_RINGS,
  PIT_STEPS,
  pitSpot,
  TOWER_CLEAR,
  PITS,
} from './layout';

export type TraderKind = 'sim' | 'bot' | 'rider' | 'you';
export type TraderMode = 'mill' | 'roam' | 'held' | 'balcony';

export interface Trader {
  i: number;
  /** 'sim:12', 'bot:abacus', 'r:3f2a9c' (a masked rider) or 'you'. */
  id: string;
  kind: TraderKind;
  /** Shown above the head (real traders); null for the sim crowd. */
  name: string | null;
  seed: Seed;
  /** Home pit index. */
  home: number;
  mode: TraderMode;
  /** Roams pit to pit instead of settling. */
  floater: boolean;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Speed this step (m/s) and the walk blend (0 standing … 1 walking). */
  speed: number;
  walk: number;
  /** Walk cycle phase (rad). */
  phase: number;
  tx: number;
  tz: number;
  /** Face this way once arrived (rad, null = face the pit's middle). */
  face: number | null;
  /** Seconds left standing before choosing a new spot. */
  wait: number;
  hurry: boolean;
  arrived: boolean;
  /** Trade id holding this trader, or -1. */
  held: number;
  /** Seconds left of a cheer (jumps) and of an arm-pumping shout. */
  cheer: number;
  shout: number;
  /** Balcony arc position and where it is pacing to. */
  bs: number;
  bt: number;
  /** Last time (crowd clock, s) this trader did something real. */
  active: number;
}

export interface CrowdOpts {
  /** Simulated crowd size (real traders are added on top). */
  count: number;
  seed?: number;
  /** Share of the sim crowd up on the balcony, and roaming between pits. */
  balcony?: number;
  floaters?: number;
  /** Seed for a sim trader (the view supplies one over the real art). */
  look: (id: string) => Seed;
}

export const SPEED = { mill: 1.05, roam: 1.45, hurry: 2.7, balcony: 0.8 } as const;
/** Two traders closer than this push apart. */
export const PERSONAL = 0.95;
const CELL = 2;
const GX = Math.ceil(HALL_W / CELL);
const GZ = Math.ceil(HALL_D / CELL);
const TURN = 7;

export class Crowd {
  readonly traders: Trader[] = [];
  /** Crowd clock (s). */
  t = 0;
  private rng: Rng;
  private readonly look: (id: string) => Seed;
  private head = new Int32Array(GX * GZ);
  private next = new Int32Array(0);
  private byId = new Map<string, Trader>();

  constructor(o: CrowdOpts) {
    this.rng = rngFrom(o.seed ?? 11);
    this.look = o.look;
    const nb = Math.round(o.count * (o.balcony ?? 0.1));
    const nf = Math.round(o.count * (o.floaters ?? 0.1));
    for (let k = 0; k < o.count; k++) {
      const t = this.make(`sim:${k}`, 'sim', null, this.look(`sim:${k}`), k % PITS.length);
      if (k < nb) {
        t.mode = 'balcony';
        t.bs = this.rng() * BALCONY_LEN;
        t.bt = t.bs;
        const p = balconyPoint(t.bs);
        t.x = p.x;
        t.z = p.z;
        t.y = BALCONY_Y;
        t.heading = p.face;
      } else {
        t.floater = k < nb + nf;
        this.pickSpot(t);
        t.x = t.tx;
        t.z = t.tz;
        t.y = floorHeight(t.x, t.z);
        t.wait = this.rng() * 4;
        t.arrived = true;
      }
    }
  }

  get(id: string): Trader | undefined {
    return this.byId.get(id);
  }

  private make(id: string, kind: TraderKind, name: string | null, seed: Seed, home: number) {
    const t: Trader = {
      i: this.traders.length,
      id,
      kind,
      name,
      seed,
      home,
      mode: 'mill',
      floater: false,
      x: 0,
      y: 0,
      z: 0,
      heading: this.rng() * Math.PI * 2,
      speed: 0,
      walk: 0,
      phase: this.rng() * Math.PI * 2,
      tx: 0,
      tz: 0,
      face: null,
      wait: 0,
      hurry: false,
      arrived: false,
      held: -1,
      cheer: 0,
      shout: 0,
      bs: 0,
      bt: 0,
      active: -Infinity,
    };
    this.traders.push(t);
    this.byId.set(id, t);
    return t;
  }

  /**
   * A real trader (bot, rider, you). New ones walk in through the door.
   * `reuse` (a trader index) replaces that slot instead of growing the
   * crowd (the view caps how many riders it shows).
   */
  addReal(
    id: string,
    kind: Exclude<TraderKind, 'sim'>,
    name: string | null,
    seed: Seed,
    home: number,
    reuse?: number,
  ): Trader {
    const hit = this.byId.get(id);
    if (hit !== undefined) return hit;
    let t: Trader;
    if (reuse !== undefined && this.traders[reuse] !== undefined) {
      t = this.traders[reuse]!;
      this.byId.delete(t.id);
      Object.assign(t, { id, kind, name, seed, home, mode: 'mill', floater: false, held: -1 });
      this.byId.set(id, t);
    } else t = this.make(id, kind, name, seed, home);
    const door = clampToFloor(DOOR.x + (this.rng() - 0.5) * 6, DOOR.z);
    t.x = door.x;
    t.z = door.z;
    t.y = 0;
    t.heading = Math.PI / 2;
    t.active = this.t;
    this.pickSpot(t);
    return t;
  }

  /**
   * A trader's mill spot: a random tier of its home pit, or the floor just
   * outside its rim. Every ninth sim trader is a board-watcher instead: it
   * stands round the central tower, looking up at the prices.
   */
  private pickSpot(t: Trader) {
    t.face = null;
    t.arrived = false;
    t.hurry = false;
    if (t.kind === 'sim' && !t.floater && t.i % 9 === 4) {
      const a = this.rng() * Math.PI * 2;
      const r = TOWER_CLEAR + 1 + this.rng() * 9;
      t.tx = Math.cos(a) * r;
      t.tz = Math.sin(a) * r;
      t.face = Math.atan2(-t.tx, -t.tz);
      return;
    }
    const p = PITS[t.home % PITS.length]!;
    const s = 1 + Math.floor(this.rng() * (PIT_STEPS + PIT_OUTER_RINGS));
    const at = pitSpot(p, this.rng() * Math.PI * 2, s);
    t.tx = at.x;
    t.tz = at.z;
  }

  /** Send a free trader to a pit (a bot moving to where its orders are). */
  sendToPit(t: Trader, pit: number) {
    if (t.mode === 'held' || t.mode === 'balcony') return;
    if (t.home === pit && t.mode === 'mill') return;
    t.home = pit;
    t.mode = 'roam';
    this.pickSpot(t);
  }

  /** The scheduler takes a trader: walk (hurry) to x,z and face `face`. */
  hold(t: Trader, trade: number, x: number, z: number, face: number, hurry = true) {
    if (t.mode === 'balcony') return;
    const c = clampToFloor(x, z);
    t.mode = 'held';
    t.held = trade;
    t.tx = c.x;
    t.tz = c.z;
    t.face = face;
    t.hurry = hurry;
    t.arrived = false;
  }

  release(t: Trader, trade: number) {
    if (t.held !== trade) return;
    t.held = -1;
    t.mode = 'mill';
    t.wait = 1 + this.rng() * 2;
    t.arrived = true;
    t.tx = t.x;
    t.tz = t.z;
    t.face = null;
  }

  /** Everyone within r of a point cheers for `secs`. */
  cheerNear(x: number, z: number, r: number, secs: number) {
    const r2 = r * r;
    for (const t of this.traders) {
      if (t.mode === 'balcony') continue;
      const dx = t.x - x;
      const dz = t.z - z;
      if (dx * dx + dz * dz < r2) t.cheer = Math.max(t.cheer, secs * (0.6 + this.rng() * 0.4));
    }
  }

  /** Is this trader free for the scheduler (not held, not up on the balcony)? */
  free(t: Trader) {
    return t.mode !== 'held' && t.mode !== 'balcony';
  }

  step(dt: number) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const n = this.traders.length;
    if (this.next.length < n) this.next = new Int32Array(Math.max(n, this.next.length * 2));
    for (let i = 0; i < n; i++) this.steer(this.traders[i]!, dt);
    this.separate(dt);
    for (let i = 0; i < n; i++) this.settle(this.traders[i]!, dt);
  }

  private steer(t: Trader, dt: number) {
    t.cheer = Math.max(0, t.cheer - dt);
    t.shout = Math.max(0, t.shout - dt);
    if (t.mode === 'balcony') {
      const d = t.bt - t.bs;
      if (Math.abs(d) < 0.2) {
        t.speed = 0;
        t.wait -= dt;
        if (t.wait <= 0) {
          t.bt = t.bs + (this.rng() - 0.5) * 30;
          t.wait = 3 + this.rng() * 8;
        }
      } else {
        const v = Math.sign(d) * Math.min(Math.abs(d) / dt, SPEED.balcony);
        t.bs += v * dt;
        t.speed = Math.abs(v);
      }
      const p = balconyPoint(t.bs);
      t.x = p.x;
      t.z = p.z;
      t.y = BALCONY_Y;
      return;
    }
    const dx = t.tx - t.x;
    const dz = t.tz - t.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) {
      t.speed = 0;
      if (!t.arrived) {
        t.arrived = true;
        t.wait = t.mode === 'roam' ? 1 + this.rng() * 3 : 1.5 + this.rng() * 5;
        if (t.mode === 'roam') t.mode = 'mill';
      }
      if (t.mode !== 'held') {
        t.wait -= dt;
        if (t.wait <= 0) this.wander(t);
      }
      return;
    }
    const v = Math.min(
      d / dt,
      t.hurry ? SPEED.hurry : t.mode === 'roam' ? SPEED.roam : SPEED.mill * (0.8 + (t.i % 5) * 0.1),
    );
    t.speed = v;
    t.x += (dx / d) * v * dt;
    t.z += (dz / d) * v * dt;
    t.phase += v * dt * 2.8;
  }

  /** Time to move on: another spot in the pit, or off to another pit. */
  private wander(t: Trader) {
    const r = this.rng();
    if (t.floater || r < 0.07) {
      let p = Math.floor(this.rng() * PITS.length);
      if (p === t.home) p = (p + 1) % PITS.length;
      t.home = p;
      t.mode = 'roam';
    }
    this.pickSpot(t);
  }

  private separate(dt: number) {
    const head = this.head;
    const next = this.next;
    head.fill(-1);
    const ts = this.traders;
    const cellOf = (x: number, z: number) => {
      const cx = Math.min(GX - 1, Math.max(0, Math.floor((x + HALL_W / 2) / CELL)));
      const cz = Math.min(GZ - 1, Math.max(0, Math.floor((z + HALL_D / 2) / CELL)));
      return cz * GX + cx;
    };
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i]!;
      if (t.mode === 'balcony') continue;
      const c = cellOf(t.x, t.z);
      next[i] = head[c]!;
      head[c] = i;
    }
    const P2 = PERSONAL * PERSONAL;
    const k = Math.min(1, dt * 8);
    for (let i = 0; i < ts.length; i++) {
      const a = ts[i]!;
      if (a.mode === 'balcony') continue;
      const cx = Math.floor((a.x + HALL_W / 2) / CELL);
      const cz = Math.floor((a.z + HALL_D / 2) / CELL);
      for (let oz = -1; oz <= 1; oz++)
        for (let ox = -1; ox <= 1; ox++) {
          const x = cx + ox;
          const z = cz + oz;
          if (x < 0 || z < 0 || x >= GX || z >= GZ) continue;
          for (let j = head[z * GX + x]!; j !== -1; j = next[j]!) {
            if (j <= i) continue;
            const b = ts[j]!;
            let dx = b.x - a.x;
            let dz = b.z - a.z;
            let d2 = dx * dx + dz * dz;
            if (d2 >= P2) continue;
            if (d2 < 1e-8) {
              dx = Math.cos(i + j);
              dz = Math.sin(i + j);
              d2 = 1e-4;
            }
            const d = Math.sqrt(d2);
            const push = ((PERSONAL - d) / d) * 0.5 * k;
            // Held traders (mid trade) give way less, so they reach their spot
            const wa = a.mode === 'held' ? 0.3 : 1;
            const wb = b.mode === 'held' ? 0.3 : 1;
            a.x -= dx * push * wa;
            a.z -= dz * push * wa;
            b.x += dx * push * wb;
            b.z += dz * push * wb;
          }
        }
    }
  }

  private settle(t: Trader, dt: number) {
    if (t.mode !== 'balcony') {
      const c = clampToFloor(t.x, t.z);
      t.x = c.x;
      t.z = c.z;
      const fh = floorHeight(t.x, t.z);
      t.y += (fh - t.y) * Math.min(1, dt * 12);
    }
    // Face where you walk; standing, face the pit's middle (or as told)
    let want: number;
    if (t.mode === 'balcony') want = balconyPoint(t.bs).face;
    else if (t.speed > 0.15) want = Math.atan2(t.tx - t.x, t.tz - t.z);
    else if (t.face !== null) want = t.face;
    else {
      const p = PITS[t.home % PITS.length]!;
      want = Math.atan2(p.x - t.x, p.z - t.z);
    }
    let d = want - t.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    t.heading += Math.sign(d) * Math.min(Math.abs(d), TURN * dt);
    t.walk += ((t.speed > 0.15 ? 1 : 0) - t.walk) * Math.min(1, dt * 6);
  }
}
