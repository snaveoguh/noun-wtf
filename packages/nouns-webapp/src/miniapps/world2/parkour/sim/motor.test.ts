// The parkour state machine against box / pole levels on the real collision.

import { describe, expect, it } from 'vitest';

import { PK } from '../contract';

import { findLedge, poleAlong, sideWall } from './detect';
import { landing } from './landing';
import { ParkourMotor } from './motor';
import { Rig, input, level } from './testKit';

const RUN = 6.5;
const fwd = (o: Parameters<typeof input>[0] = {}) =>
  input({ moveY: 1, wishZ: 1, sprint: true, ...o });

describe('wall run', () => {
  // A long wall on the rider's left (+x side), face at x = 1.0
  const { w } = level([[1.5, 3, 20, 1, 6, 40]]);

  it('runs along the wall for over a second, then wall-jumps off it', () => {
    const r = new Rig(w, 0.25, 0, 0);
    r.run(40, fwd(), RUN);
    expect(r.until('wallrun', 3, fwd({ jump: true }), RUN)).toBe(true);
    const m = r.motor.move!;
    expect(m.k === 'wallrun' && m.side).toBe(1);
    const y0 = r.b.pos.y;
    let t = 0;
    while (r.move === 'wallrun' && t < 200) {
      r.step(fwd(), RUN);
      t++;
      if (t === 60) break;
    }
    expect(r.move).toBe('wallrun');
    expect(r.b.pos.y).toBeGreaterThan(y0 + 0.4);
    expect(r.b.pos.x).toBeCloseTo(1.0 - PK.wallRunDist, 1);
    expect(r.motor.anim.kind).toBe('wallrun');
    r.step(fwd({ jump: true }), RUN);
    expect(r.move).toBe('none');
    expect(r.b.vel.x).toBeLessThan(-3); // away from the wall
    expect(r.b.vel.y).toBeGreaterThan(5);
    expect(r.b.has('walljump')).toBe(true);
    expect(r.motor.anim.kind).toBe('flip');
  });

  it('peels off on its own when the time runs out', () => {
    const r = new Rig(w, 0.25, 0, 0);
    r.run(40, fwd(), RUN);
    r.until('wallrun', 3, fwd({ jump: true }), RUN);
    r.run(Math.ceil(PK.wallRunTime * 60) + 5, fwd(), RUN);
    expect(r.move).not.toBe('wallrun');
  });

  it("won't start beside a knee-high wall", () => {
    const low = level([[1.5, 0.4, 20, 1, 0.8, 40]]).w;
    expect(sideWall(low, 0.25, 0, 5, 0, 1)).toBeNull();
    const r = new Rig(low, 0.25, 0, 0);
    r.run(40, fwd(), RUN);
    expect(r.until('wallrun', 30, fwd({ jump: true }), RUN)).toBe(false);
  });
});

describe('vertical wall run → ledge → pull-up', () => {
  // A 3.2 m block ahead: face at z = 6, top 3.2
  const { w } = level([[0, 1.6, 10, 8, 3.2, 8]]);

  it('runs up the wall, catches the lip and pulls up on top', () => {
    const r = new Rig(w, 0, 0, 0);
    r.run(30, fwd(), RUN);
    // Jump about a metre short of the wall
    r.until('hang', 200, t => fwd({ jump: r.b.pos.z > 4.7 && r.b.grounded && t < 2 }), RUN);
    expect(r.log).toContain('wallup');
    expect(r.move).toBe('hang');
    expect(r.b.pos.y).toBeCloseTo(3.2 - PK.hangDrop, 1);
    expect(r.b.pos.z).toBeCloseTo(6 - PK.hangDist, 1);
    const h = r.motor.move!;
    expect(h.k === 'hang' && h.top).toBe(true);
    r.run(70, input({ moveY: 1 }));
    expect(r.move).toBe('none');
    expect(r.b.grounded).toBe(true);
    expect(r.b.pos.y).toBeCloseTo(3.2, 1);
    expect(r.b.pos.z).toBeGreaterThan(6.2);
    expect(r.b.has('pullup')).toBe(true);
  });

  it('tic-tacs off the wall with a jump, kicked sideways by the stick', () => {
    const r = new Rig(w, 0, 0, 0);
    r.run(30, fwd(), RUN);
    expect(
      r.until('wallup', 120, t => fwd({ jump: r.b.pos.z > 4.7 && r.b.grounded && t < 2 }), RUN),
    ).toBe(true);
    r.run(6, input());
    r.step(input({ jump: true, moveX: 1 }));
    expect(r.move).toBe('none');
    expect(r.b.has('tictac')).toBe(true);
    expect(r.b.vel.z).toBeLessThan(-1); // off the wall
    expect(r.b.vel.x).toBeLessThan(-1); // rider's right while facing +z is −x
    expect(r.b.vel.y).toBeGreaterThan(5);
  });

  it('a tall wall with no lip in reach turns into the climb when held', () => {
    const tall = level([[0, 6, 10, 8, 12, 8]]).w;
    const r = new Rig(tall, 0, 0, 0);
    r.run(30, fwd(), RUN);
    r.run(120, t => fwd({ jump: r.b.pos.z > 4.7 && r.b.grounded && t < 2 }), RUN);
    expect(r.log).toContain('wallup');
    expect(r.b.climbs.length).toBe(1);
    expect(r.move).toBe('climb');
  });
});

describe('ledges', () => {
  // A wall 2.6 m high with a top to stand on
  const wall = level([[0, 1.3, 4, 6, 2.6, 4]]).w;

  it('finds the lip, its face and whether you can stand on it', () => {
    const l = findLedge(wall, 0, 0.9, 1.6, 0, -1);
    expect(l).not.toBeNull();
    expect(l!.y).toBeCloseTo(2.6, 2);
    expect(l!.z).toBeCloseTo(2, 2);
    expect(l!.nz).toBeCloseTo(-1, 2);
    expect(l!.top).toBe(true);
  });

  it('a sill under a wall that carries on: hang yes, pull up no', () => {
    // A 0.25 m sill sticking out of a 10 m facade at 3 m
    const sill = level([
      [0, 5, 4.5, 8, 10, 1],
      [0, 2.95, 3.875, 3, 0.1, 0.25],
    ]).w;
    const l = findLedge(sill, 0, 1.7, 3.2, 0, -1);
    expect(l).not.toBeNull();
    expect(l!.y).toBeCloseTo(3.0, 1);
    expect(l!.top).toBe(false);
  });

  it('grabs a lip on the way up, shimmies along it and stops at the end', () => {
    const r = new Rig(wall, 0, 0, 1.5, Math.PI);
    r.b.yaw = 0; // facing +z, the wall
    r.b.grounded = false;
    r.b.vel.y = 4.4;
    expect(r.until('hang', 40, input())).toBe(true);
    r.run(150, input({ moveX: 1 }));
    // The wall is 6 m wide (x −3..3); rider's right facing +z is −x
    expect(r.b.pos.x).toBeLessThan(-2.2);
    expect(r.b.pos.x).toBeGreaterThan(-3.1);
    expect(r.move).toBe('hang');
    expect(r.motor.anim.kind).toBe('hang');
  });

  it('drops off with duck and does not grab the same lip on the way down', () => {
    const r = new Rig(wall, 0, 0, 1.5);
    r.b.grounded = false;
    r.b.vel.y = 4.4;
    r.until('hang', 40, input());
    r.run(10, input());
    r.step(input({ duck: true, duckPressed: true }));
    expect(r.move).toBe('none');
    r.run(90, input());
    expect(r.log.slice(-80)).not.toContain('hang');
    expect(r.b.grounded).toBe(true);
  });

  it('leaps sideways to the next ledge', () => {
    // Two 2 m walls 1.4 m apart (gap 1.4)
    const two = level([
      [0, 1.3, 4, 2, 2.6, 4],
      [-3.4, 1.4, 4, 2, 2.8, 4],
    ]).w;
    const r = new Rig(two, 0.2, 0, 1.5);
    r.b.grounded = false;
    r.b.vel.y = 4.4;
    expect(r.until('hang', 40, input())).toBe(true);
    r.run(10, input());
    r.step(input({ jump: true, moveX: 1 }));
    expect(r.move).toBe('leap');
    expect(r.until('hang', 60, input())).toBe(true);
    expect(r.b.pos.x).toBeLessThan(-2.3);
    expect(r.b.pos.y).toBeCloseTo(2.8 - PK.hangDrop, 1);
  });

  it('ducking at a drop-off lowers you over the edge to hang', () => {
    // Standing on a 4 m block, the edge 0.4 m ahead (+z)
    const roof = level([[0, 2, 0, 6, 4, 6]]).w;
    const r = new Rig(roof, 0, 4, 2.6);
    r.run(5, input());
    r.step(input({ duck: true, duckPressed: true }));
    expect(r.move).toBe('hang');
    expect(r.b.pos.y).toBeCloseTo(4 - PK.hangDrop, 1);
    expect(r.b.pos.z).toBeGreaterThan(3);
    // Facing back at the wall
    expect(Math.cos(r.b.yaw)).toBeLessThan(-0.9);
    // …and W climbs straight back up
    r.run(80, input({ moveY: 1 }));
    expect(r.b.grounded).toBe(true);
    expect(r.b.pos.y).toBeCloseTo(4, 1);
  });
});

describe('poles', () => {
  const { w } = level([], [[0, 4, 0.08, 6.5]]);

  it('tells a lamp post from a wall or a fat column', () => {
    expect(poleAlong(w, 0, 0.5, 3, 0, -1, 1.6)).toBeNull(); // looking away
    const hit = poleAlong(w, 0, 0.5, 2.6, 0, 1, 1.6);
    expect(hit).not.toBeNull();
    expect(hit!.cz).toBeCloseTo(4, 1);
    expect(hit!.r).toBeGreaterThan(0.04);
    expect(hit!.r).toBeLessThan(0.12);
    expect(hit!.top).toBeGreaterThan(5.8);
    expect(hit!.base).toBeCloseTo(0, 1);
    const fat = level([], [[0, 4, 0.55, 6]]).w;
    expect(poleAlong(fat, 0, 0.5, 2.2, 0, 1, 1.6)).toBeNull();
    const wall = level([[0, 3, 5, 6, 6, 2]]).w;
    expect(poleAlong(wall, 0, 0.5, 2.6, 0, 1, 1.6)).toBeNull();
  });

  it('jump into a lamp post: grab, slide down, swing round, step off at the bottom', () => {
    const r = new Rig(w, 0.3, 0, 0);
    r.run(20, fwd(), RUN);
    const got = r.until(
      'pole',
      90,
      t => fwd({ jump: r.b.pos.z > 2.2 && r.b.grounded && t < 2 }),
      RUN,
    );
    expect(got).toBe(true);
    const y0 = r.b.pos.y;
    // Swing with D while sliding
    r.run(25, input({ moveX: 1 }));
    const m = r.motor.move!;
    expect(m.k === 'pole' && m.spin).toBeGreaterThan(0.5);
    expect(r.motor.anim.kind).toBe('pole');
    // …and slides down below where it caught on
    let low = r.b.pos.y;
    for (let k = 0; k < 120 && r.move === 'pole'; k++) {
      r.step(input());
      low = Math.min(low, r.b.pos.y);
    }
    expect(low).toBeLessThan(y0 - 0.3);
    r.run(240, input());
    expect(r.move).toBe('none');
    expect(r.b.grounded).toBe(true);
    expect(r.b.pos.y).toBeCloseTo(0, 1);
  });

  it('climbs with W, and a jump launches you off with speed', () => {
    const r = new Rig(w, 0.3, 0, 0);
    r.run(20, fwd(), RUN);
    r.until('pole', 90, t => fwd({ jump: r.b.pos.z > 2.2 && r.b.grounded && t < 2 }), RUN);
    const y0 = r.b.pos.y;
    r.run(40, input({ moveY: 1 }));
    expect(r.b.pos.y).toBeGreaterThan(y0 + 0.4);
    expect(r.b.pos.y).toBeLessThanOrEqual(6.5 - 1.45 + 1e-6);
    r.run(30, input({ moveX: 1 }));
    r.step(input({ jump: true }));
    expect(r.move).toBe('none');
    expect(Math.hypot(r.b.vel.x, r.b.vel.z)).toBeGreaterThan(PK.poleLaunchOut);
    expect(r.b.vel.y).toBeCloseTo(PK.poleLaunchUp, 3);
    expect(r.b.has('poleLaunch')).toBe(true);
    // …and doesn't regrab it straight away
    r.run(20, input());
    expect(r.log.slice(-20)).not.toContain('pole');
  });
});

describe('pole to pole', () => {
  it('a jump near the top of a pole still catches it', () => {
    const { w } = level([], [[0, 3, 0.09, 4]]);
    // Chest above the top, hands just under it
    expect(poleAlong(w, 0, 3.0, 1.5, 0, 1, 2.4)).not.toBeNull();
    expect(poleAlong(w, 0, 3.0, 1.5, 0, 1, 2.4)!.top).toBeCloseTo(4, 0);
  });

  it('the aim assist finds a thin pole 25° off the launch line, 7 m out', () => {
    const { w } = level(
      [],
      [
        [15, 15, 0.1, 8],
        [15, 7.5, 0.09, 6.5],
      ],
    );
    const m = new ParkourMotor(w) as unknown as {
      poleAhead(x: number, y: number, z: number, yaw: number): { cx: number; cz: number } | null;
    };
    const hit = m.poleAhead(15.5, 4.67, 14.08, Math.atan2(0.48, -0.88));
    expect(hit).not.toBeNull();
    expect(hit!.cz).toBeCloseTo(7.5, 1);
    // …and nothing when there's nothing out there
    expect(m.poleAhead(15.5, 4.67, 14.08, Math.PI / 2)).toBeNull();
  });

  it('a launch roughly at the next pole is aimed at it and catches it', () => {
    const { w } = level(
      [],
      [
        [0, 0, 0.09, 6.5],
        [1.2, -7.5, 0.09, 6.5],
      ],
    );
    const r = new Rig(w, 0, 0, 2.2, Math.PI);
    r.b.grounded = false;
    r.b.vel.y = 5;
    r.b.vel.z = -3;
    expect(r.until('pole', 40, input())).toBe(true);
    r.run(40, input({ moveY: 1 }));
    // Swing round to the far side (out ≈ −z), then let go
    expect(r.until('pole', 1, input())).toBe(true);
    for (let k = 0; k < 400; k++) {
      const m = r.motor.move;
      if (m !== null && m.k === 'pole' && Math.cos(m.ang) < -0.9) break;
      r.step(input({ moveX: 1, moveY: 1 }));
    }
    r.step(input({ jump: true }));
    expect(r.b.has('poleLaunch')).toBe(true);
    let caught = false;
    for (let k = 0; k < 120 && !caught; k++) {
      r.step(input());
      const m = r.motor.move;
      caught = m !== null && m.k === 'pole' && Math.abs(m.cz + 7.5) < 0.3;
    }
    expect(caught).toBe(true);
  });
});

describe('ground moves', () => {
  it('slides under a bar a standing rider walks into', () => {
    // A bar 1.0–1.5 m up across the path at z = 6
    const { w } = level([
      [0, 1.25, 6, 6, 0.5, 0.3],
      [-3, 0.5, 6, 0.2, 1, 0.3],
      [3, 0.5, 6, 0.2, 1, 0.3],
    ]);
    const walk = new Rig(w, 0, 0, 0);
    walk.run(150, fwd(), RUN);
    expect(walk.b.pos.z).toBeLessThan(6);
    const r = new Rig(w, 0, 0, 0);
    r.run(
      150,
      () =>
        fwd({
          duckPressed: r.b.pos.z > 3.4 && r.b.pos.z < 3.6,
          duck: r.b.pos.z > 3.4 && r.b.pos.z < 7,
        }),
      RUN,
    );
    expect(r.log).toContain('slide');
    expect(r.b.pos.z).toBeGreaterThan(7);
    expect(r.b.has('slide')).toBe(true);
  });

  it('runs at a bench and vaults it', () => {
    const { w } = level([[0, 0.25, 5, 3, 0.5, 0.5]]);
    const r = new Rig(w, 0, 0, 0);
    r.run(100, fwd(), RUN);
    expect(r.b.vaults.length).toBeGreaterThan(0);
    expect(r.b.vaults[0][1]).toBeCloseTo(-1, 1);
  });

  it('a sprint jump off a roof edge is a gap jump', () => {
    const { w } = level([[0, 5, 0, 8, 10, 30]], [], false);
    const r = new Rig(w, 0, 10, 0);
    r.run(100, fwd(), RUN);
    r.run(60, t => fwd({ jump: r.b.pos.z > 13.7 && r.b.grounded && t < 3 }), RUN);
    expect(r.b.has('gap')).toBe(true);
  });
});

describe('precision', () => {
  it('a standing jump with the stick held carries a set distance and sticks on a post', () => {
    // Two posts 0.6 wide, 3 m apart (centres), 3 m tall
    const { w } = level([
      [0, 1.5, 0, 0.6, 3, 0.6],
      [0, 1.5, 3, 0.6, 3, 0.6],
    ]);
    const r = new Rig(w, 0, 3, 0);
    r.run(10, input());
    r.step(input({ moveY: 1, wishZ: 1, jump: true }), 1.9);
    expect(r.b.has('leap')).toBe(true);
    r.run(70, input(), 0);
    expect(r.b.grounded).toBe(true);
    expect(r.b.pos.y).toBeCloseTo(3, 1);
    expect(r.b.pos.z).toBeGreaterThan(2.7);
    expect(r.b.has('stick')).toBe(true);
  });
});

describe('landings', () => {
  it('the rules', () => {
    const base = { speed: 5, sinceDuck: Infinity, narrow: false };
    expect(landing({ ...base, impact: 5 })).toBe('none');
    expect(landing({ ...base, impact: 10 })).toBe('roll');
    expect(landing({ ...base, impact: 10, speed: 0.5 })).toBe('stick');
    expect(landing({ ...base, impact: 15 })).toBe('stumble');
    expect(landing({ ...base, impact: 15, sinceDuck: 0.2 })).toBe('roll');
    expect(landing({ ...base, impact: 15, sinceDuck: 0.6 })).toBe('stumble');
    expect(landing({ ...base, impact: 25 })).toBe('stumbleHard');
    expect(landing({ ...base, impact: 4, narrow: true })).toBe('stick');
  });

  const drop = (h: number, duckAt: number | null) => {
    const { w } = level([[0, h / 2, 0, 4, h, 4]]);
    const r = new Rig(w, 0, h, 1.2);
    r.b.vel.z = 5;
    r.run(
      240,
      () => {
        const above = r.b.pos.y;
        const d = duckAt !== null && !r.b.grounded && above < duckAt;
        return input({ moveY: 1, wishZ: 1, duck: d, duckPressed: d });
      },
      5,
    );
    return r;
  };

  it('a 4 m drop on the run rolls and keeps going', () => {
    const r = drop(4, null);
    expect(r.log).toContain('roll');
    expect(r.b.has('roll')).toBe(true);
  });

  it('a 10 m drop stumbles, unless you duck just before landing', () => {
    expect(drop(10, null).log).toContain('stumble');
    const saved = drop(10, 1.2);
    expect(saved.log).toContain('roll');
    expect(saved.log).not.toContain('stumble');
  });
});

describe('housekeeping', () => {
  it('a respawn drops whatever move was on', () => {
    const { w } = level([[0, 1.3, 4, 6, 2.6, 4]]);
    const r = new Rig(w, 0, 0, 1.5);
    r.b.grounded = false;
    r.b.vel.y = 4.4;
    r.until('hang', 40, input());
    r.b.respawns++;
    r.b.grounded = true;
    r.step(input());
    expect(r.motor.move).toBeNull();
  });

  it('stays out of the way of the Player climb and when disabled', () => {
    const { w } = level([[1.5, 3, 20, 1, 6, 40]]);
    const r = new Rig(w, 0.25, 0, 0);
    r.motor.enabled = false;
    r.run(40, fwd(), RUN);
    r.run(30, fwd({ jump: true }), RUN);
    expect(r.log).not.toContain('wallrun');
  });

  it('is cheap: few rays a step walking, bounded in the air', () => {
    const { w } = level([[1.5, 3, 20, 1, 6, 40]], [[-3, 10, 0.08, 6]]);
    const r = new Rig(w, 0, 0, 0);
    r.run(30, fwd(), RUN);
    w.rays = 0;
    r.run(60, fwd(), RUN);
    // body physics casts 1 itself
    expect(w.rays / 60).toBeLessThan(10);
    r.b.grounded = false;
    r.b.vel.y = 6;
    r.b.pos.y = 0.5;
    w.rays = 0;
    r.run(30, input({ moveY: 1, wishZ: 1 }), RUN);
    expect(w.rays / 30).toBeLessThan(60);
  });
});
