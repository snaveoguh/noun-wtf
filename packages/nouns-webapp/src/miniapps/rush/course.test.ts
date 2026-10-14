import { describe, expect, it } from 'vitest';

import {
  FINISH_LINE,
  HANGAR_GATE,
  NO_CONTROLS,
  VEHICLE_GATE,
  aiControls,
  buildCourse,
  groundY,
  laneCentre,
  mulberry32,
  newRacer,
  rideFor,
  stepRace,
  SKY_LANES,
  TOWN_LANES,
  type Controls,
  type Racer,
} from './course';

function run(racers: Racer[], seconds: number, ctl?: (r: Racer) => Controls) {
  const course = buildCourse();
  const rnd = mulberry32(1);
  const dt = 1 / 60;
  let clock = 0;
  const events = [];
  for (let i = 0; i < seconds * 60; i++) {
    clock += dt;
    const m = new Map<number, Controls>();
    for (const r of racers) m.set(r.id, ctl ? ctl(r) : aiControls(r, racers, course, clock, rnd));
    events.push(...stepRace(racers, course, m, dt, clock));
  }
  return { course, events };
}

describe('noun rush course', () => {
  it('runs downhill on the snow and flat through town', () => {
    expect(groundY(0, 0)).toBeGreaterThan(100);
    expect(groundY(200, 0)).toBeLessThan(groundY(100, 0));
    expect(groundY(500, 0)).toBe(0);
  });

  it('gives each zone its ride', () => {
    expect(rideFor(10, 'car', 'plane')).toBe('board');
    expect(rideFor(VEHICLE_GATE + 5, 'tractor', 'plane')).toBe('tractor');
    expect(rideFor(800, 'tractor', 'plane')).toBe('foot');
    expect(rideFor(1200, 'car', 'heli')).toBe('heli');
    expect(rideFor(FINISH_LINE + 1, 'car', 'heli')).toBe('foot');
  });

  it('picks the ride from the lane you cross the stall in', () => {
    const r = newRacer(0, 'T', true, laneCentre(TOWN_LANES, 1));
    r.s = VEHICLE_GATE - 1;
    r.ride = 'foot';
    r.speed = 17;
    const keep = () => ({ ...NO_CONTROLS });
    run([r], 0.5, keep);
    expect(r.town).toBe('moto');

    const f = newRacer(1, 'F', true, laneCentre(SKY_LANES, 0));
    f.s = HANGAR_GATE - 1;
    f.ride = 'foot';
    f.speed = 17;
    run([f], 0.5, keep);
    expect(f.sky).toBe('heli');
  });

  it('AI racers make it all the way to the dance floor', () => {
    const racers = [0, 1, 2, 3].map(i => newRacer(i, `R${i}`, false, (i - 1.5) * 3, 1));
    const { events } = run(racers, 160);
    expect(racers.every(r => r.finished)).toBe(true);
    expect(new Set(racers.map(r => r.place))).toEqual(new Set([1, 2, 3, 4]));
    expect(
      events.some(e => e.kind === 'ride' && e.text === 'SNOWBOARD') || racers[0]!.ride === 'foot',
    ).toBe(true);
    expect(racers.every(r => r.finishTime > 30 && r.finishTime < 160)).toBe(true);
  });

  it('a punch knocks the racer next to you silly', () => {
    const a = newRacer(0, 'A', true, 0);
    const b = newRacer(1, 'B', true, 1);
    a.s = b.s = 500;
    const course = buildCourse();
    const m = new Map<number, Controls>([
      [0, { ...NO_CONTROLS, punch: true }],
      [1, NO_CONTROLS],
    ]);
    const ev = stepRace([a, b], course, m, 1 / 60, 10);
    expect(ev.some(e => e.kind === 'punch' && e.other === b)).toBe(true);
    expect(b.stun).toBeGreaterThan(0);
    expect(a.stun).toBe(0);
  });
});
