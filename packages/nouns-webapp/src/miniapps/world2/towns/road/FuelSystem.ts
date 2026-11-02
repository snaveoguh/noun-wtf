// ── Fuel for cars (optional): gauge, burning, filling up at the pumps ────
//
// Only made when fuel is on (fuel.ts fuelEnabled); Game reads `game.fuel`
// in one place (Cars.drive scales the throttle by `throttleScale()`). While
// you drive it burns by distance; beside a pump (any station's, or Diesel
// Flats' travel center), nearly stopped, hold E (or FILL on touch) to fill.
// The tank level is kept in localStorage, so it's the same car-to-car.

import { townFrame, townToWorld } from '../site';

import { DIESEL_PUMPS } from './diesel';
import { FUEL, burn, pumpNear, refuel, throttleScale } from './fuel';
import { liveStationFrames, stationToWorld } from './pads';
import { pumpSpots } from './stations';

export interface FuelHost {
  labelLayer: HTMLElement;
  /** The car you're driving (world x/z, speed m/s, boosting or flying), else null. */
  car(): { x: number; z: number; speed: number; boosting: boolean } | null;
}

const LEVEL_KEY = 'noun-world-fuel-l';

export class FuelSystem {
  litres: number = FUEL.tank;
  private el: HTMLDivElement;
  private bar: HTMLDivElement;
  private label: HTMLSpanElement;
  private hint: HTMLDivElement;
  private btn: HTMLButtonElement;
  private last: { x: number; z: number } | null = null;
  private pumps: { x: number; z: number }[] = [];
  private pumpT = 0;
  private holdKey = false;
  private holdTouch = false;
  private near = false;
  private saveT = 0;

  constructor(private host: FuelHost) {
    try {
      const v = Number(localStorage.getItem(LEVEL_KEY));
      if (Number.isFinite(v) && localStorage.getItem(LEVEL_KEY) !== null)
        this.litres = Math.max(0, Math.min(FUEL.tank, v));
    } catch {
      /* private mode: a full tank each load */
    }
    const el = document.createElement('div');
    el.className = 'nf-fuel';
    el.style.cssText =
      'position:absolute;left:14px;bottom:96px;display:none;align-items:center;gap:6px;' +
      'background:rgba(0,0,0,.6);color:#fff;font:800 12px system-ui,sans-serif;padding:4px 9px;border-radius:999px;pointer-events:none';
    el.innerHTML = '<b>⛽</b>';
    const track = document.createElement('div');
    track.style.cssText = 'width:70px;height:8px;border-radius:4px;background:#333;overflow:hidden';
    this.bar = document.createElement('div');
    this.bar.style.cssText = 'height:100%;background:#2fbf71';
    track.appendChild(this.bar);
    this.label = document.createElement('span');
    el.append(track, this.label);
    this.hint = document.createElement('div');
    this.hint.style.cssText =
      'position:absolute;left:50%;bottom:30%;transform:translateX(-50%);display:none;background:#ffd400;color:#000;' +
      'font:900 italic 15px system-ui,sans-serif;padding:6px 14px;box-shadow:5px 5px 0 #d22209;white-space:nowrap;pointer-events:none';
    this.btn = document.createElement('button');
    this.btn.type = 'button';
    this.btn.textContent = 'FILL';
    this.btn.style.cssText =
      'position:absolute;right:22px;bottom:40%;width:80px;height:80px;border-radius:50%;display:none;background:#ffd400;' +
      'color:#000;border:3px solid #000;box-shadow:5px 5px 0 #d22209;font:900 italic 17px system-ui,sans-serif;touch-action:none';
    const down = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.holdTouch = true;
    };
    const up = () => {
      this.holdTouch = false;
    };
    this.btn.addEventListener('pointerdown', down);
    this.btn.addEventListener('pointerup', up);
    this.btn.addEventListener('pointercancel', up);
    this.btn.addEventListener('pointerleave', up);
    host.labelLayer.append(el, this.hint, this.btn);
    this.el = el;
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('keyup', this.onKeyUp, true);
  }

  /** Cars.drive: throttle multiplier (1 with fuel in the tank). */
  throttleScale(): number {
    return throttleScale(this.litres);
  }

  get empty(): boolean {
    return this.litres <= 0;
  }

  /** Every resolved pump (stations + Diesel Flats), refreshed every couple of seconds. */
  private refreshPumps() {
    const out: { x: number; z: number }[] = [];
    const w = { x: 0, z: 0 };
    for (const f of liveStationFrames())
      for (const p of pumpSpots(f, f.st)) out.push({ ...stationToWorld(f, p.vp, p.u, w) });
    const df = townFrame('diesel');
    if (df !== null) for (const p of DIESEL_PUMPS) out.push({ ...townToWorld(df, p.vp, p.u, w) });
    this.pumps = out;
  }

  update(dt: number) {
    const car = this.host.car();
    if (car === null) {
      this.last = null;
      this.near = false;
      this.show(false);
      return;
    }
    if (this.last !== null)
      this.litres = burn(
        this.litres,
        Math.hypot(car.x - this.last.x, car.z - this.last.z),
        car.boosting,
      );
    this.last = { x: car.x, z: car.z };
    this.pumpT -= dt;
    if (this.pumpT <= 0) {
      this.pumpT = 2;
      this.refreshPumps();
    }
    this.near = car.speed < FUEL.stillSpeed && pumpNear(this.pumps, car.x, car.z) !== null;
    if (this.near && (this.holdKey || this.holdTouch)) this.litres = refuel(this.litres, dt);
    this.saveT -= dt;
    if (this.saveT <= 0) {
      this.saveT = 3;
      try {
        localStorage.setItem(LEVEL_KEY, this.litres.toFixed(2));
      } catch {
        /* not kept */
      }
    }
    this.show(true);
  }

  private show(on: boolean) {
    const want = on ? 'flex' : 'none';
    if (this.el.style.display !== want) this.el.style.display = want;
    const frac = this.litres / FUEL.tank;
    this.bar.style.width = `${Math.round(frac * 100)}%`;
    this.bar.style.background = frac < FUEL.low ? '#f3322c' : '#2fbf71';
    const txt = this.litres <= 0 ? 'EMPTY' : `${Math.round(this.litres)} L`;
    if (this.label.textContent !== txt) this.label.textContent = txt;
    const touch = matchMedia?.('(pointer: coarse)').matches === true;
    const full = this.litres >= FUEL.tank - 0.05;
    const hint = on && this.near && !touch;
    this.hint.style.display = hint ? 'block' : 'none';
    if (hint) this.hint.textContent = full ? 'TANK FULL' : 'HOLD E — FILL UP ⛽';
    this.btn.style.display = on && this.near && touch && !full ? 'block' : 'none';
    if (!(on && this.near)) this.holdTouch = false;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code !== 'KeyE' || !this.near) return;
    // At a pump E fills up (instead of getting out of the car)
    e.stopPropagation();
    e.preventDefault();
    this.holdKey = true;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyE') this.holdKey = false;
  };

  dispose() {
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('keyup', this.onKeyUp, true);
    this.el.remove();
    this.hint.remove();
    this.btn.remove();
  }
}
