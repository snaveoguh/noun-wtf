import { describe, expect, it } from 'vitest';

import { VanSim, type Vec3 } from './physics';
import { controls, heightGround, run, type Height } from './testGround';

const flat = heightGround(() => 0);
const kmh = (s: VanSim) => s.forwardSpeed * 3.6;
const up = (s: VanSim): Vec3 => s.up({ x: 0, y: 0, z: 0 });
const ss = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function at(speed: number, ground = flat, yaw = 0) {
  const s = new VanSim();
  s.place(0, 0, 0, yaw);
  s.vel.x = Math.sin(yaw) * speed;
  s.vel.z = Math.cos(yaw) * speed;
  // settle the suspension at speed
  run(s, ground, 0.3, controls({ throttle: 0.6 }));
  return s;
}

/** A mountain-style launch ramp (tracks.ts RAMP_SPECS shape) ending at z = 60, then its landing hill. */
function kicker(H: number, L: number, p: number, drop: number, land: number): Height {
  return (_x, z) => {
    if (z > 60 - L && z <= 60) return H * Math.pow((z - (60 - L)) / L, p);
    if (z > 60) return -drop * ss((z - 60) / land);
    return 0;
  };
}

describe('van physics: straight line', () => {
  it('sits at rest on its springs', () => {
    const s = new VanSim();
    s.place(0, 0, 0, 0);
    run(s, flat, 2, controls());
    expect(s.speed).toBeLessThan(0.05);
    expect(s.pos.y).toBeGreaterThan(0.8);
    expect(s.pos.y).toBeLessThan(1.0);
    expect(up(s).y).toBeGreaterThan(0.999);
  });

  it('accelerates on the flat to a ~140 km/h top speed, ~180 with boost', () => {
    const s = new VanSim();
    s.place(0, 0, 0, 0);
    let t100 = -1;
    run(s, flat, 30, controls({ throttle: 1 }), 60, t => {
      if (t100 < 0 && kmh(s) >= 100) t100 = t;
    });
    expect(t100).toBeGreaterThan(2.5);
    expect(t100).toBeLessThan(6);
    expect(kmh(s)).toBeGreaterThan(134);
    expect(kmh(s)).toBeLessThan(146);
    let top = 0;
    run(s, flat, 9, controls({ throttle: 1, boost: true }), 60, () => {
      top = Math.max(top, kmh(s));
    });
    expect(top).toBeGreaterThan(172);
    expect(top).toBeLessThan(190);
    // The tank runs dry, then refills when off the boost
    expect(s.boostTank).toBeLessThan(0.1);
    run(s, flat, 3, controls({ throttle: 1 }));
    expect(s.boostTank).toBeGreaterThan(0.2);
    // Straight and level the whole way
    expect(Math.abs(s.pos.x)).toBeLessThan(0.5);
    expect(up(s).y).toBeGreaterThan(0.995);
  });

  it('brakes from 100 km/h in a sensible distance without rolling back', () => {
    const s = at(100 / 3.6);
    const z0 = s.pos.z;
    let stopAt = -1;
    let minV = Infinity;
    run(s, flat, 6, controls({ brake: 1 }), 60, () => {
      if (stopAt < 0 && s.forwardSpeed < 0.3) stopAt = s.pos.z - z0;
      if (stopAt < 0) minV = Math.min(minV, s.forwardSpeed);
    });
    expect(stopAt).toBeGreaterThan(22);
    expect(stopAt).toBeLessThan(45);
    expect(minV).toBeGreaterThan(-0.5);
    // Nose dives under braking (weight transfer onto the fronts)
    const b = at(100 / 3.6);
    let frontLoad = 0;
    let rearLoad = 0;
    run(b, flat, 0.4, controls({ brake: 1 }), 60, () => {
      frontLoad = b.wheels[0].load + b.wheels[1].load;
      rearLoad = b.wheels[2].load + b.wheels[3].load;
    });
    expect(frontLoad).toBeGreaterThan(rearLoad * 1.4);
  });

  it('reverses when the brake is held at a standstill', () => {
    const s = new VanSim();
    s.place(0, 0, 0, 0);
    run(s, flat, 3, controls({ brake: 1 }));
    expect(s.reversing).toBe(true);
    expect(s.gear).toBe(-1);
    expect(s.forwardSpeed).toBeLessThan(-5);
    expect(s.forwardSpeed).toBeGreaterThan(-12);
  });
});

describe('van physics: cornering + handbrake', () => {
  it('handbrake kicks the tail out: much more yaw, a real slide, and it straightens up after', () => {
    const turn = (hb: boolean) => {
      const s = at(25);
      const h0 = s.heading;
      let slip = 0;
      run(s, flat, 1, controls({ throttle: 0.6, steer: 1, handbrake: hb }), 60, () => {
        slip = Math.max(slip, Math.abs(s.slipAngle));
      });
      return { s, yaw: Math.abs(s.heading - h0), slip };
    };
    const grip = turn(false);
    const drift = turn(true);
    // Right steer turns right (heading decreases: +X is the driver's left)
    expect(grip.s.heading).toBeLessThan(0);
    expect(drift.yaw).toBeGreaterThan(grip.yaw * 1.8);
    expect(drift.slip).toBeGreaterThan(0.4);
    expect(grip.slip).toBeLessThan(0.2);
    // Let go: grip comes back, no spin-out, still on four wheels
    const s = drift.s;
    run(s, flat, 2.5, controls({ throttle: 0.6 }));
    expect(Math.abs(s.slipAngle)).toBeLessThan(0.1);
    expect(s.forwardSpeed).toBeGreaterThan(8);
    expect(up(s).y).toBeGreaterThan(0.99);
  });

  it('rolls the body in a corner but never tips over at top speed', () => {
    const s = at(39);
    let minUp = 1;
    let maxRoll = 0;
    run(
      s,
      flat,
      10,
      t => controls({ throttle: 1, steer: Math.sign(Math.sin(t * 2.5)) }),
      60,
      () => {
        const u = up(s);
        minUp = Math.min(minUp, u.y);
        maxRoll = Math.max(maxRoll, Math.hypot(u.x, u.z));
      },
    );
    expect(maxRoll).toBeGreaterThan(0.01);
    expect(minUp).toBeGreaterThan(0.95);
    expect(s.grounded).toBe(4);
  });
});

describe('van physics: hills', () => {
  for (const grade of [0.15, 0.3, 0.45]) {
    it(`drives up a ${grade * 100}% grade and holds on it`, () => {
      const hill = heightGround((_x, z) =>
        z < 20 ? 0 : z < 30 ? ((z - 20) ** 2 / 20) * grade : (z - 25) * grade,
      );
      const s = new VanSim();
      s.place(0, 0, 0, 0);
      let minV = Infinity;
      run(s, hill, 14, controls({ throttle: 1 }), 60, () => {
        if (s.pos.z > 40) minV = Math.min(minV, s.forwardSpeed);
      });
      expect(s.pos.z).toBeGreaterThan(150);
      expect(minV).toBeGreaterThan(8);
      // Stop on the slope, let go: it stays put
      for (let i = 0; i < 900 && s.speed > 0.3; i++) run(s, hill, 1 / 60, controls({ brake: 1 }));
      run(s, hill, 0.5, controls());
      const z1 = s.pos.z;
      run(s, hill, 3, controls());
      expect(Math.abs(s.pos.z - z1)).toBeLessThan(0.3);
      // …and pulls away uphill again from a standstill
      run(s, hill, 4, controls({ throttle: 1 }));
      expect(s.pos.z - z1).toBeGreaterThan(8);
      expect(s.forwardSpeed).toBeGreaterThan(3);
    });
  }
});

describe('van physics: air + landings (no tunnelling)', () => {
  const ramps = [
    ['small', 1, 5, 2, 3, 45, 25],
    ['medium', 2.5, 10, 1.8, 10, 130, 35],
    ['big', 5.2, 16, 1.9, 20, 200, 45],
    ['medium, slow', 2.5, 10, 1.8, 10, 130, 12],
  ] as const;
  for (const [name, H, L, p, drop, land, v0] of ramps) {
    it(`gets air off a ${name} kicker and lands on its wheels`, () => {
      const hf = kicker(H, L, p, drop, land);
      const g = heightGround(hf);
      const s = at(v0, g);
      let air = 0;
      let minClear = Infinity;
      run(s, g, 7, controls({ throttle: 0.6 }), 30, () => {
        air = Math.max(air, s.airTime);
        minClear = Math.min(minClear, s.pos.y - hf(s.pos.x, s.pos.z));
      });
      expect(air).toBeGreaterThan(0.4);
      expect(minClear).toBeGreaterThan(0.35);
      run(s, g, 1, controls({ throttle: 0.3 }));
      expect(up(s).y).toBeGreaterThan(0.97);
      expect(s.grounded).toBe(4);
      expect(s.forwardSpeed).toBeGreaterThan(5);
    });
  }

  it('a hard drop at speed with long frames never ends under the ground', () => {
    const bumpy: Height = (x, z) => Math.sin(x * 0.21) * 0.6 + Math.sin(z * 0.17) * 0.8 - z * 0.12;
    const g = heightGround(bumpy);
    const s = new VanSim();
    s.place(0, bumpy(0, 0) + 20, 0, 0);
    s.vel.z = 40;
    s.vel.y = -5;
    let minClear = Infinity;
    // 20 fps frames, substepped like the game does
    run(s, g, 6, controls({ throttle: 1 }), 20, () => {
      minClear = Math.min(minClear, s.pos.y - bumpy(s.pos.x, s.pos.z));
    });
    expect(minClear).toBeGreaterThan(0.3);
    expect(s.grounded).toBeGreaterThan(0);
  });

  it('stays planted and upright on a bumpy dirt line at full speed', () => {
    const line: Height = (x, z) =>
      Math.sin(z * 0.11) * 0.5 +
      Math.sin(z * 0.53 + 1) * 0.08 +
      Math.sin(x * 0.7) * 0.05 -
      z * 0.14;
    const g = heightGround(line, { grip: 0.9 });
    const s = at(38, g);
    let minUp = 1;
    let minClear = Infinity;
    run(
      s,
      g,
      10,
      t => controls({ throttle: 1, steer: Math.sin(t * 0.9) * 0.4 }),
      60,
      () => {
        minUp = Math.min(minUp, up(s).y);
        minClear = Math.min(minClear, s.pos.y - line(s.pos.x, s.pos.z));
      },
    );
    expect(minUp).toBeGreaterThan(0.9);
    expect(minClear).toBeGreaterThan(0.35);
    expect(kmh(s)).toBeGreaterThan(120);
  });
});

describe('van physics: walls + recovery', () => {
  it('stops at a wall instead of driving through it', () => {
    const g = heightGround(() => 0, { wallX: 20 });
    const s = at(20, flat, Math.PI / 2); // heading +X, straight at the wall
    let maxX = -Infinity;
    let impact = 0;
    run(s, g, 3, controls({ throttle: 1 }), 60, () => {
      maxX = Math.max(maxX, s.pos.x);
      impact = Math.max(impact, s.impact);
    });
    expect(impact).toBeGreaterThan(10);
    // Capsule side reach: bodyX + bodyR ≈ 1.24 m; nose ≈ 3.2 m from the CoM
    expect(maxX).toBeLessThan(20);
    expect(s.vel.x).toBeLessThan(1);
  });

  it('R flips it back onto its wheels', () => {
    const s = new VanSim();
    s.place(0, 0, 0, 1.2);
    // On its roof
    s.q = { x: 0, y: 0, z: 1, w: 0 };
    s.pos.y = 1.6;
    run(s, flat, 2, controls());
    expect(up(s).y).toBeLessThan(0);
    expect(s.stuck).toBeGreaterThan(0.5);
    s.recover(flat);
    run(s, flat, 2, controls());
    expect(up(s).y).toBeGreaterThan(0.99);
    expect(s.grounded).toBe(4);
    expect(s.stuck).toBe(0);
  });
});
