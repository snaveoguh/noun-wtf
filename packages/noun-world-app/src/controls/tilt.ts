// Tilt steering from the accelerometer.
//
// The phone is held in landscape. Tilting it left/right like a tray (rotating
// about the screen's vertical axis) moves gravity along the screen's
// horizontal axis, which in device coordinates is ±y. We read
// `accelerationIncludingGravity`, take asin(gy / |g|) as the roll angle,
// subtract the calibrated neutral, apply a dead zone + response curve and
// low-pass the result into `value` (-1..1), which the touch layer feeds into
// the game's `input.touch.moveX` every frame.
//
// Platform quirks handled here:
//  - iOS reports gravity with the opposite sign to the spec / Android.
//  - landscape-primary vs landscape-secondary flips the device y axis.
//  - iOS 13+ needs DeviceMotionEvent.requestPermission() from a user gesture.

import { Capacitor } from '@capacitor/core';

type DME = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

/** 90 or 270 (landscape-primary / -secondary). 0 when unknown. */
function screenAngle(): number {
  const so = screen.orientation;
  if (so && typeof so.angle === 'number') return so.angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  if (typeof legacy === 'number') return legacy < 0 ? 270 : legacy;
  return 90;
}

export class Tilt {
  /** Smoothed steering, -1 (left) .. 1 (right). */
  value = 0;
  /** Raw roll in degrees after sign normalisation, before the offset. */
  rawDeg = 0;
  /** True while a devicemotion listener is attached. */
  listening = false;
  /** Set when at least one motion event with gravity data arrived. */
  hasData = false;

  range = 22;
  deadzone = 1.5;
  invert = false;
  offset = 0;
  /** >1 = finer control near the centre. */
  curve = 1.35;
  /** Per-event low-pass factor (devicemotion runs ~60 Hz). */
  smoothing = 0.28;

  private readonly ios = Capacitor.getPlatform() === 'ios';
  private handler = (e: DeviceMotionEvent) => this.onMotion(e);

  static supported(): boolean {
    return typeof DeviceMotionEvent !== 'undefined';
  }

  /** Must be called from a user gesture (tap) on iOS. */
  async requestPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
    if (!Tilt.supported()) return 'unsupported';
    const req = (DeviceMotionEvent as DME).requestPermission;
    if (typeof req !== 'function') return 'granted';
    try {
      return await req.call(DeviceMotionEvent);
    } catch {
      return 'denied';
    }
  }

  start() {
    if (this.listening || !Tilt.supported()) return;
    window.addEventListener('devicemotion', this.handler, { passive: true });
    this.listening = true;
  }

  stop() {
    if (!this.listening) return;
    window.removeEventListener('devicemotion', this.handler);
    this.listening = false;
    this.value = 0;
  }

  /** Make the current roll the neutral position. Returns the new offset. */
  calibrate(): number {
    this.offset = this.rawDeg;
    this.value = 0;
    return this.offset;
  }

  private onMotion(e: DeviceMotionEvent) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.y === null || g.y === undefined) return;
    const gx = g.x ?? 0;
    const gy = g.y;
    const gz = g.z ?? 0;
    const norm = Math.hypot(gx, gy, gz) || 9.81;
    const angle = screenAngle();
    const sign = (angle === 90 ? 1 : -1) * (this.ios ? -1 : 1) * (this.invert ? -1 : 1);
    const deg = (Math.asin(clamp(gy / norm, -1, 1)) * 180) / Math.PI;
    this.rawDeg = deg * sign;
    this.hasData = true;

    const d = this.rawDeg - this.offset;
    const mag = Math.abs(d);
    let target = 0;
    if (mag > this.deadzone) {
      const t = clamp((mag - this.deadzone) / Math.max(1, this.range - this.deadzone), 0, 1);
      target = Math.sign(d) * Math.pow(t, this.curve);
    }
    this.value += (target - this.value) * this.smoothing;
    if (Math.abs(this.value) < 0.004) this.value = 0;
  }
}

/** One shared instance: the launcher asks for permission, the touch layer reads it. */
export const tilt = new Tilt();
