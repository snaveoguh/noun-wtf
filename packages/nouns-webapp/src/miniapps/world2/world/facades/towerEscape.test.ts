// Tower escapes (the scissor stair down CAMP's tower): the plan's numbers,
// then a real walk down all of it with the game's own foot controller.

import type { EscapePlacement } from './details';
import type { InputFrame } from '../../core/Input';

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { CollisionWorld } from '../../physics/Collision';
import { RailSet } from '../../physics/Rails';
import { Player } from '../../skate/Player';

import { buildEscape } from './details';
import {
  checkTowerEscape,
  MIN_NORMAL_Y,
  PAD,
  planTowerEscape,
  slopeNormalY,
  WALKABLE_NORMAL_Y,
  type TowerEscapePlan,
} from './escape';
import { Geo } from './geom';

describe('tower escape plan', () => {
  it('is walkable from any tower height onto the roof next door', () => {
    for (const top of [40, 64.2, 96, 120, 146.4])
      for (const length of [10, 12, 14]) {
        const spec = { length, top, bottom: 20.4, exitEnd: 'B' as const };
        const plan = planTowerEscape(spec)!;
        expect(plan, `top ${top} length ${length}`).not.toBeNull();
        expect(checkTowerEscape(plan, spec)).toEqual([]);
        expect(plan.exitEnd).toBe('B');
        expect(plan.rise).toBeGreaterThan(3);
        expect(plan.rise).toBeLessThan(4.2);
        for (const p of plan.parts) {
          if (p.kind !== 'ramp' || p.role !== 'flight') continue;
          const ny = slopeNormalY(Math.abs(p.y1 - p.y0), p.u1 - p.u0);
          expect(ny).toBeGreaterThanOrEqual(MIN_NORMAL_Y);
          expect(ny).toBeGreaterThan(WALKABLE_NORMAL_Y);
        }
      }
  });

  it('alternates lanes and ends, a landing at every turn', () => {
    const plan = planTowerEscape({ length: 14, top: 146.4, bottom: 20.4 })!;
    const flights = plan.parts.filter(p => p.kind === 'ramp' && p.role === 'flight');
    expect(flights.length).toBe(plan.flights);
    expect(plan.flights).toBe(35);
    flights.forEach((f, k) => {
      const outer = k % 2 === 0;
      expect(f.d0 > plan.inset + plan.lane - 0.1).toBe(outer);
      // outer flights fall toward A (u 0), inner toward B
      expect(f.y0 < f.y1).toBe(outer);
    });
    // a landing (pad, or the bottom deck) at each flight's low end
    const pads = plan.parts.filter(
      p => p.kind === 'box' && (p.role === 'pad' || p.role === 'deck'),
    );
    expect(pads.length).toBe(plan.flights + 2); // + the head pad and the exit deck
    expect(plan.levels[0]).toBe(146.4);
    expect(plan.levels[plan.levels.length - 1]).toBeCloseTo(20.4, 6);
  });

  it('refuses walls too short to walk', () => {
    expect(planTowerEscape({ length: 4, top: 60, bottom: 20 })).toBeNull();
    expect(planTowerEscape({ length: 12, top: 20, bottom: 20 })).toBeNull();
  });
});

// ── A real walk down ────────────────────────────────────────────────────

function frame(over: Partial<InputFrame> = {}): InputFrame {
  return {
    moveX: 0,
    moveY: 0,
    lookX: 0,
    lookY: 0,
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
    mode: 'touch',
    ...over,
  };
}

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0));
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.updateMatrixWorld(true);
  return m;
};

/**
 * A tower whose wall is the plane z = 0 (facing +z) from x 0 to `length`,
 * a lower block beside it (x past `length`, roof at `roof`, a parapet
 * along its front), and the stair registered as a dynamic body: down the
 * tower, along the exit deck, over the parapet onto that roof.
 */
function scene(top: number, roof: number, length: number) {
  const world = new CollisionWorld();
  const bottom = roof + 0.9 + 0.2;
  const land = { u0: length + 1.2, u1: length + 3.2, roof, depth: 0.25 };
  const spec = { length, top, bottom, exit: 3.6, exitEnd: 'B' as const, land };
  const plan = planTowerEscape(spec)!;
  world.build([
    box(-40, length + 40, -1, 0, -40, 40), // ground
    box(length, length + 20, 0, roof, -16, 0), // the block next door
    box(length, length + 20, roof, roof + 0.9, -0.25, 0), // its parapet
    box(0, length, 0, top + 6, -12, 0), // the tower
  ]);
  const e: EscapePlacement = {
    face: { nx: 0, nz: 1, at: 0, s0: 0, s1: length, y0: 0, y1: top + 6, lm: null },
    a: 0,
    b: length,
    ladderAtS1: true,
    plan,
  };
  const collide = new Geo();
  buildEscape(new Geo(), new Geo(), collide, e, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(collide.pos, 3));
  world.setDynamic('camp:escape:test', g);
  return { world, plan, spec };
}

/** Waypoints down the stair: along the walkway to B, then each flight to its far end. */
function routeDown(plan: TowerEscapePlan): { x: number; z: number }[] {
  const L = plan.length;
  const inner = plan.inset + plan.lane / 2;
  const outer = plan.inset + plan.lane * 1.5;
  const path = [
    { x: L - PAD / 2, z: inner },
    { x: L - PAD / 2, z: outer },
  ];
  for (let k = 0; k < plan.flights; k++) {
    const isOuter = k % 2 === 0;
    const d = isOuter ? outer : inner;
    const next = isOuter ? inner : outer;
    const end = isOuter ? PAD / 2 : L - PAD / 2;
    path.push({ x: end, z: d });
    if (k < plan.flights - 1) path.push({ x: end, z: next });
  }
  // Along the exit deck, in over the parapet, down onto the roof
  const lx = L + 2.2;
  path.push({ x: lx, z: (inner + outer) / 2 }, { x: lx, z: -0.3 }, { x: lx, z: -4 });
  return path;
}

function walk(world: CollisionWorld, start: THREE.Vector3, path: { x: number; z: number }[]) {
  const p = new Player(world, new RailSet());
  p.spawn(start, Math.PI);
  p.mode = 'foot';
  p.footGrounded = true;
  const dt = 1 / 60;
  let i = 0;
  let minGap = Infinity;
  let maxFall = 0;
  let t = 0;
  let prevY = p.pos.y;
  for (; t < 600 && i < path.length; t += dt) {
    const w = path[i]!;
    const dx = w.x - p.pos.x;
    const dz = w.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.25) {
      i++;
      continue;
    }
    const k = Math.min(1, dist / 0.5) / Math.max(dist, 1e-6);
    p.update(dt, frame({ moveX: -dx * k, moveY: dz * k, sprint: true }), 0, t * 1000);
    maxFall = Math.max(maxFall, prevY - p.pos.y);
    prevY = p.pos.y;
    minGap = Math.min(minGap, p.pos.y);
  }
  return { p, reached: i, t, maxFall, minY: minGap };
}

describe('walking down a tower escape (the real foot controller)', () => {
  for (const [top, length] of [
    [64.2, 12],
    [146.1, 10.4],
  ] as const)
    it(`walks from the ${top} m walkway down onto the roof next door`, () => {
      const roof = 17;
      const { world, plan, spec } = scene(top, roof, length);
      expect(checkTowerEscape(plan, spec)).toEqual([]);
      expect(plan.exitEnd).toBe('B');
      const start = new THREE.Vector3(1, top + 0.05, plan.inset + plan.lane / 2);
      const route = routeDown(plan);
      const r = walk(world, start, route);
      expect(r.reached).toBe(route.length);
      expect(r.p.footGrounded).toBe(true);
      // On the roof, behind the parapet
      expect(r.p.pos.y).toBeCloseTo(roof, 1);
      expect(r.p.pos.z).toBeLessThan(-3);
      // Never fell: walked every flight (no drop bigger than a step)
      expect(r.maxFall).toBeLessThan(0.3);
      // A flight every few seconds at a run
      expect(r.t).toBeLessThan(plan.flights * 4 + 15);
    });
});
