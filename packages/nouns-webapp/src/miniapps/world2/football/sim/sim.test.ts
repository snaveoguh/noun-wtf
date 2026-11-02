import type { PadInput, SimState, TeamId } from '../contract';

import { describe, expect, it } from 'vitest';

import { NO_PAD, PITCH_11 } from '../contract';

import { FootballSim } from './FootballSim';
import { playMatch } from './harness';
import { makeMatch } from './setup';
import { FixedStepper } from './stepper';

const pad = (o: Partial<PadInput> = {}): PadInput => ({ ...NO_PAD, ...o });

/** A live match with the ball dead-centre and no restart pending. */
function live(size: 5 | 7 | 11 = 11, humans: { id: string; name: string; team: TeamId }[] = []) {
  const sim = new FootballSim(makeMatch({ size, seed: 3, humans, halfSeconds: 240 }));
  // past the walk-out and the kick-off setup
  for (let i = 0; i < 60 * 3; i++) sim.step({});
  sim.s.phase = 'live';
  sim.s.restart = null;
  sim.s.ball.mode = 'free';
  return sim;
}

function put(sim: FootballSim, id: string, x: number, z: number, yaw = 0) {
  const p = sim.player(id)!;
  p.x = x;
  p.z = z;
  p.vx = p.vz = 0;
  p.yaw = yaw;
  return p;
}

/** Park everyone far from the action so tests control who's involved. */
function clearPitch(sim: FootballSim, keep: string[] = []) {
  let k = 0;
  for (const p of sim.s.players) {
    if (keep.includes(p.id)) continue;
    p.x = (p.team === 0 ? -1 : 1) * (30 + (k % 3));
    p.z = -40 + (k++ % 11) * 8;
    p.vx = p.vz = 0;
  }
}

describe('football sim: determinism', () => {
  it('the same seed + inputs give the same match', () => {
    const a = playMatch({ size: 7, seed: 11 }, { maxTicks: 60 * 40 });
    const b = playMatch({ size: 7, seed: 11 }, { maxTicks: 60 * 40 });
    expect(JSON.stringify(a.final)).toBe(JSON.stringify(b.final));
  });

  it('is identical at 20 fps and 60 fps (fixed steps)', () => {
    const humans = [{ id: 'me', name: 'ME', team: 0 as TeamId }];
    const run = (fps: number) => {
      const sim = new FootballSim(makeMatch({ size: 11, seed: 5, humans, halfSeconds: 120 }));
      const st = new FixedStepper(sim);
      // input is a function of sim time (held for 50 ms windows), like a real pad
      const pads = (tick: number) => {
        const w = Math.floor(tick / 3);
        return {
          me: pad({
            mx: Math.sin(w * 0.07),
            mz: Math.cos(w * 0.05),
            sprint: w % 40 < 20,
            pass: w % 23 < 4,
            shoot: w % 61 < 8,
          }),
        };
      };
      for (let f = 0; f < 20 * fps; f++) st.frame(1 / fps, pads);
      return st.next!;
    };
    const a = run(20);
    const b = run(60);
    expect(a.tick).toBe(b.tick);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('load(state()) resumes bit-exactly', () => {
    const sim = new FootballSim(makeMatch({ size: 11, seed: 9, humans: [], halfSeconds: 120 }));
    for (let i = 0; i < 60 * 30; i++) sim.step({});
    const snap = sim.state();
    const copy = new FootballSim(sim.config);
    copy.load(snap);
    for (let i = 0; i < 60 * 30; i++) {
      sim.step({});
      copy.step({});
    }
    expect(JSON.stringify(copy.snapshot())).toBe(JSON.stringify(sim.snapshot()));
  });
});

describe('football sim: whole matches', () => {
  for (const size of [5, 7, 11] as const)
    it(`${size}-a-side CPU vs CPU plays to full time with shots, passes and no stalls`, () => {
      const r = playMatch({ size, seed: 21 });
      expect(r.final.phase).toBe('final');
      expect(r.longestStall).toBeLessThan(6);
      const st = r.final.stats;
      expect(st[0].passes + st[1].passes).toBeGreaterThan(20);
      expect(st[0].shots + st[1].shots).toBeGreaterThan(0);
      // nobody ends up somewhere silly
      for (const p of r.final.players) {
        expect(Math.abs(p.x)).toBeLessThan(r.final.players.length ? 60 : 0);
        expect(Number.isFinite(p.z)).toBe(true);
      }
      expect(r.final.clock).toBeGreaterThanOrEqual(90 * 60);
    }, 30000);

  it('a knockout draw goes to extra time and then penalties, and someone wins', () => {
    const sim = new FootballSim(
      makeMatch({ size: 5, seed: 4, humans: [], halfSeconds: 30, knockout: true }),
    );
    const periods: number[] = [];
    let st: SimState = sim.snapshot();
    for (let i = 0; i < 60 * 60 * 6 && st.phase !== 'final'; i++) {
      // keep it level: wipe goals the moment they go in
      st = sim.step({});
      if (sim.s.period < 5) sim.s.score = [0, 0];
      for (const e of st.events) if (e.type === 'period') periods.push(e.period);
    }
    expect(periods).toEqual([2, 3, 4, 5]);
    expect(st.phase).toBe('final');
    const so = st.shootout!;
    const g = so.kicks.map(k => k.filter(Boolean).length);
    expect(g[0]).not.toBe(g[1]);
    expect(so.kicks[0].length).toBeGreaterThanOrEqual(3);
    const fin = st.events.find(e => e.type === 'final');
    expect(fin && fin.type === 'final' && fin.pens).toBeTruthy();
  }, 30000);
});

describe('football sim: the laws', () => {
  it('a ball over the touchline is a throw-in to the other team, taken from the line', () => {
    const sim = live();
    clearPitch(sim);
    const b = sim.s.ball;
    const p0 = sim.player('t0p5')!;
    Object.assign(b, {
      x: PITCH_11.width / 2 - 1,
      z: 10,
      y: 0.11,
      vx: 10,
      vz: 0,
      vy: 0,
      lastTouch: p0.id,
    });
    let st = sim.snapshot();
    for (let i = 0; i < 30 && st.phase === 'live'; i++) st = sim.step({});
    expect(st.restart?.kind).toBe('throw_in');
    expect(st.restart?.team).toBe(1);
    expect(st.restart?.x).toBeCloseTo(PITCH_11.width / 2);
    // the throw comes back into play (not straight out again)
    for (let i = 0; i < 60 * 6; i++) st = sim.step({});
    expect(st.events.length >= 0 && sim.s.phase === 'live').toBe(true);
  });

  it('over the goal line off an attacker: goal kick; off a defender: corner', () => {
    const sim = live();
    clearPitch(sim);
    const att = sim.s.attackPlusZ; // attacks +z
    const def = (1 - att) as TeamId;
    const b = sim.s.ball;
    Object.assign(b, {
      x: 12,
      z: PITCH_11.length / 2 - 1,
      y: 0.11,
      vz: 10,
      vx: 0,
      lastTouch: `t${att}p9`,
    });
    let st = sim.snapshot();
    for (let i = 0; i < 30 && st.phase === 'live'; i++) st = sim.step({});
    expect(st.restart?.kind).toBe('goal_kick');
    expect(st.restart?.team).toBe(def);

    const sim2 = live();
    clearPitch(sim2);
    Object.assign(sim2.s.ball, {
      x: 12,
      z: PITCH_11.length / 2 - 1,
      y: 0.11,
      vz: 10,
      vx: 0,
      lastTouch: `t${def}p3`,
    });
    st = sim2.snapshot();
    for (let i = 0; i < 30 && st.phase === 'live'; i++) st = sim2.step({});
    expect(st.restart?.kind).toBe('corner');
    expect(st.restart?.team).toBe(att);
    expect(Math.abs(st.restart!.x)).toBeGreaterThan(PITCH_11.width / 2 - 1);
  });

  it('a goal counts, gives the scorer the goal and the other team the kick-off', () => {
    const sim = live();
    clearPitch(sim);
    const att = sim.s.attackPlusZ;
    const b = sim.s.ball;
    Object.assign(b, {
      x: 0,
      z: PITCH_11.length / 2 - 3,
      y: 0.8,
      vz: 15,
      vx: 0,
      vy: 0,
      lastTouch: `t${att}p10`,
    });
    // keep the keeper out of it
    put(sim, `t${1 - att}p0`, 20, PITCH_11.length / 2 - 1);
    let st = sim.snapshot();
    for (let i = 0; i < 60 && st.phase === 'live'; i++) st = sim.step({});
    expect(st.phase).toBe('goal');
    expect(st.score[att]).toBe(1);
    expect(st.goals[0].scorer).toBe(`t${att}p10`);
    expect(st.restart?.kind).toBe('kickoff');
    expect(st.restart?.team).toBe(1 - att);
  });

  it('an own goal goes to the other team', () => {
    const sim = live();
    clearPitch(sim);
    const att = sim.s.attackPlusZ;
    const def = 1 - att;
    put(sim, `t${def}p0`, 20, PITCH_11.length / 2 - 1);
    Object.assign(sim.s.ball, {
      x: 1,
      z: PITCH_11.length / 2 - 3,
      y: 0.5,
      vz: 12,
      lastTouch: `t${def}p2`,
    });
    let st = sim.snapshot();
    for (let i = 0; i < 60 && st.phase === 'live'; i++) st = sim.step({});
    expect(st.score[att]).toBe(1);
    expect(st.goals[0].ownGoal).toBe(true);
  });

  it('the woodwork is not a goal', () => {
    const sim = live();
    clearPitch(sim);
    const att = sim.s.attackPlusZ;
    put(sim, `t${1 - att}p0`, 20, PITCH_11.length / 2 - 1);
    const px = PITCH_11.goalWidth / 2 + PITCH_11.postRadius;
    Object.assign(sim.s.ball, {
      x: px,
      z: PITCH_11.length / 2 - 6,
      y: 1,
      vz: 25,
      vx: 0,
      vy: 1.5,
      lastTouch: `t${att}p10`,
    });
    let st = sim.snapshot();
    let post = false;
    for (let i = 0; i < 40; i++) {
      st = sim.step({});
      if (st.events.some(e => e.type === 'woodwork')) post = true;
    }
    expect(post).toBe(true);
    expect(st.score[att]).toBe(0);
  });

  it('offside: a pass to a team-mate beyond the second-last defender is given against him', () => {
    const sim = live();
    clearPitch(sim, []);
    const att = sim.s.attackPlusZ;
    const def = (1 - att) as TeamId;
    // defenders: the keeper on the line and one at z = 20; the attacker at z = 30 with the ball at z = 0
    put(sim, `t${def}p0`, 0, PITCH_11.length / 2 - 1);
    put(sim, `t${def}p1`, 26, 20);
    put(sim, `t${def}p2`, -26, 20);
    for (const p of sim.s.players)
      if (p.team === def && p.id !== `t${def}p0` && p.id !== `t${def}p1` && p.id !== `t${def}p2`) {
        p.x = 30;
        p.z = -30;
      }
    const kicker = put(sim, `t${att}p6`, 0, 0);
    const runner = put(sim, `t${att}p10`, 0, 30);
    sim.s.ball.x = 0;
    sim.s.ball.z = 0.5;
    sim.s.ball.owner = kicker.id;
    sim.startKick(kicker, {
      kind: 'pass',
      power: 0.6,
      ax: 0,
      az: 1,
      to: runner.id,
      finesse: false,
      at: 0,
      restart: null,
    });
    let st = sim.snapshot();
    let off = false;
    for (let i = 0; i < 60 * 5 && !off; i++) {
      st = sim.step({});
      if (st.events.some(e => e.type === 'offside')) off = true;
    }
    expect(off).toBe(true);
    expect(st.restart?.kind).toBe('free_kick');
    expect(st.restart?.team).toBe(def);
    expect(st.restart?.direct).toBe(false);
  });

  it('level with the line is onside', () => {
    const sim = live();
    clearPitch(sim, []);
    const att = sim.s.attackPlusZ;
    const def = (1 - att) as TeamId;
    put(sim, `t${def}p0`, 0, PITCH_11.length / 2 - 1);
    put(sim, `t${def}p1`, 10, 30);
    const kicker = put(sim, `t${att}p6`, 0, 0);
    put(sim, `t${att}p10`, 0, 30);
    sim.s.ball.z = 0.5;
    sim.s.ball.x = 0;
    sim.s.ball.owner = kicker.id;
    sim.startKick(kicker, {
      kind: 'pass',
      power: 0.6,
      ax: 0,
      az: 1,
      to: `t${att}p10`,
      finesse: false,
      at: 0,
      restart: null,
    });
    for (let i = 0; i < 20; i++) sim.step({});
    expect(sim.i.offside).not.toContain(`t${att}p10`);
  });

  it('a foul in the box is a penalty; a second yellow is a red and he goes off', () => {
    const sim = live();
    clearPitch(sim);
    const att = sim.s.attackPlusZ;
    const def = (1 - att) as TeamId;
    const victim = put(sim, `t${att}p10`, 3, PITCH_11.length / 2 - 8, 0);
    const fouler = put(sim, `t${def}p3`, 3, PITCH_11.length / 2 - 9.2, 0);
    // force the foul: call it directly through the tackle path
    (sim as unknown as { foulOn(a: unknown, b: unknown, s: boolean): void }).foulOn(
      fouler,
      victim,
      true,
    );
    expect(sim.s.restart?.kind).toBe('penalty');
    expect(sim.s.restart?.team).toBe(att);
    if (fouler.off !== true) {
      fouler.yellow = 1;
      sim.book(fouler, 'yellow');
    }
    expect(fouler.off).toBe(true);
    expect(sim.s.stats[def].reds).toBe(1);
    expect(sim.s.players.filter(p => p.off === true).length).toBe(1);
  });

  it('half time swaps ends and the other team kicks off', () => {
    const sim = new FootballSim(makeMatch({ size: 5, seed: 8, humans: [], halfSeconds: 20 }));
    const first = sim.s.restart!.team;
    const att1 = sim.s.attackPlusZ;
    let st = sim.snapshot();
    for (let i = 0; i < 60 * 60 && sim.s.period === 1; i++) st = sim.step({});
    expect(sim.s.period).toBe(2);
    expect(sim.s.attackPlusZ).not.toBe(att1);
    expect(st.restart?.kind ?? sim.s.restart?.kind).toBe('kickoff');
    expect(sim.s.restart!.team).toBe(1 - first);
  });
});

describe('football sim: humans', () => {
  it('a human gets a footballer and takes their own kick-off; A passes to the team-mate the stick points at', () => {
    const humans = [{ id: 'me', name: 'ME', team: 0 as TeamId }];
    const sim = new FootballSim(
      makeMatch({ size: 7, seed: 2, humans, halfSeconds: 240, firstKick: 0 }),
    );
    let st = sim.snapshot();
    for (let i = 0; i < 60 * 6 && !sim.s.players.some(p => p.human === 'me'); i++)
      st = sim.step({});
    const mine = sim.s.players.find(p => p.human === 'me')!;
    expect(mine).toBeTruthy();
    expect(mine.team).toBe(0);
    // wait until the kick-off is ready, then tap A toward a team-mate
    for (let i = 0; i < 60 * 5; i++) st = sim.step({});
    const me = sim.player(sim.s.restart?.taker ?? null) ?? mine;
    const mates = sim.s.players.filter(p => p.team === 0 && p.id !== me.id && !sim.isGK(p.id));
    const mate = mates[0];
    const ax = mate.x - me.x;
    const az = mate.z - me.z;
    const l = Math.hypot(ax, az);
    sim.step({ me: pad({ mx: ax / l, mz: az / l, pass: true }) });
    for (let i = 0; i < 12; i++) sim.step({ me: pad({ mx: ax / l, mz: az / l, pass: true }) });
    st = sim.step({ me: pad({ mx: ax / l, mz: az / l }) });
    let kicked = false;
    let rcv: string | null = null;
    for (let i = 0; i < 40; i++) {
      st = sim.step({});
      if (st.events.some(e => e.type === 'kick')) {
        kicked = true;
        rcv = sim.i.receiver;
      }
    }
    expect(kicked).toBe(true);
    expect(st.phase).toBe('live');
    expect(rcv).toBe(mate.id);
  });

  it('holding B fills the power bar; a full-power shot is faster than a tap', () => {
    const humans = [{ id: 'me', name: 'ME', team: 0 as TeamId }];
    const speed = (holdTicks: number) => {
      const sim = live(11, humans);
      clearPitch(sim);
      const att = sim.s.attackPlusZ;
      const dir = att === 0 ? 1 : -1;
      const me = sim.s.players.find(p => p.human === 'me')!;
      put(sim, me.id, 0, dir * 30, dir > 0 ? 0 : Math.PI);
      Object.assign(sim.s.ball, { x: 0, z: dir * 30.5, y: 0.11, owner: me.id, mode: 'free' });
      let maxCharge = 0;
      for (let i = 0; i < holdTicks; i++) {
        const st = sim.step({ me: pad({ shoot: true, mz: dir }) });
        maxCharge = Math.max(maxCharge, st.charge.me?.power ?? 0);
      }
      let v = 0;
      for (let i = 0; i < 30; i++) {
        sim.step({ me: pad({ mz: dir }) });
        v = Math.max(v, Math.hypot(sim.s.ball.vx, sim.s.ball.vy, sim.s.ball.vz));
      }
      return { v, maxCharge };
    };
    const tap = speed(4);
    const full = speed(60);
    expect(full.maxCharge).toBeGreaterThan(0.9);
    expect(full.v).toBeGreaterThan(tap.v + 6);
    expect(full.v).toBeGreaterThan(24);
  });

  it('LB switches to the team-mate nearest the ball', () => {
    const humans = [{ id: 'me', name: 'ME', team: 0 as TeamId }];
    const sim = live(11, humans);
    clearPitch(sim);
    const me = sim.s.players.find(p => p.human === 'me')!;
    put(sim, me.id, -20, -20);
    const near = put(sim, 't0p6', 2, 1);
    Object.assign(sim.s.ball, { x: 0, z: 0, owner: null, mode: 'free', vx: 0, vz: 0 });
    sim.step({ me: pad({ switchP: true }) });
    expect(near.human).toBe('me');
    expect(me.human ?? null).toBe(null);
  });
});

describe('football sim: keepers + AI', () => {
  it('a keeper saves a soft shot straight at him', () => {
    const sim = live();
    clearPitch(sim);
    const att = sim.s.attackPlusZ;
    const gk = put(sim, `t${1 - att}p0`, 0, PITCH_11.length / 2 - 1, Math.PI);
    Object.assign(sim.s.ball, {
      x: 0,
      z: PITCH_11.length / 2 - 18,
      y: 0.5,
      vz: 14,
      vx: 0,
      vy: 2,
      lastTouch: `t${att}p10`,
    });
    let saved = false;
    for (let i = 0; i < 180; i++)
      if (sim.step({}).events.some(e => e.type === 'save')) saved = true;
    expect(saved).toBe(true);
    expect(sim.s.score[att]).toBe(0);
    void gk;
  });

  it('a keeper is beaten by a hard shot in the top corner more often than by a soft one at him', () => {
    let soft = 0;
    let hard = 0;
    for (let seed = 0; seed < 12; seed++) {
      for (const kind of ['soft', 'hard'] as const) {
        const sim = new FootballSim(
          makeMatch({ size: 11, seed: 100 + seed, humans: [], halfSeconds: 240 }),
        );
        for (let i = 0; i < 200; i++) sim.step({});
        sim.s.phase = 'live';
        sim.s.restart = null;
        clearPitch(sim);
        const att = sim.s.attackPlusZ;
        put(sim, `t${1 - att}p0`, 0, PITCH_11.length / 2 - 1, Math.PI);
        sim.s.ball.mode = 'free';
        if (kind === 'soft')
          Object.assign(sim.s.ball, {
            x: 0,
            z: PITCH_11.length / 2 - 18,
            y: 0.4,
            vz: 15,
            vx: 0,
            vy: 2.2,
            lastTouch: `t${att}p10`,
          });
        else
          Object.assign(sim.s.ball, {
            x: -6,
            z: PITCH_11.length / 2 - 16,
            y: 0.3,
            vz: 30,
            vx: 4.6,
            vy: 4.6,
            lastTouch: `t${att}p10`,
          });
        for (let i = 0; i < 120; i++) sim.step({});
        if (sim.s.score[att] > 0) {
          if (kind === 'soft') soft++;
          else hard++;
        }
      }
    }
    expect(hard).toBeGreaterThan(soft);
  });

  it('out of possession the CPU presses the ball and keeps its shape (no one-man swarm)', () => {
    const sim = live();
    // team 1 carrier in midfield
    const c = sim.player('t1p6')!;
    Object.assign(sim.s.ball, { x: c.x, z: c.z, owner: c.id, mode: 'free' });
    for (let i = 0; i < 60 * 2; i++) {
      sim.step({});
      if (sim.s.ball.owner !== c.id) break;
    }
    const d = sim.s.players
      .filter(p => p.team === 0 && !sim.isGK(p.id))
      .map(p => Math.hypot(p.x - sim.s.ball.x, p.z - sim.s.ball.z))
      .sort((a, b) => a - b);
    expect(d[0]).toBeLessThan(5);
    // at most three within 8 m: the rest hold the shape
    expect(d.filter(x => x < 8).length).toBeLessThanOrEqual(3);
  });

  it('harder CPU beats easier CPU over a few matches', () => {
    let hardGoals = 0;
    let easyGoals = 0;
    for (let seed = 0; seed < 4; seed++) {
      const r = playMatch({ size: 7, seed: 40 + seed, difficulty: [4, 1] });
      hardGoals += r.final.score[0];
      easyGoals += r.final.score[1];
    }
    expect(hardGoals).toBeGreaterThan(easyGoals);
  }, 60000);
});
