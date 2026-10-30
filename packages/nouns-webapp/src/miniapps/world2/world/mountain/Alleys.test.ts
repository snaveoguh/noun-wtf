// The alley mouths: walking out of a corridor and along the city wall must
// never put the rider inside an alley block. The player's soft clamp snaps
// anyone between the ring (93.6) and the slope (95.6) back onto the wall top;
// the alley blocks used to reach the wall's outer edge (94), so the snap
// landed 0.4 m inside the hollow block box and riders walked round in it.

import type { InputFrame } from '../../core/Input';

import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';

import { ParkourMotor } from '../../parkour/sim/motor';
import { CollisionPkWorld } from '../../parkour/world';
import { CollisionWorld } from '../../physics/Collision';
import { RailSet } from '../../physics/Rails';
import { Player } from '../../skate/Player';

import { buildAlleys, inCorridor, RING_BACK, ringBands } from './Alleys';
import { ALLEYS, MOUNTAIN, alleyToWorld, worldToAlley } from './config';
import {
  raycastTerrain,
  terrainHeight,
  terrainInDomain,
  terrainNormal,
  terrainSurface,
} from './terrain';

/** Level.ts's soft bound for the baked plaza. */
const SOFT_BOUNDS = 93.6;

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
    mode: 'keyboard',
    ...over,
  };
}

let world: CollisionWorld;
let blocks: THREE.Box3[];

beforeAll(() => {
  // The banners paint on a canvas; jsdom has none
  HTMLCanvasElement.prototype.getContext = (() =>
    new Proxy(
      {},
      { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true },
    )) as never;
  const { collision } = buildAlleys();
  world = new CollisionWorld();
  // Level.ts's catch floor behind the ring
  const floor = ringBands(85, MOUNTAIN.wallZ, 96, true).map(b => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.max.x - b.min.x, 0.2, b.max.z - b.min.z));
    m.position.set((b.min.x + b.max.x) / 2, -0.3, (b.min.z + b.max.z) / 2);
    m.updateMatrixWorld(true);
    return m;
  });
  world.build([...collision, ...floor]);
  world.terrain = { raycast: raycastTerrain, normal: terrainNormal };
  blocks = collision
    .filter(m => m.name === 'COL_AlleyBlock')
    .map(m => new THREE.Box3().setFromObject(m));
});

/** A rider on foot with the game's soft clamp + mountain hooks. */
function rider() {
  const p = new Player(world, new RailSet());
  p.softBounds = SOFT_BOUNDS;
  p.mountain = { inCorridor, minZ: MOUNTAIN.minZ };
  p.terrain = {
    height: terrainHeight,
    inDomain: terrainInDomain,
    surface: terrainSurface,
    speedLimit: () => Infinity,
  };
  p.mode = 'foot';
  return p;
}

/** The parkour layer on `p`, hooked in the way ParkourSystem does it. */
function withParkour(p: Player) {
  const motor = new ParkourMotor(new CollisionPkWorld(world));
  const body = {
    get pos() {
      return p.pos;
    },
    get vel() {
      return p.vel;
    },
    get yaw() {
      return p.footYaw;
    },
    set yaw(v: number) {
      p.footYaw = v;
    },
    get grounded() {
      return p.footGrounded;
    },
    set grounded(v: boolean) {
      p.footGrounded = v;
    },
    get climbing() {
      return p.climb !== null;
    },
    get vaulting() {
      return p.vault !== null;
    },
    get respawns() {
      return p.respawns;
    },
    startClimb: (nx: number, nz: number) => p.tryStartClimb(new THREE.Vector3(nx, 0, nz)),
    startVault: (nx: number, nz: number, carry: number) =>
      p.tryStartVault(new THREE.Vector3(nx, 0, nz), carry),
    emit: () => {},
  };
  let synced = false;
  p.parkour = {
    step: (dt, f) => {
      if (!synced) motor.resync(body);
      synced = true;
      const s = Math.abs(f.moveY) > 0.05 ? Math.sign(f.moveY) : 0;
      return motor.step(dt, body, {
        moveX: f.moveX,
        moveY: f.moveY,
        wishX: Math.sin(p.footYaw) * s,
        wishZ: Math.cos(p.footYaw) * s,
        sprint: f.sprint,
        jump: f.jumpPressed,
        jumpHeld: f.crouch,
        duck: false,
        duckPressed: false,
        release: false,
      });
    },
    busy: () => motor.busy,
  };
  return p;
}

/** Is `p` inside an alley block (not on its roof)? */
function insideBlock(p: THREE.Vector3) {
  return blocks.some(
    b =>
      p.x > b.min.x + 0.01 &&
      p.x < b.max.x - 0.01 &&
      p.z > b.min.z + 0.01 &&
      p.z < b.max.z - 0.01 &&
      p.y > b.min.y &&
      p.y < b.max.y,
  );
}

describe('the soft clamp behind the ring', () => {
  // Some ring blocks reach back to 94 m, so 93.6 is inside them there
  it('sends a rider on the city wall top out onto the slope', () => {
    for (const z of [93.7, 94, 94.5, 95.4]) {
      const p = rider();
      p.spawn(new THREE.Vector3(10, 0, z), 0);
      p.pos.set(10, 0.02, z);
      p.update(1 / 60, frame(), 0, 0);
      expect(p.pos.z, `from ${z}`).toBeCloseTo(MOUNTAIN.minZ, 5);
    }
  });

  it('keeps a rider at roof height on the roof side', () => {
    const p = rider();
    p.spawn(new THREE.Vector3(10, 10.2, 93.9), 0);
    p.pos.set(10, 10.2, 93.9);
    p.update(1 / 60, frame(), 0, 0);
    expect(p.pos.z).toBeCloseTo(SOFT_BOUNDS, 5);
  });
});

describe('alley blocks', () => {
  it('end flush with the back of the ring, inside the soft clamp', () => {
    for (const b of blocks) {
      const out = Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z);
      expect(out).toBeCloseTo(RING_BACK, 3);
      expect(out).toBeLessThan(SOFT_BOUNDS - 0.32);
    }
  });

  for (const al of ALLEYS)
    for (const dir of [1, -1] as const)
      for (const o of [94.2, 94.5, 95])
        it(`${al.label}: out of the mouth at ${o} m and along the wall (${dir > 0 ? '+' : '−'}a) stays outside the blocks`, () => {
          const p = new Player(world, new RailSet());
          p.softBounds = SOFT_BOUNDS;
          p.mountain = { inCorridor, minZ: MOUNTAIN.minZ };
          p.terrain = {
            height: terrainHeight,
            inDomain: terrainInDomain,
            surface: terrainSurface,
            speedLimit: () => Infinity,
          };
          p.mode = 'foot';
          const at = alleyToWorld(al, al.a + dir * (al.width / 2 - 1), o, { x: 0, z: 0 });
          // Facing along +a (or −a) in world terms
          const ax = alleyToWorld(al, dir, 0, { x: 0, z: 0 });
          p.spawn(new THREE.Vector3(at.x, terrainHeight(at.x, at.z), at.z), Math.atan2(ax.x, ax.z));
          const l = { a: 0, o: 0 };
          for (let f = 0; f < 300; f++) {
            p.update(
              1 / 60,
              frame({ moveY: 1, sprint: true, jumpPressed: f % 45 === 20 }),
              0,
              f * 16,
            );
            const inside = blocks.some(
              b =>
                p.pos.x > b.min.x + 0.01 &&
                p.pos.x < b.max.x - 0.01 &&
                p.pos.z > b.min.z + 0.01 &&
                p.pos.z < b.max.z - 0.01 &&
                p.pos.y > b.min.y &&
                p.pos.y < b.max.y,
            );
            worldToAlley(al, p.pos.x, p.pos.z, l);
            expect(
              inside,
              `frame ${f}: a ${l.a.toFixed(2)} o ${l.o.toFixed(2)} y ${p.pos.y.toFixed(2)}`,
            ).toBe(false);
          }
        });

  // A vault from the corridor probes down from inside the hollow block: a
  // catch floor in there read as a ledge and stepped riders through the wall
  for (const al of ALLEYS)
    for (const dir of [1, -1] as const)
      for (const o of [86, 88.5, 90.5])
        it(`${al.label}: parkour into the ${dir > 0 ? '+' : '−'}a wall at ${o} m stays in the corridor`, () => {
          const p = withParkour(rider());
          const at = alleyToWorld(al, al.a - dir * 1.5, o, { x: 0, z: 0 });
          const ax = alleyToWorld(al, dir, 0, { x: 0, z: 0 });
          p.spawn(new THREE.Vector3(at.x, terrainHeight(at.x, at.z), at.z), Math.atan2(ax.x, ax.z));
          const l = { a: 0, o: 0 };
          for (let f = 0; f < 240; f++) {
            p.update(
              1 / 60,
              frame({ moveY: 1, sprint: true, jumpPressed: f % 25 === 15, crouch: f % 50 > 20 }),
              0,
              f * 16,
            );
            worldToAlley(al, p.pos.x, p.pos.z, l);
            expect(
              insideBlock(p.pos),
              `frame ${f}: a ${l.a.toFixed(2)} o ${l.o.toFixed(2)} y ${p.pos.y.toFixed(2)}`,
            ).toBe(false);
          }
        });
});
