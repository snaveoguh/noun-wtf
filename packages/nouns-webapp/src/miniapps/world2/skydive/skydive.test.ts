// Skydiving with the real Player and the real parkour motor: out of CAMP's
// window (the shell boxes the game builds, on its 150 m tower), with the
// game's substep rule (Game.step). It becomes a freefall, can pull, and
// lands soft under canopy; without pulling it hard-lands where it should
// (the parkour stumble, or the roll with a timed duck) without tunnelling,
// even diving at terminal. Parkour keeps priority: a fall down a facade
// with a ledge on it ends in a ledge hang, never a freefall.

import type { InputFrame } from '../core/Input';
import type { PkEvent, PkInput } from '../parkour/contract';

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { PlayerBody, pkInputFrom } from '../parkour/playerBody';
import { ParkourMotor } from '../parkour/sim/motor';
import { CollisionPkWorld } from '../parkour/world';
import { CollisionWorld } from '../physics/Collision';
import { RailSet } from '../physics/Rails';
import { Player } from '../skate/Player';
import { campShellBoxes, campSite, campTier } from '../world/camp/site';

import { SKY } from './contract';
import { SkyController, type SkyEvent } from './SkyController';

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({
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
});

const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0));
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.updateMatrixWorld(true);
  return m;
};

/** CAMP on its tower, over a plaza floor at y 0. */
function campScene() {
  const { tier, y0, top } = campTier(13.6);
  const site = campSite(tier, top);
  const shell = campShellBoxes(site, y0, top).map(b =>
    box(b.min[0], b.max[0], b.min[1], b.max[1], b.min[2], b.max[2]),
  );
  const world = new CollisionWorld();
  world.build([
    box(-300, 300, -1, 0, -300, 300),
    // the tower under the top tier
    box(tier.minX, tier.maxX, 0, y0, tier.minZ, tier.maxZ),
    ...shell,
  ]);
  return { world, site };
}

/** A Player wired like the game: parkour first, then the skydive hook. */
function rig(world: CollisionWorld) {
  const p = new Player(world, new RailSet());
  const pkw = new CollisionPkWorld(world);
  const motor = new ParkourMotor(pkw);
  const pkEvents: PkEvent[] = [];
  const body = new PlayerBody(p, e => pkEvents.push(e));
  const pin = {} as PkInput;
  p.parkour = {
    step: (dt, f, camYaw) => motor.step(dt, body, pkInputFrom(f, p.footYaw, camYaw, pin)),
    busy: () => motor.busy,
  };
  const sky = new SkyController(world, pkw, p, () => motor.busy);
  sky.attach();
  return { p, motor, sky, pkEvents };
}

interface Run {
  events: SkyEvent[];
  phases: Set<string>;
  minY: number;
  maxFall: number;
  t: number;
}

/** Step like Game.step until `done` (or `secs`). */
function play(
  r: ReturnType<typeof rig>,
  fps: number,
  secs: number,
  input: (t: number) => InputFrame,
  done: () => boolean,
  camYaw = Math.PI,
): Run {
  const { p, sky } = r;
  const dt = 1 / fps;
  const events: SkyEvent[] = [];
  const phases = new Set<string>();
  let minY = Infinity;
  let maxFall = 0;
  let t = 0;
  let settle = Math.ceil(fps * 0.2);
  for (; t < secs; t += dt) {
    const f = input(t);
    const steps = Math.min(
      160,
      Math.max(1, Math.ceil(dt / (1 / 90)), Math.ceil((p.speed * dt) / 0.5)),
    );
    for (let i = 0; i < steps; i++) {
      const fi = i === 0 ? f : { ...f, jumpPressed: false, duckPressed: false };
      p.update(dt / steps, fi, camYaw, t * 1000);
      events.push(...sky.events);
      sky.events.length = 0;
      phases.add(sky.phase);
      maxFall = Math.max(maxFall, -p.vel.y);
    }
    minY = Math.min(minY, p.pos.y);
    if (done()) {
      // a few more frames: the landing is judged the step after touchdown
      if (settle-- <= 0) break;
    }
  }
  return { events, phases, minY, maxFall, t };
}

/** Out of CAMP's window: run at it (−z), then whatever `air` says. */
function jumpOut(
  mode: 'foot' | 'board',
  fps: number,
  air: (t: number, clear: number, sky: SkyController) => Partial<InputFrame>,
  /** Ride as if over the mountain: a board air never turns into a skydive by itself there. */
  mountain = false,
) {
  const { world, site } = campScene();
  const r = rig(world);
  const { p, sky } = r;
  if (mountain)
    p.terrain = {
      height: () => -1e4,
      inDomain: () => true,
      surface: () => 'grass',
      speedLimit: () => Infinity,
    };
  const x = (site.window.x0 + site.window.x1) / 2;
  p.spawn(new THREE.Vector3(x, site.floorY + 0.02, site.origin.z + 4), Math.PI);
  p.mode = 'foot';
  p.footGrounded = true;
  if (mode === 'board') {
    // Rolling out of the window on the board
    p.mode = 'board';
    p.state = 'ground';
    p.fwd.set(0, 0, -1);
    p.vel.set(0, 0, -7);
  }
  const run = play(
    r,
    fps,
    40,
    t => {
      const out = p.pos.z < site.faceZ - 0.5;
      return frame(out ? air(t, sky.clear, sky) : { moveY: mode === 'foot' ? 1 : 0, sprint: true });
    },
    () => (mode === 'foot' ? p.footGrounded : p.state !== 'air') && p.pos.y < site.floorY - 5,
  );
  return { ...run, r, site };
}

describe('skydiving out of the CAMP window', () => {
  for (const fps of [60, 20])
    it(`on foot: freefall, pull, a soft landing under canopy (${fps} fps)`, () => {
      let pulled = false;
      const j = jumpOut('foot', fps, (_t, clear) => {
        const go = !pulled && clear < 70;
        if (go) pulled = true;
        return { jumpPressed: go };
      });
      const types = j.events.map(e => e.type);
      expect(types).toContain('enter');
      expect(types).toContain('pull');
      const land = j.events.find(e => e.type === 'land');
      expect(land).toMatchObject({ type: 'land', canopy: true });
      expect((land as { impact: number }).impact).toBeLessThan(9);
      // A normal landing: no roll needed, no stumble
      expect(j.r.pkEvents.some(e => e.type === 'stumble' || e.type === 'roll')).toBe(false);
      expect(j.r.p.footGrounded).toBe(true);
      expect(j.minY).toBeGreaterThan(-0.3);
      expect(j.r.p.pos.y).toBeCloseTo(0, 0);
      // Under canopy for a good while: a real descent, not a bounce
      expect(j.t).toBeGreaterThan(12);
    });

  it('on foot without pulling: a hard landing (stumble), no tunnelling', () => {
    const j = jumpOut('foot', 60, () => ({}));
    expect(j.events.map(e => e.type)).toContain('enter');
    expect(j.maxFall).toBeGreaterThan(30);
    expect(j.r.pkEvents.some(e => e.type === 'stumble')).toBe(true);
    expect(j.minY).toBeGreaterThan(-0.3);
    expect(j.r.p.pos.y).toBeCloseTo(0, 0);
  });

  it('on foot without pulling: the timed duck still rolls it out', () => {
    const j = jumpOut('foot', 60, (_t, clear) => ({ duck: clear < 6, duckPressed: clear < 6 }));
    expect(j.r.pkEvents.some(e => e.type === 'roll')).toBe(true);
    expect(j.r.pkEvents.some(e => e.type === 'stumble')).toBe(false);
  });

  it('pressing pull too low does nothing but say so', () => {
    const j = jumpOut('foot', 60, (_t, clear) => ({ jumpPressed: clear < 20 && clear > 3 }));
    const types = j.events.map(e => e.type);
    expect(types).toContain('tooLow');
    expect(types).not.toContain('pull');
  });

  for (const fps of [60, 20])
    it(`on a board: freefall, pull, rolls away under canopy (${fps} fps)`, () => {
      let pulled = false;
      const j = jumpOut('board', fps, (_t, clear) => {
        const go = !pulled && clear < 70;
        if (go) pulled = true;
        return { jumpPressed: go };
      });
      const types = j.events.map(e => e.type);
      expect(types).toContain('enter');
      expect(types).toContain('pull');
      expect(j.events.find(e => e.type === 'land')).toMatchObject({ canopy: true });
      expect(j.r.p.state).not.toBe('bail');
      expect(j.r.p.state).not.toBe('air');
      expect(j.minY).toBeGreaterThan(-0.3);
    });

  it('on a board without pulling: bails on the plaza, no tunnelling', () => {
    const j = jumpOut('board', 60, () => ({}));
    expect(j.events.map(e => e.type)).toContain('enter');
    expect(j.r.p.state).toBe('bail');
    expect(j.minY).toBeGreaterThan(-0.3);
  });
});

describe('terminal velocity never tunnels', () => {
  for (const mode of ['foot', 'board'] as const)
    for (const fps of [60, 20])
      it(`diving from 1.5 km lands on the floor (${mode}, ${fps} fps)`, () => {
        const world = new CollisionWorld();
        world.build([box(-200, 200, -1, 0, -200, 200)]);
        const r = rig(world);
        const { p } = r;
        p.spawn(new THREE.Vector3(0, 1500, 0), 0);
        p.mode = mode;
        if (mode === 'foot') p.footGrounded = false;
        else p.state = 'air';
        p.vel.set(0, -5, 0);
        const run = play(
          r,
          fps,
          60,
          () => frame({ sprint: true }),
          () => (mode === 'foot' ? p.footGrounded : p.state !== 'air'),
        );
        expect(run.phases.has('freefall')).toBe(true);
        expect(run.maxFall).toBeGreaterThan(SKY.vt.dive - 4);
        expect(run.minY).toBeGreaterThan(-0.3);
        expect(p.pos.y).toBeCloseTo(0, 0);
      });
});

describe('parkour keeps priority', () => {
  it('a fall down a facade with a ledge on it ends in a ledge hang, never a freefall', () => {
    const world = new CollisionWorld();
    world.build([
      box(-200, 200, -1, 0, -200, 200),
      box(-10, 10, 0, 120, 0, 12), // the facade: the plane z = 0, facing −z
      box(-10, 10, 39.8, 40, -0.3, 0), // a sill sticking out at 40 m
    ]);
    const r = rig(world);
    const { p, motor, sky } = r;
    // Falling from 100 m hugging the wall, facing it
    p.spawn(new THREE.Vector3(0, 100, -0.6), 0);
    p.mode = 'foot';
    p.footGrounded = false;
    p.pos.set(0, 100, -0.6);
    p.vel.set(0, -2, 0);
    let hung = false;
    const run = play(
      r,
      60,
      10,
      () => frame(),
      () => {
        hung ||= motor.move?.k === 'hang';
        return hung || p.footGrounded;
      },
      0,
    );
    expect(hung).toBe(true);
    expect(run.phases.has('freefall')).toBe(false);
    expect(sky.phase).toBe('off');
    expect(p.pos.y).toBeGreaterThan(37);
  });

  it('a freefall that drifts onto a ledge is caught by it', () => {
    const world = new CollisionWorld();
    world.build([
      box(-200, 200, -1, 0, -200, 200),
      box(-10, 10, 0, 120, 0, 12),
      box(-10, 10, 59.8, 60, -0.3, 0),
    ]);
    const r = rig(world);
    const { p, motor } = r;
    // Away from the wall, facing it, tracking in
    p.spawn(new THREE.Vector3(0, 110, -6), 0);
    p.mode = 'foot';
    p.footGrounded = false;
    p.pos.set(0, 110, -6);
    p.vel.set(0, -5, 0);
    let hung = false;
    const run = play(
      r,
      60,
      10,
      () => frame({ moveY: 1 }),
      () => {
        hung ||= motor.move?.k === 'hang';
        return hung || p.footGrounded;
      },
      0,
    );
    expect(run.phases.has('freefall')).toBe(true);
    expect(run.events.map(e => e.type)).toContain('caught');
    expect(hung || r.p.climb !== null).toBe(true);
  });

  it('climbing a tall wall never trips freefall', () => {
    const world = new CollisionWorld();
    world.build([box(-200, 200, -1, 0, -200, 200), box(-10, 10, 0, 120, 0, 12)]);
    const r = rig(world);
    const { p } = r;
    p.spawn(new THREE.Vector3(0, 0.02, -0.8), 0);
    p.mode = 'foot';
    p.footGrounded = true;
    let climbed = 0;
    const run = play(
      r,
      60,
      30,
      () => frame({ moveY: 1 }),
      () => false,
      0,
    );
    climbed = p.pos.y;
    expect(climbed).toBeGreaterThan(SKY.enterClear + 5);
    expect(run.phases.has('freefall')).toBe(false);
  });
});

describe('a big board air where skydives never start by themselves', () => {
  it('stays a plain air (the record still counts) unless you take the offer', () => {
    const j = jumpOut('board', 60, () => ({}), true);
    expect(j.events.map(e => e.type)).not.toContain('enter');
    expect(j.phases.has('freefall')).toBe(false);
  });

  for (const fps of [60, 20])
    it(`offers it high up: jump takes it, the next jump pulls, a soft landing (${fps} fps)`, () => {
      let took = false;
      let pulled = false;
      let sawOffer = false;
      const j = jumpOut(
        'board',
        fps,
        (_t, clear, sky) => {
          sawOffer ||= sky.offer;
          if (!took && sky.offer) {
            took = true;
            return { jumpPressed: true };
          }
          if (took && !pulled && sky.phase === 'freefall' && clear < 70) {
            pulled = true;
            return { jumpPressed: true };
          }
          return {};
        },
        true,
      );
      expect(sawOffer).toBe(true);
      const enter = j.events.find(e => e.type === 'enter');
      expect(enter).toMatchObject({ taken: true });
      // taking it never pulls in the same press
      const types = j.events.map(e => e.type);
      expect(types.indexOf('pull')).toBeGreaterThan(types.indexOf('enter'));
      expect(j.events.find(e => e.type === 'land')).toMatchObject({ canopy: true });
      expect(j.r.p.state).not.toBe('bail');
      expect(j.minY).toBeGreaterThan(-0.3);
    });
});
