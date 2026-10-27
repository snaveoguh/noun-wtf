// ── 3D Grand Exchange: walking the floor as yourself, with other players ─
//
// The WALK camera: your Noun World rider on foot (sim/walker.ts drives it,
// render/walkers.ts draws it), a chase camera you drag round, and every
// other player in the Exchange room (net/) walking about live. FloorScene
// owns one of these and calls it at fixed points of its frame; it never
// needs to know about sockets or rigs.
//
// The floor's own 'you' trader (the one the real exchange's fills about
// you animate) is pinned to wherever you walk, and hidden: you are drawn
// once, as your rider.

import type { LabelSpec } from './labels';
import type { NounSeed } from '../../world2/character/NounAppearance';
import type { Trader } from '../sim/crowd';

import * as THREE from 'three';

import { seedKey } from '../../world2/character/NounAppearance';
import { encodeOutfit, type Outfit } from '../../world2/character/outfit';
import { ExchangeNet } from '../net/exchangeNet';
import { PERSONAL } from '../sim/crowd';
import { NO_INPUT, spawnWalker, stepWalker, walkerClip, type WalkInput } from '../sim/walker';

import { LOW } from './crowdMesh';
import { Walkers } from './walkers';

export interface MeLook {
  seed: NounSeed;
  name: string;
  weight: number;
  /** Trousers + shoes as picked in Noun World (null: the Noun's default). */
  outfit: Outfit | null;
}

/** A remote player drawn this frame (for labels, taps and trades). */
export interface PeerView {
  id: string;
  name: string;
  tag: string;
  seedKey: string;
  x: number;
  y: number;
  z: number;
}

type Project = (x: number, y: number, z: number) => { x: number; y: number; ok: boolean };

/** Remote players play back this far in the past (smooth over 10 Hz). */
const INTERP_MS = 140;
/** Most other players drawn at once. */
export const MAX_PEERS = 24;

const KEYS: Record<string, keyof typeof DIRS> = {
  KeyW: 'f',
  ArrowUp: 'f',
  KeyS: 'b',
  ArrowDown: 'b',
  KeyA: 'l',
  ArrowLeft: 'l',
  KeyD: 'r',
  ArrowRight: 'r',
};
const DIRS = { f: 0, b: 0, l: 0, r: 0 };

export class WalkMode {
  readonly walker = spawnWalker();
  readonly walkers = new Walkers();
  readonly net: ExchangeNet | null;
  private held = { ...DIRS };
  private run = false;
  private stick = { side: 0, fwd: 0 };
  look: MeLook;
  /** My outfit's wire key ('' = my Noun's default). */
  private readonly outfitKey: string;
  peers: PeerView[] = [];

  /** `tag`: my public exchange tag (what the other players offer deals to). */
  constructor(look: MeLook, tag: () => string, online: boolean) {
    this.look = look;
    this.outfitKey = look.outfit !== null ? encodeOutfit(look.outfit) : '';
    this.walkers.setMyLook({ seed: look.seed, weight: look.weight, outfit: this.outfitKey });
    this.net = online ? new ExchangeNet(tag) : null;
    this.net?.connect();
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onBlur);
  }

  /** Is this key one of the walk keys (FloorScene leaves those alone while walking)? */
  static isWalkKey(e: KeyboardEvent) {
    return e.code in KEYS || e.key === 'Shift';
  }

  private onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const down = e.type === 'keydown';
    if (e.key === 'Shift') this.run = down;
    const k = KEYS[e.code];
    if (k !== undefined) this.held[k] = down ? 1 : 0;
  };

  private onBlur = () => {
    this.held = { ...DIRS };
    this.run = false;
  };

  /** Touch stick: side / fwd in -1 … 1 (all the way out runs). */
  setStick(side: number, fwd: number) {
    this.stick = { side, fwd };
  }

  input(): WalkInput {
    const kf = this.held.f - this.held.b;
    const ks = this.held.r - this.held.l;
    if (kf !== 0 || ks !== 0) return { fwd: kf, side: ks, run: this.run };
    const m = Math.hypot(this.stick.side, this.stick.fwd);
    if (m < 0.15) return NO_INPUT;
    return { fwd: this.stick.fwd, side: this.stick.side, run: m > 0.92 };
  }

  get moving() {
    const i = this.input();
    return i.fwd !== 0 || i.side !== 0;
  }

  /** Move me (`active`: the WALK camera is on; otherwise I just stand). */
  step(dt: number, camAz: number, active: boolean) {
    stepWalker(this.walker, active ? this.input() : NO_INPUT, camAz, dt);
  }

  /** Pin the floor's 'you' trader to me, so fills about me play where I stand. */
  pin(t: Trader) {
    const w = this.walker;
    t.x = w.x;
    t.z = w.z;
    t.y = w.y;
    t.tx = w.x;
    t.tz = w.z;
    t.heading = w.heading;
    t.speed = 0;
    t.arrived = true;
    t.wait = 1e9;
    t.name = this.look.name.toUpperCase().slice(0, 18) || 'YOU';
  }

  /** Nudge the crowd out of the way of real people (me and the other players). */
  shove(traders: readonly Trader[], youIndex: number) {
    const pts: { x: number; z: number }[] = [{ x: this.walker.x, z: this.walker.z }];
    for (const p of this.peers) pts.push(p);
    const R = PERSONAL + 0.25;
    for (const t of traders) {
      if (t.i === youIndex || t.mode === 'balcony') continue;
      for (const p of pts) {
        const dx = t.x - p.x;
        const dz = t.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2) || 1e-3;
        const k = (R - d) / d;
        t.x += dx * k;
        t.z += dz * k;
      }
    }
  }

  /** Pose my rider and the other players; send my pose. */
  draw(dt: number, visible: boolean) {
    const w = this.walker;
    const clip = walkerClip(w);
    if (visible) this.walkers.me.pose(w.x, w.y, w.z, w.heading, clip, w.speed, dt);
    else this.walkers.me.hide();
    const net = this.net;
    if (net === null) return;
    net.send(dt, {
      x: w.x,
      y: w.y,
      z: w.z,
      yaw: w.heading,
      anim: clip,
      speed: w.speed,
      name: this.look.name,
      seedKey: seedKey(this.look.seed),
      weight: this.look.weight,
      outfit: this.outfitKey,
    });
    net.tick();
    const t = performance.now() - INTERP_MS;
    const out: PeerView[] = [];
    const keep = new Set<string>();
    for (const peer of net.peers.values()) {
      if (out.length >= MAX_PEERS) break;
      const p = peer.buf.sample(t);
      if (p === null) continue;
      keep.add(peer.id);
      const rig = this.walkers.peer(peer.id, p.seedKey, p.weight, p.outfit);
      rig?.pose(p.x, p.y, p.z, p.yaw, p.anim, p.speed, dt);
      out.push({
        id: peer.id,
        name: p.name || 'RIDER',
        tag: p.tag,
        seedKey: p.seedKey,
        x: p.x,
        y: p.y,
        z: p.z,
      });
    }
    this.walkers.prune(keep);
    this.peers = out;
  }

  /** Name tags over the other players (yours is the floor's own 'you' label). */
  labels(project: Project, cam: THREE.Vector3): LabelSpec[] {
    const specs: LabelSpec[] = [];
    const add = (i: number, name: string, x: number, y: number, z: number, you: boolean) => {
      const p = project(x, y + LOW.top + 0.35, z);
      if (!p.ok) return;
      const d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
      if (d > 90) return;
      specs.push({
        i,
        x: p.x,
        y: p.y,
        scale: Math.min(1.15, Math.max(0.62, 1.25 - d / 70)),
        name,
        text: null,
        kind: 'name',
        real: true,
        you,
        followed: false,
        stamp: 0,
        pop: false,
      });
    };
    this.peers.forEach((p, k) =>
      add(-2 - k, `${p.name.toUpperCase()} · PLAYER`, p.x, p.y, p.z, false),
    );
    return specs;
  }

  /** The player under a tap (screen px), if any. */
  pick(project: Project, x: number, y: number, within: number): PeerView | null {
    let best: PeerView | null = null;
    let bestD = within;
    for (const p of this.peers)
      for (const h of [1, 1.6]) {
        const s = project(p.x, p.y + h, p.z);
        if (!s.ok) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
    return best;
  }

  /** A player's name by their public tag (for the offers list). */
  nameOf(tag: string): string | null {
    return this.peers.find(p => p.tag === tag)?.name ?? null;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    this.net?.dispose();
    this.walkers.dispose();
  }
}
