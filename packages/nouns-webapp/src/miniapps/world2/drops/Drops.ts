// ── Drop party v2: on-chain items floating in the world ────────────────
//
// Each live drop from the world-drops function is a glowing, spinning
// pickup with a light beam you can see from far off. Ride or walk into one
// and the claim card opens (ui/DropClaim.tsx): the server wants the ride
// that got you there before it signs a voucher, so this module keeps its own
// ride trace in the run-proof format (netlify/lib/runProof.ts):
// [t, x, y, z, speed, state] samples, state 0 ground / 1 air / 2 grind /
// 3 manual, every 0.4 s on the ground and every frame in the air, restarted
// whenever energy could come from outside the physics (teleport, respawn,
// getting on or off the board, climbing) — the same rules as the stats
// tracker's RunTrace.

import type { Player } from '../skate/Player';

import * as THREE from 'three';

import { getToonRamp, inkExcluded } from '../render/Toon';

import { DROPS_ADDRESS, DROPS_URL, gatewayUrl, type WorldDrop } from './contract';

const STRIDE = 6;
/** Keep at most this many samples (older rides are trimmed off the front). */
const MAX_SAMPLES = 30_000;
/** The server's own check is 4 m; touching is a little tighter. */
const TOUCH_R = 2.6;
/** Walk this far away before the same drop can open its card again. */
const RETOUCH_R = 7;
const REFRESH_S = 45;
const STATE_CODE: Record<string, number> = { ground: 0, air: 1, grind: 2, manual: 3 };

/** The ride since the last reset, in run-proof samples. */
export class DropTrace {
  private data = new Float32Array(STRIDE * 1024);
  n = 0;
  private t0 = 0;
  private lastT = -Infinity;
  private lastSt = -1;
  private maxV = 0;

  reset(clock: number) {
    this.n = 0;
    this.t0 = clock;
    this.lastT = -Infinity;
    this.lastSt = -1;
    this.maxV = 0;
  }

  sample(clock: number, x: number, y: number, z: number, v: number, st: number, force = false) {
    const t = clock - this.t0;
    const gap = t - this.lastT;
    if (!(gap > 1e-4)) return;
    const due =
      force ||
      st !== this.lastSt ||
      gap >= (st === 1 ? 1 / 30 : 0.4) ||
      (v > this.maxV && gap >= 0.1);
    if (!due) return;
    if (this.n >= MAX_SAMPLES) this.trim();
    if ((this.n + 1) * STRIDE > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data.set([t, x, y, z, v, st], this.n * STRIDE);
    this.n++;
    this.lastT = t;
    this.lastSt = st;
    if (v > this.maxV) this.maxV = v;
  }

  /**
   * Drop the older half. A proof may start anywhere (riding only loses
   * energy) but not already fast, so cut at a slow-ish sample.
   */
  private trim() {
    const d = this.data;
    let cut = -1;
    for (let i = this.n >> 1; i < this.n; i++)
      if (d[i * STRIDE + 4] < 20) {
        cut = i;
        break;
      }
    if (cut < 0) {
      this.n = 0;
      this.lastSt = -1;
      return;
    }
    d.copyWithin(0, cut * STRIDE, this.n * STRIDE);
    this.n -= cut;
  }

  encode(): string {
    const bytes = new Uint8Array(this.data.buffer, 0, this.n * STRIDE * 4);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
}

// ── Visuals ─────────────────────────────────────────────────────────────

const KIND_COLOR: Record<string, number> = {
  eth: 0x8f9cff,
  erc20: 0xffc93c,
  erc721: 0xff3d8b,
  erc1155: 0x22c7f0,
};

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx !== null) draw(ctx);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let glowTex: THREE.Texture | null = null;
function glowTexture() {
  glowTex ??= canvasTex(128, 128, ctx => {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  });
  return glowTex;
}

function labelTexture(text: string, color: string) {
  return canvasTex(512, 96, ctx => {
    ctx.font = '900 54px ui-sans-serif, system-ui, sans-serif';
    const w = Math.min(500, ctx.measureText(text).width + 40);
    ctx.fillStyle = 'rgba(17,16,24,.85)';
    ctx.beginPath();
    ctx.roundRect(256 - w / 2, 10, w, 76, 38);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 50, 470);
  });
}

function toon(color: number, emissive = 0.45) {
  return new THREE.MeshToonMaterial({
    color,
    gradientMap: getToonRamp(),
    emissive: new THREE.Color(color).multiplyScalar(emissive),
  });
}

/** The spinning item itself (≈1 m tall), by asset kind. */
function buildItem(d: WorldDrop): { obj: THREE.Object3D; dispose: () => void } {
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T) => {
    disposables.push(x);
    return x;
  };
  const g = new THREE.Group();
  const kind = d.asset.kind;
  if (kind === 'eth') {
    // ETH diamond: two stacked pyramids, the top one shorter
    const mat = keep(toon(0x8f9cff, 0.55));
    const dark = keep(toon(0x4a55c9, 0.35));
    const top = new THREE.Mesh(keep(new THREE.ConeGeometry(0.42, 0.62, 4)), mat);
    top.position.y = 0.31;
    const bot = new THREE.Mesh(keep(new THREE.ConeGeometry(0.42, 0.78, 4)), dark);
    bot.rotation.x = Math.PI;
    bot.position.y = -0.39;
    g.add(top, bot);
  } else if (kind === 'erc20') {
    // A fat gold coin with a raised rim
    const mat = keep(toon(0xffc93c, 0.5));
    const face = keep(toon(0xffe27a, 0.6));
    const coin = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.5, 0.5, 0.14, 32)), [
      mat,
      face,
      face,
    ]);
    coin.rotation.x = Math.PI / 2;
    const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(0.5, 0.05, 8, 32)), mat);
    g.add(coin, ring);
  } else {
    // Framed NFT: the token's image (when it loads), a thick gold frame
    const frame = keep(toon(0xffc93c, 0.4));
    const back = new THREE.Mesh(keep(new THREE.BoxGeometry(1.1, 1.1, 0.1)), frame);
    const pic = keep(
      canvasTex(256, 256, ctx => {
        ctx.fillStyle = '#e1d7d5';
        ctx.fillRect(0, 0, 256, 256);
        ctx.fillStyle = '#111018';
        ctx.font = '900 120px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⌐◨-◨', 128, 128, 230);
      }),
    );
    const picMat = keep(new THREE.MeshBasicMaterial({ map: pic, side: THREE.DoubleSide }));
    const front = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.9, 0.9)), picMat);
    front.position.z = 0.051;
    const rear = front.clone();
    rear.position.z = -0.051;
    rear.rotation.y = Math.PI;
    g.add(back, front, rear);
    const img = d.asset.image;
    if (img !== undefined && img !== '') {
      new THREE.TextureLoader().setCrossOrigin('anonymous').load(
        gatewayUrl(img),
        tex => {
          tex.colorSpace = THREE.SRGBColorSpace;
          keep(tex);
          picMat.map = tex;
          picMat.needsUpdate = true;
        },
        undefined,
        () => undefined,
      );
    }
  }
  return { obj: g, dispose: () => disposables.forEach(x => x.dispose()) };
}

interface Pickup {
  drop: WorldDrop;
  root: THREE.Group;
  item: THREE.Object3D;
  glow: THREE.Sprite;
  beam: THREE.Mesh;
  label: THREE.Sprite;
  phase: number;
  dispose: () => void;
}

export interface TouchedDrop {
  drop: WorldDrop;
  /** The ride that reached it, captured at the touch (base64 run proof). */
  proof: string;
  at: number;
}

export interface MapDrop {
  x: number;
  z: number;
  kind: string;
  label: string;
}

/** Drops in the world. `Drops.create` is null when the feature is off. */
export class Drops {
  readonly group = new THREE.Group();
  private pickups = new Map<string, Pickup>();
  private trace = new DropTrace();
  private clock = 0;
  private last = { x: 0, y: 0, z: 0, v: 0, mode: '', on: false };
  private refreshAcc = REFRESH_S;
  private loading = false;
  private disposed = false;
  /** Drops whose card was opened, until you walk away from them. */
  private armedOff = new Set<string>();
  private claimed = new Set<string>();
  private listeners = new Set<() => void>();
  touched: TouchedDrop | null = null;
  /** Server chain + contract (from GET). */
  chainId: number | null = null;

  static create(): Drops | null {
    return DROPS_ADDRESS === null ? null : new Drops();
  }

  private constructor() {
    this.group.name = 'world-drops';
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  /** Close the claim card (the drop stays until you walk off and back). */
  dismiss() {
    this.touched = null;
    this.emit();
  }

  /** Claimed on-chain: gone from the world for everyone (after a refresh). */
  markClaimed(dropId: string) {
    this.claimed.add(dropId);
    this.removePickup(dropId);
    this.emit();
  }

  list(): WorldDrop[] {
    return [...this.pickups.values()].map(p => p.drop);
  }

  mapPoints(): MapDrop[] {
    return this.list().map(d => ({ x: d.x, z: d.z, kind: d.asset.kind, label: d.asset.label }));
  }

  async refresh() {
    if (this.loading || this.disposed) return;
    this.loading = true;
    try {
      const res = await fetch(DROPS_URL, { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as {
        enabled?: boolean;
        chainId?: number;
        drops?: WorldDrop[];
      };
      if (this.disposed) return;
      if (body.enabled !== true) {
        this.setDrops([]);
        return;
      }
      this.chainId = Number(body.chainId) || null;
      this.setDrops(Array.isArray(body.drops) ? body.drops : []);
    } catch {
      // offline / no functions: keep what we have
    } finally {
      this.loading = false;
    }
  }

  setDrops(list: WorldDrop[]) {
    const now = Date.now();
    const want = new Map<string, WorldDrop>();
    for (const d of list) {
      if (
        typeof d?.dropId !== 'string' ||
        ![d.x, d.y, d.z].every(Number.isFinite) ||
        d.expiresAt <= now ||
        this.claimed.has(d.dropId)
      )
        continue;
      want.set(d.dropId, d);
    }
    for (const id of [...this.pickups.keys()]) if (!want.has(id)) this.removePickup(id);
    for (const [id, d] of want) {
      const cur = this.pickups.get(id);
      if (cur !== undefined) {
        const moved = Math.hypot(cur.drop.x - d.x, cur.drop.y - d.y, cur.drop.z - d.z) > 0.01;
        if (!moved) {
          cur.drop = d;
          this.styleTaken(cur);
          continue;
        }
        this.removePickup(id);
      }
      this.addPickup(d);
    }
    this.emit();
  }

  private addPickup(d: WorldDrop) {
    const color = KIND_COLOR[d.asset.kind] ?? 0xffffff;
    const css = `#${color.toString(16).padStart(6, '0')}`;
    const root = new THREE.Group();
    root.position.set(d.x, d.y, d.z);
    const { obj: item, dispose: disposeItem } = buildItem(d);
    root.add(item);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture(),
      color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.9,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(2.6);
    // A tall soft beam: visible from far down the track
    const beamGeo = new THREE.CylinderGeometry(0.18, 0.55, 40, 12, 1, true);
    beamGeo.translate(0, 20, 0);
    const beamMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = -1;
    const labelTex = labelTexture(d.asset.label, css);
    const labelMat = new THREE.SpriteMaterial({
      map: labelTex,
      transparent: true,
      depthWrite: false,
    });
    const label = new THREE.Sprite(labelMat);
    label.scale.set(2.6, 0.49, 1);
    label.position.y = 1.35;
    root.add(glow, beam, label);
    for (const o of [glow, beam, label]) inkExcluded.add(o);
    this.group.add(root);
    const p: Pickup = {
      drop: d,
      root,
      item,
      glow,
      beam,
      label,
      phase: Math.random() * Math.PI * 2,
      dispose: () => {
        disposeItem();
        glowMat.dispose();
        beamGeo.dispose();
        beamMat.dispose();
        labelTex.dispose();
        labelMat.dispose();
        for (const o of [glow, beam, label]) inkExcluded.delete(o);
      },
    };
    this.styleTaken(p);
    this.pickups.set(d.dropId, p);
  }

  /** Someone else is mid-claim: dim it. */
  private styleTaken(p: Pickup) {
    const k = p.drop.taken ? 0.35 : 1;
    (p.glow.material as THREE.SpriteMaterial).opacity = 0.9 * k;
    (p.beam.material as THREE.MeshBasicMaterial).opacity = 0.22 * k;
  }

  private removePickup(id: string) {
    const p = this.pickups.get(id);
    if (p === undefined) return;
    this.group.remove(p.root);
    p.dispose();
    this.pickups.delete(id);
  }

  /** Call every frame in the world (after the physics step). */
  update(dt: number, player: Player) {
    if (this.disposed) return;
    this.clock += dt;
    this.refreshAcc += dt;
    if (this.refreshAcc >= REFRESH_S) {
      this.refreshAcc = 0;
      void this.refresh();
    }
    this.record(dt, player);

    // Float + spin
    const t = this.clock;
    for (const p of this.pickups.values()) {
      p.item.position.y = Math.sin(t * 2.1 + p.phase) * 0.22;
      p.item.rotation.y = t * 1.6 + p.phase;
      const pulse = 1 + Math.sin(t * 3.3 + p.phase) * 0.12;
      p.glow.scale.setScalar(2.6 * pulse);
    }

    // Touch: from the rider's middle to the item
    const px = player.pos.x;
    const py = player.pos.y + 0.9;
    const pz = player.pos.z;
    for (const [id, p] of this.pickups) {
      const d = Math.hypot(p.drop.x - px, p.drop.y - py, p.drop.z - pz);
      if (this.armedOff.has(id)) {
        if (d > RETOUCH_R) this.armedOff.delete(id);
        continue;
      }
      if (d > TOUCH_R || this.touched !== null) continue;
      // The proof must hold this very moment: sample it now
      const st = this.stateCode(player);
      this.trace.sample(
        this.clock,
        player.pos.x,
        player.pos.y,
        player.pos.z,
        player.speed,
        st,
        true,
      );
      // Just respawned on top of it: no ride to show yet, keep rolling
      if (this.trace.n < 3) continue;
      this.armedOff.add(id);
      this.touched = { drop: p.drop, proof: this.trace.encode(), at: performance.now() };
      this.emit();
    }
  }

  private stateCode(p: Player) {
    if (p.mode === 'foot') return p.footGrounded ? 0 : 1;
    return STATE_CODE[p.state] ?? 0;
  }

  /** Same reset rules as the stats tracker's RunTrace (net/Stats.ts). */
  private record(dt: number, p: Player) {
    const { x, y, z } = p.pos;
    const v = p.speed;
    const L = this.last;
    const moved = Math.hypot(x - L.x, y - L.y, z - L.z);
    const teleport = moved > 2 + 3 * Math.max(v, L.v) * dt;
    const respawned = L.v > 4 && v < 0.05;
    // Getting on / off the board or climbing a wall: energy from outside
    const switched = p.mode !== L.mode || p.climb !== null;
    if (!L.on || teleport || respawned || switched) this.trace.reset(this.clock);
    L.on = p.climb === null;
    if (p.climb === null) this.trace.sample(this.clock, x, y, z, v, this.stateCode(p));
    L.x = x;
    L.y = y;
    L.z = z;
    L.v = v;
    L.mode = p.mode;
  }

  dispose() {
    this.disposed = true;
    for (const id of [...this.pickups.keys()]) this.removePickup(id);
    this.group.removeFromParent();
    this.listeners.clear();
  }
}
