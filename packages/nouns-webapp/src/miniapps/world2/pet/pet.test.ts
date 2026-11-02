import { describe, expect, it } from 'vitest';

import { boxWorld, type Box } from './boxWorld';
import { PET, PET_MODES } from './contract';
import { chooseMode, newPetBody, shouldPoof, stepPet, type Owner } from './follow';
import { checkPetName, cleanPetName } from './name';
import { blendPose, poseFor, restPose } from './pose';
import { parseSavedPet } from './store';
import { decodePet, encodePet } from './wire';

const floor: Box = { x0: -100, x1: 100, y0: -1, y1: 0, z0: -100, z1: 100 };

const owner = (over: Partial<Owner> = {}): Owner => ({
  x: 0,
  y: 0,
  z: 0,
  fx: 0,
  fz: 1,
  speed: 0,
  grounded: true,
  onBoard: false,
  headTop: 1.75,
  ...over,
});

describe('pet names', () => {
  it('keeps a rider-name charset, short', () => {
    expect(cleanPetName('mochi!! 🐭')).toBe('MOCHI ');
    expect(cleanPetName('a   b')).toBe('A B');
    expect(cleanPetName('x'.repeat(40))).toHaveLength(PET.nameMax);
  });
  it('refuses empty and blocked names', () => {
    expect(checkPetName('  ')).toEqual({ ok: false, why: 'empty' });
    expect(checkPetName('fuck')).toEqual({ ok: false, why: 'blocked' });
    expect(checkPetName('f.u.c.k')).toEqual({ ok: false, why: 'blocked' });
    expect(checkPetName(' Mochi ')).toEqual({ ok: true, name: 'MOCHI' });
  });
});

describe('pet on the wire (pt)', () => {
  it('round-trips', () => {
    const w = encodePet('mochi', 'fly', 'Pip');
    expect(w).toEqual([1, 2, 'PIP']);
    expect(decodePet(JSON.parse(JSON.stringify(w)))).toEqual({
      look: 'mochi',
      mode: 'fly',
      name: 'PIP',
    });
  });
  it('codes are append only', () => {
    expect(PET_MODES.slice(0, 7)).toEqual([
      'beside',
      'head',
      'fly',
      'ride',
      'watch',
      'away',
      'perch',
    ]);
  });
  it('rejects anything malformed, and hides a blocked name', () => {
    for (const bad of [
      null,
      1,
      'x',
      [],
      [1, 2],
      [0, 0, 'A'],
      [9, 0, 'A'],
      [1, 99, 'A'],
      [1, 0.5, 'A'],
      [1, 0, 7],
      [1, 0, 'A'.repeat(99)],
    ])
      expect(decodePet(bad)).toBeNull();
    expect(decodePet([1, 0, 'shit'])).toEqual({ look: 'mochi', mode: 'beside', name: '' });
    expect(decodePet([1, 0, '<b>x</b>'])?.name).toBe('BXB');
  });
});

describe('saved pet', () => {
  it('reads v1 and fixes what it can', () => {
    expect(parseSavedPet(null)).toBeNull();
    expect(parseSavedPet('nope')).toBeNull();
    expect(parseSavedPet('{"v":2}')).toBeNull();
    expect(parseSavedPet('{"v":1,"look":"x","name":"shit","follow":"zz","at":5}')).toEqual({
      v: 1,
      look: 'mochi',
      name: 'MOCHI',
      follow: 'auto',
      at: 5,
    });
    expect(
      parseSavedPet('{"v":1,"look":"mochi","name":"pip","follow":"head","at":1}')?.follow,
    ).toBe('head');
  });
});

describe('which mode', () => {
  const ctx = { vehicle: false, busy: false, away: false, parkour: false };
  it('context wins over the player choice', () => {
    expect(
      chooseMode({ ...ctx, away: true, vehicle: true }, 'head', { onBoard: false, speed: 0 }),
    ).toBe('away');
    expect(chooseMode({ ...ctx, vehicle: true }, 'fly', { onBoard: false, speed: 0 })).toBe('ride');
    expect(chooseMode({ ...ctx, busy: true }, 'fly', { onBoard: false, speed: 0 })).toBe('watch');
    expect(chooseMode({ ...ctx, parkour: true }, 'beside', { onBoard: false, speed: 0 })).toBe(
      'head',
    );
  });
  it('auto: runs beside on foot, flies by a fast board', () => {
    expect(chooseMode(ctx, 'auto', { onBoard: false, speed: 6 })).toBe('beside');
    expect(chooseMode(ctx, 'auto', { onBoard: true, speed: 1 })).toBe('beside');
    expect(chooseMode(ctx, 'auto', { onBoard: true, speed: 9 })).toBe('fly');
    expect(chooseMode(ctx, 'head', { onBoard: true, speed: 9 })).toBe('head');
  });
});

/** Run the pet behind an owner who moves by `move(t)` for `secs`. */
function run(
  boxes: Box[],
  move: (t: number, o: Owner) => void,
  secs: number,
  mode: 'beside' | 'fly' | 'head' = 'beside',
  o0: Partial<Owner> = {},
) {
  const w = boxWorld(boxes);
  const o = owner(o0);
  const b = newPetBody(o.x + 1, o.y, o.z - 0.5);
  b.mode = mode;
  const dt = 1 / 60;
  let maxDist = 0;
  let inside = 0;
  let poofs = 0;
  for (let t = 0; t < secs; t += dt) {
    move(t, o);
    if (stepPet(b, o, mode, w, dt) === 'poof') poofs++;
    maxDist = Math.max(maxDist, Math.hypot(o.x - b.x, o.z - b.z));
    if (mode !== 'head' && w.inside(b.x, b.y + PET.radius, b.z, PET.radius * 0.8)) inside++;
  }
  return { b, o, maxDist, inside, poofs, w };
}

describe('following on the ground', () => {
  it('keeps up with a running rider, beside and a little behind', () => {
    const r = run(
      [floor],
      (t, o) => {
        o.z = t * 5.5;
        o.speed = 5.5;
      },
      6,
    );
    expect(r.poofs).toBe(0);
    expect(r.maxDist).toBeLessThan(2.6);
    expect(r.b.z).toBeLessThan(r.o.z);
    expect(Math.abs(Math.abs(r.b.x) - PET.besideSide)).toBeLessThan(0.3);
    expect(r.b.y).toBe(0);
  });

  it('sits, then sleeps, when the rider stands about, and is happy when they move', () => {
    const w = boxWorld([floor]);
    const o = owner();
    const b = newPetBody(PET.besideSide, 0, -PET.besideBack);
    let slept = false;
    let happy = false;
    for (let t = 0; t < PET.sleepAfter + 3; t += 1 / 30) {
      stepPet(b, o, 'beside', w, 1 / 30);
      if (t > PET.sitAfter + 0.5 && t < PET.sleepAfter - 1) expect(b.gait).toBe('sit');
      slept ||= b.gait === 'sleep';
    }
    expect(slept).toBe(true);
    o.speed = 2;
    o.z = 0.5;
    happy = stepPet(b, o, 'beside', w, 1 / 30) === 'happy';
    expect(happy).toBe(true);
    expect(b.gait).toBe('happy');
  });

  it('never walks into a wall beside the rider: takes the other side', () => {
    // a wall along the rider's right, 0.5 m away
    const wall: Box = { x0: -0.5 - 0.3, x1: -0.5, y0: 0, y1: 3, z0: -50, z1: 50 };
    const r = run(
      [floor, wall],
      (t, o) => {
        o.z = t * 3;
        o.speed = 3;
      },
      5,
      'beside',
      {},
    );
    expect(r.inside).toBe(0);
    expect(r.poofs).toBe(0);
    expect(r.maxDist).toBeLessThan(3);
  });

  it('goes round a pillar instead of through it', () => {
    const pillar: Box = { x0: 0.5, x1: 1.5, y0: 0, y1: 3, z0: 5, z1: 6 };
    const r = run(
      [floor, pillar],
      (t, o) => {
        o.z = Math.min(12, t * 3);
        o.speed = o.z < 12 ? 3 : 0;
      },
      7,
    );
    expect(r.inside).toBe(0);
    expect(Math.hypot(r.o.x - r.b.x, r.o.z - r.b.z)).toBeLessThan(2);
  });

  it('steps up a kerb and hops down it, but never off a ledge into a drop', () => {
    const kerb: Box = { x0: -100, x1: 100, y0: 0, y1: 0.3, z0: 4, z1: 100 };
    const r = run(
      [floor, kerb],
      (t, o) => {
        o.z = Math.min(10, t * 3);
        o.y = o.z > 4 ? 0.3 : 0;
        o.speed = o.z < 10 ? 3 : 0;
      },
      6,
    );
    expect(r.b.y).toBeCloseTo(0.3, 5);
    expect(r.poofs).toBe(0);
    // a 6 m drop beside a walkway: it stays on the walkway
    const walk: Box = { x0: -0.6, x1: 0.6, y0: 5, y1: 6, z0: -50, z1: 50 };
    const r2 = run(
      [floor, walk],
      (t, o) => {
        o.z = t * 2;
        o.speed = 2;
      },
      4,
      'beside',
      { y: 6 },
    );
    // it may end up behind on the walkway, but always on it (or poofed back onto it)
    expect(r2.b.y).toBeCloseTo(6, 5);
  });

  it('poofs back after a window jump (rider lands 30 m below)', () => {
    const w = boxWorld([floor, { x0: -5, x1: 5, y0: 29, y1: 30, z0: -5, z1: 5 }]);
    const o = owner({ y: 30 });
    const b = newPetBody(1, 30, -0.5);
    stepPet(b, o, 'beside', w, 1 / 60);
    // the rider falls out past the edge
    let poofed = false;
    for (let t = 0; t < 6; t += 1 / 60) {
      o.z = Math.min(8, o.z + 4 / 60);
      o.grounded = o.y <= 0;
      o.y = Math.max(0, o.y - 12 / 60);
      o.speed = o.grounded ? 0 : 4;
      if (stepPet(b, o, 'beside', w, 1 / 60) === 'poof') poofed = true;
      // never poofs while the rider's still in the air
      if (!o.grounded) expect(b.y).toBeGreaterThan(29);
    }
    expect(poofed).toBe(true);
    expect(b.y).toBe(0);
    expect(Math.hypot(o.x - b.x, o.z - b.z)).toBeLessThan(1.5);
  });

  it('poofs on a teleport (respawn, a room door), and is happy about it', () => {
    const w = boxWorld([floor]);
    const o = owner();
    const b = newPetBody(1, 0, -0.5);
    stepPet(b, o, 'beside', w, 1 / 60);
    o.x = 40;
    expect(stepPet(b, o, 'beside', w, 1 / 60)).toBe('poof');
    expect(Math.hypot(o.x - b.x, o.z - b.z)).toBeLessThan(1.5);
    expect(b.happy).toBeGreaterThan(0);
  });

  it('stuck behind a wall it cannot get round: poofs', () => {
    const b = newPetBody(0, 0, -3);
    expect(shouldPoof({ ...b, stuck: PET.stuckFor + 0.1 }, owner())).toBe(true);
    expect(shouldPoof(b, owner())).toBe(false);
  });

  it('watching: stays put, sitting, facing the rider', () => {
    const w = boxWorld([floor]);
    const o = owner({ x: 6, z: 6 });
    const b = newPetBody(0, 0, 0);
    for (let i = 0; i < 120; i++) stepPet(b, o, 'watch', w, 1 / 60);
    expect(b.x).toBe(0);
    expect(b.z).toBe(0);
    expect(b.gait).toBe('sit');
    expect(b.yaw).toBeCloseTo(Math.atan2(6, 6), 3);
  });
});

describe('flying and riding the head', () => {
  it('flies by the head at board speed, never through a wall', () => {
    const wall: Box = { x0: -1.5, x1: -0.6, y0: 0, y1: 5, z0: 10, z1: 30 };
    const r = run(
      [floor, wall],
      (t, o) => {
        o.z = t * 12;
        o.speed = 12;
        o.onBoard = true;
      },
      4,
      'fly',
    );
    expect(r.inside).toBe(0);
    expect(r.poofs).toBe(0);
    expect(r.maxDist).toBeLessThan(3.5);
    expect(r.b.y).toBeGreaterThan(1.5);
  });

  it('sits on the head, and climbs down under a low ceiling', () => {
    const r = run([floor], () => {}, 0.5, 'head');
    expect(r.b.y).toBeCloseTo(1.75, 5);
    expect(r.b.gait).toBe('perch');
    const ceiling: Box = { x0: -10, x1: 10, y0: 2.1, y1: 2.4, z0: -10, z1: 10 };
    const r2 = run([floor, ceiling], () => {}, 0.5, 'head');
    expect(r2.b.y).toBe(0);
  });
});

describe('poses', () => {
  it('every gait gives finite joints, and blending lands on the target', () => {
    for (const g of [
      'stand',
      'idle',
      'walk',
      'trot',
      'run',
      'hop',
      'sit',
      'sleep',
      'happy',
      'fly',
      'perch',
      'ride',
    ] as const)
      for (const ph of [0, 0.25, 0.5, 0.9]) {
        const p = poseFor(g, ph, 3.3);
        const flat = JSON.stringify(p);
        expect(flat).not.toMatch(/null|NaN/);
      }
    const cur = restPose();
    const to = poseFor('run', 0.25, 1);
    for (let i = 0; i < 60; i++) blendPose(cur, to, 0.3);
    expect(cur.legs[0]).toBeCloseTo(to.legs[0], 4);
  });
  it('sleep pushes the noggles up and shuts the eyes; the happy spin goes all the way round', () => {
    expect(poseFor('sleep', 0, 0).noggles).toBeLessThan(-0.5);
    expect(poseFor('sleep', 0, 0).eyesShut).toBe(1);
    expect(poseFor('happy', 1, 0).spin).toBeCloseTo(Math.PI * 2, 5);
    expect(poseFor('happy', 0, 0).spin).toBe(0);
  });
});
