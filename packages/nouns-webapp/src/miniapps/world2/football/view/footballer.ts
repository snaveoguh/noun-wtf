// ── A footballer: a Noun rider in kit, posed for every Action ───────────
//
// NounCharacter from the seed key (no board), dressed in the team's kit:
// the shirt is a small per-player canvas (team colour, collar trim, a
// noggles crest, the number big on the back and small on the chest),
// sleeves in the shirt colour, shorts + socks from the team (the outfit
// system's shorts split the trousers into shorts / skin / sock groups),
// black boots. The keeper wears the keeper colour.
//
// Every frame the view hands in the PlayerState; the bones are posed
// procedurally through breakdance's PoseDriver from poses.ts (no clips, no
// mixer: the rig's clips would be thrown away), the stride phase comes from
// distance travelled so feet don't skate, the kicking foot is latched to
// the side the ball is on when a kick starts, and actions crossfade.
// How often a footballer is solved is the view's call (lod.ts).

import type { PoseOut } from '../../breakdance/view/pose';
import type { Action, BallState, Footballer, PlayerState, TeamKit } from '../contract';

import * as THREE from 'three';

import { PoseDriver, type Layer } from '../../breakdance/view/rig';
import { parseSeedKey, type NounSeed } from '../../character/NounAppearance';
import { NounCharacter, type CharacterAssets } from '../../character/NounCharacter';
import { SHOE_COLORS, type Outfit } from '../../character/outfit';
import { MINOR_CAP, textureDiet } from '../../render/textureDiet';
import { toToon, toonify } from '../../render/Toon';

import { inkOn } from './hudFormat';
import { advanceStride, footballPose, kickSide, snappy, type PoseIn } from './poses';

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The footballer's Noun: their seed key, or a stand-in from the id (bots without one). */
export function seedFor(seedKey: string, id: string): NounSeed {
  const s = seedKey !== '' ? parseSeedKey(seedKey) : null;
  if (s !== null) return s;
  const h = hashStr(id);
  const h2 = hashStr(`${id}#`);
  return {
    background: h % 2,
    body: (h >>> 3) % 30,
    accessory: (h >>> 9) % 140,
    head: h2 % 240,
    glasses: (h2 >>> 11) % 20,
  };
}

const BLACK_BOOT = Math.max(
  0,
  SHOE_COLORS.findIndex(s => s.name === 'BLACK'),
);
/** Shorts + boots; the colours are replaced by the kit. */
const KIT_OUTFIT: Outfit = {
  pants: 'shorts',
  pantsColor: 0,
  shoes: 'runner',
  shoeColor: BLACK_BOOT,
};

const hex = (n: number) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;

/** Lighter / darker shade of a kit colour (trim). */
function trimOf(shirt: number, shorts: number): number {
  return Math.abs(shirt - shorts) < 0x202020 ? (shirt ^ 0xffffff) & 0xffffff : shorts;
}

type Region = [number, number, number, number];

/** The shirt canvas: team colour, collar trim, crest, number on the back (and small on the chest). */
export function paintShirt(
  ctx: CanvasRenderingContext2D,
  size: number,
  shirt: number,
  trim: number,
  num: number,
  regions: { front: Region; back: Region },
) {
  ctx.fillStyle = hex(shirt);
  ctx.fillRect(0, 0, size, size);
  const ink = inkOn(shirt);
  const px = (r: Region) => ({
    x: r[0] * size,
    y: r[1] * size,
    w: (r[2] - r[0]) * size,
    h: (r[3] - r[1]) * size,
  });
  const f = px(regions.front);
  const b = px(regions.back);
  // Collar bands
  ctx.fillStyle = hex(trim);
  ctx.fillRect(f.x, f.y, f.w, f.h * 0.07);
  ctx.fillRect(b.x, b.y, b.w, b.h * 0.07);
  // V-neck notch
  ctx.beginPath();
  ctx.moveTo(f.x + f.w * 0.38, f.y);
  ctx.lineTo(f.x + f.w * 0.5, f.y + f.h * 0.17);
  ctx.lineTo(f.x + f.w * 0.62, f.y);
  ctx.closePath();
  ctx.fill();
  // Side stripes down the front
  ctx.fillRect(f.x, f.y, f.w * 0.06, f.h);
  ctx.fillRect(f.x + f.w * 0.94, f.y, f.w * 0.06, f.h);
  // Noggles crest over the heart (the character's left = image right on the front)
  const cx = f.x + f.w * 0.7;
  const cy = f.y + f.h * 0.28;
  const u = Math.max(1, f.w * 0.035);
  ctx.fillStyle = '#e5242b';
  ctx.fillRect(cx - u * 4, cy, u * 3, u * 2.4);
  ctx.fillRect(cx + u * 0.6, cy, u * 3, u * 2.4);
  ctx.fillRect(cx - u, cy + u * 0.6, u * 1.6, u * 0.7);
  ctx.fillStyle = '#fff';
  ctx.fillRect(cx - u * 3.4, cy + u * 0.5, u, u * 1.4);
  ctx.fillRect(cx + u * 1.2, cy + u * 0.5, u, u * 1.4);
  // Numbers
  const text = String(num);
  const draw = (x: number, y: number, h: number) => {
    ctx.font = `900 ${Math.round(h)}px 'Arial Black',Impact,'Londrina Solid',sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1, h * 0.12);
    ctx.strokeStyle = hex(trim);
    ctx.strokeText(text, x, y);
    ctx.fillStyle = ink;
    ctx.fillText(text, x, y);
  };
  draw(b.x + b.w / 2, b.y + b.h * 0.5, b.h * 0.58);
  draw(f.x + f.w * 0.3, f.y + f.h * 0.3, f.h * 0.16);
}

/** Team materials shared by every footballer on a side (sleeves, shorts, socks). */
export class KitBank {
  private mats = new Map<string, THREE.Material>();
  private owned = new Set<THREE.Material>();
  private textures: THREE.Texture[] = [];

  constructor(readonly toon: boolean) {}

  /** A material this bank owns, in toon form when the world is toon-shaded (both tracked). */
  own(m: THREE.MeshStandardMaterial): THREE.Material {
    this.owned.add(m);
    if (!this.toon) return m;
    const t = toToon(m);
    this.owned.add(t);
    return t;
  }

  owns(m: THREE.Material) {
    return this.owned.has(m);
  }

  /** A shared flat team material (sleeves, shorts, socks). */
  mat(key: string, color: number): THREE.Material {
    let m = this.mats.get(key);
    if (m === undefined) {
      m = this.own(new THREE.MeshStandardMaterial({ color, roughness: 0.82, name: `fb-${key}` }));
      this.mats.set(key, m);
    } else (m as THREE.MeshStandardMaterial).color.setHex(color);
    return m;
  }

  /** A footballer's own shirt texture (tracked for disposal). */
  shirt(
    kitColor: number,
    trim: number,
    num: number,
    regions: { front: Region; back: Region },
  ): THREE.Texture {
    const size = textureDiet.on ? Math.min(128, MINOR_CAP) : 128;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    paintShirt(g, size, kitColor, trim, num, regions);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.anisotropy = 2;
    this.textures.push(t);
    return t;
  }

  /** Free one footballer's own material (its shirt). */
  drop(m: THREE.Material) {
    if (!this.owned.delete(m)) return;
    m.dispose();
  }

  release(t: THREE.Texture) {
    const i = this.textures.indexOf(t);
    if (i >= 0) this.textures.splice(i, 1);
    t.dispose();
  }

  dispose() {
    for (const m of this.owned) m.dispose();
    for (const t of this.textures) t.dispose();
    this.owned.clear();
    this.textures = [];
    this.mats.clear();
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

const findIn = (root: THREE.Object3D, name: string) => {
  let hit: THREE.Object3D | null = null;
  root.traverse(o => {
    if (hit === null && o.name.replace(/[.:_]/g, '').toLowerCase() === name) hit = o;
  });
  return hit as THREE.Object3D | null;
};

/** Actions that read the ball's side when they start (the foot that plays it). */
const FOOTED = new Set<Action>([
  'pass',
  'lob',
  'shoot',
  'volley',
  'trap',
  'tackle',
  'slide',
  'skill',
  'gk_kick',
]);

export class FootballerView {
  readonly ch: NounCharacter;
  readonly root: THREE.Group;
  readonly keeper: boolean;
  readonly hash: number;
  /** Last state drawn. */
  s: PlayerState | null = null;
  /** Stride phase (cycles). */
  phase = 0;
  side: 1 | -1 = -1;
  /** Extra celebration variety (the view bumps it per goal). */
  celebrate = 0;
  /** Seconds since the last pose solve (skipped frames add up). */
  private pending = 0;
  private driver: PoseDriver | null = null;
  private headRef: unknown = undefined;
  private lastAction: Action | '' = '';
  private cur: PoseOut | null = null;
  private prev: PoseOut | null = null;
  private xk = 1;
  private lastX = NaN;
  private lastZ = NaN;
  private hands: [THREE.Object3D | null, THREE.Object3D | null] = [null, null];
  private shirtTex: THREE.Texture | null = null;
  private bodyMats: THREE.Material[] = [];
  private poseIn: PoseIn = {
    action: 'idle',
    t: 0,
    dir: 0,
    speed: 0,
    phase: 0,
    side: -1,
    time: 0,
    variant: 0,
  };

  constructor(
    readonly f: Footballer,
    kit: TeamKit,
    assets: CharacterAssets,
    private bank: KitBank,
    toon: boolean,
    shadows: boolean,
  ) {
    this.keeper = f.role === 'GK';
    this.hash = hashStr(f.id);
    this.ch = new NounCharacter(seedFor(f.seedKey, f.id), assets);
    this.root = this.ch.root;
    this.root.name = `footballer-${f.id}`;
    this.ch.board.visible = false;
    // The game's distance LOD hides Nouns past 45–60 m on phones: the
    // broadcast camera sits further off than that. This view does its own.
    this.ch.noLod = true;
    this.ch.setOutfit(KIT_OUTFIT);
    this.dress(kit, assets);
    // The kit is already toon (the bank's); this converts the rest (skin, boots, head)
    if (toon) toonify(this.root);
    this.ch.setCastShadows(shadows);
    this.hands = [findIn(this.ch.body, 'handl'), findIn(this.ch.body, 'handr')];
    this.phase = (this.hash % 1000) / 1000;
  }

  /** Put the kit on (also on a kit change between matches). */
  dress(kit: TeamKit, assets: CharacterAssets) {
    const shirt = this.keeper ? kit.keeper : kit.shirt;
    const trim = trimOf(shirt, this.keeper ? 0x0b0b12 : kit.shorts);
    const regions = assets.manifest.uvRegions ?? {};
    const front = (regions.front ?? [0, 0, 0.4375, 0.4375]) as Region;
    const back = (regions.back ?? [0.5, 0, 0.9375, 0.4375]) as Region;
    if (this.shirtTex !== null) this.bank.release(this.shirtTex);
    this.shirtTex = this.bank.shirt(shirt, trim, this.f.number, { front, back });
    const team = `t${this.f.team}${this.keeper ? 'k' : ''}`;
    const sleeve = this.bank.mat(`${team}-sleeve`, shirt);
    const shorts = this.bank.mat(`${team}-shorts`, this.keeper ? 0x1b1b22 : kit.shorts);
    const socks = this.bank.mat(`${team}-socks`, this.keeper ? shirt : kit.socks);
    for (const m of this.bodyMats) this.bank.drop(m);
    this.bodyMats = [];
    this.ch.body.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const name = (list[0]?.name ?? '').toLowerCase();
      if (/nounpants|-shorts$/.test(name) && list.length >= 3) {
        // Shorts split: [cloth, skin, sock]
        mesh.material = [shorts, list[1], socks];
        return;
      }
      const out = list.map(m => {
        const n = (m.name ?? '').toLowerCase();
        if (/nounbody/.test(n)) {
          const std = new THREE.MeshStandardMaterial({
            name: m.name,
            map: this.shirtTex,
            roughness: 0.85,
          });
          const b = this.bank.own(std);
          this.bodyMats.push(std, b);
          return b;
        }
        if (/sleeve/.test(n)) return sleeve;
        return m;
      });
      mesh.material = Array.isArray(mesh.material) ? out : out[0];
    });
  }

  /** Hands' midpoint (in the root's parent space), for a held ball. */
  handsAt(out: THREE.Vector3): THREE.Vector3 {
    const [l, r] = this.hands;
    const parent = this.root.parent;
    if (l === null || r === null || parent === null) {
      out.set(0, 1.1, 0.3).applyQuaternion(this.root.quaternion).add(this.root.position);
      return out;
    }
    l.getWorldPosition(_a);
    r.getWorldPosition(_b);
    out.addVectors(_a, _b).multiplyScalar(0.5);
    return out.applyMatrix4(_m.copy(parent.matrixWorld).invert());
  }

  /**
   * Place + pose for this frame. `pose`: solve the bones now (else they
   * hold; the time adds up); `blend`: crossfade between actions.
   */
  update(p: PlayerState, ball: BallState, dt: number, time: number, pose: boolean, blend: boolean) {
    this.s = p;
    const ch = this.ch;
    // Place
    this.root.position.set(p.x, p.y, p.z);
    this.root.quaternion.setFromAxisAngle(UP, p.yaw);
    this.root.visible = p.off !== true;
    // Stride from ground actually covered (velocity when standing still on a treadmill: the contact sheet)
    const speed = Math.hypot(p.vx, p.vz);
    let moved = Number.isNaN(this.lastX) ? 0 : Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    if (moved > 3) moved = 0; // a teleport (restart placement, replay cut)
    if (moved < speed * dt * 0.2) moved = speed * dt;
    this.lastX = p.x;
    this.lastZ = p.z;
    this.phase = advanceStride(this.phase, moved, speed);
    // Which foot plays the ball
    if (p.action !== this.lastAction && FOOTED.has(p.action))
      this.side = kickSide(p.x, p.z, p.yaw, ball.x, ball.z, this.side);
    else if (p.action === 'dribble') {
      const lx = (ball.x - p.x) * Math.cos(p.yaw) - (ball.z - p.z) * Math.sin(p.yaw);
      if (Math.abs(lx) > 0.12) this.side = lx > 0 ? 1 : -1;
    }
    const changed = p.action !== this.lastAction;
    this.lastAction = p.action;
    this.pending += dt;
    if (!pose || !ch.hasRig) return;
    // The GLB head arrives after the body: rebuild so the ground solve sees it
    if (this.driver === null || this.headRef !== ch.head) {
      this.driver = new PoseDriver(ch.root, ch.body, ch.body, ch.head);
      this.headRef = ch.head;
    }
    if (!this.driver.ok) return;
    const step = this.pending;
    this.pending = 0;
    // Missingnoun heads glitch on their own clock (NounCharacter.update would tick it)
    (ch.head?.userData.tick as ((dt: number) => void) | undefined)?.(step);
    const pi = this.poseIn;
    pi.action = p.action;
    pi.t = p.actionT;
    pi.dir = p.actionDir ?? 0;
    pi.speed = speed;
    pi.phase = this.phase;
    pi.side = this.side;
    pi.time = time;
    pi.variant = p.action === 'celebrate' ? this.hash + this.celebrate : this.hash;
    const out = footballPose(pi);
    if (changed && blend && this.cur !== null) {
      this.prev = this.cur;
      this.xk = 0;
    } else if (!blend) this.prev = null;
    this.cur = out;
    let layers: Layer[];
    if (this.prev !== null && this.xk < 1) {
      this.xk = Math.min(1, this.xk + step / (snappy(p.action) ? 0.09 : 0.2));
      const k = this.xk * this.xk * (3 - 2 * this.xk);
      layers = [
        { out: this.prev, w: 1 },
        { out, w: k },
      ];
    } else {
      this.prev = null;
      layers = [{ out, w: 1 }];
    }
    this.driver.drive(step, layers, 1);
  }

  dispose() {
    this.ch.dispose();
    // This Noun's own (cloned) body materials; shared team ones are the bank's
    this.root.traverse(o => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) if (!this.bank.owns(m)) m.dispose();
    });
    for (const m of this.bodyMats) this.bank.drop(m);
    this.bodyMats = [];
    if (this.shirtTex !== null) this.bank.release(this.shirtTex);
    this.shirtTex = null;
  }
}
