import type { InputFrame } from '../core/Input';
import type { Game } from '../Game';

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StatsTracker } from '../net/Stats';
import { CollisionWorld } from '../physics/Collision';
import { RailSet } from '../physics/Rails';
import { Player } from '../skate/Player';
import { createCombo } from '../skate/Tricks';

import { VanDrive } from './VanDrive';

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

/** A van-shaped group: the four tyres VanDrive rigs (the rest of the model doesn't matter here). */
function vanGroup() {
  const g = new THREE.Group();
  for (const [x, z] of [
    [1, 1.97],
    [-1, 1.97],
    [1, -1.28],
    [-1, -1.28],
  ]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.26, 8));
    t.name = 'van-tyre';
    t.position.set(x, 0.37, z);
    g.add(t);
  }
  g.position.set(10, 0, 20);
  g.updateMatrixWorld(true);
  return g;
}

/** Just enough of Game for VanDrive: a flat world, a real skater + stats tracker. */
function fakeGame() {
  const world = new CollisionWorld();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2));
  floor.updateMatrixWorld(true);
  world.build([floor]);
  const player = new Player(world, new RailSet());
  const scene = new THREE.Scene();
  const g = {
    world,
    player,
    stats: new StatsTracker(
      () => 'T',
      () => false,
    ),
    gfx: { camera: new THREE.PerspectiveCamera(), scene, toon: false },
    missions: { ud: { active: false } },
    hoops: { active: false },
    replay: { active: false },
    showroom: false,
    audio: { ctx: null, master: null, noise: null, start: () => undefined },
    fm: { vanPos: new THREE.Vector3() },
    van: null,
    net: { players: new Map() },
    remotes: new Map(),
    me: null,
    cam: { mode: 'follow', shakeScale: 1, yaw: 0, orbitYaw: 0, snap: () => undefined },
    particles: { dustAt: () => undefined },
  };
  const game = g as unknown as Game;
  const van = new VanDrive(game);
  (g as unknown as { van2: VanDrive }).van2 = van;
  return { game, g, van, world, player };
}

/** One Game.step's worth for the van: preStep, drive or not, update, then the stats tracker. */
function step(
  f: ReturnType<typeof fakeGame>,
  input: InputFrame,
  downM: number,
  dt = 1 / 60,
): boolean {
  const driving = f.van.preStep(input);
  if (driving) f.van.drive(dt, input, 0);
  f.van.update(dt);
  f.g.stats.update(dt, f.player, f.player.combo, downM);
  return driving;
}

const floorUnder = (w: CollisionWorld, x: number, z: number) =>
  w.raycast(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0), 10)?.point.y ?? -1;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('VanDrive: getting in and out', () => {
  it('E at the cab door gets in; the parked collision lifts out and goes back where it stops', () => {
    const f = fakeGame();
    const grp = vanGroup();
    const home = { pos: new THREE.Vector3(), yaw: 0 };
    f.van.attach(grp, home);
    // Parked: the van's floor is solid (dynamic body), the home spot sits beside it
    expect(f.world.dynamicCount).toBe(1);
    expect(floorUnder(f.world, 10, 20)).toBeGreaterThan(0.7);
    // Not at the door: E is the board toggle as usual
    f.player.spawn(new THREE.Vector3(30, 0, 30), 0);
    f.player.toggleBoard();
    const far = frame({ boardTogglePressed: true });
    expect(step(f, far, 0)).toBe(false);
    expect(far.boardTogglePressed).toBe(true);
    for (let i = 0; i < 10; i++) step(f, frame(), 0);
    expect(f.van.ui.near).toBe(false);
    // At the driver's door (van-local +X side of the cab)
    f.player.spawn(new THREE.Vector3(12.6, 0, 21.5), 0);
    f.player.toggleBoard();
    for (let i = 0; i < 10; i++) step(f, frame(), 0);
    expect(f.van.ui.near).toBe(true);
    const events: string[] = [];
    f.van.on('enter', () => events.push('enter'));
    f.van.on('exit', () => events.push('exit'));
    expect(step(f, frame({ boardTogglePressed: true }), 0)).toBe(true);
    expect(f.van.driving).toBe(true);
    expect(events).toEqual(['enter']);
    expect(f.world.dynamicCount).toBe(0);
    expect(floorUnder(f.world, 10, 20)).toBeLessThan(0.05);

    // Drive off down +Z
    for (let i = 0; i < 240; i++) step(f, frame({ moveY: 1 }), 0);
    expect(f.van.speed).toBeGreaterThan(15);
    expect(f.van.pos.z).toBeGreaterThan(40);
    // The rider rides along (the world streams around them), hidden in the cab
    expect(f.player.pos.distanceTo(new THREE.Vector3(f.van.pos.x, f.van.pos.y, f.van.pos.z))).toBe(
      0,
    );
    expect(f.player.vel.length()).toBeGreaterThan(15);

    // E at speed: brakes to a stop first, then out
    step(f, frame({ boardTogglePressed: true }), 0);
    expect(f.van.driving).toBe(true);
    for (let i = 0; i < 8; i++) step(f, frame(), 0);
    expect(f.van.ui.stopping).toBe(true);
    for (let i = 0; i < 600 && f.van.driving; i++) step(f, frame(), 0);
    expect(f.van.driving).toBe(false);
    expect(events).toEqual(['enter', 'exit']);
    // Out on foot beside it, standing still, nothing carried out
    expect(f.player.mode).toBe('foot');
    expect(f.player.vel.length()).toBe(0);
    const d = Math.hypot(f.player.pos.x - f.van.pos.x, f.player.pos.z - f.van.pos.z);
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(4);
    // Parked again where it stopped (collision + home spot moved with it)
    expect(f.world.dynamicCount).toBe(1);
    expect(floorUnder(f.world, grp.position.x, grp.position.z)).toBeGreaterThan(0.7);
    expect(home.pos.distanceTo(grp.position)).toBeLessThan(4);
    expect(grp.position.z).toBeGreaterThan(40);
  });

  it('driving never counts toward skate stats; the tracker resumes cleanly on exit', () => {
    const f = fakeGame();
    f.van.attach(vanGroup(), { pos: new THREE.Vector3(), yaw: 0 });
    f.player.spawn(new THREE.Vector3(12.6, 0, 21.5), 0);
    f.player.toggleBoard();
    step(f, frame({ boardTogglePressed: true }), 0);
    expect(f.van.driving).toBe(true);
    expect(f.g.stats.suspended).toBe(true);
    // Flat out with the mountain distance climbing (as Game passes hud.mountain.down)
    let down = 0;
    for (let i = 0; i < 600; i++) {
      down += f.van.speed / 60;
      step(f, frame({ moveY: 1, sprint: true }), down);
      // Something else (the Upside Down leaving) can't un-suspend it mid-drive
      if (i === 300) f.g.stats.suspended = false;
    }
    expect(down).toBeGreaterThan(300);
    expect(f.g.stats.suspended).toBe(true);
    expect(f.g.stats.mine.best.downM).toBeUndefined();
    expect(f.g.stats.mine.best.kmh).toBeUndefined();
    expect(f.g.stats.runs()).toEqual([]);
    // Out: suspension lifts, and the next ride counts again (from zero speed)
    for (let i = 0; i < 900 && f.van.driving; i++) {
      step(f, frame({ boardTogglePressed: i === 0 }), down);
    }
    expect(f.van.driving).toBe(false);
    expect(f.g.stats.suspended).toBe(false);
    step(f, frame(), down + 1);
    expect(f.g.stats.mine.best.downM).toBeGreaterThan(300);
    expect(f.g.stats.mine.best.kmh).toBeUndefined();
  });

  it('getting out inside the Upside Down leaves the tracker suspended', () => {
    const f = fakeGame();
    f.van.attach(vanGroup(), { pos: new THREE.Vector3(), yaw: 0 });
    f.player.spawn(new THREE.Vector3(12.6, 0, 21.5), 0);
    step(f, frame({ boardTogglePressed: true }), 0);
    expect(f.van.driving).toBe(true);
    f.g.missions.ud.active = true;
    step(f, frame({ boardTogglePressed: true }), 0);
    expect(f.van.driving).toBe(false);
    expect(f.g.stats.suspended).toBe(true);
  });

  it('while driving the skate-only intents are drained (no spray, tricks or respawn)', () => {
    const f = fakeGame();
    f.van.attach(vanGroup(), { pos: new THREE.Vector3(), yaw: 0 });
    f.player.spawn(new THREE.Vector3(12.6, 0, 21.5), 0);
    step(f, frame({ boardTogglePressed: true }), 0);
    const inp = frame({ spray: true, jumpPressed: true, respawnPressed: true, tricks: ['ollie'] });
    expect(f.van.preStep(inp)).toBe(true);
    expect(inp.spray).toBe(false);
    expect(inp.jumpPressed).toBe(false);
    expect(inp.respawnPressed).toBe(false);
    expect(inp.tricks).toEqual([]);
    expect(createCombo().entries).toEqual([]);
  });
});
