// ── The Big Drop's SSX course (a PeakSystem) ────────────────────────────
//
// Runs the course laid out in courseSpec.ts (the terrain carves its lines,
// courseProps.ts builds what stands on it):
//   - the governor: on the course's snow a grounded board is held to
//     courseCap(s) (the excess bleeds off smoothly), ×1.45 while boosting;
//   - boost: the meter fills from air, grabs, grinds and landed combos and
//     drains on a bail (boostMeter.ts); Tab / gamepad X / the touch button
//     burns it, boost pads give a free burn; speed lines, an FOV kick and a
//     whoosh while it burns;
//   - grinds: the course's rails are in the game's RailSet; a board falling
//     onto one within a couple of metres is pulled onto it (SSX-style
//     magnet rails), and the Player's own grind takes over;
//   - the run: START gate → checkpoints → FINISH, a split at each against
//     your best, the best kept on this device (courseRun.ts);
//   - the HUD (courseHud.ts) and a dark vignette inside the caves.
// Nothing here counts toward stats (the Big Drop suspends them).

import type { PeakCtx, PeakSystem, PeakSystemFactory } from './contract';
import type { LineSample } from './track';

import * as THREE from 'three';

import {
  BOOST,
  bailBoost,
  createBoost,
  fillFromCombo,
  fillFromRiding,
  governSpeed,
  padBoost,
  stepBoost,
  tapBoost,
} from './boostMeter';
import { insideCave, linePoint, railPoints } from './courseGeom';
import { CourseHud } from './courseHud';
import { CourseProps } from './courseProps';
import {
  createRun,
  formatDelta,
  formatTime,
  loadCourseBest,
  type RunEvent,
  saveCourseBest,
  stepRun,
} from './courseRun';
import {
  BOOSTS,
  BRANCH,
  CAVES,
  CHECKPOINTS,
  COURSE,
  courseCap,
  courseSectionName,
  onBranch,
  PAD,
  RAILS,
} from './courseSpec';
import { branchLateral } from './terrainCarve';
import { lineAt, TRACK } from './track';

/** Pulled onto a rail from this far (m, across) and this high over it (m). */
const MAGNET = { across: 2.2, above: 2.8, below: 0.4 } as const;
/** Gates count you through within this far past the lane edge (m). */
const GATE_MARGIN = 8;

interface Pad {
  x: number;
  y: number;
  z: number;
  lat: number;
  line: 'main' | 'branch';
  s: number;
  cool: number;
}

interface MagnetRail {
  s0: number;
  s1: number;
  /** Peak coordinates of the grind line, flat [x, y, z, …], evenly in s. */
  pts: number[];
}

class Course implements PeakSystem {
  private props: CourseProps;
  private hud: CourseHud | null = null;
  private boost = createBoost();
  private run = createRun(loadCourseBest());
  private events: RunEvent[] = [];
  private pads: Pad[];
  private rails: MagnetRail[];
  private ln: LineSample = { cx: 0, dcx: 0, w: 0, gully: 0, cruise: 0, feats: [] };
  private touchBoost = false;
  private lastState = '';
  private lastBanked: unknown = null;
  private lastSection = '';
  private local = new THREE.Vector3();
  /** Read by the browser test (window.__w2): the last frame's numbers. */
  readonly debug = { s: 0, lat: 0, latB: NaN, cap: 0, speed: 0, burning: false, onCourse: false };

  constructor(private ctx: PeakCtx) {
    this.props = new CourseProps(ctx);
    const p = { x: 0, y: 0, z: 0 };
    this.pads = BOOSTS.map(b => {
      linePoint(b.line, b.s, b.lat, p);
      return { x: p.x, y: p.y, z: p.z, lat: b.lat, line: b.line, s: b.s, cool: 0 };
    });
    this.rails = RAILS.map(r => {
      const pts = railPoints(r);
      if (r.look === 'log') for (let i = 1; i < pts.length; i += 3) pts[i] = pts[i]! + 0.42;
      return { s0: r.s0, s1: r.s1, pts };
    });
    const parent = ctx.game.gfx.renderer.domElement.parentElement;
    if (parent !== null) this.hud = new CourseHud(parent, () => (this.touchBoost = true));
    this.lastBanked = ctx.game.player.combo.lastBanked;
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const g = ctx.game;
    const p = g.player;
    const rp = ctx.riderPeak;
    const s = Math.min(TRACK.end, Math.max(TRACK.start, rp.z));
    lineAt(s, this.ln);
    const ln = this.ln;
    const lat = (rp.x - ln.cx) / Math.sqrt(1 + ln.dcx * ln.dcx);
    const half = ln.w / 2;
    const branch = s <= COURSE.end && onBranch(s);
    const latB = branch ? branchLateral(rp.x, s, ln) : NaN;
    const near = (m: number) =>
      Math.abs(lat) < half + m || (branch && Math.abs(latB) < BRANCH.half + m);
    const onCourse = rp.z >= 0 && rp.z <= COURSE.end && near(COURSE.reach);

    this.props.update(dt, s);
    if (Math.random() < 0.02) this.props.checkRails();

    // ── Boost: fill, tap, burn ──
    const st = p.state;
    if (st === 'bail' && this.lastState !== 'bail') bailBoost(this.boost);
    this.lastState = st;
    const banked = p.combo.lastBanked;
    if (banked !== this.lastBanked) {
      this.lastBanked = banked;
      if (banked !== null && !banked.bailed) fillFromCombo(this.boost, banked.points);
    }
    if (p.mode === 'board')
      fillFromRiding(
        this.boost,
        dt,
        st === 'air' ? 'air' : st === 'grind' ? 'grind' : st === 'bail' ? 'other' : 'ground',
        p.grab !== null,
      );
    const tapped = g.input.last?.boostPressed === true || this.touchBoost;
    this.touchBoost = false;
    if (tapped && p.mode === 'board' && st !== 'bail') {
      const wasFull = this.boost.meter >= 0.999;
      if (tapBoost(this.boost)) {
        g.sfx.play('whoosh', { gain: 0.9, rate: 1.2 });
        if (wasFull) this.hud?.banner('TRICKY!', 1200);
      } else g.sfx.play('beep', { gain: 0.25, rate: 0.6 });
    }
    // Boost pads
    for (const pad of this.pads) {
      pad.cool = Math.max(0, pad.cool - dt);
      if (pad.cool > 0 || Math.abs(rp.z - pad.s) > PAD.len / 2 + 1) continue;
      const l = pad.line === 'branch' ? latB : lat;
      if (!(Math.abs(l - pad.lat) < PAD.half + 1) || rp.y - pad.y > 2.5) continue;
      pad.cool = 1.5;
      padBoost(this.boost);
      const sp = p.speed;
      if (sp > 1) p.vel.multiplyScalar((sp + BOOST.padKick) / sp);
      g.sfx.play('whoosh', { gain: 1, rate: 1.4 });
    }
    const burning = stepBoost(this.boost, dt);

    // ── The governor, and the burn's drive ──
    const grounded = p.mode === 'board' && (st === 'ground' || st === 'manual');
    const cap = courseCap(s);
    if (burning && grounded) {
      const sp = p.speed;
      const lim = (onCourse ? cap : Infinity) * BOOST.capK;
      if (sp < lim) {
        if (sp > 1) p.vel.multiplyScalar(Math.min(lim, sp + BOOST.accel * dt) / sp);
        else p.vel.addScaledVector(p.fwd, BOOST.accel * dt);
      }
    } else if (burning && st === 'grind' && p.grind !== null) {
      p.grind.speed += BOOST.accel * 0.5 * dt;
    }
    if (grounded && onCourse && Number.isFinite(cap)) {
      const sp = p.speed;
      const ns = governSpeed(sp, cap, burning, dt);
      if (ns < sp) p.vel.multiplyScalar(ns / sp);
    }

    // ── Magnet rails ──
    if (p.mode === 'board' && st === 'air' && p.grindCooldown <= 0 && p.vel.y < 2.5)
      this.magnet(rp.x, rp.y, rp.z);

    // ── The run ──
    this.events.length = 0;
    stepRun(this.run, dt, rp.z, () => near(GATE_MARGIN), this.events);
    for (const e of this.events) this.onEvent(e);

    // ── Effects ──
    g.cam.fovKick = burning ? (this.boost.tricky ? 16 : 11) : 0;
    let cave = false;
    for (const cv of CAVES) if (insideCave(cv, rp.x, rp.y, rp.z)) cave = true;
    const sec = courseSectionName(s);
    if (sec !== this.lastSection) {
      if (sec !== '' && this.run.phase === 'running') this.hud?.banner(sec, 1100);
      this.lastSection = sec;
    }

    // ── HUD ──
    const r = this.run;
    const best = r.best;
    const free = rp.z > COURSE.finish + 600 && r.phase !== 'running';
    let sub = best !== null ? `BEST ${formatTime(best.time)}` : 'NO TIME YET';
    let hint = '';
    if (r.phase === 'running') sub = `CP ${r.next}/${CHECKPOINTS.length} · ${sub}`;
    else if (r.phase === 'ready') hint = 'SSX COURSE: ride through the START gate';
    else if (r.phase === 'missed') hint = `MISSED ${r.missed}: R for another run`;
    else hint = 'R: run it again';
    this.hud?.update({
      clock: !free,
      time: formatTime(r.phase === 'ready' ? 0 : r.t),
      delta: r.phase === 'ready' ? '' : formatDelta(r.delta),
      deltaSign: Number.isFinite(r.delta) ? (r.delta > 0 ? 1 : -1) : 0,
      sub,
      hint,
      meter: this.boost.meter,
      full: this.boost.meter >= 0.999,
      burning,
      cave,
      touch: g.input.mode === 'touch',
    });
    const d = this.debug;
    d.s = s;
    d.lat = lat;
    d.latB = latB;
    d.cap = cap;
    d.speed = p.speed;
    d.burning = burning;
    d.onCourse = onCourse;
  }

  /** In the air over a course rail: pull the board onto its line, so the grind catches it. */
  private magnet(x: number, y: number, z: number) {
    for (const r of this.rails) {
      if (z < r.s0 || z > r.s1) continue;
      const n = r.pts.length / 3;
      const f = ((z - r.s0) / (r.s1 - r.s0)) * (n - 1);
      const i = Math.min(n - 2, Math.max(0, Math.floor(f)));
      const k = f - i;
      const P = r.pts;
      const rx = P[i * 3]! + (P[i * 3 + 3]! - P[i * 3]!) * k;
      const ry = P[i * 3 + 1]! + (P[i * 3 + 4]! - P[i * 3 + 1]!) * k;
      const rz = P[i * 3 + 2]! + (P[i * 3 + 5]! - P[i * 3 + 2]!) * k;
      const dy = y - ry;
      if (Math.hypot(x - rx, z - rz) > MAGNET.across || dy > MAGNET.above || dy < -MAGNET.below)
        continue;
      // Heading along it?
      const tx = P[i * 3 + 3]! - P[i * 3]!;
      const tz = P[i * 3 + 5]! - P[i * 3 + 2]!;
      const vel = this.ctx.game.player.vel;
      const hv = Math.hypot(vel.x, vel.z);
      if (hv < 2 || Math.abs(vel.x * tx + vel.z * tz) / (hv * Math.hypot(tx, tz)) < 0.75) continue;
      const pl = this.ctx.game.player;
      this.ctx.toLocal(rx, ry + 0.12, rz, this.local);
      pl.pos.copy(this.local);
      if (pl.vel.y < -1) pl.vel.y = -1;
      return;
    }
  }

  private onEvent(e: RunEvent) {
    const g = this.ctx.game;
    const hud = this.hud;
    if (e.type === 'start') {
      hud?.banner('GO!', 900);
      g.sfx.play('go', { gain: 0.8 });
    } else if (e.type === 'checkpoint') {
      hud?.banner(CHECKPOINTS[e.index]!.name, 1400, `${formatTime(e.t)} ${formatDelta(e.delta)}`);
      g.sfx.play('beep', { gain: 0.6, rate: 1.3 });
    } else if (e.type === 'missed') {
      hud?.banner(`MISSED ${e.name}`, 2600, 'R: back to the top');
      g.sfx.play('beep', { gain: 0.6, rate: 0.5 });
    } else if (e.type === 'finish') {
      hud?.banner(
        e.newBest ? 'NEW BEST!' : 'FINISH',
        5000,
        `${formatTime(e.t)} ${formatDelta(e.delta)}`.trim(),
      );
      g.sfx.play(e.newBest ? 'sparkle' : 'go', { gain: 0.9 });
      if (e.newBest && this.run.best !== null) saveCourseBest(this.run.best);
    }
  }

  rebase(): void {
    this.props.rebase();
  }

  dispose(): void {
    this.ctx.game.cam.fovKick = 0;
    this.props.dispose();
    this.hud?.dispose();
    this.hud = null;
  }
}

/** The live course (the browser test reads it through window.__w2). */
export let activeCourse: Course | null = null;

export const createCourse: PeakSystemFactory = ctx => {
  const c = new Course(ctx);
  activeCourse = c;
  const dispose = c.dispose.bind(c);
  c.dispose = () => {
    dispose();
    if (activeCourse === c) activeCourse = null;
  };
  return c;
};
