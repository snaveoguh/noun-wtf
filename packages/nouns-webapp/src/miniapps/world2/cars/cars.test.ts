import { describe, expect, it } from 'vitest';

import { VanSim, VAN } from '../van/physics';
import { controls, heightGround, run } from '../van/testGround';

import { CLOSE_S, DoorAnim, doorAngle, DOOR_OPEN, enterDelay, HOLD_S, OPEN_S } from './doors';
import { canLiftOff, FlightSim, HOVER_MIN, type FlightControls } from './flight';
import {
  followSpeed,
  gapAhead,
  laneLength,
  LANES,
  lanePoint,
  nearestS,
  parkSpot,
  planTraffic,
  PARK_SPOTS,
  ROAD_IN,
  ROAD_OUT,
  type LanePoint,
} from './lanes';
import { decodeCar, decodeParked, encodeCar, encodeParked } from './netCar';
import { CAR_IDS, CARS, isCarId, simParams } from './specs';

const flat = heightGround(() => 0);
const kmh = (s: VanSim) => s.forwardSpeed * 3.6;

describe('car specs', () => {
  it('every car has a house name, wheels inside its body, a seat inside the car', () => {
    expect(CAR_IDS.length).toBeGreaterThanOrEqual(8);
    for (const id of CAR_IDS) {
      const s = CARS[id];
      expect(s.id).toBe(id);
      expect(isCarId(id)).toBe(true);
      expect(s.name).toMatch(/^[\d '.A-Z]+$/);
      const g = s.geo;
      expect(g.axleF).toBeGreaterThan(0);
      expect(g.axleR).toBeLessThan(0);
      expect(g.axleF + g.wheelR).toBeLessThanOrEqual(g.length / 2 + 0.05);
      expect(-g.axleR + g.wheelR).toBeLessThanOrEqual(g.length / 2 + 0.05);
      expect(g.halfTrack + g.wheelW / 2).toBeLessThanOrEqual(g.width / 2 + 0.06);
      expect(Math.abs(g.seat[0])).toBeLessThan(g.width / 2);
      expect(g.seat[1]).toBeLessThan(g.height);
      expect(s.paints.length).toBeGreaterThanOrEqual(2);
    }
    expect(isCarId('van')).toBe(false);
    expect(isCarId('toString')).toBe(false);
  });

  it('three heroes: a flying roadster, a 1947 racer, a scissor-door supercar', () => {
    expect(CARS.roadstar.special).toBe('fly');
    expect(CARS.roadstar.flight).toBeDefined();
    expect(CARS.toro.doors).toBe('scissor');
    expect(CARS.cavallino.mass).toBeLessThan(CARS.toro.mass / 1.5);
    expect(CARS.toro.mu).toBeGreaterThan(CARS.cavallino.mu);
    expect(CARS.dip.special).toBe('hop');
  });

  it('simParams: centre of mass between the axles, springs sag as asked', () => {
    for (const id of CAR_IDS) {
      const s = CARS[id];
      const p = simParams(s);
      expect(p.frontZ).toBeCloseTo(-p.rearZ, 5);
      const sag = (p.mass * p.gravity) / 4 / p.spring;
      expect(sag).toBeCloseTo(s.sag, 5);
      expect(p.floorClear).toBeLessThan(p.comH);
      expect(p.bodyZ1).toBeGreaterThan(p.bodyZ0);
      // The van's own numbers are untouched
      expect(VAN.mass).toBe(2200);
    }
  });
});

// Heavy loops: generous timeouts for loaded CI boxes
describe('car physics (VanSim with each car)', { timeout: 120000 }, () => {
  it.each(CAR_IDS)('%s sits level on its wheels at rest', id => {
    const s = new VanSim(simParams(CARS[id]));
    s.place(0, 0, 0, 0);
    run(s, flat, 2, controls());
    expect(s.speed).toBeLessThan(0.05);
    expect(s.grounded).toBe(4);
    expect(s.up({ x: 0, y: 0, z: 0 }).y).toBeGreaterThan(0.999);
    // origin back on the ground (the model's wheels touch the road)
    const o = s.origin({ x: 0, y: 0, z: 0 });
    expect(Math.abs(o.y)).toBeLessThan(0.08);
  });

  it.each(CAR_IDS)('%s tops out near its top speed', id => {
    const spec = CARS[id];
    const s = new VanSim(simParams(spec));
    s.place(0, 0, 0, 0);
    let top = 0;
    run(s, flat, 40, controls({ throttle: 1 }), 60, () => (top = Math.max(top, kmh(s))));
    // (power-limited: the last few km/h come slowly)
    expect(top).toBeGreaterThan(spec.topKmh * 0.88);
    expect(top).toBeLessThan(spec.topKmh * 1.08);
  });

  it('the TORO pulls harder and corners flatter than the bubble car', () => {
    const t100 = (id: 'toro' | 'bubble') => {
      const s = new VanSim(simParams(CARS[id]));
      s.place(0, 0, 0, 0);
      let at = -1;
      run(s, flat, 20, controls({ throttle: 1 }), 60, t => {
        if (at < 0 && kmh(s) >= 80) at = t;
      });
      return at;
    };
    expect(t100('toro')).toBeGreaterThan(0);
    expect(t100('toro')).toBeLessThan(t100('bubble'));
  });

  it('a handbrake flick at speed gets the KAIDO sideways (it drifts)', () => {
    const s = new VanSim(simParams(CARS.kaido));
    s.place(0, 0, 0, 0);
    s.vel.z = 22;
    run(s, flat, 0.3, controls({ throttle: 0.6 }));
    let drifted = false;
    run(s, flat, 1.2, controls({ throttle: 0.6, steer: 1, handbrake: true }), 60, () => {
      if (s.drifting) drifted = true;
    });
    expect(drifted).toBe(true);
    // and it stays on its wheels
    run(s, flat, 3, controls());
    expect(s.up({ x: 0, y: 0, z: 0 }).y).toBeGreaterThan(0.9);
  });
});

describe('ROADSTAR flight', () => {
  const P = CARS.roadstar.flight!;
  const none: FlightControls = {
    throttle: 0,
    brake: 0,
    steer: 0,
    up: false,
    down: false,
    boost: false,
  };
  const fly = (
    f: FlightSim,
    secs: number,
    c: Partial<FlightControls>,
    ground: (x: number, z: number) => number = () => 0,
  ) => {
    let landed = false;
    for (let i = 0; i < secs * 60 && !landed; i++)
      landed = f.step(1 / 60, { ...none, ...c }, ground);
    return landed;
  };

  it('lifts off only at speed, on its wheels', () => {
    expect(canLiftOff(P, 5, 4)).toBe(false);
    expect(canLiftOff(P, P.liftSpeed + 1, 4)).toBe(true);
    expect(canLiftOff(P, P.liftSpeed + 1, 0)).toBe(false);
  });

  it('pops up and hovers with nothing held', () => {
    const f = new FlightSim(P);
    f.takeOff(0, 0, 0, 0, 16, 0);
    expect(fly(f, 3, {})).toBe(false);
    expect(f.y).toBeGreaterThanOrEqual(HOVER_MIN - 0.05);
    const y = f.y;
    fly(f, 2, {});
    expect(Math.abs(f.y - y)).toBeLessThan(0.6);
    // and drifts on forward, slowing
    expect(f.z).toBeGreaterThan(20);
    expect(f.speed).toBeLessThan(16);
  });

  it('climbs, turns, caps its speed, respects the ceiling', () => {
    const f = new FlightSim(P);
    f.takeOff(0, 0, 0, 0, 16, 0);
    fly(f, 4, { up: true, throttle: 1 });
    expect(f.y).toBeGreaterThan(20);
    expect(f.speed).toBeLessThanOrEqual(P.maxSpeed + 0.5);
    const yaw = f.yaw;
    fly(f, 1, { steer: 1, throttle: 1 });
    expect(f.yaw).toBeLessThan(yaw - 0.5);
    expect(f.roll).toBeGreaterThan(0.1);
    fly(f, 40, { up: true });
    expect(f.y).toBeLessThanOrEqual(P.ceiling + 0.01);
    // (500 km/h top: a few seconds of boost to get past it)
    fly(f, 8, { throttle: 1, boost: true });
    expect(f.speed).toBeGreaterThan(P.maxSpeed);
    expect(f.speed).toBeLessThanOrEqual(P.boostSpeed + 0.5);
  });

  it('rides over the roofs below it and lands by sinking', () => {
    const f = new FlightSim(P);
    f.takeOff(0, 0, 0, 0, 20, 0);
    const roof = (_x: number, z: number) => (z > 30 && z < 60 ? 12 : 0);
    fly(f, 2.5, { throttle: 1 }, roof);
    expect(f.z).toBeGreaterThan(35);
    expect(f.y).toBeGreaterThan(12);
    fly(f, 3, { throttle: 1 }, roof);
    expect(f.z).toBeGreaterThan(60);
    expect(fly(f, 8, { down: true }, roof)).toBe(true);
    expect(f.y).toBeCloseTo(roof(f.x, f.z), 5);
  });
});

describe('doors', () => {
  it('open in OPEN_S, hold, then close in CLOSE_S', () => {
    const d = new DoorAnim('scissor');
    d.openThenClose();
    let t = 0;
    while (d.phase !== 'open' && t < 5) {
      d.step(1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeCloseTo(OPEN_S, 1);
    expect(d.angle).toBeCloseTo(DOOR_OPEN.scissor, 5);
    expect(d.passable).toBe(true);
    let held = 0;
    while (d.phase === 'open') {
      d.step(1 / 60);
      held += 1 / 60;
    }
    expect(held).toBeCloseTo(HOLD_S, 1);
    let shut = 0;
    while (d.phase !== 'shut' && shut < 5) {
      d.step(1 / 60);
      shut += 1 / 60;
    }
    expect(shut).toBeCloseTo(CLOSE_S, 1);
    expect(d.angle).toBe(0);
  });

  it('scissor doors go up (more than 60°), eased; no doors never move', () => {
    expect(DOOR_OPEN.scissor).toBeGreaterThan(Math.PI / 3);
    expect(doorAngle('scissor', 0.5)).toBeCloseTo(DOOR_OPEN.scissor / 2, 5);
    expect(doorAngle('scissor', 0.1)).toBeLessThan(DOOR_OPEN.scissor * 0.1);
    const n = new DoorAnim('none');
    n.open();
    n.step(1);
    expect(n.angle).toBe(0);
    expect(n.passable).toBe(true);
    expect(enterDelay('none')).toBeLessThan(enterDelay('scissor'));
  });

  it('open() holds until close()', () => {
    const d = new DoorAnim('swing');
    d.open();
    for (let i = 0; i < 300; i++) d.step(1 / 60);
    expect(d.phase).toBe('open');
    d.close();
    for (let i = 0; i < 60; i++) d.step(1 / 60);
    expect(d.phase).toBe('shut');
  });
});

describe('ring road lanes', () => {
  const p: LanePoint = { x: 0, z: 0, yaw: 0 };

  it('every lane stays on the road, between the kerbs, and is continuous', () => {
    for (const l of LANES) {
      const P = laneLength(l);
      let prev: LanePoint | null = null;
      for (let s = 0; s <= P; s += 0.5) {
        lanePoint(l, s, p);
        const r = Math.max(Math.abs(p.x), Math.abs(p.z));
        expect(r).toBeGreaterThan(ROAD_IN + 1.2);
        expect(r).toBeLessThan(ROAD_OUT - 1.2);
        if (prev !== null) {
          expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThan(0.51);
          // heading points along the travel
          const hx = Math.sin(prev.yaw);
          const hz = Math.cos(prev.yaw);
          expect((p.x - prev.x) * hx + (p.z - prev.z) * hz).toBeGreaterThan(0.45);
        }
        prev = { ...p };
      }
    }
  });

  it('traffic keeps right: the kerb on the outer lane is on its right', () => {
    lanePoint(LANES[0], 0, p);
    // right of heading = (−cos yaw, sin yaw)
    const rx = -Math.cos(p.yaw);
    const rz = Math.sin(p.yaw);
    expect(p.x * rx + p.z * rz).toBeGreaterThan(0);
    lanePoint(LANES[1], 0, p);
    expect(p.x * -Math.cos(p.yaw) + p.z * Math.sin(p.yaw)).toBeLessThan(0);
  });

  it('nearestS finds the point back', () => {
    for (const s of [0, 37.5, 120, 333]) {
      lanePoint(LANES[0], s, p);
      const n = nearestS(LANES[0], p.x, p.z);
      expect(n.d).toBeLessThan(0.05);
      expect(Math.abs(n.s - s)).toBeLessThan(0.1);
    }
  });

  it('parked spots face along the traffic beside them', () => {
    for (let i = 0; i < PARK_SPOTS.length; i++) {
      const sp = parkSpot(i);
      const along = Math.abs(sp.z) > Math.abs(sp.x) ? 'x' : 'z';
      const f = along === 'x' ? Math.abs(Math.sin(sp.yaw)) : Math.abs(Math.cos(sp.yaw));
      expect(f).toBeGreaterThan(0.99);
    }
  });

  it('planTraffic parks every car once, spreads a few cruisers, deterministically', () => {
    const plan = planTraffic(CAR_IDS, { seed: 7, cruisers: 3, paints: () => 4 });
    const parked = plan.filter(p => p.kind === 'parked');
    const cruise = plan.filter(p => p.kind === 'cruise');
    expect(new Set(parked.map(p => p.car)).size).toBe(CAR_IDS.length);
    expect(new Set(parked.map(p => (p.kind === 'parked' ? p.spot : -1))).size).toBe(parked.length);
    expect(cruise.length).toBe(3);
    expect(cruise.every(c => c.kind === 'cruise' && c.car !== 'stompa' && c.speed <= 8)).toBe(true);
    expect(planTraffic(CAR_IDS, { seed: 7, cruisers: 3, paints: () => 4 })).toEqual(plan);
  });

  it('following: full speed with room, easing, stopped close behind', () => {
    expect(followSpeed(7, Infinity)).toBe(7);
    expect(followSpeed(7, 9)).toBeGreaterThan(0);
    expect(followSpeed(7, 9)).toBeLessThan(7);
    expect(followSpeed(7, 5)).toBe(0);
    expect(gapAhead(10, [5, 30, 400], 500)).toBe(20);
    expect(gapAhead(490, [5], 500)).toBe(15);
  });
});

describe('net: the car key', () => {
  it('round-trips id, paint and flags', () => {
    const k = encodeCar({
      id: 'roadstar',
      paint: 2,
      flying: true,
      doorsOpen: false,
      boosting: true,
    });
    expect(k).toBe('roadstar.5.2');
    expect(decodeCar(k)).toEqual({
      id: 'roadstar',
      paint: 2,
      flying: true,
      doorsOpen: false,
      boosting: true,
    });
    expect(decodeCar('toro.2')).toEqual({
      id: 'toro',
      paint: 0,
      flying: false,
      doorsOpen: true,
      boosting: false,
    });
  });

  it('rejects anything malformed (older / newer / hostile clients)', () => {
    for (const bad of [
      undefined,
      null,
      3,
      '',
      'van.0',
      'toro',
      'toro.99',
      'toro.8.0',
      'TORO.0',
      '__proto__.0',
      'x'.repeat(40),
    ])
      expect(decodeCar(bad)).toBeNull();
  });
});

describe('the car you got out of (lc)', () => {
  it('round-trips id, paint, position and heading (rounded to a cm)', () => {
    const lc = encodeParked({ id: 'roadstar', paint: 3, x: 12.3456, y: 0.5, z: -88.004, yaw: 7 });
    expect(lc[0]).toBe('roadstar.3');
    const p = decodeParked(JSON.parse(JSON.stringify(lc)));
    expect(p).not.toBeNull();
    expect(p!.id).toBe('roadstar');
    expect(p!.paint).toBe(3);
    expect(p!.x).toBeCloseTo(12.35, 5);
    expect(p!.z).toBeCloseTo(-88, 5);
    // the heading wraps into ±π but points the same way
    expect(Math.cos(p!.yaw)).toBeCloseTo(Math.cos(7), 2);
    expect(Math.sin(p!.yaw)).toBeCloseTo(Math.sin(7), 2);
  });

  it('every car id survives', () => {
    for (const id of CAR_IDS)
      expect(decodeParked(encodeParked({ id, paint: 1, x: 0, y: 0, z: 0, yaw: 0 }))?.id).toBe(id);
  });

  it('anything malformed is nothing', () => {
    for (const bad of [
      undefined,
      null,
      'toro.1',
      ['toro.1', 0, 0, 0],
      ['toro.1', 0, 0, 0, 0, 0],
      ['nope.1', 0, 0, 0, 0],
      ['toro.12', 0, 0, 0, 0],
      ['__proto__.1', 0, 0, 0, 0],
      ['toro.1', 0, Infinity, 0, 0],
      ['toro.1', 0, 0, 1e9, 0],
      ['toro.1', '0', 0, 0, 0],
      ['toro.1', 0, 0, 0, NaN],
    ])
      expect(decodeParked(bad)).toBeNull();
  });
});
