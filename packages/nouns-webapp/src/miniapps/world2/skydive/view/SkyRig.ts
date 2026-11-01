// ── Drives a NounCharacter's bones from the `sk` anim key ────────────────
//
// Like parkour's ParkourRig: call after NounCharacter.update (and after
// parkour's rig), the skydive pose fades in over the clip and back out.

import type { NounCharacter } from '../../character/NounCharacter';
import type { SkyAnim } from '../net/sk';

import { PoseDriver } from '../../breakdance/view/rig';

import { skyPose } from './poses';

/** Seconds to blend the skydive pose in over the clip, and back out. */
export const FADE_IN = 0.5;
const FADE_OUT = 0.3;

export class SkyRig {
  private driver: PoseDriver | null = null;
  private head: unknown = undefined;
  private t = 0;
  w = 0;
  private ramp = 0;

  constructor(readonly ch: NounCharacter) {}

  get active() {
    return this.w > 0.01;
  }

  update(dt: number, a: SkyAnim, board: boolean) {
    const ch = this.ch;
    if (!ch.hasRig) return;
    if (this.driver === null || this.head !== ch.head) {
      this.driver = new PoseDriver(ch.root, ch.body, ch.body, ch.head);
      this.head = ch.head;
    }
    if (!this.driver.ok) return;
    this.t += dt;
    const pose = skyPose(a, board, this.t);
    // In: a steady ~0.5 s ramp, eased, out of whatever the fall clip shows
    // (the arms-spread air pose), never a snap; out: quicker
    this.ramp = Math.max(
      0,
      Math.min(1, this.ramp + (pose !== null ? dt / FADE_IN : -dt / FADE_OUT)),
    );
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

  private last: ReturnType<typeof skyPose> = null;
}
