// ── The cypher's crowd: a ring of Nouns bobbing to the beat ─────────────
//
// Each one plays the rig's dance clip driven off the beat clock (its own
// offset, some half-time) or the idle, faces the middle, and reacts on top
// with its arms: "ohhh" (hands up beside the head, a hop) on big moves,
// both hands up on freezes, a groan (hands down, lean back) on crashes.

import * as THREE from 'three';

import { aimBone, NounCharacter, type CharacterAssets } from '../../character/NounCharacter';

import { hashStr, seedOf } from './dancer';

export type Reaction = 'ooh' | 'hands' | 'groan' | 'clap';

interface Arm {
  upper: THREE.Object3D;
  fore: THREE.Object3D;
  hand: THREE.Object3D;
  sx: number;
}

interface Fan {
  ch: NounCharacter;
  arms: Arm[];
  base: THREE.Vector3;
  yaw: number;
  /** Beat offset / tempo style. */
  off: number;
  half: boolean;
  idle: boolean;
  react: Reaction | null;
  reactT: number;
  /** Per-fan delay before reacting (a ripple round the ring). */
  delay: number;
  hop: number;
}

const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** Crowd spots on a ring, leaving gaps for the DJ (+z) and the judges (−z). */
export function crowdSpots(n: number, seed = 1): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  // Two arcs: left (x > 0) and right (x < 0), each from 38° off +z to 40° off −z
  const lo = (38 * Math.PI) / 180;
  const hi = Math.PI - (40 * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const k = Math.floor(i / 2);
    const per = Math.ceil(n / 2);
    const row = (hashStr(`${seed}:${i}`) % 3) * 0.55;
    const a = lo + ((k + 0.5) / per) * (hi - lo) + ((hashStr(`a${i}`) % 100) / 100 - 0.5) * 0.12;
    const r = 5.5 + row;
    const x = side * Math.sin(a) * r;
    const z = Math.cos(a) * r;
    out.push({ x, z, yaw: Math.atan2(-x, -z) });
  }
  return out;
}

export class Crowd {
  readonly group = new THREE.Group();
  private fans: Fan[] = [];

  /** Spots still to fill: a Noun build is a hitch, so the crowd arrives one a frame. */
  private pending: { x: number; z: number; yaw: number; i: number }[];

  constructor(
    private assets: CharacterAssets,
    n: number,
    private shadows: boolean,
  ) {
    this.group.name = 'BreakCrowd';
    this.pending = crowdSpots(n).map((s, i) => ({ ...s, i }));
  }

  private buildFan(s: { x: number; z: number; yaw: number; i: number }) {
    const { assets, shadows } = this;
    {
      const i = s.i;
      const id = `crowd:${i}`;
      const ch = new NounCharacter(seedOf(null, id), assets);
      ch.board.visible = false;
      if (!shadows) ch.setCastShadows(false);
      ch.root.position.set(s.x, 0, s.z);
      ch.root.quaternion.setFromAxisAngle(UP, s.yaw);
      this.group.add(ch.root);
      const h = hashStr(id);
      const arms: Arm[] = [];
      for (const [side, sx] of [
        ['l', 1],
        ['r', -1],
      ] as const) {
        const f = (nm: string) => {
          let hit: THREE.Object3D | null = null;
          ch.body.traverse(o => {
            if (hit === null && o.name.replace(/[.:_]/g, '').toLowerCase() === nm) hit = o;
          });
          return hit as THREE.Object3D | null;
        };
        const upper = f(`upperarm${side}`);
        const fore = f(`forearm${side}`);
        const hand = f(`hand${side}`);
        if (upper !== null && fore !== null && hand !== null) arms.push({ upper, fore, hand, sx });
      }
      this.fans.push({
        ch,
        arms,
        base: ch.root.position.clone(),
        yaw: s.yaw,
        off: h % 4,
        half: (h >>> 4) % 3 === 0,
        idle: (h >>> 7) % 6 === 0,
        react: null,
        reactT: 0,
        delay: (((h >>> 9) % 100) / 100) * 0.35,
        hop: 0,
      });
    }
  }

  /** Everyone reacts (with a little ripple). */
  react(r: Reaction, strength = 1) {
    for (const f of this.fans) {
      if (strength < 1 && Math.random() > strength) continue;
      f.react = r;
      f.reactT = -f.delay;
    }
  }

  update(dt: number, beat: number, hype: number) {
    const next = this.pending.shift();
    if (next !== undefined) this.buildFan(next);
    for (const f of this.fans) {
      const ph = f.half ? beat / 8 : beat / 4;
      const t = ((((ph + f.off / 4) % 1) + 1) % 1) * 2;
      if (f.idle && hype < 0.6 && f.react === null) f.ch.play({ clip: 'idle', fade: 0.4 });
      else f.ch.play({ clip: 'dance', fade: 0.4, time: t, timeScale: 0 });
      f.ch.update(dt, { lean: 0, travelled: 0, riding: false });
      // Reactions on top of the clip
      let w = 0;
      if (f.react !== null) {
        f.reactT += dt;
        const len = f.react === 'clap' ? 2.2 : 1.6;
        w =
          f.reactT < 0
            ? 0
            : Math.min(1, f.reactT * 6) *
              (1 - THREE.MathUtils.smoothstep(f.reactT, len - 0.4, len));
        if (f.reactT > len) f.react = null;
      }
      const jumpTo = f.react === 'ooh' || f.react === 'hands' ? w : 0;
      f.hop += (jumpTo - f.hop) * (1 - Math.exp(-10 * dt));
      const bob = Math.max(0, Math.sin(Math.PI * 2 * (beat + f.off * 0.25))) * 0.03 * hype;
      f.ch.root.position.set(
        f.base.x,
        bob + (f.react === 'ooh' ? Math.abs(Math.sin(f.reactT * 9)) * 0.12 * f.hop : f.hop * 0.05),
        f.base.z,
      );
      if (w > 0.01 && f.react !== null) this.poseArms(f, f.react, w, beat);
    }
  }

  private poseArms(f: Fan, r: Reaction, w: number, beat: number) {
    const root = f.ch.root;
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(_q);
    for (const a of f.arms) {
      const sx = a.sx;
      let up: THREE.Vector3;
      let lo: THREE.Vector3;
      switch (r) {
        case 'ooh':
          // Hands up by the sides of the big head
          up = new THREE.Vector3(sx * 0.8, 0.55, 0.25);
          lo = new THREE.Vector3(sx * 0.15, 0.95, 0.25);
          break;
        case 'hands':
          up = new THREE.Vector3(sx * 0.7, 0.7, 0.15);
          lo = new THREE.Vector3(sx * 0.45, 0.88, 0.1);
          break;
        case 'groan':
          up = new THREE.Vector3(sx * 0.35, -0.9, -0.2);
          lo = new THREE.Vector3(sx * 0.1, -0.95, 0.2);
          break;
        case 'clap': {
          const c = Math.abs(Math.sin(Math.PI * beat * 2));
          up = new THREE.Vector3(sx * 0.45, -0.1, 0.9);
          lo = new THREE.Vector3(-sx * (0.25 + 0.5 * c), 0.25, 0.85);
          break;
        }
      }
      aimBone(a.upper, a.fore, _d.copy(up).normalize().applyQuaternion(_q), w);
      aimBone(a.fore, a.hand, _d.copy(lo).normalize().applyQuaternion(_q), w);
    }
  }

  dispose() {
    for (const f of this.fans) f.ch.dispose();
    this.fans = [];
    this.pending = [];
    this.group.removeFromParent();
  }
}
