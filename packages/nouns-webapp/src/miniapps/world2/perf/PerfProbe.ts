// ── ?perf=1: where Noun World's frame time goes ─────────────────────────
//
// Game.frame brackets every frame (frameStart / frameEnd) and Game.step
// calls `perf.lap('system')` after each system, so each bucket holds the
// main-thread ms that system took that frame. Off (the default) every call
// returns at the first branch. On, an overlay shows fps, frame-time
// percentiles, the top systems, renderer.info and the JS heap, and
// `window.__w2perf` hands the same numbers to scripts (snapshot / reset).

import type * as THREE from 'three';

import {
  type BucketSummary,
  type FrameSummary,
  type HitchEntry,
  isHitch,
  percentile,
  Ring,
  summarize,
  summarizeBuckets,
  topSystems,
} from './perfStats';

const WINDOW = 600; // frames kept (~10 s at 60 fps)
const HITCH_LOG = 200; // hitches kept (oldest dropped)

export interface PerfSnapshot {
  /** rAF-to-rAF frame interval (what the player feels). */
  frame: FrameSummary;
  /** Main-thread ms inside Game.step (CPU cost of a frame). */
  cpu: FrameSummary;
  systems: BucketSummary[];
  /** renderer.info summed over every pass of the last frame. */
  render: {
    calls: number;
    triangles: number;
    points: number;
    lines: number;
    programs: number;
    textures: number;
    geometries: number;
    pixelRatio: number;
    width: number;
    height: number;
  } | null;
  heapMB: number | null;
  /** MB/s of heap growth between GCs (allocation pressure). */
  allocMBps: number | null;
  longTasks: { count: number; totalMs: number; maxMs: number };
  /** Frames that stalled since the last reset, with what ran in them (newest last). */
  hitchLog: HitchEntry[];
  /** Anything the game adds (quality tier, step-downs). */
  extra: Record<string, unknown>;
}

class Probe {
  on = false;
  private frames = new Ring(WINDOW);
  private cpu = new Ring(WINDOW);
  private buckets = new Map<string, Ring>();
  private acc = new Map<string, number>();
  private lastRaf = 0;
  private t0 = 0;
  private mark = 0;
  private renderer: THREE.WebGLRenderer | null = null;
  private overlay: HTMLDivElement | null = null;
  private overlayAt = 0;
  private longTasks = { count: 0, totalMs: 0, maxMs: 0 };
  private heapLast = 0;
  private heapGrow = 0;
  private heapT = 0;
  private allocMBps: number | null = null;
  private hitchLog: HitchEntry[] = [];
  private lastFrameMs = 0;
  private medianFrame = 16.7;
  extra: Record<string, unknown> = {};

  /** Turn on (from Game's constructor when the URL says ?perf=1). */
  enable(renderer: THREE.WebGLRenderer, opts: { overlay: boolean }) {
    this.on = true;
    this.renderer = renderer;
    // Sum info over the composer's passes; reset by hand each frame
    renderer.info.autoReset = false;
    if (opts.overlay && typeof document !== 'undefined') {
      const el = document.createElement('div');
      el.style.cssText =
        'position:fixed;left:6px;top:64px;z-index:99999;pointer-events:none;' +
        'font:11px/1.3 ui-monospace,monospace;color:#cfe;background:rgba(0,0,0,.66);' +
        'padding:6px 8px;border-radius:4px;white-space:pre;max-width:60vw';
      el.dataset.perfOverlay = '1';
      document.body.appendChild(el);
      this.overlay = el;
    }
    try {
      const po = new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          this.longTasks.count++;
          this.longTasks.totalMs += e.duration;
          this.longTasks.maxMs = Math.max(this.longTasks.maxMs, e.duration);
        }
      });
      po.observe({ type: 'longtask', buffered: false });
    } catch {
      // longtask isn't supported everywhere (Safari)
    }
    (window as unknown as { __w2perf?: unknown }).__w2perf = {
      snapshot: () => this.snapshot(),
      reset: () => this.reset(),
      probe: this,
    };
  }

  frameStart(now: number) {
    if (!this.on) return;
    this.lastFrameMs = this.lastRaf > 0 ? now - this.lastRaf : 0;
    if (this.lastRaf > 0) this.frames.push(this.lastFrameMs);
    this.lastRaf = now;
    this.t0 = this.mark = performance.now();
    this.renderer?.info.reset();
  }

  /** Charge the time since the previous lap (or frame start) to `name`. */
  lap(name: string) {
    if (!this.on) return;
    const t = performance.now();
    this.acc.set(name, (this.acc.get(name) ?? 0) + (t - this.mark));
    this.mark = t;
  }

  frameEnd() {
    if (!this.on) return;
    const t = performance.now();
    if (t - this.mark > 0.01) this.lap('other');
    const cpuMs = t - this.t0;
    this.cpu.push(cpuMs);
    // Running median, refreshed every 30 frames (sorting 600 numbers a frame isn't free)
    if (this.frames.count % 30 === 0 && this.frames.length > 10)
      this.medianFrame = percentile(
        this.frames.values().sort((a, b) => a - b),
        50,
      );
    if (isHitch(this.lastFrameMs, cpuMs, this.medianFrame)) {
      this.hitchLog.push({
        at: Math.round(this.t0),
        frameMs: Math.round(this.lastFrameMs),
        cpuMs: Math.round(cpuMs),
        top: topSystems(this.acc),
      });
      if (this.hitchLog.length > HITCH_LOG) this.hitchLog.shift();
    }
    for (const [k, v] of this.acc) {
      let r = this.buckets.get(k);
      if (r === undefined) {
        r = new Ring(WINDOW);
        // Back-fill zeros so a late bucket's mean is per frame, not per hit
        for (let i = 0; i < this.cpu.length - 1; i++) r.push(0);
        this.buckets.set(k, r);
      }
      r.push(v);
    }
    for (const [k, r] of this.buckets) if (!this.acc.has(k)) r.push(0);
    this.acc.clear();
    this.sampleHeap(t);
    if (this.overlay !== null && t - this.overlayAt > 500) {
      this.overlayAt = t;
      this.overlay.textContent = this.text();
    }
  }

  private sampleHeap(t: number) {
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    if (mem === undefined) return;
    const h = mem.usedJSHeapSize;
    if (this.heapT === 0) {
      this.heapT = t;
      this.heapLast = h;
      return;
    }
    if (h > this.heapLast) this.heapGrow += h - this.heapLast;
    this.heapLast = h;
    if (t - this.heapT >= 2000) {
      this.allocMBps = this.heapGrow / 1e6 / ((t - this.heapT) / 1000);
      this.heapGrow = 0;
      this.heapT = t;
    }
  }

  reset() {
    this.frames.clear();
    this.cpu.clear();
    this.buckets.clear();
    this.acc.clear();
    this.longTasks = { count: 0, totalMs: 0, maxMs: 0 };
    this.hitchLog = [];
    this.lastRaf = 0;
  }

  snapshot(): PerfSnapshot {
    const r = this.renderer;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return {
      frame: summarize(this.frames.values()),
      cpu: summarize(this.cpu.values()),
      systems: summarizeBuckets(this.buckets),
      render:
        r === null
          ? null
          : {
              calls: r.info.render.calls,
              triangles: r.info.render.triangles,
              points: r.info.render.points,
              lines: r.info.render.lines,
              programs: r.info.programs?.length ?? 0,
              textures: r.info.memory.textures,
              geometries: r.info.memory.geometries,
              pixelRatio: r.getPixelRatio(),
              width: r.domElement.width,
              height: r.domElement.height,
            },
      heapMB: mem === undefined ? null : mem.usedJSHeapSize / 1e6,
      allocMBps: this.allocMBps,
      longTasks: { ...this.longTasks },
      hitchLog: this.hitchLog.slice(),
      extra: { ...this.extra },
    };
  }

  private text(): string {
    const s = this.snapshot();
    const f = s.frame;
    const lines = [
      `${f.fps.toFixed(0)} fps  frame p50 ${f.p50.toFixed(1)} p95 ${f.p95.toFixed(1)} p99 ${f.p99.toFixed(1)} max ${f.max.toFixed(0)} ms  hitches ${f.hitches}`,
      `cpu p50 ${s.cpu.p50.toFixed(1)} p95 ${s.cpu.p95.toFixed(1)} ms   long tasks ${s.longTasks.count} (max ${s.longTasks.maxMs.toFixed(0)} ms)`,
    ];
    if (s.render !== null) {
      const g = s.render;
      lines.push(
        `draws ${g.calls}  tris ${(g.triangles / 1000).toFixed(0)}k  progs ${g.programs}  tex ${g.textures}  geo ${g.geometries}  ${g.width}×${g.height} @${g.pixelRatio.toFixed(2)}`,
      );
    }
    if (s.heapMB !== null)
      lines.push(
        `heap ${s.heapMB.toFixed(0)} MB  alloc ${s.allocMBps === null ? '…' : s.allocMBps.toFixed(1)} MB/s`,
      );
    for (const [k, v] of Object.entries(s.extra)) lines.push(`${k}: ${String(v)}`);
    for (const b of s.systems.slice(0, 12))
      lines.push(`${b.name.padEnd(12)} ${b.mean.toFixed(2).padStart(6)}  p95 ${b.p95.toFixed(2)}`);
    return lines.join('\n');
  }
}

/** The one probe (Game turns it on; everything else just calls lap()). */
export const perf = new Probe();

/** ?perf=1 (overlay) or ?perf=quiet (numbers for scripts, no overlay). */
export function perfParam(search = typeof window === 'undefined' ? '' : window.location.search) {
  const v = new URLSearchParams(search).get('perf');
  if (v === null || v === '0') return null;
  return { overlay: v !== 'quiet' };
}
