// On-foot vault / step-up / climb selection against simple box levels.

import type { InputFrame } from '../core/Input';

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { CollisionWorld } from '../physics/Collision';
import { RailSet } from '../physics/Rails';

import { Player } from './Player';

type Box = [cx: number, cy: number, cz: number, sx: number, sy: number, sz: number];

/** Big floor at y = 0 for z < pitZ (a pit down to y = -3 beyond it), plus boxes. */
function makePlayer(boxes: Box[], pitZ = 50) {
  const all: Box[] = [
    [0, -0.5, (pitZ - 60) / 2, 60, 1, pitZ + 60],
    [0, -3.5, pitZ + 30, 60, 1, 60],
    ...boxes,
  ];
  const meshes = all.map(([cx, cy, cz, sx, sy, sz]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz));
    m.position.set(cx, cy, cz);
    return m;
  });
  const world = new CollisionWorld();
  world.build(meshes);
  const p = new Player(world, new RailSet());
  p.spawn(new THREE.Vector3(0, 0, 0), 0); // facing +z
  p.mode = 'foot';
  p.footGrounded = true;
  return { p, world };
}

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

interface RunOpts {
  dur?: number;
  /** Seconds before jumping (null = never jump). */
  jumpAt?: number | null;
  moveX?: number;
  moveY?: number;
}

/** Drive the player at 60 Hz (camera faces +z, so moveY = +z, moveX = -x). */
function run(p: Player, world: CollisionWorld, o: RunOpts = {}) {
  const { dur = 2.5, jumpAt = 0.1, moveX = 0, moveY = 1 } = o;
  const dt = 1 / 60;
  const out = {
    vaults: [] as string[],
    vaultTime: 0,
    climbed: false,
    events: [] as string[],
    maxOverlap: 0,
  };
  let jumped = false;
  let vStart = -1;
  for (let t = 0; t < dur; t += dt) {
    const jump = jumpAt !== null && !jumped && t >= jumpAt;
    if (jump) jumped = true;
    const was = p.vault;
    p.update(dt, frame({ moveX, moveY, jumpPressed: jump }), 0, t * 1000);
    for (const e of p.events) out.events.push(e.type);
    if (p.vault !== null && was === null) {
      out.vaults.push(p.vault.kind);
      vStart = t;
    }
    if (p.vault === null && was !== null) out.vaultTime = t - vStart + dt;
    if (p.climb !== null) out.climbed = true;
    if (p.vault === null && p.climb === null) {
      const a = p.pos.clone().add(new THREE.Vector3(0, 0.6, 0));
      const b = p.pos.clone().add(new THREE.Vector3(0, 1.08, 0));
      out.maxOverlap = Math.max(out.maxOverlap, world.capsulePushout(a, b, 0.28).length());
    }
  }
  return out;
}

describe('on-foot vault', () => {
  it('hops a thin chest-high wall onto the far side', () => {
    // (a plain jump already clears ~1.1 m when timed well)
    const { p, world } = makePlayer([[0, 0.65, 2.0, 6, 1.3, 0.3]]);
    const r = run(p, world, { jumpAt: 0.2 });
    expect(r.vaults).toEqual(['over']);
    expect(r.vaultTime).toBeGreaterThan(0.38);
    expect(r.vaultTime).toBeLessThan(0.58);
    expect(r.climbed).toBe(false);
    expect(p.pos.z).toBeGreaterThan(3);
    expect(p.pos.y).toBeCloseTo(0, 1);
    expect(p.footGrounded).toBe(true);
    expect(r.events).toContain('footJump');
    expect(r.events).toContain('footLand');
    expect(r.maxOverlap).toBeLessThan(0.02);
  });

  it('hops a thin railing and a knee-high bench', () => {
    for (const box of [
      [0, 1.0, 2.0, 6, 0.06, 0.06], // top rail only (posts don't matter)
      [0, 0.25, 2.0, 6, 0.5, 0.45],
    ] as Box[]) {
      const { p, world } = makePlayer([box]);
      const r = run(p, world, { jumpAt: 0.25 });
      // The knee-high bench may simply be jumped clean over
      if (r.vaults.length > 0) expect(r.vaults).toEqual(['over']);
      expect(p.pos.z).toBeGreaterThan(2.8);
      expect(r.maxOverlap).toBeLessThan(0.02);
    }
  });

  it('jumping while pushing into a low wall vaults it', () => {
    const { p, world } = makePlayer([[0, 0.6, 2.0, 6, 1.2, 0.3]]);
    run(p, world, { jumpAt: null, dur: 1.0 }); // walk up and lean on it
    expect(p.vault).toBeNull();
    expect(p.pos.z).toBeLessThan(2);
    const r = run(p, world, { jumpAt: 0 });
    expect(r.vaults).toEqual(['over']);
    expect(p.pos.z).toBeGreaterThan(3);
  });

  it('hops a wall approached at an angle without ending up inside it', () => {
    const { p, world } = makePlayer([[0, 0.65, 2.0, 12, 1.3, 0.3]]);
    const r = run(p, world, { jumpAt: 0.2, moveX: -0.8, moveY: 1 });
    expect(r.vaults).toEqual(['over']);
    expect(p.pos.z).toBeGreaterThan(2.5);
    expect(r.maxOverlap).toBeLessThan(0.02);
  });

  it('hops a head-high (1.9 m) thin wall', () => {
    const { p, world } = makePlayer([[0, 0.95, 2.0, 6, 1.9, 0.3]]);
    const r = run(p, world, { jumpAt: 0.2 });
    expect(r.vaults).toEqual(['over']);
    expect(r.climbed).toBe(false);
    expect(p.pos.z).toBeGreaterThan(3);
    expect(r.maxOverlap).toBeLessThan(0.02);
  });

  it('steps up onto a thick platform', () => {
    const { p, world } = makePlayer([[0, 0.6, 6.0, 6, 1.2, 8]]);
    const r = run(p, world, { jumpAt: 0.2, dur: 1.5 });
    expect(r.vaults).toEqual(['up']);
    expect(r.vaultTime).toBeLessThan(0.45);
    expect(p.pos.y).toBeCloseTo(1.2, 1);
    expect(p.footGrounded).toBe(true);
    expect(r.maxOverlap).toBeLessThan(0.02);
  });

  it('vaults a ledge with a drop behind and falls to the low ground', () => {
    // Parapet at the pit edge (pit starts at z = 2.15)
    const { p, world } = makePlayer([[0, 0.65, 2.0, 6, 1.3, 0.3]], 2.15);
    const r = run(p, world, { jumpAt: 0.2, dur: 3 });
    expect(r.vaults).toEqual(['over']);
    expect(p.pos.y).toBeCloseTo(-3, 1);
    expect(p.footGrounded).toBe(true);
  });

  it('never vaults tall walls (they climb)', () => {
    const { p, world } = makePlayer([[0, 2.5, 2.0, 6, 5, 0.6]]);
    const r = run(p, world, { jumpAt: 0.2, dur: 1 });
    expect(r.vaults).toEqual([]);
    expect(r.climbed).toBe(true);
  });

  it('does not vault a 2.4 m wall', () => {
    const { p, world } = makePlayer([[0, 1.2, 2.0, 6, 2.4, 0.3]]);
    const r = run(p, world, { jumpAt: 0.2, dur: 1.5 });
    expect(r.vaults).toEqual([]);
    expect(p.pos.z).toBeLessThan(2);
  });

  it('walking into a low wall without jumping just blocks', () => {
    const { p, world } = makePlayer([[0, 0.5, 2.0, 6, 1.0, 0.3]]);
    const r = run(p, world, { jumpAt: null, dur: 2 });
    expect(r.vaults).toEqual([]);
    expect(r.climbed).toBe(false);
    expect(p.pos.z).toBeLessThan(2);
  });

  it('jumping while walking along a wall does not vault', () => {
    // Wall along the z axis just to the player's left (+x side)
    const { p, world } = makePlayer([[0.6, 0.5, 5, 0.3, 1.0, 20]]);
    p.pos.x = 0.1;
    let vaults = 0;
    for (let i = 0; i < 4; i++) {
      const r = run(p, world, { jumpAt: 0.1, dur: 0.8, moveX: -0.15 });
      vaults += r.vaults.length;
    }
    expect(vaults).toBe(0);
  });

  it('no vault when a low ceiling leaves no headroom', () => {
    const { p, world } = makePlayer([
      [0, 0.5, 2.0, 6, 1.0, 0.3],
      [0, 2.1, 2.5, 6, 0.2, 6],
    ]);
    const r = run(p, world, { jumpAt: 0.2, dur: 1.5 });
    expect(r.vaults).toEqual([]);
    expect(r.maxOverlap).toBeLessThan(0.02);
  });
});
