// ── Noun Football: PadInput from gamepad, keyboard and touch ─────────────
//
// The console layout (contract.ts PadInput):
//   gamepad   L stick move · R stick skill flick / switch by direction
//             A pass · B shoot · X lob / cross · Y through ball
//             RT sprint · LT jockey / close control · RB finesse · LB switch
//             START pause menu · BACK camera
//   keyboard  WASD / arrows move · Shift sprint
//             J or E pass · Space or K shoot · L or Q lob / cross · I or F through
//             C or Tab switch · Ctrl or R finesse · Z jockey · V skill (in the move direction)
//             Esc menu · H camera
//   touch     FootballTouch (net/FootballUi.tsx) writes `touch`: a stick + buttons
//
// Movement is camera-relative and comes out in pitch space. Buttons are
// levels; a tap shorter than a frame is latched so the sim still sees it.

import type { PadInput, StadiumFrame } from '../contract';

import { NO_PAD } from '../contract';

export interface FootballTouchPad {
  /** Stick, screen-relative: x right, y up (forward), −1..1. */
  sx: number;
  sy: number;
  pass: boolean;
  shoot: boolean;
  lob: boolean;
  through: boolean;
  sprint: boolean;
  switchP: boolean;
  finesse: boolean;
  jockey: boolean;
}

export const NO_TOUCH: FootballTouchPad = {
  sx: 0,
  sy: 0,
  pass: false,
  shoot: false,
  lob: false,
  through: false,
  sprint: false,
  switchP: false,
  finesse: false,
  jockey: false,
};

const KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  pass: ['KeyJ', 'KeyE'],
  shoot: ['Space', 'KeyK'],
  lob: ['KeyL', 'KeyQ'],
  through: ['KeyI', 'KeyF'],
  switchP: ['KeyC', 'Tab'],
  finesse: ['ControlLeft', 'ControlRight', 'KeyR'],
  jockey: ['KeyZ'],
  skill: ['KeyV'],
  menu: ['Escape'],
  cam: ['KeyH'],
};
const ALL = new Set(Object.values(KEYS).flat());

export type FootballDevice = 'keyboard' | 'gamepad' | 'touch';

/** Pure: a camera-relative stick (screen x right, y forward) → pitch-space direction. */
export function stickToPitch(
  sx: number,
  sy: number,
  camFwdX: number,
  camFwdZ: number,
  frame: StadiumFrame,
  out: { x: number; z: number },
) {
  const fl = Math.hypot(camFwdX, camFwdZ) || 1;
  const fx = camFwdX / fl;
  const fz = camFwdZ / fl;
  // world: forward f, right = (−fz, fx)
  const wx = fx * sy - fz * sx;
  const wz = fz * sy + fx * sx;
  const c = Math.cos(frame.yaw);
  const s = Math.sin(frame.yaw);
  out.x = wx * c - wz * s;
  out.z = wx * s + wz * c;
  return out;
}

const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);

export class FootballInputReader {
  touch: FootballTouchPad = { ...NO_TOUCH };
  device: FootballDevice = 'keyboard';
  /** Edges for the mode (menu, camera) since the last sample. */
  menuPressed = false;
  camPressed = false;
  private keys = new Set<string>();
  private tapped = new Set<string>();
  private off: (() => void)[] = [];
  private gpPrev: boolean[] = [];
  private _p = { x: 0, z: 0 };

  attach() {
    if (this.off.length > 0) return;
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))
        return;
      if (!ALL.has(e.code)) return;
      // Tab / Space would move focus / scroll the page
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.tapped.add(e.code);
      this.device = 'keyboard';
      if (KEYS.menu.includes(e.code)) this.menuPressed = true;
      if (KEYS.cam.includes(e.code)) this.camPressed = true;
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
    this.touch = { ...NO_TOUCH };
    this.menuPressed = false;
    this.camPressed = false;
  }

  private k(codes: string[]) {
    return codes.some(c => this.keys.has(c) || this.tapped.has(c));
  }

  /** Read the edges (menu / camera) once. */
  takeEdges() {
    const out = { menu: this.menuPressed, cam: this.camPressed };
    this.menuPressed = false;
    this.camPressed = false;
    return out;
  }

  /** One sample in pitch space, given the camera's forward (world x / z). */
  sample(camFwdX: number, camFwdZ: number, frame: StadiumFrame): PadInput {
    let sx = (this.k(KEYS.right) ? 1 : 0) - (this.k(KEYS.left) ? 1 : 0);
    let sy = (this.k(KEYS.up) ? 1 : 0) - (this.k(KEYS.down) ? 1 : 0);
    let rsx = 0;
    let rsy = 0;
    const out: PadInput = {
      ...NO_PAD,
      sprint: this.k(KEYS.sprint),
      pass: this.k(KEYS.pass),
      shoot: this.k(KEYS.shoot),
      lob: this.k(KEYS.lob),
      through: this.k(KEYS.through),
      switchP: this.k(KEYS.switchP),
      finesse: this.k(KEYS.finesse),
      jockey: this.k(KEYS.jockey),
    };
    // V: a skill flick in the direction you're moving
    if (this.tapped.has('KeyV') && (sx !== 0 || sy !== 0)) {
      rsx = sx;
      rsy = sy;
    }
    this.tapped.clear();
    const t = this.touch;
    if (
      t.sx !== 0 ||
      t.sy !== 0 ||
      t.pass ||
      t.shoot ||
      t.lob ||
      t.through ||
      t.sprint ||
      t.switchP ||
      t.jockey
    ) {
      this.device = 'touch';
      sx += t.sx;
      sy += t.sy;
      out.pass ||= t.pass;
      out.shoot ||= t.shoot;
      out.lob ||= t.lob;
      out.through ||= t.through;
      out.sprint ||= t.sprint;
      out.switchP ||= t.switchP;
      out.finesse ||= t.finesse;
      out.jockey ||= t.jockey;
    }
    const gp = Array.from(navigator.getGamepads?.() ?? []).find(p => p?.connected === true);
    if (gp) {
      const b = (i: number) => gp.buttons[i]?.pressed === true;
      const lx = dz(gp.axes[0] ?? 0);
      const ly = -dz(gp.axes[1] ?? 0);
      const rx = dz(gp.axes[2] ?? 0);
      const ry = -dz(gp.axes[3] ?? 0);
      if (lx !== 0 || ly !== 0 || gp.buttons.some(q => q.pressed)) this.device = 'gamepad';
      sx += lx;
      sy += ly;
      rsx += rx;
      rsy += ry;
      out.pass ||= b(0);
      out.shoot ||= b(1);
      out.lob ||= b(2);
      out.through ||= b(3);
      out.switchP ||= b(4);
      out.finesse ||= b(5);
      out.jockey ||= b(6);
      out.sprint ||= b(7);
      // START / BACK edges
      if (b(9) && this.gpPrev[9] !== true) this.menuPressed = true;
      if (b(8) && this.gpPrev[8] !== true) this.camPressed = true;
      this.gpPrev = gp.buttons.map(q => q.pressed);
    }
    const len = Math.hypot(sx, sy);
    if (len > 1) {
      sx /= len;
      sy /= len;
    }
    const m = stickToPitch(sx, sy, camFwdX, camFwdZ, frame, this._p);
    out.mx = m.x;
    out.mz = m.z;
    const rl = Math.hypot(rsx, rsy);
    if (rl > 0) {
      const r = stickToPitch(
        rsx / Math.max(1, rl),
        rsy / Math.max(1, rl),
        camFwdX,
        camFwdZ,
        frame,
        this._p,
      );
      out.rx = r.x;
      out.rz = r.z;
    }
    return out;
  }
}
