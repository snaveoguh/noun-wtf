// ── Noun Football: the camera director ──────────────────────────────────
//
// Picks a shot (camFraming.ts) from the mode + the match, then damps the
// live camera toward it: position, look point and fov each ease on their
// own rate, and for a moment after the shot changes they ease slower, so
// a change of mode or a cinematic cut-in glides instead of snapping.
// Replays cut (hidden by the HUD's wipe). Pitch space throughout; `apply`
// maps the result into the world through the StadiumFrame.

import type { CamMode, PitchSpec, SimState, StadiumFrame, TeamId } from '../contract';

import * as THREE from 'three';

import { pitchToWorld } from '../contract';

import {
  broadcastShot,
  broadcastZoom,
  celebrationShot,
  highShot,
  leadPoint,
  playerShot,
  replayShot,
  setPieceShot,
  walkoutShot,
  type FrameCtx,
  type ReplayAngle,
  type Shot,
} from './camFraming';

export type ShotName =
  | 'broadcast'
  | 'player'
  | 'high'
  | 'walkout'
  | 'celebration'
  | 'setpiece'
  | 'goalcam'
  | 'tele';

const _w = { x: 0, y: 0, z: 0 };
const _look = new THREE.Vector3();

export interface CamExtras {
  /** The human-controlled footballer (player cam fallback). */
  controlled: string | null;
  /** Celebration subject (the last scorer) while a goal is being celebrated. */
  scorer: string | null;
  /** Seconds since the match view started (cinematic drift). */
  time: number;
}

export class FootballCamera {
  mode: CamMode = 'broadcast';
  focus: string | null = null;
  /** In broadcast mode, cut in to cinematic shots for walk-outs, goals and penalties. */
  auto = true;
  /** The shot that's live (HUD / tests). */
  shot: ShotName = 'broadcast';
  /** Replay: the angle and the goal the ball went in (pitch z). */
  replayAngle: ReplayAngle = 'goalcam';
  replayGoalZ = 0;
  readonly ctx: FrameCtx;
  readonly cur: Shot = { pos: { x: 0, y: 30, z: 0 }, look: { x: 0, y: 0, z: 0 }, fov: 40 };
  private primed = false;
  private glide = 0;
  private zoom = 0.3;
  private fx = 0;
  private fz = 0;
  private shake = 0;
  private shakeT = 0;
  reduceMotion = false;

  constructor(pitch: PitchSpec, stand: -1 | 1 = -1) {
    this.ctx = { pitch, aspect: 16 / 9, stand };
  }

  setPitch(p: PitchSpec) {
    this.ctx.pitch = p;
  }

  setMode(mode: CamMode, focus?: string | null) {
    if (focus !== undefined) this.focus = focus;
    if (mode === this.mode) return;
    const wasReplay = this.mode === 'replay';
    this.mode = mode;
    if (mode === 'replay' || wasReplay) this.cut();
    else this.glide = 1.3;
  }

  /** Snap next frame (replay in / out, a new match). */
  cut() {
    this.primed = false;
  }

  addShake(k: number) {
    if (this.reduceMotion) return;
    this.shake = Math.min(1, this.shake + k);
  }

  /** The shot for the state right now (unsmoothed). */
  target(s: SimState, ex: CamExtras): Shot {
    const ctx = this.ctx;
    const b = s.ball;
    const pitch = ctx.pitch;
    const find = (id: string | null) =>
      id === null ? undefined : s.players.find(p => p.id === id);
    const goalZFor = (team: TeamId) => (s.attackPlusZ === team ? 1 : -1) * (pitch.length / 2);
    if (this.mode === 'replay') {
      this.shot = this.replayAngle;
      return replayShot(this.replayAngle, b.x, b.y, b.z, this.replayGoalZ, ctx);
    }
    if (this.mode === 'high') {
      this.shot = 'high';
      return highShot(this.fz, ctx);
    }
    if (this.mode === 'player') {
      const p = find(this.focus) ?? find(ex.controlled);
      if (p !== undefined) {
        this.shot = 'player';
        return playerShot(p.x, p.z, s.attackPlusZ === p.team ? 1 : -1, ctx);
      }
    }
    const cine = this.mode === 'cinematic' || (this.mode === 'broadcast' && this.auto);
    if (cine) {
      if (s.phase === 'pregame') {
        this.shot = 'walkout';
        return walkoutShot(ex.time, ctx);
      }
      if (s.phase === 'goal') {
        const p = find(ex.scorer);
        if (p !== undefined) {
          this.shot = 'celebration';
          return celebrationShot(p.x, p.z, p.yaw, ex.time, ctx);
        }
      }
      const r = s.restart;
      if (
        r !== null &&
        (s.phase === 'restart' || s.phase === 'shootout') &&
        (r.kind === 'penalty' ||
          (this.mode === 'cinematic' && (r.kind === 'corner' || r.kind === 'free_kick')))
      ) {
        this.shot = 'setpiece';
        return setPieceShot(r.x, r.z, goalZFor(r.team), ctx);
      }
    }
    this.shot = 'broadcast';
    return broadcastShot(this.fx, this.fz, this.zoom, ctx);
  }

  /** Advance the director one frame; returns the live (smoothed) shot. */
  update(dt: number, s: SimState, ex: CamExtras, aspect: number): Shot {
    const ctx = this.ctx;
    ctx.aspect = aspect;
    const b = s.ball;
    // Broadcast focus: the ball, led, eased (z faster than x: play runs along it)
    const lead = leadPoint(b.x, b.z, b.vx, b.vz);
    const speed = Math.hypot(b.vx, b.vy, b.vz);
    const zt = broadcastZoom(b.x, b.y, b.z, speed, ctx.pitch);
    if (!this.primed) {
      this.fx = lead.x;
      this.fz = lead.z;
      this.zoom = zt;
    } else {
      this.fx += (lead.x - this.fx) * (1 - Math.exp(-2.2 * dt));
      this.fz += (lead.z - this.fz) * (1 - Math.exp(-3 * dt));
      this.zoom += (zt - this.zoom) * (1 - Math.exp(-(zt < this.zoom ? 2.4 : 0.9) * dt));
    }
    const prevShot = this.shot;
    const t = this.target(s, ex);
    if (this.shot !== prevShot && this.primed && this.mode !== 'replay') this.glide = 1.3;
    const c = this.cur;
    if (!this.primed) {
      c.pos = { ...t.pos };
      c.look = { ...t.look };
      c.fov = t.fov;
      this.primed = true;
      this.glide = 0;
      return c;
    }
    const slow = this.glide > 0 ? 0.35 + 0.65 * (1 - this.glide / 1.3) : 1;
    this.glide = Math.max(0, this.glide - dt);
    const rates =
      this.shot === 'broadcast'
        ? { p: 2.6, l: 4.5, f: 2.2 }
        : this.shot === 'goalcam' || this.shot === 'tele'
          ? { p: 4, l: 8, f: 4 }
          : { p: 2.2, l: 3.5, f: 2 };
    const kp = 1 - Math.exp(-rates.p * slow * dt);
    const kl = 1 - Math.exp(-rates.l * slow * dt);
    const kf = 1 - Math.exp(-rates.f * slow * dt);
    c.pos.x += (t.pos.x - c.pos.x) * kp;
    c.pos.y += (t.pos.y - c.pos.y) * kp;
    c.pos.z += (t.pos.z - c.pos.z) * kp;
    c.look.x += (t.look.x - c.look.x) * kl;
    c.look.y += (t.look.y - c.look.y) * kl;
    c.look.z += (t.look.z - c.look.z) * kl;
    c.fov += (t.fov - c.fov) * kf;
    this.shakeT += dt;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    return c;
  }

  /** Put the live shot on a camera (world space through the stadium frame). */
  apply(cam: THREE.PerspectiveCamera, frame: StadiumFrame) {
    const c = this.cur;
    pitchToWorld(frame, c.pos.x, c.pos.y, c.pos.z, _w);
    cam.position.set(_w.x, _w.y, _w.z);
    let lx = c.look.x;
    let ly = c.look.y;
    if (this.shake > 0.001) {
      const k = this.shake * this.shake * 0.35;
      lx += Math.sin(this.shakeT * 47) * k;
      ly += Math.sin(this.shakeT * 61 + 1) * k;
    }
    pitchToWorld(frame, lx, ly, c.look.z, _w);
    cam.up.set(0, 1, 0);
    cam.lookAt(_look.set(_w.x, _w.y, _w.z));
    if (Math.abs(cam.fov - c.fov) > 0.01) {
      cam.fov = c.fov;
      cam.updateProjectionMatrix();
    }
  }
}
