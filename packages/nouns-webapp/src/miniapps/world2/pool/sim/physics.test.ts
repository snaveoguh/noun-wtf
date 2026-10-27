import { describe, expect, it } from 'vitest';

import { firstHit } from './aim';
import { energy, makeBall, ShotRun, strike, TICK, type Ball } from './physics';
import { rackBalls, rng } from './rack';
import { newFrame, playShot } from './rules';
import { L, POCKETS, R, SEGMENTS, W } from './table';

const only = (...bs: Ball[]) => {
  const out: Ball[] = [];
  for (let id = 0; id < 16; id++) out.push(bs.find(b => b.id === id) ?? makeBall(id, 0, 0, false));
  return out;
};

function segDist(b: Ball) {
  let best = Infinity;
  for (const s of SEGMENTS) {
    const ex = s.bx - s.ax;
    const ey = s.by - s.ay;
    let t = ((b.x - s.ax) * ex + (b.y - s.ay) * ey) / (ex * ex + ey * ey);
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(b.x - s.ax - ex * t, b.y - s.ay - ey * t));
  }
  return best;
}

describe('pool physics', { timeout: 60_000 }, () => {
  it('never gains energy after the strike (breaks and spin shots)', () => {
    const r = rng(7);
    for (let k = 0; k < 24; k++) {
      const balls = rackBalls(k + 1);
      const cue = balls[0]!;
      cue.x = -0.6;
      cue.y = (r() - 0.5) * 0.6;
      const a = (r() - 0.5) * 0.2;
      strike(cue, Math.cos(a), Math.sin(a), 0.3 + r() * 0.7, r() * 2 - 1, r() * 2 - 1);
      const run = new ShotRun(balls);
      let e = energy(run.balls);
      let ticks = 0;
      while (!run.done) {
        run.advance(run.t + TICK / 2);
        const e2 = energy(run.balls);
        expect(e2).toBeLessThanOrEqual(e * (1 + 1e-9) + 1e-9);
        e = e2;
        ticks++;
      }
      expect(ticks).toBeGreaterThan(10);
      expect(energy(run.balls)).toBe(0);
    }
  });

  it('never tunnels: max power from anywhere, every ball stays on the cloth or drops', () => {
    const r = rng(99);
    let pots = 0;
    for (let k = 0; k < 30; k++) {
      const balls = rackBalls(k + 11);
      // Scatter the rack so shots go everywhere
      for (const b of balls) {
        b.x = (r() - 0.5) * (L - 4 * R);
        b.y = (r() - 0.5) * (W - 4 * R);
      }
      // (overlaps from the scatter are pushed apart on the first substep)
      const a = r() * Math.PI * 2;
      strike(balls[0]!, Math.cos(a), Math.sin(a), 1, r() * 2 - 1, r() * 2 - 1);
      const run = new ShotRun(balls);
      while (!run.done) {
        run.advance(run.t + TICK);
        for (const b of run.balls) {
          if (!b.on || (Math.abs(b.x) < L / 2 - 0.1 && Math.abs(b.y) < W / 2 - 0.1)) continue;
          expect(Math.abs(b.x)).toBeLessThan(L / 2 + 0.06);
          expect(Math.abs(b.y)).toBeLessThan(W / 2 + 0.06);
          expect(segDist(b)).toBeGreaterThan(R * 0.7);
        }
      }
      expect(run.report.escaped).toBe(0);
      pots += run.report.potted.length;
    }
    expect(pots).toBeGreaterThan(0);
  });

  it('a max-power ball straight into a cushion comes back off it', () => {
    const cue = makeBall(0, 0.3, 0.1);
    strike(cue, 1, 0, 1, 0, 0);
    const run = new ShotRun(only(cue));
    run.advance(0.3);
    const b = run.balls[0]!;
    expect(b.on).toBe(true);
    expect(b.vx).toBeLessThan(0);
    expect(b.x).toBeLessThan(L / 2 - R + 1e-9);
  });

  it('is deterministic: the same shot twice is bit-identical', () => {
    const go = () => {
      const st = newFrame(42, 0);
      return playShot(st, {
        shot: { dx: 1, dy: 0.003, power: 1, side: 0.2, top: -0.1 },
        cue: { x: -0.6, y: 0.05 },
      });
    };
    const a = go();
    const b = go();
    expect(a.run.frames.length).toBe(b.run.frames.length);
    expect(a.state).toEqual(b.state);
    const fa = a.run.frames[a.run.frames.length - 1]!;
    const fb = b.run.frames[b.run.frames.length - 1]!;
    expect([...fa]).toEqual([...fb]);
  });

  it('a known break spreads the rack and pots a ball (seed 5)', () => {
    const r = playShot(newFrame(5, 0), {
      shot: { dx: 1, dy: 0.006, power: 1, side: 0, top: 0 },
      cue: { x: -0.55, y: 0 },
    });
    expect(r.outcome.foul).toBeNull();
    expect(r.outcome.potted.length).toBeGreaterThan(0);
    expect(r.outcome.again).toBe(true);
    expect(r.run.report.railBalls).toBeGreaterThanOrEqual(4);
  });

  it('pots straight-in shots into every pocket, and a 30° cut into a corner', () => {
    for (const p of POCKETS) {
      const n = Math.hypot(p.aim.x, p.aim.y);
      const ux = -p.aim.x / n;
      const uy = -p.aim.y / n;
      const obj = { x: p.aim.x + ux * 0.3, y: p.aim.y + uy * 0.3 };
      const st = newFrame(1, 0);
      st.phase = 'play';
      st.inHand = null;
      st.balls = st.balls.map(() => null);
      st.balls[3] = obj;
      st.balls[0] = { x: obj.x + ux * 0.4, y: obj.y + uy * 0.4 };
      // Stun-ish draw so the cue ball doesn't follow it in
      st.balls[0] = { x: obj.x + ux * 0.25, y: obj.y + uy * 0.25 };
      const r = playShot(st, { shot: { dx: -ux, dy: -uy, power: 0.12, side: 0, top: -0.3 } });
      expect(r.run.report.potted.map(q => [q.id, q.pocket])).toEqual([[3, p.id]]);
    }
    // 30° cut into pocket 3 (+x, +y corner)
    const p = POCKETS[3]!;
    const obj = { x: 0.55, y: 0.15 };
    const ux0 = p.aim.x - obj.x;
    const uy0 = p.aim.y - obj.y;
    const d = Math.hypot(ux0, uy0);
    const ghost = { x: obj.x - (ux0 / d) * 2 * R, y: obj.y - (uy0 / d) * 2 * R };
    const cut = (30 * Math.PI) / 180;
    const base = Math.atan2(uy0, ux0);
    const cueDir = { x: Math.cos(base - cut), y: Math.sin(base - cut) };
    const cue = { x: ghost.x - cueDir.x * 0.45, y: ghost.y - cueDir.y * 0.45 };
    const st = newFrame(1, 0);
    st.phase = 'play';
    st.inHand = null;
    st.balls = st.balls.map(() => null);
    st.balls[0] = cue;
    st.balls[5] = obj;
    const hit = firstHit(st.balls, cue, cueDir.x, cueDir.y);
    expect(hit?.kind).toBe('ball');
    // Cut-induced throw pulls the object ball a hair along the shot: aim a touch thicker
    const r = playShot(st, {
      shot: { dx: cueDir.x, dy: cueDir.y, power: 0.4, side: 0, top: 0 },
    });
    const thick = playShot(st, {
      shot: {
        dx: Math.cos(base - cut + 0.012),
        dy: Math.sin(base - cut + 0.012),
        power: 0.4,
        side: 0,
        top: 0,
      },
    });
    const down = [r, thick].some(x => x.run.report.potted.some(q => q.id === 5 && q.pocket === 3));
    expect(down).toBe(true);
  });

  it('reflects off a cushion sensibly: straight back square on, shorter than mirror at 45°', () => {
    // Square on: comes straight back
    {
      const cue = makeBall(0, 0, 0);
      strike(cue, 0, 1, 0.3, 0, 0);
      const run = new ShotRun(only(cue));
      run.finish();
      expect(Math.abs(run.balls[0]!.x)).toBeLessThan(1e-9);
    }
    // 45° into the long cushion, a rolling ball: leaves at under 45° from the
    // normal (the rail grips it), but not much under
    const angleOff = (side: number) => {
      const cue = makeBall(0, -0.45, 0.1);
      strike(cue, Math.SQRT1_2, Math.SQRT1_2, 0.25, side, 0.4);
      const run = new ShotRun(only(cue));
      let out: { vx: number; vy: number } | null = null;
      while (!run.done && out === null) {
        run.advance(run.t + TICK);
        const b = run.balls[0]!;
        if (b.vy < 0) out = { vx: b.vx, vy: b.vy };
      }
      expect(out).not.toBeNull();
      return (Math.atan2(out!.vx, -out!.vy) * 180) / Math.PI;
    };
    const plain = angleOff(0);
    expect(plain).toBeGreaterThan(30);
    expect(plain).toBeLessThan(50);
    // Running english (spin the way it's going) lengthens it, reverse shortens it
    // (heading up-right into the top cushion, running english is left: counter-clockwise)
    const running = angleOff(-1);
    const reverse = angleOff(1);
    expect(running).toBeGreaterThan(plain + 2);
    expect(reverse).toBeLessThan(plain - 1);
  });

  it('top spin follows through, back spin draws back', () => {
    const shot = (top: number) => {
      const st = newFrame(1, 0);
      st.phase = 'play';
      st.inHand = null;
      st.balls = st.balls.map(() => null);
      st.balls[0] = { x: -0.25, y: 0 };
      st.balls[2] = { x: 0, y: 0 };
      const r = playShot(st, { shot: { dx: 1, dy: 0, power: 0.12, side: 0, top } });
      return r.state.balls[0]!.x;
    };
    const follow = shot(0.8);
    const stun = shot(0);
    const draw = shot(-0.8);
    expect(follow).toBeGreaterThan(stun);
    expect(stun).toBeGreaterThan(draw);
    expect(follow).toBeGreaterThan(0.15);
    expect(draw).toBeLessThan(-0.05);
  });
});
