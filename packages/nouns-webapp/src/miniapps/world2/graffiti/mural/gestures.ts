// ── Mural mode gestures: pen paints, fingers navigate (iPad habits) ─────
//
// Pure: a state machine fed pointer samples (from PointerEvents, coalesced
// ones included) that calls back paint / pan / zoom / undo / redo.
//
//   pen        paints, always. Once a pen has been seen, fingers never paint
//              (penOnly): one finger pans, two pan + pinch-zoom.
//   palm       while a pen is down, or within PALM_MS of it lifting, new
//              touches are ignored until they lift; so is any touch with a
//              big contact patch (the side of a hand).
//   fingers    without a pen: in 'paint' one finger paints, in 'move' it
//              pans; two fingers always navigate. A second finger landing
//              within CANCEL_MS of the first cancels the stroke it started
//              (it was the start of a pinch, not paint).
//   taps       two fingers down and up quickly without moving = undo, three
//              = redo (Procreate).
//   mouse      left button paints ('move': pans), middle / right pans, the
//              wheel zooms (the UI calls zoom itself for that).

export type PointerKind = 'pen' | 'touch' | 'mouse';

export interface GestureSample {
  id: number;
  type: PointerKind;
  x: number;
  y: number;
  /** ms */
  t: number;
  /** 0..1 as the browser reports it. */
  pressure: number;
  /** Contact size, CSS px (touch). */
  w: number;
  h: number;
  /** Mouse button that went down (0 left, 1 middle, 2 right). */
  button: number;
}

export interface GestureOut {
  paintStart(s: GestureSample): void;
  paintMove(s: GestureSample): void;
  paintEnd(s: GestureSample): void;
  /** The stroke so far should be thrown away. */
  paintCancel(): void;
  /** Screen-space drag (px). */
  pan(dx: number, dy: number): void;
  /** Scale the view by `factor` about the screen point (cx, cy). */
  zoom(factor: number, cx: number, cy: number): void;
  undo(): void;
  redo(): void;
}

export const PALM_MS = 500;
export const PALM_PX = 48;
export const CANCEL_MS = 260;
export const TAP_MS = 320;
export const TAP_SLOP = 14;

interface Touch {
  id: number;
  x: number;
  y: number;
  x0: number;
  y0: number;
  palm: boolean;
}

export class GestureClassifier {
  /** Fingers paint (no pen yet, and the paint/move toggle on paint). */
  fingerMode: 'paint' | 'move' = 'paint';
  /** Set once a pen shows up: from then on only the pen paints. */
  penOnly = false;

  private touches = new Map<number, Touch>();
  /** The pointer painting now (pen, finger or mouse), or null. */
  private painter: { id: number; type: PointerKind; t0: number; moved: number } | null = null;
  private penDown = false;
  private penUpAt = -Infinity;
  private mouseNav: { id: number; x: number; y: number } | null = null;
  // Two-finger navigation (pan + pinch)
  private navD = 0;
  private navX = 0;
  private navY = 0;
  // Tap detection across one touch gesture (first finger down → last up)
  private tapT0 = 0;
  private tapMax = 0;
  private tapMoved = false;
  private tapOk = false;

  constructor(private out: GestureOut) {}

  /** Is a pen or finger painting right now? */
  get painting() {
    return this.painter !== null;
  }

  private live(): Touch[] {
    const a: Touch[] = [];
    for (const t of this.touches.values()) if (!t.palm) a.push(t);
    return a;
  }

  private resetNav() {
    const l = this.live();
    if (l.length >= 2) {
      this.navX = (l[0].x + l[1].x) / 2;
      this.navY = (l[0].y + l[1].y) / 2;
      this.navD = Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y);
    } else if (l.length === 1) {
      this.navX = l[0].x;
      this.navY = l[0].y;
      this.navD = 0;
    }
  }

  down(s: GestureSample) {
    if (s.type === 'pen') {
      this.penOnly = true;
      this.penDown = true;
      // Whatever touches are on the glass now are a resting hand
      for (const t of this.touches.values()) t.palm = true;
      this.tapOk = false;
      if (this.painter !== null && this.painter.type !== 'pen') this.endPaint(s, true);
      if (this.painter === null) {
        this.painter = { id: s.id, type: 'pen', t0: s.t, moved: 0 };
        this.out.paintStart(s);
      }
      return;
    }
    if (s.type === 'mouse') {
      if (s.button === 0 && this.fingerMode === 'paint' && this.painter === null) {
        this.painter = { id: s.id, type: 'mouse', t0: s.t, moved: 0 };
        this.out.paintStart(s);
      } else this.mouseNav = { id: s.id, x: s.x, y: s.y };
      return;
    }
    // Touch
    const palm =
      this.penDown ||
      s.t - this.penUpAt < PALM_MS ||
      Math.max(s.w, s.h) > PALM_PX ||
      this.painter?.type === 'pen';
    this.touches.set(s.id, { id: s.id, x: s.x, y: s.y, x0: s.x, y0: s.y, palm });
    if (palm) return;
    const n = this.live().length;
    if (n === 1) {
      this.tapT0 = s.t;
      this.tapMax = 1;
      this.tapMoved = false;
      this.tapOk = true;
    } else this.tapMax = Math.max(this.tapMax, n);
    if (n === 1 && !this.penOnly && this.fingerMode === 'paint' && this.painter === null) {
      this.painter = { id: s.id, type: 'touch', t0: s.t, moved: 0 };
      this.out.paintStart(s);
      return;
    }
    if (n >= 2 && this.painter?.type === 'touch') {
      // A second finger: this is navigation. A stroke only just begun was
      // the first finger of the pinch, so it goes; a real one is kept
      const p = this.painter;
      if (s.t - p.t0 < CANCEL_MS || p.moved < TAP_SLOP) {
        this.painter = null;
        this.out.paintCancel();
      } else this.endPaint(s, false);
    }
    this.resetNav();
  }

  move(s: GestureSample) {
    const p = this.painter;
    if (p !== null && p.id === s.id) {
      if (s.type === 'touch') {
        const t = this.touches.get(s.id);
        if (t !== undefined) {
          p.moved = Math.max(p.moved, Math.hypot(s.x - t.x0, s.y - t.y0));
          t.x = s.x;
          t.y = s.y;
        }
      }
      this.out.paintMove(s);
      return;
    }
    if (s.type === 'mouse') {
      const m = this.mouseNav;
      if (m !== null && m.id === s.id) {
        this.out.pan(s.x - m.x, s.y - m.y);
        m.x = s.x;
        m.y = s.y;
      }
      return;
    }
    if (s.type !== 'touch') return;
    const t = this.touches.get(s.id);
    if (t === undefined) return;
    t.x = s.x;
    t.y = s.y;
    if (t.palm) return;
    if (Math.hypot(t.x - t.x0, t.y - t.y0) > TAP_SLOP) this.tapMoved = true;
    if (this.painter !== null) return;
    const l = this.live();
    if (l.length >= 2) {
      const cx = (l[0].x + l[1].x) / 2;
      const cy = (l[0].y + l[1].y) / 2;
      const d = Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y);
      this.out.pan(cx - this.navX, cy - this.navY);
      if (this.navD > 8 && d > 8) {
        const f = d / this.navD;
        if (Math.abs(f - 1) > 1e-4) this.out.zoom(f, cx, cy);
      }
      this.navX = cx;
      this.navY = cy;
      this.navD = d;
    } else if (l.length === 1) {
      this.out.pan(t.x - this.navX, t.y - this.navY);
      this.navX = t.x;
      this.navY = t.y;
    }
  }

  up(s: GestureSample, cancelled = false) {
    const p = this.painter;
    if (s.type === 'pen') {
      this.penDown = false;
      this.penUpAt = s.t;
    }
    if (p !== null && p.id === s.id) {
      this.touches.delete(s.id);
      if (cancelled && p.type !== 'pen') {
        this.painter = null;
        this.out.paintCancel();
      } else this.endPaint(s, false);
      if (s.type === 'touch') this.tapOk = false;
      return;
    }
    if (s.type === 'mouse') {
      if (this.mouseNav?.id === s.id) this.mouseNav = null;
      return;
    }
    const t = this.touches.get(s.id);
    if (t === undefined) return;
    this.touches.delete(s.id);
    if (t.palm) return;
    if (this.live().length === 0) {
      // The gesture is over: was it a quick multi-finger tap?
      const quick = s.t - this.tapT0 < TAP_MS;
      if (this.tapOk && !cancelled && quick && !this.tapMoved) {
        if (this.tapMax === 2) this.out.undo();
        else if (this.tapMax === 3) this.out.redo();
      }
      this.tapOk = false;
    } else this.resetNav();
  }

  private endPaint(s: GestureSample, cancel: boolean) {
    this.painter = null;
    if (cancel) this.out.paintCancel();
    else this.out.paintEnd(s);
  }

  /** Forget every pointer (mural mode closing, the page losing focus). */
  reset() {
    if (this.painter !== null) {
      this.painter = null;
      this.out.paintCancel();
    }
    this.touches.clear();
    this.mouseNav = null;
    this.penDown = false;
    this.tapOk = false;
  }
}
