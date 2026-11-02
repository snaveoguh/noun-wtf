import type { Game } from '../Game';

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { CollisionWorld } from '../physics/Collision';
import { VanSim } from '../van/physics';
import { controls, heightGround, run } from '../van/testGround';

import { BUGGY_FAR, BUGGY_WAKE, buggyAsleep, buggyPaint, cleanSpots, restOn, spotsKey } from './buggy';
import { whineHz } from './CarAudio';
import { CarSystem } from './Cars';
import { planTraffic } from './lanes';
import { triCount } from './kit';
import { buildCar } from './models';
import { passengerSeats, riderShown, SEATS, seatRoot } from './seats';
import { CAR_IDS, CARS, simParams, TRAFFIC_IDS } from './specs';

const B = CARS.buggy;
const flat = heightGround(() => 0);

describe('GOLF BUGGY spec', () => {
  it('a slow, open, doorless two-seater with an electric voice', () => {
    expect(B.name).toBe('GOLF BUGGY');
    expect(B.open).toBe(true);
    expect(B.doors).toBe('none');
    expect(B.special).toBeNull();
    expect(B.horn).toBe('beep');
    expect(B.voice).toBe('electric');
    expect(B.topKmh).toBeLessThan(45);
    expect(B.boostKmh).toBeLessThan(45);
    expect(B.boostKmh).toBeGreaterThan(B.topKmh);
    expect(B.paints.length).toBeGreaterThanOrEqual(3);
  });

  it('wheels and seats inside the body; the driver on the left, a passenger beside', () => {
    const g = B.geo;
    expect(g.axleF + g.wheelR).toBeLessThanOrEqual(g.length / 2);
    expect(-g.axleR + g.wheelR).toBeLessThanOrEqual(g.length / 2);
    expect(g.halfTrack + g.wheelW / 2).toBeLessThanOrEqual(g.width / 2);
    expect(passengerSeats('buggy')).toBe(1);
    const [d, p] = SEATS.buggy;
    expect(d.at[0]).toBeGreaterThan(0);
    expect(p.at[0]).toBeLessThan(0);
    expect(d.at[1]).toBeCloseTo(p.at[1], 6);
    expect(d.at[2]).toBeCloseTo(p.at[2], 6);
    for (const s of SEATS.buggy) {
      expect(Math.abs(s.at[0])).toBeLessThan(g.width / 2);
      expect(Math.abs(s.at[2])).toBeLessThan(g.length / 2);
    }
    expect(riderShown(B, 0)).toBe(true);
    expect(riderShown(B, 1)).toBe(true);
    // the rider's head (top ≈ 2.2 m at scale 1, scaled) clears the canopy roof
    const root = seatRoot('buggy', 0)!;
    expect(root[1] + 2.2 * 0.62).toBeLessThan(g.height - 0.1);
  });

  it('stays out of the plaza fleet and traffic; the traffic plan is unchanged', () => {
    expect(CAR_IDS).toContain('buggy');
    expect(TRAFFIC_IDS).not.toContain('buggy');
    expect(TRAFFIC_IDS.length).toBe(CAR_IDS.length - 1);
    const plan = planTraffic(TRAFFIC_IDS, { seed: 4217, cruisers: 3, paints: () => 4 });
    expect(plan.some(p => p.car === 'buggy')).toBe(false);
  });

  it('the model is a handful of draws on the shared materials, under a tri budget', () => {
    const m = buildCar(B, 0);
    let meshes = 0;
    const mats = new Set<THREE.Material>();
    m.group.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh === m.driver) return;
      meshes++;
      for (const x of [mesh.material].flat()) mats.add(x);
    });
    // the body + four wheels (the shared rig)
    expect(meshes).toBe(5);
    expect(mats.size).toBe(2);
    for (const x of mats) expect((x as THREE.MeshStandardMaterial).map ?? null).toBeNull();
    expect(triCount(m.group)).toBeLessThan(4000);
    // the body sits within its geo box
    const box = new THREE.Box3().setFromObject(m.group);
    expect(box.max.y).toBeLessThanOrEqual(B.geo.height + 0.02);
    expect(box.max.z - box.min.z).toBeLessThanOrEqual(B.geo.length + 0.05);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(B.geo.width + 0.1);
    // a second buggy of the same paint shares the body buffers
    const m2 = buildCar(B, 0);
    const body = (x: typeof m) => (x.group.children[0] as THREE.Mesh).geometry;
    expect(body(m2)).toBe(body(m));
  });

  it('gets to its top speed briskly and coasts down quickly off the pedal', () => {
    const s = new VanSim(simParams(B));
    s.place(0, 0, 0, 0);
    let t20 = -1;
    run(s, flat, 12, controls({ throttle: 1 }), 60, t => {
      if (t20 < 0 && s.forwardSpeed * 3.6 >= 20) t20 = t;
    });
    expect(t20).toBeGreaterThan(0);
    expect(t20).toBeLessThan(5);
    expect(s.forwardSpeed * 3.6).toBeLessThan(B.topKmh * 1.08);
    const v = s.forwardSpeed;
    run(s, flat, 3, controls());
    expect(s.forwardSpeed).toBeLessThan(v * 0.7);
  });

  it('the whine rises with speed', () => {
    expect(whineHz(0)).toBeLessThan(whineHz(0.5));
    expect(whineHz(0.5)).toBeLessThan(whineHz(1));
    expect(whineHz(1)).toBeGreaterThan(800);
    expect(whineHz(5)).toBe(whineHz(1.4));
  });
});

describe('buggy parking (pure)', () => {
  it('spot keys: same spots, same key; NaNs are dropped', () => {
    const a = [{ x: 1, y: 2, z: 3, yaw: 0.5 }];
    expect(spotsKey(a)).toBe(spotsKey([{ x: 1.001, y: 2, z: 3, yaw: 0.5 }]));
    expect(spotsKey(a)).not.toBe(spotsKey([{ x: 1.2, y: 2, z: 3, yaw: 0.5 }]));
    expect(cleanSpots([...a, { x: NaN, y: 0, z: 0, yaw: 0 }])).toHaveLength(1);
  });

  it('paints: mostly cream, always a valid index', () => {
    const p = Array.from({ length: 16 }, (_, i) => buggyPaint(i, B.paints.length));
    expect(p.filter(x => x === 0).length).toBeGreaterThan(p.length / 3);
    expect(p.every(x => x >= 0 && x < B.paints.length)).toBe(true);
    expect(new Set(p).size).toBeGreaterThan(2);
  });

  it('restOn: level ground is flat; a slope tilts it the right way', () => {
    const g = B.geo;
    expect(restOn([2, 2, 2, 2], g)).toEqual({ y: 2, pitch: 0, roll: 0 });
    const wb = g.axleF - g.axleR;
    const up = restOn([1, 1, 0, 0], g);
    expect(up.pitch).toBeCloseTo(Math.atan2(1, wb), 6);
    // origin height: the plane at z = 0
    expect(up.y).toBeCloseTo((0 - g.axleR) / wb, 6);
    const left = restOn([0.5, 0, 0.5, 0], g);
    expect(left.roll).toBeGreaterThan(0);
    expect(left.pitch).toBeCloseTo(0, 6);
  });

  it('sleep: asleep past BUGGY_FAR, awake again inside BUGGY_WAKE', () => {
    const d = (m: number) => m * m;
    expect(buggyAsleep(d(BUGGY_FAR - 1), false)).toBe(false);
    expect(buggyAsleep(d(BUGGY_FAR + 1), false)).toBe(true);
    expect(buggyAsleep(d((BUGGY_FAR + BUGGY_WAKE) / 2), true)).toBe(true);
    expect(buggyAsleep(d(BUGGY_WAKE - 1), true)).toBe(false);
  });
});

// ── CarSystem's buggy API against a stub game (no WebGL) ──

function stubGame(ground: (x: number, z: number) => number) {
  const world = new CollisionWorld();
  // a 400 m square of ground, 2 m cells
  const geo = new THREE.PlaneGeometry(400, 400, 200, 200);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, ground(pos.getX(i), pos.getZ(i)));
  world.build([new THREE.Mesh(geo)]);
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  const game = {
    world,
    gfx: { camera, scene, toon: false, quality: 'high' },
    missions: { ud: { active: false } },
    interiors: { inside: false },
    net: { players: new Map(), myId: '', crew: null, ride: null },
    remotes: new Map(),
    hoops: { active: false },
    replay: { active: false },
    showroom: false,
    van2: { driving: false, pos: new THREE.Vector3(1e4, 0, 1e4) },
    dragon: { riding: false },
    player: {
      pos: new THREE.Vector3(1e4, 0, 1e4),
      climb: null,
      vault: null,
      mode: 'foot',
      speed: 0,
      state: 'ground',
    },
  };
  return { game: game as unknown as Game, camera, scene, world };
}

describe('CarSystem.parkBuggies / clearBuggies', () => {
  const spots = [
    { x: 0, y: 0, z: 0, yaw: 0 },
    { x: 4, y: 0, z: 0, yaw: Math.PI / 2 },
    { x: 8, y: 0, z: 0, yaw: Math.PI },
  ];

  it('builds one a frame, only near the camera; idempotent per group', () => {
    const { game, camera } = stubGame(() => 0);
    const cars = new CarSystem(game);
    cars.parkBuggies('golf', spots);
    expect(cars.buggies).toHaveLength(0);
    expect(cars.buggiesPending).toBe(3);
    // camera far away: nothing builds
    camera.position.set(0, 10, 1000);
    for (let i = 0; i < 5; i++) cars.update(1 / 60);
    expect(cars.buggies).toHaveLength(0);
    // near: one a frame
    camera.position.set(0, 3, -8);
    cars.update(1 / 60);
    expect(cars.buggies).toHaveLength(1);
    cars.update(1 / 60);
    expect(cars.buggies).toHaveLength(2);
    cars.update(1 / 60);
    expect(cars.buggies).toHaveLength(3);
    expect(cars.buggiesPending).toBe(0);
    // same spots again: nothing new
    cars.parkBuggies('golf', spots.map(s => ({ ...s })));
    for (let i = 0; i < 3; i++) cars.update(1 / 60);
    expect(cars.buggies).toHaveLength(3);
    expect(cars.buggies.every(b => b.group === 'golf' && b.mode === 'parked')).toBe(true);
    // sitting on the ground, takeable with E
    for (const b of cars.buggies) expect(b.y).toBeCloseTo(0, 3);
    // another group is separate; new spots for a group replace its buggies
    cars.parkBuggies('range', [{ x: 0, y: 0, z: 12, yaw: 0 }]);
    cars.parkBuggies('golf', spots.slice(0, 1));
    for (let i = 0; i < 4; i++) cars.update(1 / 60);
    expect(cars.buggies.filter(b => b.group === 'golf')).toHaveLength(1);
    expect(cars.buggies.filter(b => b.group === 'range')).toHaveLength(1);
  });

  it('clearBuggies removes them (and their colliders, and any still waiting)', () => {
    const { game, camera, world } = stubGame(() => 0);
    const cars = new CarSystem(game);
    camera.position.set(0, 3, -8);
    cars.parkBuggies('golf', spots);
    cars.update(1 / 60);
    expect(world.dynamicCount).toBe(1);
    cars.clearBuggies('golf');
    expect(cars.buggies).toHaveLength(0);
    expect(cars.buggiesPending).toBe(0);
    expect(world.dynamicCount).toBe(0);
    for (let i = 0; i < 4; i++) cars.update(1 / 60);
    expect(cars.buggies).toHaveLength(0);
    // and parking again after a clear works
    cars.parkBuggies('golf', spots);
    for (let i = 0; i < 4; i++) cars.update(1 / 60);
    expect(cars.buggies).toHaveLength(3);
  });

  it('far buggies sleep: hidden, no collider, and wake when you come back', () => {
    const { game, camera, world, scene } = stubGame(() => 0);
    const cars = new CarSystem(game);
    camera.position.set(0, 3, -8);
    cars.parkBuggies('golf', spots);
    for (let i = 0; i < 3; i++) cars.update(1 / 60);
    expect(world.dynamicCount).toBe(3);
    camera.position.set(0, 3, BUGGY_FAR + 50);
    cars.update(1 / 60);
    expect(cars.buggies.every(b => b.asleep)).toBe(true);
    expect(world.dynamicCount).toBe(0);
    let shown = 0;
    scene.traverseVisible(o => {
      if ((o as THREE.Mesh).isMesh) shown++;
    });
    expect(shown).toBe(0);
    camera.position.set(0, 3, -8);
    cars.update(1 / 60);
    expect(cars.buggies.every(b => !b.asleep)).toBe(true);
    expect(world.dynamicCount).toBe(3);
  });

  it('settles onto a slope (y = the ground under its wheels, tilted)', () => {
    const slope = (_x: number, z: number) => 10 + z * 0.15;
    const { game, camera } = stubGame(slope);
    const cars = new CarSystem(game);
    camera.position.set(0, 14, -8);
    // the spot's y is a little off: the probe finds the ground
    cars.parkBuggies('golf', [{ x: 0, y: 10.3, z: 0, yaw: 0 }]);
    cars.update(1 / 60);
    const [b] = cars.buggies;
    expect(b.y).toBeCloseTo(10, 1);
  });

  it('ignores junk spots', () => {
    const { game, camera } = stubGame(() => 0);
    const cars = new CarSystem(game);
    camera.position.set(0, 3, -8);
    cars.parkBuggies('golf', [
      { x: NaN, y: 0, z: 0, yaw: 0 },
      null as unknown as { x: number; y: number; z: number; yaw: number },
      { x: 0, y: 0, z: 0, yaw: 0 },
    ]);
    for (let i = 0; i < 3; i++) cars.update(1 / 60);
    expect(cars.buggies).toHaveLength(1);
  });
});
