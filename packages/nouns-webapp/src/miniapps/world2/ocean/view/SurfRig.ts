// ── Drives a NounCharacter's bones from the `sf` anim key ────────────────
//
// Like skydive's SkyRig: call after NounCharacter.update; the surf pose
// fades in over the clip (~0.3 s) and back out when you walk out.

import type { NounCharacter } from '../../character/NounCharacter';
import type { SurfAnim } from '../net/sf';

import { PoseDriver } from '../../breakdance/view/rig';

import { surfPose } from './poses';

const FADE_IN = 0.3;
const FADE_OUT = 0.35;

export class SurfRig {
  private driver: PoseDriver | null = null;
  private head: unknown = undefined;
  private t = 0;
  private ramp = 0;
  w = 0;
  private last: ReturnType<typeof surfPose> = null;

  constructor(readonly ch: NounCharacter) {}

  get active() {
    return this.w > 0.01;
  }

  update(dt: number, a: SurfAnim) {
    const ch = this.ch;
    if (!ch.hasRig) return;
    if (this.driver === null || this.head !== ch.head) {
      this.driver = new PoseDriver(ch.root, ch.body, ch.body, ch.head);
      this.head = ch.head;
    }
    if (!this.driver.ok) return;
    this.t += dt;
    const pose = surfPose(a, this.t);
    this.ramp = Math.max(0, Math.min(1, this.ramp + (pose !== null ? dt / FADE_IN : -dt / FADE_OUT)));
    this.w = this.ramp * this.ramp * (3 - 2 * this.ramp);
    if (pose === null) {
      if (this.w < 0.01) {
        this.w = 0;
        this.last = null;
        return;
      }
    } else this.last = pose;
    if (this.last === null) return;
    this.driver.drive(dt, [{ out: this.last, w: 1 }], this.w);
  }
}
