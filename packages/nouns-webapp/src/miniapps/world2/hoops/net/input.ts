// ── BallerInput from keyboard, gamepad and touch ─────────────────────────
//
//   keyboard  WASD / arrows move (camera-relative), Space shoot (hold,
//             release), J / E pass, K / F move (crossover / steal),
//             Shift sprint, Q call for it
//   gamepad   standard layout: L stick, X shoot, A pass, B move, RT / RB
//             sprint, Y / LB call
//   touch     the view's touch overlay writes `touch` (stick + buttons)
//
// Buttons are levels; a tap shorter than a sample is latched so it still
// shows up as pressed once.

import type { CourtXform } from './court';

import { NO_INPUT, type BallerInput } from '../contract';

export interface TouchPad {
  /** Stick, screen-relative: x right, y up (forward), −1..1. */
  sx: number;
  sy: number;
  shoot: boolean;
  pass: boolean;
  move: boolean;
  sprint: boolean;
  call: boolean;
}

const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  shoot: ['Space'],
  pass: ['KeyJ', 'KeyE'],
  move: ['KeyK', 'KeyF'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  call: ['KeyQ'],
};
const ALL = new Set(Object.values(KEYS).flat());

export class BallerInputReader {
  touch: TouchPad = {
    sx: 0,
    sy: 0,
    shoot: false,
    pass: false,
    move: false,
    sprint: false,
    call: false,
  };
  /** Last device used (the view can show matching button hints). */
  device: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  private keys = new Set<string>();
  private tapped = new Set<string>();
  private off: (() => void)[] = [];
  private _c = { x: 0, z: 0 };

  attach() {
    if (this.off.length > 0) return;
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!ALL.has(e.code)) return;
      this.keys.add(e.code);
      this.tapped.add(e.code);
      this.device = 'keyboard';
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.code);
    const blur = () => this.keys.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    this.off.push(
      () => window.removeEventListener('keydown', down),
      () => window.removeEventListener('keyup', up),
      () => window.removeEventListener('blur', blur),
    );
  }

  detach() {
    for (const f of this.off) f();
    this.off = [];
    this.keys.clear();
    this.tapped.clear();
    this.touch = {
      sx: 0,
      sy: 0,
      shoot: false,
      pass: false,
      move: false,
      sprint: false,
      call: false,
    };
  }

  private k(codes: string[]) {
    return codes.some(c => this.keys.has(c) || this.tapped.has(c));
  }

  /**
   * One sample. `fwdX / fwdZ`: the camera's forward in world x / z (the
   * stick is camera-relative), `court` turns it into court space.
   */
  sample(fwdX: number, fwdZ: number, court: CourtXform | null): BallerInput {
    let sx = (this.k(KEYS.right) ? 1 : 0) - (this.k(KEYS.left) ? 1 : 0);
    let sy = (this.k(KEYS.up) ? 1 : 0) - (this.k(KEYS.down) ? 1 : 0);
    const out: BallerInput = {
      ...NO_INPUT,
      shoot: this.k(KEYS.shoot),
      pass: this.k(KEYS.pass),
      move: this.k(KEYS.move),
      sprint: this.k(KEYS.sprint),
      call: this.k(KEYS.call),
    };
    this.tapped.clear();
    const t = this.touch;
    if (t.sx !== 0 || t.sy !== 0 || t.shoot || t.pass || t.move || t.sprint || t.call) {
      this.device = 'touch';
      sx += t.sx;
      sy += t.sy;
      out.shoot ||= t.shoot;
      out.pass ||= t.pass;
      out.move ||= t.move;
      out.sprint ||= t.sprint;
      out.call ||= t.call;
    }
    const gp = Array.from(navigator.getGamepads?.() ?? []).find(p => p?.connected === true);
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const lx = dz(gp.axes[0] ?? 0);
      const ly = -dz(gp.axes[1] ?? 0);
      const b = (i: number) => gp.buttons[i]?.pressed === true;
      if (lx !== 0 || ly !== 0 || gp.buttons.some(q => q.pressed)) this.device = 'gamepad';
      sx += lx;
      sy += ly;
      out.shoot ||= b(2);
      out.pass ||= b(0);
      out.move ||= b(1);
      out.sprint ||= b(7) || b(5);
      out.call ||= b(3) || b(4);
    }
    const len = Math.hypot(sx, sy);
    if (len > 1) {
      sx /= len;
      sy /= len;
    }
    // Camera-relative → world (forward f, right = (−f.z, f.x)) → court
    const fl = Math.hypot(fwdX, fwdZ) || 1;
    const fx = fwdX / fl;
    const fz = fwdZ / fl;
    const wx = fx * sy - fz * sx;
    const wz = fz * sy + fx * sx;
    if (court !== null) {
      court.dirToCourt(wx, wz, this._c);
      out.moveX = this._c.x;
      out.moveZ = this._c.z;
    } else {
      out.moveX = wx;
      out.moveZ = wz;
    }
    return out;
  }
}
