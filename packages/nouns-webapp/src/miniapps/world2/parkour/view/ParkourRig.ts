// ── Drives a NounCharacter's bones from parkour anim keys ────────────────
//
// Call after NounCharacter.update (the mixer has posed the clip): the
// parkour pose fades in over the clip, moves crossfade into each other,
// and when the anim goes back to 'none' it fades out to the clip again.
// Every clip keys every bone, so nothing accumulates frame to frame.

import type { PoseOut } from '../../breakdance/view/pose';
import type { NounCharacter } from '../../character/NounCharacter';
import type { PkAnim } from '../contract';

import { PoseDriver, type Layer } from '../../breakdance/view/rig';

import { pkPose, snapIn } from './poses';

export class ParkourRig {
  private driver: PoseDriver | null = null;
  private head: unknown = undefined;
  /** Procedural weight over the clip (0..1). */
  w = 0;
  private cur: PoseOut | null = null;
  private prev: PoseOut | null = null;
  private kind: PkAnim['kind'] = 'none';
  /** Crossfade from the previous move (0..1). */
  private xk = 1;

  constructor(private ch: NounCharacter) {}

  /** Is a parkour pose showing (fully or fading)? */
  get active() {
    return this.w > 0.01;
  }

  update(dt: number, a: PkAnim) {
    const ch = this.ch;
    if (!ch.hasRig) return;
    // The GLB head arrives after the body: rebuild so the ground solve sees it
    if (this.driver === null || this.head !== ch.head) {
      this.driver = new PoseDriver(ch.root, ch.body, ch.body, ch.head);
      this.head = ch.head;
    }
    if (!this.driver.ok) return;
    const pose = pkPose(a);
    if (pose !== null) {
      if (a.kind !== this.kind && this.cur !== null && this.w > 0.05) {
        this.prev = this.cur;
        this.xk = 0;
      }
      this.kind = a.kind;
      this.cur = pose;
    } else this.kind = 'none';
    const target = pose !== null ? 1 : 0;
    const rate = pose !== null ? (snapIn(a.kind) ? 30 : 14) : 9;
    this.w += (target - this.w) * (1 - Math.exp(-rate * dt));
    if (this.w < 0.01 && pose === null) {
      this.w = 0;
      this.cur = this.prev = null;
      return;
    }
    if (this.cur === null) return;
    this.xk = Math.min(1, this.xk + dt / 0.14);
    const layers: Layer[] =
      this.prev !== null && this.xk < 1
        ? [
            { out: this.prev, w: 1 },
            { out: this.cur, w: this.xk * this.xk * (3 - 2 * this.xk) },
          ]
        : [{ out: this.cur, w: 1 }];
    if (this.xk >= 1) this.prev = null;
    this.driver.drive(dt, layers, this.w);
  }
}
