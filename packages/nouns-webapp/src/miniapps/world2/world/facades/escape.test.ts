// Fire escapes: the plan's numbers, then a real walk up one with the game's
// own foot controller (climb the drop ladder, zig-zag up, onto the roof).

import type { InputFrame } from '../../core/Input';
import type { EscapePlacement } from './details';

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { CollisionWorld } from '../../physics/Collision';
import { RailSet } from '../../physics/Rails';
import { Player } from '../../skate/Player';

import { buildEscape } from './details';
import {
  checkEscape,
  DEPTH,
  LANE,
  MIN_NORMAL_Y,
  minEscapeLength,
  PAD,
  planEscape,
  slopeNormalY,
  STEP_RISE,
  WALKABLE_NORMAL_Y,
} from './escape';
import { Geo } from './geom';

/** The plaza's roofs: every 3.4 m storey from 2 to 6, parapets 0.9 m. */
const ROOFS = [6.8, 10.2, 13.6, 17, 20.4];

describe('fire escape plan', () => {
  it('is walkable for every plaza height and length', () => {
    for (const roof of ROOFS)
      for (const length of [minEscapeLength(), 6.4, 6.8, 8]) {
        const spec = { length, roof, parapet: roof + 0.9, parapetDepth: 0.25 };
        const plan = planEscape(spec)!;
        expect(plan, `roof ${roof} length ${length}`).not.toBeNull();
        expect(checkEscape(plan, spec)).toEqual([]);
        for (const p of plan.parts) {
          if (p.kind !== 'ramp' || p.role === 'rail') continue;
          const run = p.axis === 'u' ? Math.abs(p.u1 - p.u0) : Math.abs(p.d1 - p.d0);
          const rise = Math.abs(p.y1 - p.y0);
          const ny = slopeNormalY(rise, run);
          // Stricter than what the foot controller stands on
          expect(ny).toBeGreaterThanOrEqual(MIN_NORMAL_Y);
          expect(ny).toBeGreaterThan(WALKABLE_NORMAL_Y);
          // Drawn steps no taller than the capsule clears (0.28 m) and near a real stair's
          expect(rise / p.steps).toBeLessThan(0.26);
          expect(rise / p.steps).toBeGreaterThan(STEP_RISE * 0.6);
        }
        // Reaches the roof: a deck over the parapet, a ramp down onto it
        expect(plan.top).toBeGreaterThan(roof + 0.9);
        expect(plan.levels[0]).toBeCloseTo(3.63);
        expect(plan.ladder.top).toBe(plan.levels[0]);
      }
  });

  it('stacks flights a full storey apart (headroom)', () => {
    const plan = planEscape({ length: 6.8, roof: 17, parapet: 17.9 })!;
    expect(plan.levels).toEqual([3.63, 7.03, 10.43, 13.83].map(v => expect.closeTo(v, 6)));
    const flights = plan.parts.filter(p => p.kind === 'ramp' && p.role === 'flight');
    for (let k = 1; k < flights.length; k++)
      expect(flights[k]!.y0 - flights[k - 1]!.y0).toBeCloseTo(3.4, 6);
  });

  it('refuses walls too short for a walkable flight, and one-storey buildings', () => {
    expect(planEscape({ length: minEscapeLength() - 0.5, roof: 13.6, parapet: 14.5 })).toBeNull();
    expect(planEscape({ length: 7, roof: 3.4, parapet: 4.3 })).toBeNull();
  });
});

// ── A real climb ────────────────────────────────────────────────────────

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
 * A building whose street wall is the plane z = 0 (facing +z), the street
 * in front, a parapet round the roof's front edge, and the escape's
 * colliders registered as a dynamic body, as in the game.
 */
function scene(roof: number, length: number, ladderAtS1: boolean) {
  const world = new CollisionWorld();
  world.build([
    box(-40, 40, -1, 0, -40, 40), // ground
    box(-12, 12, 0, roof, -16, 0), // the building
    box(-12, 12, roof, roof + 0.9, -0.25, 0), // its front parapet
  ]);
  const spec = { length, roof, parapet: roof + 0.9, parapetDepth: 0.25 };
  const plan = planEscape(spec)!;
  const a = -length / 2;
  const e: EscapePlacement = {
    face: { nx: 0, nz: 1, at: 0, s0: -12, s1: 12, y0: 0, y1: roof + 0.9, lm: null },
    a,
    b: a + length,
    ladderAtS1,
    plan,
  };
  const collide = new Geo();
  buildEscape(new Geo(), new Geo(), collide, e, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(collide.pos, 3));
  world.setDynamic('facades:fe:test', g);
  // wall frame (u, d) → world (x, z)
  const toWorld = (u: number, d: number) => ({ x: ladderAtS1 ? a + u : a + length - u, z: d });
  return { world, plan, toWorld };
}

/** Walk (and climb) through waypoints with the game's Player; returns the trace. */
function walk(
  world: CollisionWorld,
  start: { x: number; z: number },
  path: { x: number; z: number }[],
  maxT = 120,
) {
  const p = new Player(world, new RailSet());
  p.spawn(new THREE.Vector3(start.x, 0, start.z), Math.PI);
  p.mode = 'foot';
  p.footGrounded = true;
  const dt = 1 / 60;
  let i = 0;
  let climbed = false;
  let mantled = false;
  let maxY = 0;
  let t = 0;
  for (; t < maxT && i < path.length; t += dt) {
    const w = path[i]!;
    const dx = w.x - p.pos.x;
    const dz = w.z - p.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.22 && p.climb === null && p.vault === null) {
      i++;
      continue;
    }
    // Camera faces +z (yaw 0): moveY → +z, moveX → −x
    const k = Math.min(1, dist / 0.5) / Math.max(dist, 1e-6);
    const input =
      p.climb !== null
        ? frame({ moveY: 1 })
        : frame({ moveX: -dx * k, moveY: dz * k, mode: 'touch' });
    p.update(dt, input, 0, t * 1000);
    for (const ev of p.events) {
      if (ev.type === 'climbStart') climbed = true;
      if (ev.type === 'mantle') mantled = true;
    }
    maxY = Math.max(maxY, p.pos.y);
  }
  return { p, reached: i, climbed, mantled, maxY, t };
}

describe('walking up a fire escape (the real foot controller)', () => {
  for (const [roof, ladderAtS1] of [
    [10.2, true],
    [17, false],
  ] as const)
    it(`climbs the ladder and walks up to a ${roof} m roof`, () => {
      const length = 6.8;
      const { world, plan, toWorld } = scene(roof, length, ladderAtS1);
      const run = length - PAD;
      const lad = (plan.ladder.u0 + plan.ladder.u1) / 2;
      const inner = LANE / 2 + 0.05;
      const outer = (LANE + DEPTH) / 2;
      const path = [toWorld(lad, DEPTH - 0.3)];
      for (let k = 0; k < plan.levels.length; k++) {
        // pad → inner platform → back to A → out onto the flight → up to the pad
        path.push(
          toWorld(run + PAD / 2, inner),
          toWorld(0.55, inner),
          toWorld(0.55, outer),
          toWorld(run + PAD / 2, outer),
        );
      }
      // over the deck, down the ramp onto the roof
      path.push(toWorld(run + PAD / 2, -0.6), toWorld(run + PAD / 2, -3.2));
      const start = toWorld(lad, DEPTH + 2.5);
      const r = walk(world, start, path);
      expect(r.climbed).toBe(true);
      expect(r.mantled).toBe(true);
      expect(r.reached).toBe(path.length);
      // Standing on the roof, behind the parapet
      expect(r.p.footGrounded).toBe(true);
      expect(r.p.pos.y).toBeCloseTo(roof, 1);
      expect(r.p.pos.z).toBeLessThan(-2.5);
      expect(r.maxY).toBeGreaterThan(plan.top - 0.05);
    });
});
