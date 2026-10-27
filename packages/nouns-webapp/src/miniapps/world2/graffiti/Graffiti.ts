// ── Persistent 3D graffiti ───────────────────────────────────────────────
//
// Spray onto any flat surface. Surfaces are carved into deterministic
// 6 m × 3 m "cells" (from the plane + position), so every client derives
// the same wall id from the same hit. Each cell owns a transparent canvas
// decal. Paint is stored as vector strokes (see strokes.ts for the format:
// colour, nozzle size, cap, opacity and a simplified polyline), so a mural
// redraws identically everywhere and undo can take single strokes down.
//
// Tags travel live over PartyKit (`world:graffiti:save/load`). PartyKit only
// keeps the last 20 tags per wall and a few walls per index bucket, so every
// tag is also written to the `world-graffiti` Netlify function, which keeps
// them for good. A fresh visitor loads that store, then asks PartyKit about
// every wall too, so a tag the store never got still shows up on arrival
// (and is carried over into the store). Offline (dev) runs keep paint in
// localStorage instead.
//
// Detail: a cell's canvas starts at 512×256 (~12 mm a pixel) and steps up
// to 1024 or 2048 wide when it holds fine-tip strokes, with a cap on how
// many big canvases exist at once so memory stays bounded.

import type { CollisionWorld } from '../physics/Collision';

import * as THREE from 'three';

import { type DrawItem, SprayHistory, WallLog, type Outgoing } from './history';
import { inParallel, nearestFirst } from './loadOrder';
import { postTag, type QueuedTag, StoreQueue } from './storeQueue';
import {
  CELL_H_MM,
  CELL_W_MM,
  EDGE_MM,
  hexToInt,
  intToHex,
  LEGACY_COLORS,
  MAX_POINTS,
  quantRadius,
  simplify,
  simplifyEps,
  type Stroke,
} from './strokes';

export { decodeDabs, encodeDabs, type Dab } from './strokes';

/** The original 16 cans (legacy `g2:` tags index into these). */
export const SPRAY_COLORS = LEGACY_COLORS;

/**
 * Swatches in the spray-can panel. 1–9, 0 pick the first ten. The rest are
 * pulled from the Nouns art palette (noggles red, Nouns yellow, the two
 * background greys…).
 */
export const SPRAY_PALETTE = [
  '#ffffff',
  '#000000',
  '#f3322c',
  '#ffc110',
  '#068940',
  '#254efb',
  '#ff638d',
  '#5648ed',
  '#fe500c',
  '#4bea69',
  '#2b83f6',
  '#34ac80',
  '#e11833',
  '#f78a18',
  '#cc0595',
  '#00e5ff',
  '#a3ff12',
  '#7e5243',
  '#a86f60',
  '#f9f4e6',
  '#d5d7e1',
  '#e1d7d5',
  '#807f7e',
  '#1f1d29',
] as const;

/** Nozzle radii in mm, fine tip → fat cap. */
export const NOZZLES = [
  { r: 4, label: 'FINE' },
  { r: 10, label: 'THIN' },
  { r: 20, label: 'MED' },
  { r: 40, label: 'WIDE' },
  { r: 80, label: 'FAT' },
  { r: 160, label: 'XXL' },
] as const;

const CELL_W = CELL_W_MM / 1000;
const CELL_H = CELL_H_MM / 1000;
const TIER_W = [512, 1024, 2048];
const INDEX_BUCKETS = 8;
const RANGE = 7;
const STORE_URL = '/.netlify/functions/world-graffiti';
const STORE_BATCH = 40;
/** Store batches in flight at once while loading. */
const STORE_PARALLEL = 4;
const PREFS_KEY = 'w2-spray-v1';
const OFFLINE_KEY = 'w2-graffiti-offline';
const OFFLINE_MAX_CHARS = 1_500_000;

const OUTBOX_KEY = 'w2-graffiti-outbox';

/**
 * Tags on their way to the permanent store (one at a time, retried). Each is
 * saved in localStorage until the store has it, so a closed tab or an outage
 * never loses paint: the next visit sends whatever is left.
 */
const storeQueue = new StoreQueue(t => postTag(STORE_URL, t), undefined, undefined, {
  load: () => {
    const v = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as QueuedTag[]) : [];
  },
  save: tags => {
    if (tags.length === 0) localStorage.removeItem(OUTBOX_KEY);
    else localStorage.setItem(OUTBOX_KEY, JSON.stringify(tags));
  },
});
if (typeof window !== 'undefined') storeQueue.restore();
const storeTag = (wallId: string, data: string) => storeQueue.push(wallId, data);

interface Cell {
  id: string;
  /** id without the cu|cv part: cells on the same plane share it. */
  plane: string;
  mesh: THREE.Mesh;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  tier: number;
  origin: THREE.Vector3; // world position of the cell's bottom-left corner
  u: THREE.Vector3;
  v: THREE.Vector3;
  n: THREE.Vector3;
  dirty: boolean;
  log: WallLog;
}

export interface GraffitiNet {
  save(wallId: string, data: string): void;
  load(wallId: string): void;
}

export interface SprayTools {
  /** 0xRRGGBB */
  color: number;
  hex: string;
  size: number;
  hard: boolean;
  /** 1..16 (sixteenths). */
  opacity: number;
  recent: number[];
  picking: boolean;
  canUndo: boolean;
  note: { text: string; at: number } | null;
}

interface LiveStroke {
  cell: Cell;
  stroke: Stroke;
  /** Line mode: the fixed start point (mm). */
  anchor: [number, number] | null;
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgba = (c: number, a: number) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;

function isTouchDevice() {
  try {
    return window.matchMedia?.('(pointer: coarse)').matches === true || 'ontouchstart' in window;
  } catch {
    return false;
  }
}

/** Which canvas size a nozzle needs to read cleanly. */
export function tierFor(rMm: number) {
  return rMm < 12 ? 2 : rMm < 30 ? 1 : 0;
}

// ── Drawing (2D canvas) ──────────────────────────────────────────────────

function drawDabs(ctx: CanvasRenderingContext2D, W: number, H: number, item: DrawItem) {
  if (item.kind !== 'dabs') return;
  const rnd = mulberry32(item.seed);
  for (const d of item.dabs) {
    const x = d.u * W;
    const y = (1 - d.v) * H;
    // Same look on any canvas tier as on the original 512-wide one
    const r = Math.max((1.5 * W) / 512, d.r * H);
    const col = hexToInt(LEGACY_COLORS[d.c] ?? '#ffffff') ?? 0xffffff;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(col, 0.55));
    g.addColorStop(0.45, rgba(col, 0.35));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(col, 0.5);
    const dot = Math.max(1.2, W / 420);
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = r * (1 + rnd() * 0.6);
      ctx.fillRect(x + Math.cos(a) * rr, y + Math.sin(a) * rr, dot, dot);
    }
  }
}

function tracePath(ctx: CanvasRenderingContext2D, pts: number[], s: number, H: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0] * s, H - pts[1] * s);
  if (pts.length === 2) ctx.lineTo(pts[0] * s + 0.01, H - pts[1] * s);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] * s, H - pts[i + 1] * s);
}

/**
 * Soft cap: stacked passes narrowing to a dense core, plus overspray.
 * Thin lines keep the original 4 passes; fat ones (many pixels wide) get
 * more, finer steps so the falloff reads as haze rather than rings. Every
 * set builds to the same core density as the 4-pass one.
 */
const SOFT_PASSES: [number, number][] = [
  [1, 0.2],
  [0.8, 0.26],
  [0.58, 0.34],
  [0.36, 0.5],
];
const SOFT_CORE = 1 - SOFT_PASSES.reduce((a, [, x]) => a * (1 - x), 1);
const softCache = new Map<number, [number, number][]>([[4, SOFT_PASSES]]);

export function softPasses(widthPx: number): [number, number][] {
  const n = Math.max(4, Math.min(12, Math.round(widthPx / 6)));
  const hit = softCache.get(n);
  if (hit !== undefined) return hit;
  const ramp = (i: number) => 0.2 + (0.3 * i) / (n - 1);
  const core = (k: number) => {
    let clear = 1;
    for (let i = 0; i < n; i++) clear *= 1 - ramp(i) * k;
    return 1 - clear;
  };
  // Scale the alpha ramp down until the core matches
  let lo = 0;
  let hi = 1;
  for (let it = 0; it < 24; it++) {
    const mid = (lo + hi) / 2;
    if (core(mid) < SOFT_CORE) lo = mid;
    else hi = mid;
  }
  const out = Array.from({ length: n }, (_, i): [number, number] => [
    1 - (0.64 * i) / (n - 1),
    ramp(i) * lo,
  ]);
  softCache.set(n, out);
  return out;
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  stroke: Stroke,
  seed: number,
) {
  const s = W / CELL_W_MM;
  const op = stroke.opacity / 16;
  const width = Math.max(1, stroke.r * 2 * s);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(stroke.color, 1);
  tracePath(ctx, stroke.pts, s, H);
  if (stroke.hard) {
    ctx.globalAlpha = op;
    ctx.lineWidth = width;
    ctx.stroke();
  } else {
    for (const [wf, a] of softPasses(width)) {
      ctx.globalAlpha = a * op;
      ctx.lineWidth = Math.max(1, width * wf);
      ctx.stroke();
    }
    // Overspray speckle along the stroke, seeded so every client matches
    const rnd = mulberry32(seed);
    const pts = stroke.pts;
    let len = 0;
    for (let i = 2; i < pts.length; i += 2)
      len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    const count = Math.min(260, Math.round(4 + (len / Math.max(4, stroke.r)) * 3));
    const dot = Math.max(1, Math.min(3, stroke.r * s * 0.12));
    ctx.fillStyle = rgba(stroke.color, 1);
    ctx.globalAlpha = 0.45 * op;
    const segs = Math.max(1, pts.length / 2 - 1);
    for (let k = 0; k < count; k++) {
      const seg = Math.min(segs - 1, Math.floor(rnd() * segs));
      const t = rnd();
      const i = seg * 2;
      const x0 = pts[i];
      const y0 = pts[i + 1];
      const x1 = pts.length > i + 2 ? pts[i + 2] : x0;
      const y1 = pts.length > i + 3 ? pts[i + 3] : y0;
      const a = rnd() * Math.PI * 2;
      const rr = stroke.r * (0.85 + rnd() * 0.6);
      const x = (x0 + (x1 - x0) * t + Math.cos(a) * rr) * s;
      const y = H - (y0 + (y1 - y0) * t + Math.sin(a) * rr) * s;
      ctx.fillRect(x, y, dot, dot);
    }
  }
  ctx.restore();
}

function drawItem(ctx: CanvasRenderingContext2D, W: number, H: number, it: DrawItem) {
  if (it.kind === 'dabs') drawDabs(ctx, W, H, it);
  else drawStroke(ctx, W, H, it.stroke, it.seed);
}

const _p = new THREE.Vector3();

export class Graffiti {
  group = new THREE.Group();
  cells = new Map<string, Cell>();
  spraying = false;
  /** A stroke was finished on `plane`, ending at `at` (respect/hooks: homes vs walls). */
  onStroke: ((plane: string, at: THREE.Vector3) => void) | null = null;
  /** Aim point for the HUD crosshair (null when nothing in range). */
  aim: { point: THREE.Vector3; normal: THREE.Vector3 } | null = null;

  private history = new SprayHistory();
  private live: LiveStroke | null = null;
  /** Wall as it was before the live stroke (restored every frame). */
  private snapshot: HTMLCanvasElement | null = null;
  private wasActive = false;
  /** This press is an eyedropper pick, not paint. */
  private pickPress = false;
  /** Shift held when this press began: straight line from the last stroke. */
  private lineFrom: { plane: string; world: THREE.Vector3 } | null = null;
  private lastEnd: { plane: string; world: THREE.Vector3 } | null = null;
  private prevWorld: THREE.Vector3 | null = null;
  private sinceSpray = 0;
  private indexed = new Set<string>();
  /** Walls asked of PartyKit on this connection. */
  private asked = new Set<string>();
  /** Permanent-store load; PartyKit's index waits for it. */
  private stored: Promise<void> | null = null;
  private storedDone = false;
  /** Where the rider is (Game sets it): stored walls load nearest-first. */
  near: (() => { x: number; y: number; z: number } | null) | null = null;
  private readonly startedAt = Date.now();
  private hiss: { gain: GainNode } | null = null;
  private tierCaps: number[];
  private cursor: THREE.Group;
  private cursorDisc: THREE.Mesh;
  private cursorRing: THREE.LineLoop;
  private cursorHalo: THREE.LineLoop;

  // ── Tool state (read by the spray panel) ──
  private toolState: SprayTools;
  private toolListeners = new Set<() => void>();

  constructor(
    private world: CollisionWorld,
    private levelKey: string,
    private net: GraffitiNet | null,
  ) {
    this.group.name = 'graffiti';
    const touch = isTouchDevice();
    // How many 1024- and 2048-wide canvases may exist at once
    this.tierCaps = [Infinity, touch ? 12 : 32, touch ? 3 : 8];
    this.toolState = this.loadPrefs();

    // Aim cursor: a disc of the current colour at the real nozzle size,
    // a contrasting outline, and a fixed halo so fine tips stay findable
    this.cursor = new THREE.Group();
    this.cursor.name = 'spray-cursor';
    const circle = (seg: number) => {
      const g = new THREE.BufferGeometry();
      const p: number[] = [];
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        p.push(Math.cos(a), Math.sin(a), 0);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      return g;
    };
    this.cursorDisc = new THREE.Mesh(
      new THREE.CircleGeometry(1, 40),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.cursorRing = new THREE.LineLoop(
      circle(48),
      new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, depthWrite: false }),
    );
    this.cursorHalo = new THREE.LineLoop(
      circle(32),
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
    );
    for (const o of [this.cursorDisc, this.cursorRing, this.cursorHalo]) {
      o.renderOrder = 3;
      o.frustumCulled = false;
      this.cursor.add(o);
    }
    this.cursor.visible = false;
    this.group.add(this.cursor);

    if (net === null) queueMicrotask(() => this.loadOffline());
  }

  // ── Tools ─────────────────────────────────────────────────────────────

  get tools(): SprayTools {
    return this.toolState;
  }

  /** For useSyncExternalStore. */
  subscribeTools = (fn: () => void) => {
    this.toolListeners.add(fn);
    return () => {
      this.toolListeners.delete(fn);
    };
  };

  getTools = () => this.toolState;

  private setTools(patch: Partial<SprayTools>) {
    const next = { ...this.toolState, ...patch };
    next.hex = intToHex(next.color);
    next.canUndo = this.history.canUndo;
    this.toolState = next;
    try {
      const { color, size, hard, opacity, recent } = next;
      localStorage.setItem(PREFS_KEY, JSON.stringify({ color, size, hard, opacity, recent }));
    } catch {
      // private mode: settings just don't stick
    }
    for (const l of this.toolListeners) l();
  }

  private loadPrefs(): SprayTools {
    const base: SprayTools = {
      color: 0xf3322c,
      hex: '#f3322c',
      size: 3,
      hard: false,
      opacity: 16,
      recent: [],
      picking: false,
      canUndo: false,
      note: null,
    };
    try {
      const raw = JSON.parse(
        localStorage.getItem(PREFS_KEY) ?? 'null',
      ) as Partial<SprayTools> | null;
      if (raw !== null && typeof raw === 'object') {
        if (Number.isInteger(raw.color)) base.color = (raw.color as number) & 0xffffff;
        if (Number.isInteger(raw.size))
          base.size = Math.max(0, Math.min(NOZZLES.length - 1, raw.size!));
        base.hard = raw.hard === true;
        if (Number.isInteger(raw.opacity)) base.opacity = Math.max(1, Math.min(16, raw.opacity!));
        if (Array.isArray(raw.recent))
          base.recent = raw.recent.filter(Number.isInteger).slice(0, 8) as number[];
      }
    } catch {
      // ignore
    }
    base.hex = intToHex(base.color);
    return base;
  }

  /** Current colour as #rrggbb. */
  get colorHex() {
    return this.toolState.hex;
  }

  setColor(c: number | string) {
    const v = typeof c === 'string' ? hexToInt(c) : c & 0xffffff;
    if (v === null) return;
    this.setTools({ color: v });
  }

  pickSwatch(i: number) {
    const hex = SPRAY_PALETTE[i];
    if (hex !== undefined) this.setColor(hex);
  }

  /** Step through the palette (T / Shift+T). */
  cycleColor(dir = 1) {
    const n = SPRAY_PALETTE.length;
    const at = SPRAY_PALETTE.findIndex(h => hexToInt(h) === this.toolState.color);
    const next = at < 0 ? 0 : (at + dir + n) % n;
    this.pickSwatch(next);
  }

  setSize(i: number) {
    this.setTools({ size: Math.max(0, Math.min(NOZZLES.length - 1, Math.round(i))) });
  }

  stepSize(d: number) {
    this.setSize(this.toolState.size + d);
  }

  setHard(hard: boolean) {
    this.setTools({ hard });
  }

  setOpacity(sixteenths: number) {
    this.setTools({ opacity: Math.max(1, Math.min(16, Math.round(sixteenths))) });
  }

  /** Arm the eyedropper: the next press picks a colour instead of painting. */
  setPicking(on: boolean) {
    this.setTools({ picking: on });
  }

  private note(text: string) {
    this.setTools({ note: { text, at: performance.now() } });
  }

  private get radius() {
    return NOZZLES[this.toolState.size]?.r ?? 40;
  }

  private rememberColor(c: number) {
    const recent = [c, ...this.toolState.recent.filter(x => x !== c)].slice(0, 8);
    if (recent.join() !== this.toolState.recent.join()) this.setTools({ recent });
  }

  /** Pick the colour under the aim point. True if there was paint there. */
  pickAt(): boolean {
    const a = this.aim;
    if (a === null) return false;
    const id = this.cellId(a.point, a.normal);
    const cell = this.cells.get(id.id);
    if (cell !== undefined) {
      _p.subVectors(a.point, cell.origin);
      const x = Math.floor((_p.dot(cell.u) / CELL_W) * cell.canvas.width);
      const y = Math.floor((1 - _p.dot(cell.v) / CELL_H) * cell.canvas.height);
      try {
        const px = cell.ctx.getImageData(x, y, 1, 1).data;
        if (px[3] > 40) {
          const c = (px[0] << 16) | (px[1] << 8) | px[2];
          this.setColor(c);
          this.rememberColor(c);
          this.setTools({ picking: false });
          this.note(`picked ${intToHex(c)}`);
          return true;
        }
      } catch {
        // tainted / unavailable canvas: fall through
      }
    }
    this.setTools({ picking: false });
    this.note('no paint there to pick');
    return false;
  }

  /** Take back your last stroke (synced to everyone as a removal). */
  undo() {
    this.finishStroke();
    const { walls, out } = this.history.undo();
    this.send(out);
    for (const id of walls) {
      const cell = this.cells.get(id);
      if (cell !== undefined) this.redraw(cell);
    }
    this.lastEnd = null;
    this.setTools({});
    if (walls.size === 0) this.note('nothing to undo');
  }

  // ── Loading ───────────────────────────────────────────────────────────

  /**
   * Load every wall with paint: the permanent store first, then PartyKit's
   * copy of every wall the store or PartyKit's index buckets know of. The
   * store can lack tags PartyKit has (from before it existed, or a write
   * that never landed), and those used to stay hidden until somebody
   * sprayed the wall and PartyKit rebroadcast it. Missing ones are carried
   * over into the store (see paintTags). Runs again on every reconnect.
   */
  loadAll() {
    if (this.net === null) return;
    this.asked.clear();
    this.stored ??= this.loadStored().finally(() => {
      this.storedDone = true;
    });
    void this.stored.then(() => {
      for (let i = 0; i < INDEX_BUCKETS; i++) this.net?.load(this.indexId(i));
      for (const id of this.indexed) this.askParty(id);
    });
  }

  /** Ask PartyKit for a wall's tags (once per connection). */
  private askParty(id: string) {
    if (this.net === null || !id.startsWith(`${this.levelKey}|`) || this.asked.has(id)) return;
    this.asked.add(id);
    this.net.load(id);
  }

  private async loadStored() {
    try {
      const res = await fetch(`${STORE_URL}?level=${this.levelKey}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { walls } = (await res.json()) as { walls: string[] };
      for (const id of walls) this.indexed.add(id);
      // The walls round the rider first, a few batches at once (loadOrder.ts)
      const order = nearestFirst(walls, this.near?.() ?? null, CELL_W, CELL_H);
      const batches: string[][] = [];
      for (let i = 0; i < order.length; i += STORE_BATCH)
        batches.push(order.slice(i, i + STORE_BATCH));
      await inParallel(batches, STORE_PARALLEL, async batch => {
        const r = await fetch(
          `${STORE_URL}?level=${this.levelKey}&ids=${encodeURIComponent(JSON.stringify(batch))}`,
          { cache: 'no-store' },
        );
        if (!r.ok) return;
        const got = (await r.json()) as { walls: Record<string, string[]> };
        for (const [id, tags] of Object.entries(got.walls))
          this.paintTags(
            id,
            tags.map(d => ({ imageData: d })),
            false,
          );
      });
    } catch {
      // Offline or the function is down: PartyKit still has recent tags
    }
  }

  private offlineKey() {
    return `${OFFLINE_KEY}:${this.levelKey}`;
  }

  private readOffline(): Record<string, string[]> {
    try {
      const v = JSON.parse(localStorage.getItem(this.offlineKey()) ?? '{}') as unknown;
      return v !== null && typeof v === 'object' ? (v as Record<string, string[]>) : {};
    } catch {
      return {};
    }
  }

  private loadOffline() {
    for (const [id, tags] of Object.entries(this.readOffline()))
      if (Array.isArray(tags))
        this.paintTags(
          id,
          tags.map(d => ({ imageData: d })),
          false,
        );
  }

  private saveOffline(out: Outgoing[]) {
    try {
      const all = this.readOffline();
      for (const o of out) (all[o.wallId] ??= []).push(o.data);
      let json = JSON.stringify(all);
      // Over budget: shed the oldest tag of the biggest wall
      while (json.length > OFFLINE_MAX_CHARS) {
        const big = Object.entries(all).sort((a, b) => b[1].length - a[1].length)[0];
        if (big === undefined || big[1].length === 0) break;
        big[1].shift();
        json = JSON.stringify(all);
      }
      localStorage.setItem(this.offlineKey(), json);
    } catch {
      // storage blocked or full
    }
  }

  private indexId(i: number) {
    return `w2idx:${this.levelKey}:${i}`;
  }

  /** Handle a `world:graffiti:tags` broadcast. */
  onTags(wallId: string, tags: { imageData: string; timestamp?: number }[]) {
    if (wallId.startsWith(`w2idx:${this.levelKey}:`)) {
      for (const t of tags) if (typeof t.imageData === 'string') this.askParty(t.imageData);
      return;
    }
    this.paintTags(wallId, tags, true);
  }

  /**
   * Paint tags onto a wall. From PartyKit (`fromParty`), a tag the store
   * didn't have that predates this visit is an old one from before the store
   * existed: write it there so it survives PartyKit forgetting it.
   */
  private paintTags(
    wallId: string,
    tags: { imageData: string; timestamp?: number }[],
    fromParty: boolean,
  ) {
    if (!wallId.startsWith(`${this.levelKey}|`)) return;
    const cell = this.cellFromId(wallId);
    if (cell === null) return;
    let redraw = false;
    for (const t of tags) {
      if (typeof t.imageData !== 'string' || cell.log.has(t.imageData)) continue;
      const res = cell.log.add(t.imageData);
      if (res.action === 'skip') continue;
      if (fromParty && this.storedDone && (t.timestamp ?? Infinity) < this.startedAt)
        storeTag(wallId, t.imageData);
      if (res.action === 'redraw') {
        redraw = true;
        continue;
      }
      const want = Math.max(
        0,
        ...res.items.map(i => (i.kind === 'stroke' ? tierFor(i.stroke.r) : 0)),
      );
      if (want > cell.tier && this.retier(cell, want)) {
        redraw = true;
        continue;
      }
      if (!redraw) {
        // Under a live stroke, paint into the snapshot so it isn't wiped
        const ctx =
          this.live?.cell === cell && this.snapshot ? this.snapshot.getContext('2d')! : cell.ctx;
        for (const it of res.items) drawItem(ctx, cell.canvas.width, cell.canvas.height, it);
        if (this.live?.cell === cell) this.renderLive();
        cell.dirty = true;
      }
    }
    if (redraw) this.redraw(cell);
  }

  // ── Cells ─────────────────────────────────────────────────────────────

  private basis(n: THREE.Vector3) {
    const nq = new THREE.Vector3(
      Math.round(n.x * 20) / 20,
      Math.round(n.y * 20) / 20,
      Math.round(n.z * 20) / 20,
    ).normalize();
    let u: THREE.Vector3;
    let v: THREE.Vector3;
    if (Math.abs(nq.y) > 0.85) {
      // Floor / ceiling: u = +X, v = -Z so text reads from the south
      u = new THREE.Vector3(1, 0, 0);
      v = new THREE.Vector3().crossVectors(nq, u).normalize();
    } else {
      u = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), nq).normalize();
      v = new THREE.Vector3().crossVectors(nq, u).normalize();
    }
    return { n: nq, u, v };
  }

  private cellId(point: THREE.Vector3, normal: THREE.Vector3) {
    const { n, u, v } = this.basis(normal);
    const d = Math.round(n.dot(point) * 20) / 20;
    const cu = Math.floor(u.dot(point) / CELL_W);
    const cv = Math.floor(v.dot(point) / CELL_H);
    const plane = `${this.levelKey}|${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}|${d.toFixed(2)}`;
    return { id: `${plane}|${cu}|${cv}`, plane, n, u, v, d, cu, cv };
  }

  private cellFor(point: THREE.Vector3, normal: THREE.Vector3): Cell {
    const c = this.cellId(point, normal);
    return this.ensureCell(c.id, c.n, c.u, c.v, c.d, c.cu, c.cv);
  }

  private cellFromId(id: string): Cell | null {
    const existing = this.cells.get(id);
    if (existing !== undefined) return existing;
    const parts = id.split('|');
    if (parts.length !== 5) return null;
    const nn = parts[1].split(',').map(Number);
    if (nn.length !== 3 || nn.some(x => !Number.isFinite(x))) return null;
    const { n, u, v } = this.basis(new THREE.Vector3(nn[0], nn[1], nn[2]));
    const d = Number(parts[2]);
    const cu = Number(parts[3]);
    const cv = Number(parts[4]);
    if (![d, cu, cv].every(Number.isFinite)) return null;
    return this.ensureCell(id, n, u, v, d, cu, cv);
  }

  private ensureCell(
    id: string,
    n: THREE.Vector3,
    u: THREE.Vector3,
    v: THREE.Vector3,
    d: number,
    cu: number,
    cv: number,
  ): Cell {
    const hit = this.cells.get(id);
    if (hit !== undefined) return hit;
    const canvas = document.createElement('canvas');
    canvas.width = TIER_W[0];
    canvas.height = TIER_W[0] / 2;
    const ctx = canvas.getContext('2d')!;
    const texture = this.makeTexture(canvas);
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      roughness: 0.75,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(CELL_W, CELL_H), mat);
    const origin = n
      .clone()
      .multiplyScalar(d)
      .addScaledVector(u, cu * CELL_W)
      .addScaledVector(v, cv * CELL_H);
    // Plane frame: X = u, Y = v, Z = n
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n));
    mesh.position
      .copy(origin)
      .addScaledVector(u, CELL_W / 2)
      .addScaledVector(v, CELL_H / 2)
      .addScaledVector(n, 0.012);
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    this.group.add(mesh);
    const cell: Cell = {
      id,
      plane: id.split('|').slice(0, 3).join('|'),
      mesh,
      canvas,
      ctx,
      texture,
      tier: 0,
      origin,
      u,
      v,
      n,
      dirty: false,
      log: new WallLog(),
    };
    this.cells.set(id, cell);
    return cell;
  }

  private makeTexture(canvas: HTMLCanvasElement) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    return texture;
  }

  /** Move a cell to a bigger canvas (if the cap allows). True if it did. */
  private retier(cell: Cell, want: number): boolean {
    let tier = cell.tier;
    for (let t = Math.min(want, TIER_W.length - 1); t > cell.tier; t--) {
      let used = 0;
      for (const c of this.cells.values()) if (c.tier === t) used++;
      if (used < this.tierCaps[t]) {
        tier = t;
        break;
      }
    }
    if (tier === cell.tier) return false;
    cell.tier = tier;
    cell.canvas.width = TIER_W[tier];
    cell.canvas.height = TIER_W[tier] / 2;
    cell.texture.dispose();
    cell.texture = this.makeTexture(cell.canvas);
    const mat = cell.mesh.material as THREE.MeshStandardMaterial;
    mat.map = cell.texture;
    mat.needsUpdate = true;
    return true;
  }

  /** Repaint a cell from scratch: its log, then my unsent strokes. */
  private redraw(cell: Cell) {
    const { width: W, height: H } = cell.canvas;
    cell.ctx.clearRect(0, 0, W, H);
    for (const it of cell.log.items()) drawItem(cell.ctx, W, H, it);
    for (const s of this.history.pendingOn(cell.id))
      if (s !== undefined) drawStroke(cell.ctx, W, H, s.stroke, s.seed);
    if (this.live?.cell === cell) {
      this.takeSnapshot(cell);
      this.renderLive();
    }
    cell.dirty = true;
  }

  // ── Live stroke ───────────────────────────────────────────────────────

  private takeSnapshot(cell: Cell) {
    const { width: W, height: H } = cell.canvas;
    if (this.snapshot === null) this.snapshot = document.createElement('canvas');
    if (this.snapshot.width !== W || this.snapshot.height !== H) {
      this.snapshot.width = W;
      this.snapshot.height = H;
    }
    const sctx = this.snapshot.getContext('2d')!;
    sctx.clearRect(0, 0, W, H);
    sctx.drawImage(cell.canvas, 0, 0);
  }

  private renderLive() {
    const l = this.live;
    if (l === null || this.snapshot === null) return;
    const { canvas, ctx } = l.cell;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.snapshot, 0, 0);
    drawStroke(ctx, canvas.width, canvas.height, l.stroke, 0);
    l.cell.dirty = true;
  }

  private toLocal(cell: Cell, p: THREE.Vector3): [number, number] {
    _p.subVectors(p, cell.origin);
    return [Math.round(_p.dot(cell.u) * 1000), Math.round(_p.dot(cell.v) * 1000)];
  }

  private inRange([u, v]: [number, number]) {
    return u >= -EDGE_MM && u <= CELL_W_MM + EDGE_MM && v >= -EDGE_MM && v <= CELL_H_MM + EDGE_MM;
  }

  private startStroke(cell: Cell, first: [number, number], anchor: [number, number] | null) {
    const r = quantRadius(this.radius);
    if (this.retier(cell, tierFor(r))) this.redraw(cell);
    const pts = anchor !== null ? [anchor[0], anchor[1], first[0], first[1]] : [first[0], first[1]];
    this.live = {
      cell,
      anchor,
      stroke: {
        color: this.toolState.color,
        r,
        hard: this.toolState.hard,
        opacity: this.toolState.opacity,
        pts,
      },
    };
    this.takeSnapshot(cell);
    this.renderLive();
  }

  /** Finish the live stroke: simplify, draw the final shape, record it. */
  private finishStroke() {
    const l = this.live;
    if (l === null) return;
    const s = l.stroke;
    if (s.pts.length > 4) s.pts = simplify(s.pts, simplifyEps(s.r));
    this.renderLive();
    this.live = null;
    const n = s.pts.length;
    this.lastEnd = {
      plane: l.cell.plane,
      world: l.cell.origin
        .clone()
        .addScaledVector(l.cell.u, s.pts[n - 2] / 1000)
        .addScaledVector(l.cell.v, s.pts[n - 1] / 1000),
    };
    const { out } = this.history.addStroke(l.cell.id, s);
    this.send(out);
    this.onStroke?.(l.cell.plane, this.lastEnd.world);
    this.rememberColor(s.color);
    this.setTools({});
  }

  private capture(point: THREE.Vector3, normal: THREE.Vector3, line: boolean) {
    const cell = this.cellFor(point, normal);
    const here = this.toLocal(cell, point);
    let l = this.live;
    if (l !== null && l.cell !== cell) {
      // Crossing into the next cell: carry the stroke over the seam
      const samePlane = l.cell.plane === cell.plane;
      const bridge = this.toLocal(l.cell, point);
      if (samePlane && l.anchor === null && this.inRange(bridge)) l.stroke.pts.push(...bridge);
      const prev = this.prevWorld;
      this.finishStroke();
      if (samePlane && prev !== null) {
        const back = this.toLocal(cell, prev);
        if (this.inRange(back)) this.startStroke(cell, back, null);
      }
      l = this.live;
    }
    if (l === null) {
      let anchor: [number, number] | null = null;
      if (line && this.lineFrom !== null && this.lineFrom.plane === cell.plane) {
        const a = this.toLocal(cell, this.lineFrom.world);
        if (this.inRange(a)) anchor = a;
      }
      this.startStroke(cell, here, anchor);
      l = this.live!;
    }
    const pts = l.stroke.pts;
    if (l.anchor !== null) {
      // Straight line: anchor → cursor
      pts.length = 2;
      pts.push(here[0], here[1]);
    } else {
      const n = pts.length;
      const step = Math.max(1, l.stroke.r * 0.12);
      if (Math.hypot(here[0] - pts[n - 2], here[1] - pts[n - 1]) >= step)
        pts.push(here[0], here[1]);
      if (pts.length / 2 >= MAX_POINTS) {
        l.stroke.pts = simplify(pts, simplifyEps(l.stroke.r));
        if (l.stroke.pts.length / 2 >= MAX_POINTS * 0.75) {
          // Long stroke: close it and carry on in a fresh one
          this.finishStroke();
          this.startStroke(cell, here, null);
        }
      }
    }
    this.renderLive();
  }

  // ── Spraying ──────────────────────────────────────────────────────────

  /**
   * Per-frame update. `from` = spray origin (camera), `dirs` = aim
   * directions sampled since the last frame (oldest first; the last one is
   * where the cursor is now). Returns true while paint is landing.
   */
  update(
    dt: number,
    active: boolean,
    from: THREE.Vector3,
    dirs: THREE.Vector3[],
    playerPos: THREE.Vector3,
    opts: { line?: boolean; cursor?: boolean } = {},
  ): boolean {
    this.aim = null;
    let landed = false;
    const hitOf = (dir: THREE.Vector3) => {
      const hit = this.world.raycast(from, dir, 40);
      return hit !== null && hit.point.distanceTo(playerPos) < RANGE ? hit : null;
    };
    const last = dirs.length > 0 ? hitOf(dirs[dirs.length - 1]) : null;
    if (last !== null) this.aim = { point: last.point.clone(), normal: last.normal.clone() };

    if (active && !this.wasActive) {
      // Press: an armed eyedropper picks; otherwise a new gesture
      this.pickPress = this.toolState.picking;
      if (this.pickPress) this.pickAt();
      else {
        this.history.beginGesture();
        this.lineFrom = opts.line === true ? this.lastEnd : null;
        this.prevWorld = null;
      }
    }
    if (active && !this.pickPress) {
      // Every cursor sample since last frame, so fast curves stay curves
      const samples = dirs.length > 1 ? dirs.slice(-12) : dirs;
      for (let i = 0; i < samples.length; i++) {
        const hit = i === samples.length - 1 ? last : hitOf(samples[i]);
        if (hit === null) {
          // Off the wall: end the stroke (the gesture carries on)
          this.finishStroke();
          this.prevWorld = null;
          continue;
        }
        this.capture(hit.point, hit.normal, this.lineFrom !== null && opts.line === true);
        this.prevWorld = hit.point.clone();
        landed = true;
      }
    }
    if (!active && this.wasActive) {
      if (!this.pickPress) {
        this.finishStroke();
        this.history.endGesture();
        this.setTools({});
      }
      this.pickPress = false;
      this.lineFrom = null;
    }
    this.wasActive = active;
    this.spraying = active && !this.pickPress;
    this.sinceSpray = active ? 0 : this.sinceSpray + dt;
    // Flush after a short pause so one burst = one save per wall
    if (!active && this.sinceSpray > 0.8 && this.history.hasPending) this.flush();

    this.updateCursor(opts.cursor !== false);
    for (const c of this.cells.values()) {
      if (c.dirty) {
        c.texture.needsUpdate = true;
        c.dirty = false;
      }
    }
    return landed;
  }

  private updateCursor(show: boolean) {
    const a = this.aim;
    this.cursor.visible = show && a !== null;
    if (!this.cursor.visible || a === null) return;
    const { n, u, v } = this.basis(a.normal);
    this.cursor.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(u, v, n));
    this.cursor.position.copy(a.point).addScaledVector(n, 0.02);
    const r = quantRadius(this.radius) / 1000;
    this.cursorDisc.scale.setScalar(r);
    this.cursorRing.scale.setScalar(r);
    this.cursorHalo.scale.setScalar(Math.max(r * 1.35, 0.05));
    this.cursorHalo.visible = r < 0.03 || this.toolState.picking;
    const c = this.toolState.color;
    (this.cursorDisc.material as THREE.MeshBasicMaterial).color.setHex(c);
    (this.cursorDisc.material as THREE.MeshBasicMaterial).opacity = this.toolState.picking
      ? 0.15
      : 0.25 + 0.45 * (this.toolState.opacity / 16);
    // Outline contrasts with the paint: dark ring for light colours
    const lum = ((c >> 16) & 255) * 0.3 + ((c >> 8) & 255) * 0.59 + (c & 255) * 0.11;
    (this.cursorRing.material as THREE.LineBasicMaterial).color.setHex(
      lum > 140 ? 0x111111 : 0xffffff,
    );
  }

  private send(out: Outgoing[]) {
    for (const o of out) {
      const cell = this.cells.get(o.wallId);
      // Mark as seen (the PartyKit echo is skipped); my strokes are on the canvas already
      const res = cell?.log.add(o.data);
      if (res?.action === 'redraw' && cell !== undefined) this.redraw(cell);
      if (this.net === null) continue;
      this.net.save(o.wallId, o.data);
      storeTag(o.wallId, o.data);
      if (!this.indexed.has(o.wallId)) {
        this.indexed.add(o.wallId);
        this.net.save(this.indexId(hashStr(o.wallId) % INDEX_BUCKETS), o.wallId);
      }
    }
    if (this.net === null && out.length > 0) this.saveOffline(out);
  }

  flush() {
    this.finishStroke();
    this.send(this.history.flush());
    // The before-stroke copy can be big (2048 wide): let it go between bursts
    this.snapshot = null;
  }

  /** Spray-can hiss, driven by `spraying`. */
  updateAudio(ctx: AudioContext | null, master: AudioNode | null, noise: AudioBuffer | null) {
    if (ctx === null || master === null || noise === null) return;
    if (this.hiss === null) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3500;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(hp).connect(gain).connect(master);
      src.start();
      this.hiss = { gain };
    }
    // Fine tips hiss quieter than a fat cap
    const loud = 0.08 + 0.1 * (this.toolState.size / (NOZZLES.length - 1));
    this.hiss.gain.gain.setTargetAtTime(
      this.spraying && this.aim !== null ? loud : 0,
      ctx.currentTime,
      0.03,
    );
  }

  dispose() {
    this.flush();
    for (const c of this.cells.values()) {
      c.texture.dispose();
      c.mesh.geometry.dispose();
      (c.mesh.material as THREE.Material).dispose();
    }
    this.cells.clear();
    this.cursor.traverse(o => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.group.removeFromParent();
  }
}
