// ── FPS input: keyboard + mouse (pointer lock), gamepad, touch ─────────
//
// Same split as world2's core/Input: devices write raw state, and once per
// frame `sample()` folds it into a PlayerInput for the sim. View angles are
// absolute (the client owns its camera), which is also what a phase-2 host
// wants from each client.

import type { PlayerInput } from '../sim/types';

import { WEAPON_ORDER, type WeaponId } from '../sim/weapons';

export type InputMode = 'keyboard' | 'gamepad' | 'touch';

export interface TouchState {
  moveX: number;
  moveY: number;
  lookDX: number;
  lookDY: number;
  fire: boolean;
  jump: boolean;
  crouch: boolean;
  reload: boolean;
  scope: boolean;
  grenade: boolean;
  sprint: boolean;
}

export class FpsInput {
  private keys = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private lmb = false;
  private rmb = false;
  private wheel = 0;
  private gpPrev: boolean[] = [];
  private el: HTMLElement;
  mode: InputMode = 'keyboard';
  locked = false;
  yaw = 0;
  pitch = 0;
  /** Mouse sensitivity (rad per pixel). */
  sens = 0.0022;
  /** Touch look sensitivity multiplier. */
  touchSens = 1;
  invertY = false;
  /** FOV scale (scoped → slower look). */
  lookScale = 1;
  /** Aim assist slowdown (0..1) set by the game when near a target. */
  assist = 0;
  desired: WeaponId | null = null;
  owned: WeaponId[] = ['splatter', 'hopper'];
  private lastWeapon: WeaponId | null = null;
  readonly touch: TouchState = {
    moveX: 0,
    moveY: 0,
    lookDX: 0,
    lookDY: 0,
    fire: false,
    jump: false,
    crouch: false,
    reload: false,
    scope: false,
    grenade: false,
    sprint: false,
  };
  /** One-shot UI intents read by the game (V third person, Tab board). */
  viewTogglePressed = false;
  enabled = true;
  /** Debug (headless tests): accept mouse buttons/look without pointer lock. */
  unlockedMouse = false;
  private crouchToggle = false;
  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (!this.enabled) return;
    this.mode = 'keyboard';
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ControlLeft'].includes(e.code))
      e.preventDefault();
    if (!this.keys.has(e.code)) this.onPress(e.code);
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked && !this.unlockedMouse) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
    this.mode = 'keyboard';
  };
  private onMouseDown = (e: MouseEvent) => {
    if (!this.locked && !this.unlockedMouse) return;
    if (e.button === 0) this.lmb = true;
    if (e.button === 2) this.rmb = true;
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.lmb = false;
    if (e.button === 2) this.rmb = false;
  };
  private onWheel = (e: WheelEvent) => {
    if (!this.locked) return;
    this.wheel += Math.sign(e.deltaY);
  };
  private onContext = (e: Event) => e.preventDefault();
  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.el;
    if (!this.locked) {
      this.lmb = false;
      this.rmb = false;
      this.keys.clear();
    }
  };
  private onBlur = () => {
    this.keys.clear();
    this.lmb = false;
    this.rmb = false;
  };

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('blur', this.onBlur);
    el.addEventListener('contextmenu', this.onContext);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  requestLock() {
    if (this.locked) return;
    try {
      const r = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (r !== undefined && typeof r.catch === 'function') r.catch(() => undefined);
    } catch {
      // not allowed (no gesture) — the overlay asks for a click
    }
  }

  releaseLock() {
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  private onPress(code: string) {
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(code);
    if (n >= 0) this.selectWeapon(WEAPON_ORDER[n]);
    if (code === 'KeyQ' && this.lastWeapon !== null) this.selectWeapon(this.lastWeapon);
    if (code === 'KeyV') this.viewTogglePressed = true;
    if (code === 'KeyC') this.crouchToggle = !this.crouchToggle;
  }

  selectWeapon(w: WeaponId) {
    if (!this.owned.includes(w)) return;
    const cur = this.desired;
    if (cur !== null && cur !== w) this.lastWeapon = cur;
    this.desired = w;
  }

  cycleWeapon(dir: number) {
    const list = WEAPON_ORDER.filter(w => this.owned.includes(w));
    if (list.length === 0) return;
    const cur = this.desired ?? list[0];
    const i = list.indexOf(cur);
    this.selectWeapon(list[(i + dir + list.length) % list.length]);
  }

  /** Fold devices into one PlayerInput. `dt` for gamepad look. */
  sample(dt: number): PlayerInput {
    const k = (c: string) => this.keys.has(c);
    let moveX = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    let moveY = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    let fire = this.lmb;
    let scope = this.rmb;
    let jump = k('Space');
    let sprint = k('ShiftLeft') || k('ShiftRight');
    // Sprinting stands you back up from a toggled crouch
    if (sprint && this.crouchToggle) this.crouchToggle = false;
    let crouch = k('ControlLeft') || k('ControlRight') || this.crouchToggle;
    let reload = k('KeyR');
    let grenade = k('KeyG');
    const assistK = 1 - this.assist * 0.45;
    const sy = this.invertY ? -1 : 1;
    this.yaw -= this.mouseDX * this.sens * this.lookScale * assistK;
    this.pitch -= this.mouseDY * this.sens * this.lookScale * assistK * sy;
    this.mouseDX = 0;
    this.mouseDY = 0;
    if (this.wheel !== 0) {
      this.cycleWeapon(this.wheel > 0 ? 1 : -1);
      this.wheel = 0;
    }

    // Gamepad
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (gp === null || !gp.connected) continue;
      const ax = (i: number) => {
        const v = gp.axes[i] ?? 0;
        return Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85;
      };
      const btn = (i: number) => gp.buttons[i]?.pressed === true;
      const pressed = (i: number) => btn(i) && this.gpPrev[i] !== true;
      const lx = ax(0);
      const ly = ax(1);
      const rx = ax(2);
      const ry = ax(3);
      const any =
        Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0.05 ||
        gp.buttons.some(b => b.pressed);
      if (any) this.mode = 'gamepad';
      if (this.mode === 'gamepad') {
        moveX += lx;
        moveY -= ly;
        const curve = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 1.7);
        const rate = 3.4 * this.lookScale * assistK;
        this.yaw -= curve(rx) * rate * dt;
        this.pitch -= curve(ry) * rate * 0.7 * dt * sy;
        fire ||= (gp.buttons[7]?.value ?? 0) > 0.3;
        scope ||= (gp.buttons[6]?.value ?? 0) > 0.3;
        jump ||= btn(0);
        crouch ||= btn(1);
        reload ||= btn(2);
        grenade ||= btn(5);
        sprint ||= btn(10);
        if (pressed(3)) this.cycleWeapon(1);
        if (pressed(4)) this.cycleWeapon(-1);
        if (pressed(11) || pressed(8)) this.viewTogglePressed = true;
      }
      this.gpPrev = gp.buttons.map(b => b.pressed);
      break;
    }

    // Touch
    const t = this.touch;
    if (this.mode === 'touch') {
      moveX += t.moveX;
      moveY += t.moveY;
      this.yaw -= t.lookDX * 0.0055 * this.touchSens * this.lookScale * assistK;
      this.pitch -= t.lookDY * 0.0055 * this.touchSens * this.lookScale * assistK * sy;
      t.lookDX = 0;
      t.lookDY = 0;
      fire ||= t.fire;
      jump ||= t.jump;
      crouch ||= t.crouch;
      reload ||= t.reload;
      scope ||= t.scope;
      grenade ||= t.grenade;
      sprint ||= t.sprint || Math.hypot(t.moveX, t.moveY) > 0.95;
    }

    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    if (!this.enabled) {
      moveX = moveY = 0;
      fire = jump = crouch = reload = grenade = sprint = scope = false;
    }
    return {
      moveX: Math.max(-1, Math.min(1, moveX)),
      moveY: Math.max(-1, Math.min(1, moveY)),
      yaw: this.yaw,
      pitch: this.pitch,
      fire,
      jump,
      crouch,
      sprint,
      reload,
      scope,
      grenade,
      weapon: this.desired,
    };
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('blur', this.onBlur);
    this.el.removeEventListener('contextmenu', this.onContext);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.releaseLock();
  }
}
