import type { ClubId, CourseSurface, Lie, SwingInput, V3, Wind } from '../contract';

import { describe, expect, it } from 'vitest';

import { CLUBS, clubOrder } from './clubs';
import { CUP_R, rollDistance, rollSpeedFor, simulateShot } from './physics';
import { launchOf } from './swing';
import { flatFairway, makeSurface } from './testCourse';

const CALM: Wind = { x: 0, z: 0 };
const FAR: V3 = { x: 0, y: 0, z: 5000 };
const O: V3 = { x: 0, y: 0, z: 0 };

function hit(
  course: CourseSurface,
  club: ClubId,
  lie: Lie,
  more: Partial<SwingInput> = {},
  wind: Wind = CALM,
  from: V3 = O,
  pin: V3 = FAR,
) {
  const n = course.normal(from.x, from.z, { x: 0, y: 1, z: 0 });
  const swing: SwingInput = { club, aim: 0, power: 1, accuracy: 0, ...more };
  return simulateShot(course, from, lie, launchOf(swing, lie, n), wind, pin);
}

/** Lateral offset to the player's right when aiming +z (right = −x). */
const right = (p: V3) => -p.x;

describe('ball flight', () => {
  const fw = flatFairway();

  it('a driver off the tee carries 200–260 m, apex 25–40 m, rolls 10–40 m', () => {
    const r = hit(fw, 'D', 'tee', {}, CALM, { x: 0, y: 0.03, z: 0 });
    expect(r.carry).toBeGreaterThan(200);
    expect(r.carry).toBeLessThan(260);
    expect(r.apex).toBeGreaterThan(25);
    expect(r.apex).toBeLessThan(40);
    const roll = r.total - r.carry;
    expect(roll).toBeGreaterThan(10);
    expect(roll).toBeLessThan(40);
    expect(r.events[0].kind).toBe('land');
    expect(r.events[r.events.length - 1].kind).toBe('rest');
    expect(r.lie).toBe('fairway');
    expect(r.rest.y).toBeCloseTo(0, 6);
  });

  it('a 7-iron carries ~140–160 m and stops quickly on a green', () => {
    const r = hit(flatFairway('green'), '7i', 'fairway');
    expect(r.carry).toBeGreaterThan(140);
    expect(r.carry).toBeLessThan(160);
    expect(r.total - r.carry).toBeLessThan(6);
  });

  it('a full wedge checks and spins back on a green', () => {
    const r = hit(flatFairway('green'), 'LW', 'fairway');
    expect(r.total).toBeLessThan(r.carry);
    // ...and actually came back toward the player after landing
    const land = r.events.find(e => e.kind === 'land')!;
    const maxZ = Math.max(...r.path.map(p => p.z));
    expect(r.rest.z).toBeLessThan(land.at.z);
    expect(maxZ - r.rest.z).toBeGreaterThan(1);
  });

  it('distances fall down the bag', () => {
    let last = Infinity;
    for (const id of clubOrder) {
      if (id === 'P') continue;
      const r = hit(fw, id, id === 'D' ? 'tee' : 'fairway');
      expect(r.carry).toBeLessThan(last);
      last = r.carry;
    }
  });

  it('the bag table matches what the physics flies (±4%)', () => {
    for (const id of clubOrder) {
      if (id === 'P') continue;
      const r = hit(fw, id, id === 'D' ? 'tee' : 'fairway');
      const k = CLUBS[id];
      expect(Math.abs(r.carry - k.carry) / k.carry).toBeLessThan(0.04);
      expect(Math.abs(r.total - k.total) / k.total).toBeLessThan(0.04);
    }
    const p = hit(flatFairway('green'), 'P', 'green');
    expect(Math.abs(p.total - CLUBS.P.total) / CLUBS.P.total).toBeLessThan(0.04);
  });

  it('overswing goes a little further; a bad strike curves the right way', () => {
    const pure = hit(fw, '7i', 'fairway');
    const over = hit(fw, '7i', 'fairway', { power: 1.1 });
    expect(over.carry).toBeGreaterThan(pure.carry);
    expect(over.carry).toBeLessThan(pure.carry * 1.12);
    const slice = hit(fw, 'D', 'tee', { accuracy: 0.6 });
    const hook = hit(fw, 'D', 'tee', { accuracy: -0.6 });
    expect(right(slice.rest)).toBeGreaterThan(15);
    expect(right(hook.rest)).toBeLessThan(-15);
    // It curves: further right at rest than the start line alone would put it
    const land = slice.events.find(e => e.kind === 'land')!;
    const early = slice.path[20];
    expect(right(land.at) / land.at.z).toBeGreaterThan(right(early) / early.z);
    // Overswing amplifies the same error
    const slice2 = hit(fw, 'D', 'tee', { accuracy: 0.3, power: 1.1 });
    const slice1 = hit(fw, 'D', 'tee', { accuracy: 0.3, power: 1 });
    expect(right(slice2.rest)).toBeGreaterThan(right(slice1.rest));
  });

  it('aim follows yaw = atan2(dx, dz); +accuracy goes right whatever the aim', () => {
    const aim = Math.PI / 2; // facing +x; right is −z
    const r = hit(fw, '7i', 'fairway', { aim, accuracy: 0.5 });
    // Facing +x, the player's right is +z (forward × up)
    expect(r.rest.x).toBeGreaterThan(130);
    expect(r.rest.z).toBeGreaterThan(5);
  });

  it('draw / fade shaping curves without a mishit', () => {
    const fade = hit(fw, '6i', 'fairway', { shape: 1 });
    const draw = hit(fw, '6i', 'fairway', { shape: -1 });
    expect(right(fade.rest)).toBeGreaterThan(3);
    expect(right(draw.rest)).toBeLessThan(-3);
  });

  it('headwind shortens, tailwind lengthens, crosswind drifts', () => {
    const calm = hit(fw, '5i', 'fairway');
    const head = hit(fw, '5i', 'fairway', {}, { x: 0, z: -8 });
    const tail = hit(fw, '5i', 'fairway', {}, { x: 0, z: 8 });
    const cross = hit(fw, '5i', 'fairway', {}, { x: 8, z: 0 });
    expect(head.carry).toBeLessThan(calm.carry - 10);
    expect(tail.carry).toBeGreaterThan(calm.carry + 5);
    expect(cross.rest.x).toBeGreaterThan(5);
    expect(Math.abs(calm.rest.x)).toBeLessThan(0.01);
  });

  it('rough, deep grass and sand cost distance; a wedge plays from sand', () => {
    const lies = (lie: Lie, club: ClubId) => hit(flatFairway(lie), club, lie).carry;
    const fwy = lies('fairway', '7i');
    expect(lies('rough', '7i')).toBeLessThan(fwy);
    expect(lies('deep', '7i')).toBeLessThan(lies('rough', '7i'));
    expect(lies('sand', '7i')).toBeLessThan(fwy * 0.7);
    // A sand wedge from sand still flies most of its distance
    expect(lies('sand', 'SW')).toBeGreaterThan(hit(fw, 'SW', 'fairway').carry * 0.7);
    // ...and a driver from sand is a chunk
    expect(lies('sand', '3W')).toBeLessThan(hit(fw, '3W', 'fairway').carry * 0.45);
  });

  it('a ball landing in sand stops near where it lands', () => {
    const sand = makeSurface({ base: 'fairway', bowls: [{ x: 0, z: 140, r: 12, depth: 0.6 }] });
    const r = hit(sand, '8i', 'fairway');
    expect(r.lie).toBe('sand');
    expect(r.events.some(e => e.kind === 'sand')).toBe(true);
    expect(r.total - r.carry).toBeLessThan(3);
  });

  it('splashes out of a deep (0.8 m) bunker with a sand wedge', () => {
    // r 3.2 m: the face is ~0.5 rise / run near the lip, like the course's
    const bunker = makeSurface({ base: 'fringe', bowls: [{ x: 0, z: 0, r: 3.2, depth: 0.8 }] });
    const from = { x: 0, y: bunker.height(0, 0), z: 0 };
    const r = hit(bunker, 'SW', 'sand', { power: 0.6 }, CALM, from);
    expect(r.lie).toBe('fringe');
    expect(r.rest.z).toBeGreaterThan(10);
    // A putter from the floor just rolls back into the sand
    const p = hit(bunker, 'P', 'sand', { power: 0.3 }, CALM, from);
    expect(p.lie).toBe('sand');
  });

  it('is deterministic', () => {
    const tree = makeSurface({
      trees: [{ x: 0, z: 90, trunk: 0.3, r: 4, h0: 3, h1: 12, kind: 1 }],
    });
    const a = hit(tree, '7i', 'fairway', { accuracy: 0.2 }, { x: 2, z: 3 });
    const b = hit(tree, '7i', 'fairway', { accuracy: 0.2 }, { x: 2, z: 3 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('never tunnels: every recorded point is on or above the ground', () => {
    const hills = makeSurface({ gx: 0.3, gz: -0.4 });
    for (const id of ['D', '7i', 'LW'] as ClubId[]) {
      for (const aim of [0, 1, 2, 3, 4, 5]) {
        const r = hit(hills, id, 'fairway', { aim });
        for (const p of r.path) expect(p.y).toBeGreaterThanOrEqual(hills.height(p.x, p.z) - 1e-6);
      }
    }
  });
});

describe('on the ground', () => {
  const green = flatFairway('green');

  it('greens run at about stimp 10 (1.83 m/s rolls ~3 m)', () => {
    expect(rollDistance(1.83, 'green')).toBeGreaterThan(2.7);
    expect(rollDistance(1.83, 'green')).toBeLessThan(3.4);
    expect(rollSpeedFor(rollDistance(2.5, 'green'), 'green')).toBeCloseTo(2.5, 3);
  });

  it('a putt with the right pace rolls where the model says (flat green)', () => {
    for (const d of [1, 3, 8, 15]) {
      const power = rollSpeedFor(d, 'green') / CLUBS.P.speed;
      const r = hit(green, 'P', 'green', { power });
      expect(Math.abs(r.total - d)).toBeLessThan(0.15 + d * 0.02);
      expect(r.apex).toBeLessThan(0.001);
    }
  });

  it('a putt with the right pace drops; a too-fast one lips out', () => {
    const pin = { x: 0, y: 0, z: 5 };
    const good = hit(
      green,
      'P',
      'green',
      { power: rollSpeedFor(5.3, 'green') / CLUBS.P.speed },
      CALM,
      O,
      pin,
    );
    expect(good.holed).toBe(true);
    expect(good.events[good.events.length - 1].kind).toBe('holed');
    expect(good.rest).toEqual(pin);
    // Hammered, a little off centre
    const fast = hit(green, 'P', 'green', { power: 0.6, aim: 0.006 }, CALM, O, pin);
    expect(fast.holed).toBe(false);
    expect(fast.events.some(e => e.kind === 'lip')).toBe(true);
    // Just missing the hole entirely: no lip
    const miss = hit(
      green,
      'P',
      'green',
      { power: rollSpeedFor(5.3, 'green') / 8, aim: 0.03 },
      CALM,
      O,
      pin,
    );
    expect(miss.holed).toBe(false);
    expect(Math.hypot(miss.rest.x, miss.rest.z - 5)).toBeGreaterThan(CUP_R);
  });

  it('a putt across a sloped green breaks downhill', () => {
    // Ground rises toward +x: it falls toward −x
    const s = makeSurface({ base: 'green', gx: 0.02 });
    const power = rollSpeedFor(6, 'green') / CLUBS.P.speed;
    const r = hit(s, 'P', 'green', { power });
    expect(r.rest.x).toBeLessThan(-0.25);
    // and the break grows along the putt (it curves, not a straight push)
    const mid = r.path[Math.floor(r.path.length / 2)];
    expect(r.rest.x / r.rest.z).toBeLessThan(mid.x / Math.max(mid.z, 0.01));
  });

  it('downhill putts run further, uphill ones stop short', () => {
    const power = rollSpeedFor(5, 'green') / CLUBS.P.speed;
    const down = hit(makeSurface({ base: 'green', gz: -0.02 }), 'P', 'green', { power });
    const up = hit(makeSurface({ base: 'green', gz: 0.02 }), 'P', 'green', { power });
    expect(down.total).toBeGreaterThan(5.5);
    expect(up.total).toBeLessThan(4.6);
  });

  it('a ball left on a slope rolls down; a ball on a gentle slope stays', () => {
    // y = −0.12·z: downhill is +z
    const steep = makeSurface({ base: 'green', gz: -0.12 });
    const still = { club: 'P' as ClubId, power: 0 };
    const r = hit(steep, 'P', 'green', still);
    expect(r.rest.z).toBeGreaterThan(1);
    expect(r.rest.y).toBeCloseTo(steep.height(r.rest.x, r.rest.z), 6);
    const gentle = makeSurface({ base: 'green', gz: -0.03 });
    const g = hit(gentle, 'P', 'green', still);
    expect(Math.hypot(g.rest.x, g.rest.z)).toBeLessThan(0.01);
    const fairway = makeSurface({ base: 'fairway', gx: 0.08 });
    expect(Math.abs(hit(fairway, 'P', 'fairway', still).rest.x)).toBeLessThan(0.01);
  });

  it('a ball rolling off a tier comes to rest on the flat below', () => {
    // A 14 % step across z 3..5, flat either side (the course's green tiers)
    const tier: CourseSurface = {
      ...flatFairway('green'),
      height: (_x, z) => (z < 3 ? 0 : z > 5 ? -0.28 : -0.28 * ((z - 3) / 2)),
      normal(_x, z, out) {
        const g = z > 3 && z < 5 ? 0.14 : 0;
        const l = Math.sqrt(1 + g * g);
        out.x = 0;
        out.y = 1 / l;
        out.z = g / l;
        return out;
      },
    };
    const r = hit(tier, 'P', 'green', { power: rollSpeedFor(3.5, 'green') / CLUBS.P.speed });
    expect(r.rest.z).toBeGreaterThan(5);
    expect(r.rest.y).toBeCloseTo(-0.28, 6);
  });

  it('stays stable on steep ground (0.8 rise / run)', () => {
    const s = makeSurface({ base: 'rough', gz: -0.8 });
    const r = hit(s, 'P', 'rough', { power: 0.2, aim: 1 });
    expect(Number.isFinite(r.rest.x)).toBe(true);
    for (const p of r.path) expect(p.y).toBeGreaterThanOrEqual(s.height(p.x, p.z) - 1e-6);
    // It rolled down the hill (+z)
    expect(r.rest.z).toBeGreaterThan(5);
  });
});

describe('hazards and trees', () => {
  it('into the water: event, lie and the entry point', () => {
    const s = makeSurface({ ponds: [{ x: 0, z: 150, r: 25 }] });
    const r = hit(s, '7i', 'fairway');
    expect(r.holed).toBe(false);
    expect(r.lie).toBe('water');
    const ev = r.events.find(e => e.kind === 'water')!;
    expect(ev).toBeTruthy();
    expect(Math.hypot(r.rest.x, r.rest.z - 150)).toBeLessThan(25);
    expect(r.rest.y).toBeCloseTo(s.waterLevel(r.rest.x, r.rest.z)!, 6);
  });

  it('rolling into the water', () => {
    const s = makeSurface({ base: 'green', ponds: [{ x: 0, z: 8, r: 2 }] });
    const r = hit(s, 'P', 'green', { power: rollSpeedFor(10, 'green') / 8 });
    expect(r.lie).toBe('water');
    expect(r.rest.z).toBeGreaterThan(5.5);
    expect(r.rest.z).toBeLessThan(10);
  });

  it('out of bounds: event and lie', () => {
    const s = makeSurface({ inBounds: { x0: -10, z0: -10, x1: 10, z1: 2000 } });
    const r = hit(s, 'D', 'tee', { accuracy: 0.8 });
    expect(r.lie).toBe('ob');
    expect(r.events.some(e => e.kind === 'ob')).toBe(true);
    expect(r.rest.x).toBeLessThan(-10);
  });

  it('flying over OB and landing in bounds is fine', () => {
    // OB is a strip the shot flies over
    const s = makeSurface({
      regions: [{ kind: 'rect', x0: -50, z0: 60, x1: 50, z1: 100, lie: 'ob' }],
    });
    const r = hit(s, '7i', 'fairway');
    expect(r.lie).toBe('fairway');
  });

  it('a tree trunk knocks the ball back', () => {
    const s = makeSurface({ trees: [{ x: 0, z: 10, trunk: 0.4, r: 3, h0: 6, h1: 14, kind: 0 }] });
    const r = hit(s, 'P', 'fairway', { club: 'P', power: 1.1 });
    expect(r.events.some(e => e.kind === 'tree')).toBe(true);
    expect(r.rest.z).toBeLessThan(10);
  });

  it('a canopy stops a shot short', () => {
    const open = hit(flatFairway(), '9i', 'fairway');
    const s = makeSurface({ trees: [{ x: 0, z: 40, trunk: 0.3, r: 6, h0: 4, h1: 24, kind: 1 }] });
    const r = hit(s, '9i', 'fairway');
    expect(r.events.some(e => e.kind === 'tree')).toBe(true);
    expect(r.total).toBeLessThan(open.total - 10);
  });

  it('the flagstick knocks down a shot flying into it', () => {
    // Find where a pure PW pitches, then put the pin there
    const g = flatFairway('green');
    const free = hit(g, 'PW', 'fairway');
    const land = free.events.find(e => e.kind === 'land')!;
    const i = Math.round(land.t * 30) - 3;
    const q = free.path[i];
    const pin = { x: q.x, y: 0, z: q.z };
    const r = hit(g, 'PW', 'fairway', {}, CALM, O, pin);
    // A ball well over the flag height doesn't touch it
    if (q.y < 2.1) {
      expect(r.events.some(e => e.kind === 'pin')).toBe(true);
      expect(Math.hypot(r.rest.x - pin.x, r.rest.z - pin.z)).toBeLessThan(4);
    }
  });
});
