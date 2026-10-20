// ── The Dragon Run in the game: rings in the sky, the clock, your ghost ───
//
// While you fly, the course's rings hang in the sky (one instanced draw
// call, plus the next ring lit up and pulsing). Flying through the Roost
// ring starts the clock; each checkpoint shows your split against your best;
// the Roost ring again stops it. Your best run is kept in this browser with
// its path (course.ts trace), and flies alongside you as a see-through ghost
// dragon the next time. Getting off the dragon drops the run.

import * as THREE from 'three';

import { CourseRun, courseLength, ghostAt, type CourseEvent, type Ring } from './course';
import { buildDragonMesh, flapWings, type DragonMesh } from './mesh';

export interface RaceUi {
  /** The clock is running. */
  on: boolean;
  /** Next ring (1-based) / how many. */
  ring: number;
  total: number;
  ms: number;
  /** Next ring's name (checkpoints) and distance (m). */
  label: string | null;
  dist: number;
  best: number | null;
  /** Your last finished time. */
  last: number | null;
  /** Near the start, not racing: say how to start. */
  hint: boolean;
}

export interface RaceHost {
  scene: THREE.Object3D;
  notice(text: string): void;
  sound?(id: 'mission-complete' | 'ui-confirm' | 'crystal-chime'): void;
}

interface Best {
  /** Course fingerprint (rounded length): a changed course drops old bests. */
  course: number;
  ms: number;
  splits: number[];
  trace: number[];
}

const STORE = 'noun-world-dragon-run-v1';
/** Show "fly through the Roost ring" this close to it (m). */
const HINT_R = 1500;

export function fmtRaceMs(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

function loadBest(course: number): Best | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw === null) return null;
    const b = JSON.parse(raw) as Best;
    if (b.course !== course || !Number.isFinite(b.ms) || !Array.isArray(b.trace)) return null;
    return b;
  } catch {
    return null;
  }
}

function saveBest(b: Best) {
  try {
    localStorage.setItem(STORE, JSON.stringify(b));
  } catch {
    // no storage: the best lasts this page
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _g = { x: 0, y: 0, z: 0, yaw: 0 };
const _e = new THREE.Euler();

export class DragonRace {
  ui: RaceUi | null = null;
  run: CourseRun | null = null;
  private best: Best | null = null;
  private last: number | null = null;
  private fingerprint = 0;
  private rings: readonly Ring[] = [];
  private ringMesh: THREE.InstancedMesh | null = null;
  private nextMesh: THREE.Mesh | null = null;
  private ghost: DragonMesh | null = null;
  private ghostFlap = 0;
  private shown = false;
  private disposables: { dispose(): void }[] = [];
  private pulse = 0;

  constructor(private host: RaceHost) {}

  /** The course (once the towns resolve). */
  setCourse(rings: readonly Ring[]) {
    if (this.rings === rings || rings.length < 2) return;
    this.rings = rings;
    this.fingerprint = Math.round(courseLength(rings));
    this.best = loadBest(this.fingerprint);
    this.build();
  }

  get ready(): boolean {
    return this.rings.length >= 2;
  }

  get bestMs(): number | null {
    return this.best?.ms ?? null;
  }

  private build() {
    this.disposeMeshes();
    const n = this.rings.length;
    const geo = new THREE.TorusGeometry(1, 0.07, 6, 28);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc110, fog: true });
    mat.name = 'DragonRing';
    const inst = new THREE.InstancedMesh(geo, mat, n);
    inst.name = 'DragonRunRings';
    inst.frustumCulled = false;
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      this.ringMatrix(i, 1, _m);
      inst.setMatrixAt(i, _m);
      inst.setColorAt(i, col.set(this.rings[i]!.label !== null ? 0xff5fd2 : 0xffc110));
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor !== null) inst.instanceColor.needsUpdate = true;
    const nextMat = new THREE.MeshBasicMaterial({ color: 0x4bea69, fog: false });
    nextMat.name = 'DragonRingNext';
    const next = new THREE.Mesh(new THREE.TorusGeometry(1, 0.11, 6, 32), nextMat);
    next.frustumCulled = false;
    this.ringMesh = inst;
    this.nextMesh = next;
    this.disposables.push(geo, mat, next.geometry, nextMat);
  }

  /** Ring i facing along the course (from the ring before toward the one after). */
  private ringMatrix(i: number, scale: number, out: THREE.Matrix4) {
    const r = this.rings[i]!;
    const a = this.rings[Math.max(0, i - 1)]!;
    const b = this.rings[Math.min(this.rings.length - 1, i + 1)]!;
    _d.set(b.x - a.x, 0, b.z - a.z);
    if (_d.lengthSq() < 1) _d.set(0, 0, 1);
    _q.setFromUnitVectors(_z, _d.normalize());
    _s.setScalar(r.r * scale);
    return out.compose(_p.set(r.x, r.y, r.z), _q, _s);
  }

  private show(on: boolean) {
    if (on === this.shown || this.ringMesh === null || this.nextMesh === null) return;
    this.shown = on;
    if (on) this.host.scene.add(this.ringMesh, this.nextMesh);
    else this.host.scene.remove(this.ringMesh, this.nextMesh);
    if (!on) this.hideGhost();
  }

  /** Off the dragon: the rings go, the run is dropped. */
  stop() {
    this.run = null;
    this.show(false);
    this.ui = null;
  }

  /** Every flying frame: the dragon moved from → to, facing yaw. */
  step(dt: number, from: THREE.Vector3, to: THREE.Vector3, yaw: number): CourseEvent[] {
    if (!this.ready) return [];
    this.show(true);
    this.run ??= new CourseRun(this.rings);
    const run = this.run;
    const ev = run.step(dt, from, to, yaw);
    for (const e of ev) this.onEvent(e);
    if (run.done) this.run = new CourseRun(this.rings);
    this.paint(dt, to);
    this.flyGhost(dt);
    return ev;
  }

  private onEvent(e: CourseEvent) {
    const best = this.best;
    if (e.t === 'start') {
      this.host.notice('🐉 DRAGON RUN · GO!');
      this.host.sound?.('ui-confirm');
    } else if (e.t === 'ring') {
      if (e.label === null) {
        this.host.sound?.('crystal-chime');
        return;
      }
      const split = best?.splits[e.index];
      const delta =
        split !== undefined
          ? ` (${e.ms <= split ? '−' : '+'}${fmtRaceMs(Math.abs(e.ms - split))})`
          : '';
      this.host.notice(`${e.label} · ${fmtRaceMs(e.ms)}${delta}`);
      this.host.sound?.('ui-confirm');
    } else {
      this.last = e.ms;
      const run = this.run!;
      const prev = best?.ms ?? null;
      if (prev === null || e.ms < prev) {
        this.best = {
          course: this.fingerprint,
          ms: e.ms,
          splits: [...run.splits],
          trace: [...run.trace],
        };
        saveBest(this.best);
        this.host.notice(
          prev === null
            ? `🏁 DRAGON RUN ${fmtRaceMs(e.ms)} · YOUR FIRST TIME`
            : `🏁 NEW BEST ${fmtRaceMs(e.ms)} (−${fmtRaceMs(prev - e.ms)})`,
        );
      } else this.host.notice(`🏁 ${fmtRaceMs(e.ms)} · BEST ${fmtRaceMs(prev)}`);
      this.host.sound?.('mission-complete');
    }
  }

  private paint(dt: number, at: THREE.Vector3) {
    const run = this.run!;
    const next = this.nextMesh!;
    const i = Math.min(run.next, this.rings.length - 1);
    this.pulse += dt * 4;
    this.ringMatrix(i, 1.05 + Math.sin(this.pulse) * 0.06, _m);
    next.matrixAutoUpdate = false;
    next.matrix.copy(_m);
    next.matrixWorldNeedsUpdate = true;
    const r = this.rings[i]!;
    const dist = Math.round(Math.hypot(r.x - at.x, r.y - at.y, r.z - at.z));
    const start = this.rings[0]!;
    const hint = !run.started && Math.hypot(start.x - at.x, start.z - at.z) < HINT_R;
    const ui: RaceUi = {
      on: run.started,
      ring: i + 1,
      total: this.rings.length,
      ms: Math.round(run.ms),
      label: r.label,
      dist,
      best: this.best?.ms ?? null,
      last: this.last,
      hint,
    };
    this.ui = ui;
  }

  private flyGhost(dt: number) {
    const run = this.run;
    const best = this.best;
    const pose =
      run !== null && run.started && best !== null ? ghostAt(best.trace, run.ms, _g) : null;
    if (pose === null) {
      this.hideGhost();
      return;
    }
    if (this.ghost === null) {
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      });
      mat.name = 'DragonGhost';
      this.disposables.push(mat);
      this.ghost = buildDragonMesh(false, false, mat);
    }
    const g = this.ghost.group;
    if (g.parent === null) this.host.scene.add(g);
    g.position.set(pose.x, pose.y, pose.z);
    g.quaternion.setFromEuler(_e.set(0, pose.yaw, 0, 'YXZ'));
    this.ghostFlap += dt * 5;
    flapWings(this.ghost, this.ghostFlap);
  }

  private hideGhost() {
    const g = this.ghost?.group;
    if (g?.parent) g.parent.remove(g);
  }

  private disposeMeshes() {
    this.hideGhost();
    this.show(false);
    this.shown = false;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.ringMesh?.dispose();
    this.ringMesh = null;
    this.nextMesh = null;
    this.ghost = null;
  }

  dispose() {
    this.disposeMeshes();
  }
}
