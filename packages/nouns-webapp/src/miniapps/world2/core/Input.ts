// ── Input — keyboard / mouse / gamepad / touch → game intents ───────────
//
// Skate-style "flick-it" trick input: the right stick (or mouse drag with
// the right button held, or a swipe on the right half of a touch screen)
// is a virtual stick. Pull it down to crouch/load, flick it up to pop.
// The direction you flick decides the trick. Keyboard players get a
// simpler Space-to-ollie + J/K/L/U flip keys scheme.

export type TrickInput =
  | 'ollie'
  | 'nollie'
  | 'kickflip'
  | 'heelflip'
  | 'shuvit'
  | 'fs_shuvit'
  | 'treflip'
  | 'hardflip'
  | 'varial'
  | 'impossible';

export type InputMode = 'keyboard' | 'gamepad' | 'touch';

export interface InputFrame {
  /** Left stick / WASD: x = right, y = forward. */
  moveX: number;
  moveY: number;
  /** Camera look delta this frame (pixels-ish). */
  lookX: number;
  lookY: number;
  /** Virtual flick stick (right stick / mouse drag / touch swipe), -1..1. */
  stickX: number;
  stickY: number;
  push: boolean;
  pushPressed: boolean;
  brake: boolean;
  crouch: boolean;
  manual: boolean;
  noseManual: boolean;
  grabL: boolean;
  grabR: boolean;
  sprint: boolean;
  jumpPressed: boolean;
  boardTogglePressed: boolean;
  cameraTogglePressed: boolean;
  micPressed: boolean;
  respawnPressed: boolean;
  emotePressed: number; // 0 none, 1..4
  /** Hold to spray paint. */
  spray: boolean;
  colorCyclePressed: boolean;
  tricks: TrickInput[];
  mode: InputMode;
}

const FLICK_WINDOW_MS = 260;
const DOWN_T = -0.55;
const UP_T = 0.55;

interface StickTracker {
  loadedAt: number; // time stick entered the "down" zone (ms), 0 = not loaded
  noseLoadedAt: number; // time stick entered the "up" zone (for nollie)
  lastX: number;
  lastY: number;
  passedLeft: boolean;
  passedRight: boolean;
}

function newTracker(): StickTracker {
  return {
    loadedAt: 0,
    noseLoadedAt: 0,
    lastX: 0,
    lastY: 0,
    passedLeft: false,
    passedRight: false,
  };
}

/** Classify a flick into a trick. Called every frame with the current stick. */
function trackFlick(t: StickTracker, x: number, y: number, now: number, out: TrickInput[]) {
  if (y < DOWN_T) {
    if (!t.loadedAt) {
      t.loadedAt = now;
      t.passedLeft = t.passedRight = false;
    }
    // Keep refreshing while held down so a slow load still counts.
    t.loadedAt = now;
  } else if (t.loadedAt) {
    if (x < -0.6) t.passedLeft = true;
    if (x > 0.6) t.passedRight = true;
    const dt = now - t.loadedAt;
    if (dt > FLICK_WINDOW_MS) {
      t.loadedAt = 0;
    } else if (y > UP_T) {
      // Released upward → pop
      if (t.passedLeft && x > 0.3) out.push('treflip');
      else if (t.passedRight && x < -0.3) out.push('hardflip');
      else if (x < -0.42) out.push('kickflip');
      else if (x > 0.42) out.push('heelflip');
      else out.push('ollie');
      t.loadedAt = 0;
    } else if (Math.abs(x) > 0.85 && y > -0.35 && y < 0.35) {
      out.push(x < 0 ? 'shuvit' : 'fs_shuvit');
      t.loadedAt = 0;
    }
  }
  // Nollie: load up, flick down
  if (y > UP_T && !t.loadedAt) {
    t.noseLoadedAt = now;
  } else if (t.noseLoadedAt && y < DOWN_T) {
    if (now - t.noseLoadedAt < FLICK_WINDOW_MS) out.push('nollie');
    t.noseLoadedAt = 0;
  } else if (t.noseLoadedAt && now - t.noseLoadedAt > FLICK_WINDOW_MS && y <= UP_T) {
    t.noseLoadedAt = 0;
  }
  t.lastX = x;
  t.lastY = y;
}

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private rmb = false;
  /** Left mouse held — sprays (hold + drag to paint) */
  private lmb = false;
  private mouseStick = { x: 0, y: 0 };
  private stickTracker = newTracker();
  private pendingTricks: TrickInput[] = [];
  private gamepadPrev: boolean[] = [];
  mode: InputMode = 'keyboard';
  pointerLocked = false;
  /** Mouse cursor in normalised device coords (-1..1, y up). */
  cursorX = 0;
  cursorY = 0;
  private _freeCursor = false;
  /**
   * On foot the mouse is a free cursor: left-drag paints where it points,
   * right-drag turns the camera, and the pointer is never locked.
   */
  get freeCursor() {
    return this._freeCursor;
  }
  set freeCursor(on: boolean) {
    if (on === this._freeCursor) return;
    this._freeCursor = on;
    this.el.style.cursor = on ? 'crosshair' : '';
    if (on && document.pointerLockElement === this.el) document.exitPointerLock?.();
  }

  // Touch state (driven by the React touch overlay)
  touch = {
    moveX: 0,
    moveY: 0,
    stickX: 0,
    stickY: 0,
    push: false,
    brake: false,
    grab: false,
    spray: false,
    lookX: 0,
    lookY: 0,
    boardToggle: false,
    jump: false,
    /** OLLIE button held: crouch to load, the release pops. */
    crouch: false,
  };

  private el: HTMLElement;
  private disposers: (() => void)[] = [];

  constructor(el: HTMLElement) {
    this.el = el;
    const on = <K extends keyof WindowEventMap>(
      target: Window | HTMLElement,
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };

    // macOS swallows keyups while ⌘ is held (e.g. ⌘⇧4 screenshots), which
    // left Shift "held" = stuck in a manual. Trust the event's modifier
    // flags over our key set, and drop everything when ⌘ is involved.
    const syncModifiers = (e: KeyboardEvent | MouseEvent) => {
      if (!e.shiftKey) {
        this.keys.delete('ShiftLeft');
        this.keys.delete('ShiftRight');
      }
      if (e.metaKey) this.keys.clear();
    };
    on(window, 'mousemove', syncModifiers);
    const onVis = () => this.keys.clear();
    document.addEventListener('visibilitychange', onVis);
    this.disposers.push(() => document.removeEventListener('visibilitychange', onVis));
    on(window, 'keydown', e => {
      syncModifiers(e);
      if (!this.enabled || isTyping(e)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code))
        e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.mode = 'keyboard';
    });
    on(window, 'keyup', e => {
      syncModifiers(e);
      if (e.key === 'Meta') this.keys.clear();
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    on(window, 'blur', () => {
      this.keys.clear();
      this.rmb = false;
      this.lmb = false;
    });
    on(el, 'contextmenu', e => e.preventDefault());
    on(el, 'mousedown', e => {
      if (e.button === 2) {
        this.rmb = true;
        this.mouseStick.x = this.mouseStick.y = 0;
      }
      if (e.button === 0 && this.enabled) this.lmb = true;
      if (
        e.button === 0 &&
        this.enabled &&
        !this._freeCursor &&
        !this.pointerLocked &&
        !('ontouchstart' in window)
      ) {
        el.requestPointerLock?.();
      }
      this.mode = 'keyboard';
    });
    on(window, 'mouseup', e => {
      if (e.button === 0) this.lmb = false;
      if (e.button === 2) {
        this.rmb = false;
        this.mouseStick.x = this.mouseStick.y = 0;
      }
    });
    on(window, 'mousemove', e => {
      const r = el.getBoundingClientRect();
      this.cursorX = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
      this.cursorY = -(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1);
      if (this._freeCursor) {
        // Free cursor: only a right-drag turns the camera
        if (this.rmb) {
          this.mouseDX += e.movementX;
          this.mouseDY += e.movementY;
        }
        return;
      }
      if (this.rmb) {
        // Mouse flick: drag down then up to ollie (screen-y inverted → stick-y)
        this.mouseStick.x = clamp(this.mouseStick.x + e.movementX / 70, -1, 1);
        this.mouseStick.y = clamp(this.mouseStick.y - e.movementY / 70, -1, 1);
      } else if (this.pointerLocked || e.buttons & 1) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    const plc = () => {
      this.pointerLocked = document.pointerLockElement === el;
    };
    document.addEventListener('pointerlockchange', plc);
    this.disposers.push(() => document.removeEventListener('pointerlockchange', plc));
  }

  private enabled = true;

  /** Disable while the game is backgrounded (keys cleared, pointer released). */
  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) {
      this.keys.clear();
      this.rmb = false;
      this.lmb = false;
      this.mouseDX = this.mouseDY = 0;
      if (document.pointerLockElement === this.el) document.exitPointerLock?.();
    }
  }

  dispose() {
    for (const d of this.disposers) d();
    if (document.pointerLockElement === this.el) document.exitPointerLock?.();
  }

  private key(...codes: string[]) {
    return codes.some(c => this.keys.has(c));
  }
  private keyPressed(...codes: string[]) {
    return codes.some(c => this.pressed.has(c));
  }

  /** Sample all devices. Call once per frame. */
  poll(now: number): InputFrame {
    const f: InputFrame = {
      moveX: 0,
      moveY: 0,
      lookX: this.mouseDX * 0.0022,
      lookY: this.mouseDY * 0.0022,
      stickX: 0,
      stickY: 0,
      push: false,
      pushPressed: false,
      brake: false,
      crouch: false,
      manual: false,
      noseManual: false,
      grabL: false,
      grabR: false,
      sprint: false,
      jumpPressed: false,
      boardTogglePressed: false,
      cameraTogglePressed: false,
      micPressed: false,
      respawnPressed: false,
      emotePressed: 0,
      spray: false,
      colorCyclePressed: false,
      tricks: [],
      mode: this.mode,
    };
    this.mouseDX = this.mouseDY = 0;

    // ── Keyboard ──
    f.moveX = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);
    f.moveY = (this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0);
    f.push = this.key('KeyW', 'ArrowUp');
    f.pushPressed = this.keyPressed('KeyW', 'ArrowUp');
    f.brake = this.key('KeyS', 'ArrowDown');
    f.crouch = this.key('Space');
    f.manual = this.key('ShiftLeft');
    f.noseManual = this.key('ShiftRight', 'KeyQ');
    f.sprint = this.key('ShiftLeft', 'ShiftRight');
    f.grabL = this.key('KeyI');
    f.grabR = this.key('KeyO');
    f.jumpPressed = this.keyPressed('Space');
    f.boardTogglePressed = this.keyPressed('KeyF', 'KeyE');
    f.cameraTogglePressed = this.keyPressed('KeyC');
    f.micPressed = this.keyPressed('KeyV');
    f.respawnPressed = this.keyPressed('KeyR');
    f.spray = this.key('KeyG') || this.lmb;
    f.colorCyclePressed = this.keyPressed('KeyT');
    f.emotePressed = this.keyPressed('Digit1')
      ? 1
      : this.keyPressed('Digit2')
        ? 2
        : this.keyPressed('Digit3')
          ? 3
          : 0;
    if (this.released.has('Space'))
      f.tricks.push(
        this.key('KeyJ')
          ? 'kickflip'
          : this.key('KeyL')
            ? 'heelflip'
            : this.key('KeyK')
              ? 'shuvit'
              : this.key('KeyU')
                ? 'treflip'
                : 'ollie',
      );
    if (this.keyPressed('KeyJ') && !this.key('Space')) f.tricks.push('kickflip');
    if (this.keyPressed('KeyL') && !this.key('Space')) f.tricks.push('heelflip');
    if (this.keyPressed('KeyK') && !this.key('Space')) f.tricks.push('shuvit');
    if (this.keyPressed('KeyU') && !this.key('Space')) f.tricks.push('treflip');
    if (this.keyPressed('KeyN')) f.tricks.push('nollie');

    // ── Mouse flick stick ──
    if (this.rmb) {
      f.stickX = this.mouseStick.x;
      f.stickY = this.mouseStick.y;
      // Spring back to centre so repeated flicks work without lifting the button
      this.mouseStick.x *= 0.86;
      this.mouseStick.y *= 0.86;
    }

    // ── Gamepad ──
    const pads = navigator.getGamepads?.() ?? [];
    const gp = Array.from(pads).find(p => p?.connected === true);
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const lx = dz(gp.axes[0] ?? 0);
      const ly = -dz(gp.axes[1] ?? 0);
      const rx = gp.axes[2] ?? 0;
      const ry = -(gp.axes[3] ?? 0);
      const btn = (i: number) => !!gp.buttons[i]?.pressed;
      const btnPressed = (i: number) => btn(i) && !this.gamepadPrev[i];
      const anyActive =
        Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0.3 ||
        gp.buttons.some(b => b.pressed);
      if (anyActive) this.mode = 'gamepad';
      if (this.mode === 'gamepad') {
        f.moveX = lx;
        f.moveY = ly;
        f.stickX = Math.abs(rx) > 0.12 ? rx : 0;
        f.stickY = Math.abs(ry) > 0.12 ? ry : 0;
        f.push = btn(0) || btn(2);
        f.pushPressed = btnPressed(0) || btnPressed(2);
        f.brake = btn(1);
        f.grabL = btn(6);
        f.grabR = btn(7);
        f.sprint = btn(10);
        f.jumpPressed = btnPressed(0);
        f.boardTogglePressed = btnPressed(3);
        f.cameraTogglePressed = btnPressed(8);
        f.respawnPressed = btnPressed(9) && false;
        f.micPressed = btnPressed(12);
        // On foot the right trigger sprays (Game decides by mode)
        f.spray = f.spray || btn(7);
        f.colorCyclePressed = f.colorCyclePressed || btnPressed(11);
        f.emotePressed = btnPressed(14) ? 1 : btnPressed(15) ? 2 : btnPressed(13) ? 3 : 0;
        f.lookX += (btn(4) ? -1 : 0) + (btn(5) ? 1 : 0) * 0.04;
        // Manual: right stick held gently back (no flick)
        f.manual = f.stickY < -0.25 && f.stickY > -0.6 && Math.abs(f.stickX) < 0.4;
        f.noseManual = f.stickY > 0.25 && f.stickY < 0.6 && Math.abs(f.stickX) < 0.4;
        f.crouch = f.stickY < DOWN_T;
      }
      this.gamepadPrev = gp.buttons.map(b => b.pressed);
    }

    // ── Touch ──
    if (
      this.mode === 'touch' ||
      this.touch.moveX ||
      this.touch.moveY ||
      this.touch.stickX ||
      this.touch.stickY
    ) {
      if (this.touch.moveX || this.touch.moveY) this.mode = 'touch';
      if (this.mode === 'touch') {
        f.moveX = this.touch.moveX;
        f.moveY = this.touch.moveY;
        f.stickX = this.touch.stickX;
        f.stickY = this.touch.stickY;
        f.push = this.touch.push || f.moveY > 0.55;
        f.brake = this.touch.brake;
        f.grabR = this.touch.grab;
        f.spray = f.spray || this.touch.spray;
        f.crouch = f.stickY < DOWN_T || this.touch.crouch;
        f.lookX += this.touch.lookX;
        f.lookY += this.touch.lookY;
        this.touch.lookX = this.touch.lookY = 0;
        if (this.touch.boardToggle) f.boardTogglePressed = true;
        if (this.touch.jump) f.jumpPressed = true;
        this.touch.boardToggle = false;
        this.touch.jump = false;
      }
    }

    // Flick recognition on whichever virtual stick is active
    if (this.mode !== 'keyboard' || this.rmb) {
      trackFlick(this.stickTracker, f.stickX, f.stickY, now, f.tricks);
      if (this.rmb && f.stickY < DOWN_T) f.crouch = true;
    }
    if (this.pendingTricks.length) {
      f.tricks.push(...this.pendingTricks);
      this.pendingTricks = [];
    }

    this.pressed.clear();
    this.released.clear();
    return f;
  }

  /** Inject a trick from UI (e.g. touch buttons). */
  queueTrick(t: TrickInput) {
    this.pendingTricks.push(t);
  }
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
