// ── Drives a NounCharacter's bones from the `sk` anim key ────────────────
//
// Like parkour's ParkourRig: call after NounCharacter.update (and after
// parkour's rig), the skydive pose fades in over the clip and back out.

import type { NounCharacter } from '../../character/NounCharacter';
import type { SkyAnim } from '../net/sk';

import { PoseDriver } from '../../breakdance/view/rig';

import { skyPose } from './poses';

export class SkyRig {
  private driver: PoseDriver | null = null;
  private head: unknown = undefined;
  private t = 0;
  w = 0;

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
    const target = pose !== null ? 1 : 0;
    this.w += (target - this.w) * (1 - Math.exp(-(pose !== null ? 6 : 12) * dt));
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
