// ── Mock SimState stream (develop / test the view without hoops/sim) ────
//
// A scripted 2v2 half-court possession reel at SIM_DT: check ball,
// dribbling, a crossover that breaks ankles, a pass, a three-point swish, a
// rim-out + rebound, a bank shot, a steal, a dunk that hangs on the rim, a
// block, catching fire, an on-fire swish from downtown, and the final
// buzzer with celebrations. Built once up front (≈2 k states).

import {
  JERSEY_COURT,
  MODE_DEFAULTS,
  SIM_DT,
  type BallerAction,
  type BallerState,
  type GameConfig,
  type GamePhase,
  type SimEvent,
  type SimState,
} from '../contract';

const K = JERSEY_COURT;
const RIM_Z = K.length / 2 - K.rimFromBaseline;
const BOARD_Z = K.length / 2 - K.boardFromBaseline;
const BR = K.ballRadius;
const G = 9.8;

export interface MockStream {
  config: GameConfig;
  states: SimState[];
  duration: number;
  /** Times (s) of the reel's set pieces, for screenshots / tests. */
  marks: Record<string, number>;
  /** State at time t (nearest step). */
  at(t: number): SimState;
}

export const MOCK_IDS = ['me', 'pal', 'bot:0', 'bot:1'] as const;

export function mockConfig(): GameConfig {
  return {
    ...MODE_DEFAULTS[2],
    nbaScoring: true,
    target: 21,
    seed: 7,
    court: K,
    players: [
      { id: 'me', team: 0, bot: false, name: 'you', seedKey: '0-3-12-40-7' },
      { id: 'pal', team: 0, bot: false, name: 'nounish', seedKey: '1-8-30-122-15' },
      { id: 'bot:0', team: 1, bot: true, name: 'lil dunkin', seedKey: '0-14-55-200-3' },
      { id: 'bot:1', team: 1, bot: true, name: 'big noggs', seedKey: '1-21-77-31-9' },
    ],
  };
}

type V3 = [number, number, number];

const MARKS: Record<string, number> = {
  checkball: 0.5,
  dribble: 2.4,
  crossover: 3.3,
  pass: 4.2,
  jumperRelease: 5.45,
  swish: 6.62,
  rimOut: 11.2,
  rebound: 11.95,
  bank: 14.75,
  bankScore: 15.06,
  steal: 17.55,
  dunkTakeoff: 19.4,
  dunkSlam: 20.0,
  dunkHang: 20.3,
  block: 24.32,
  onFire: 25.4,
  fireRelease: 27.6,
  fireSwish: 28.75,
  final: 28.9,
  end: 33,
};

export function createMockStream(): MockStream {
  const config = mockConfig();
  const players: BallerState[] = config.players.map((p, i) => ({
    id: p.id,
    team: p.team,
    x: [0, 4.5, 0, 3.5][i],
    y: 0,
    z: [1, 4, 3, 5][i],
    yaw: 0,
    vx: 0,
    vz: 0,
    action: 'idle',
    actionT: 0,
    hasBall: false,
    onFire: false,
    stamina: 1,
  }));
  const P = Object.fromEntries(players.map(p => [p.id, p])) as Record<string, BallerState>;
  const me = P.me;
  const pal = P.pal;
  const b0 = P['bot:0'];
  const b1 = P['bot:1'];
  const ball = {
    x: 0,
    y: 1,
    z: 1.4,
    vx: 0,
    vy: 0,
    vz: 0,
    sx: 0,
    sy: 0,
    sz: 0,
    state: 'held' as SimState['ball']['state'],
    holder: 'me' as string | null,
    shooter: null as string | null,
    value: 0,
  };
  const states: SimState[] = [];
  let score: [number, number] = [11, 14];
  let phase: GamePhase = 'checkball';
  let offense: 0 | 1 = 0;
  let tPrev = -1;
  let events: SimEvent[] = [];
  const yawSet = new Set<string>();

  const at = (tE: number, t: number, ev: SimEvent) => {
    if (tE > tPrev && tE <= t) events.push(ev);
  };
  const k01 = (t: number, t0: number, t1: number) => Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  const ease = (k: number) => k * k * (3 - 2 * k);
  const go = (
    p: BallerState,
    t: number,
    t0: number,
    t1: number,
    a: [number, number],
    b: [number, number],
    e = true,
  ) => {
    if (t < t0 || t >= t1) return;
    const k = e ? ease(k01(t, t0, t1)) : k01(t, t0, t1);
    p.x = a[0] + (b[0] - a[0]) * k;
    p.z = a[1] + (b[1] - a[1]) * k;
  };
  const act = (p: BallerState, t: number, t0: number, t1: number, a: BallerAction) => {
    if (t < t0 || t >= t1) return false;
    p.action = a;
    p.actionT = k01(t, t0, t1);
    return true;
  };
  const jump = (p: BallerState, t: number, t0: number, t1: number, h: number) => {
    if (t < t0 || t >= t1) return;
    const k = k01(t, t0, t1);
    p.y = 4 * h * k * (1 - k);
  };
  const face = (p: BallerState, x: number, z: number) => {
    p.yaw = Math.atan2(x - p.x, z - p.z);
    yawSet.add(p.id);
  };
  const faceRim = (p: BallerState) => face(p, 0, RIM_Z);
  /** Guard: between the attacker and the rim. */
  const guard = (d: BallerState, a: BallerState, gap = 1.3) => {
    const dx = 0 - a.x;
    const dz = RIM_Z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    d.x = a.x + (dx / l) * gap;
    d.z = a.z + (dz / l) * gap;
    d.action = 'defend';
    d.actionT = 0;
    face(d, a.x, a.z);
  };
  const hold = (p: BallerState) => {
    ball.state = 'held';
    ball.holder = p.id;
    ball.shooter = null;
    p.hasBall = true;
    ball.x = p.x + Math.sin(p.yaw) * 0.45;
    ball.z = p.z + Math.cos(p.yaw) * 0.45;
    ball.y = p.y + 1.0;
    ball.vx = ball.vy = ball.vz = 0;
  };
  /** Ballistic flight a → b over [t0, t1). */
  const fly = (t: number, t0: number, t1: number, a: V3, b: V3, state: 'air' | 'loose' = 'air') => {
    if (t < t0 || t >= t1) return false;
    const T = t1 - t0;
    const s = t - t0;
    const vx = (b[0] - a[0]) / T;
    const vz = (b[2] - a[2]) / T;
    const vy0 = (b[1] - a[1] + 0.5 * G * T * T) / T;
    ball.x = a[0] + vx * s;
    ball.z = a[2] + vz * s;
    ball.y = a[1] + vy0 * s - 0.5 * G * s * s;
    ball.vx = vx;
    ball.vz = vz;
    ball.vy = vy0 - G * s;
    ball.state = state;
    ball.holder = null;
    // Backspin about the flight's side axis
    const l = Math.hypot(vx, vz) || 1;
    ball.sx = (-vz / l) * 14;
    ball.sz = (vx / l) * 14;
    ball.sy = 0;
    return true;
  };
  const shotFrom = (p: BallerState): V3 => [
    p.x + Math.sin(p.yaw) * 0.2,
    p.y + 2.35,
    p.z + Math.cos(p.yaw) * 0.2,
  ];
  const rim: V3 = [0, K.rimHeight + 0.02, RIM_Z];
  const below: V3 = [0, BR, RIM_Z - 0.1];

  const N = Math.round(MARKS.end / SIM_DT);
  const prev = players.map(p => ({ x: p.x, z: p.z }));
  for (let i = 0; i <= N; i++) {
    const t = i * SIM_DT;
    events = [];
    yawSet.clear();
    for (const p of players) {
      p.y = 0;
      p.hasBall = false;
      p.meter = undefined;
      p.action = 'idle';
      p.actionT = (t * 0.5) % 1;
    }

    // ── Check ball → dribble up, crossover breaks b0's ankles ──
    if (t < 1.5) {
      phase = 'checkball';
      offense = 0;
      at(0.5, t, { type: 'checkball', team: 0 });
      faceRim(me);
      hold(me);
      guard(b0, me, 1.6);
      guard(b1, pal, 1.4);
    } else if (t < 4.0) {
      phase = 'live';
      go(me, t, 1.5, 3.2, [0, 1], [-1.6, 3.6]);
      go(me, t, 3.2, 4.0, [-1.6, 3.6], [-0.6, 5.2]);
      go(pal, t, 1.5, 4.0, [4.5, 4], [4.5, 4.5]);
      me.action = 'dribble';
      act(me, t, 3.2, 3.55, 'crossover');
      faceRim(me);
      at(3.3, t, { type: 'crossover', id: 'me', ankles: true });
      if (t < 3.3) guard(b0, me, 1.3);
      else {
        act(b0, t, 3.3, 4.9, 'stumble');
        face(b0, -1.6, 3.6);
      }
      guard(b1, pal, 1.5);
      hold(me);
      if (Math.floor(t / 0.42) !== Math.floor((t - SIM_DT) / 0.42))
        events.push({ type: 'dribble', id: 'me' });
    }
    // ── Pass to pal → catch → three-point swish ──
    else if (t < 6.6) {
      phase = 'live';
      act(b0, t, 3.3, 4.9, 'stumble');
      if (t < 4.5) {
        act(me, t, 4.0, 4.4, 'pass');
        face(me, pal.x, pal.z);
        if (t < 4.12) hold(me);
        else fly(t, 4.12, 4.5, [me.x + 0.3, 1.25, me.z + 0.2], [4.3, 1.2, 4.75]);
        at(4.12, t, { type: 'pass', from: 'me', to: 'pal' });
      }
      faceRim(pal);
      act(pal, t, 4.45, 4.8, 'catch');
      if (t >= 4.5 && t < 5.45) hold(pal);
      if (act(pal, t, 4.8, 5.3, 'gather')) pal.meter = 0.86 * k01(t, 4.8, 5.3);
      if (act(pal, t, 5.3, 6.0, 'jumpshot')) {
        jump(pal, t, 5.3, 6.0, 0.6);
        if (t < 5.45) {
          hold(pal);
          pal.meter = 0.86;
        }
      }
      at(5.45, t, { type: 'shot', id: 'pal', value: 3, quality: 0.97, kind: 'jumper' });
      if (t >= 5.45) {
        fly(t, 5.45, 6.6, shotFrom({ ...pal, y: 0.5 }), rim);
        ball.shooter = 'pal';
        ball.value = 3;
      }
      guard(b1, pal, 2.2);
      faceRim(me);
    }
    // ── Swish → scored → b0 checks it up, misses (rim-out), me rebounds ──
    else if (t < 12.2) {
      at(6.6, t, { type: 'net' });
      at(6.62, t, { type: 'score', team: 0, id: 'pal', points: 3, how: 'swish' });
      if (t >= 6.62 && score[0] === 11) score = [14, 14];
      if (t < 8.0) {
        phase = 'scored';
        if (
          !fly(t, 6.6, 7.0, rim, below, 'loose') &&
          !fly(t, 7.0, 7.6, below, [0.4, BR, 9.4], 'loose')
        )
          fly(t, 7.6, 8.0, [0.4, BR, 9.4], [0.6, BR, 9.0], 'loose');
        at(7.0, t, { type: 'bounce', strength: 0.6 });
        at(7.6, t, { type: 'bounce', strength: 0.3 });
        act(pal, t, 6.62, 8.0, 'celebrate');
        act(b1, t, 6.62, 8.0, 'dejected');
        act(b0, t, 6.62, 8.0, 'dejected');
        faceRim(me);
        // Everyone resets for the check
        go(b0, t, 6.62, 8.0, [-1.6, 3.6], [0, 3]);
        go(me, t, 6.62, 8.0, [-0.6, 5.2], [0, 4.5]);
      } else {
        phase = 'live';
        offense = 1;
        at(8.0, t, { type: 'checkball', team: 1 });
        go(b0, t, 8.0, 9.6, [0, 3], [-3, 6]);
        b0.action = 'dribble';
        faceRim(b0);
        if (t < 9.6) hold(b0);
        if (act(b0, t, 9.6, 10.0, 'gather')) {
          b0.meter = 0.6 * k01(t, 9.6, 10.0);
          hold(b0);
        }
        if (act(b0, t, 10.0, 10.6, 'jumpshot')) {
          jump(b0, t, 10.0, 10.6, 0.5);
          if (t < 10.15) hold(b0);
        }
        at(10.15, t, { type: 'shot', id: 'bot:0', value: 2, quality: 0.42, kind: 'jumper' });
        const front: V3 = [-0.12, K.rimHeight + BR + 0.02, RIM_Z - K.rimRadius + 0.02];
        if (t >= 10.15) {
          if (!fly(t, 10.15, 11.2, [-2.9, 2.75, 6.1], front))
            fly(t, 11.2, 11.95, front, [1.1, 2.55, 8.4]);
          ball.shooter = t < 11.2 ? 'bot:0' : null;
        }
        at(11.2, t, { type: 'rim', strength: 0.75 });
        at(11.25, t, { type: 'miss', id: 'bot:0' });
        guard(me, b0, 1.4);
        if (t >= 10.6) {
          go(me, t, 10.6, 11.7, [me.x, me.z], [1.1, 8.0]);
          if (t >= 10.6 && t < 11.7) face(me, 0, RIM_Z);
        }
        if (act(me, t, 11.6, 12.2, 'rebound')) {
          me.x = 1.1;
          me.z = 8.0;
          jump(me, t, 11.6, 12.2, 0.75);
          if (t >= 11.95) hold(me);
        }
        at(11.95, t, { type: 'rebound', id: 'me', offensive: false });
        guard(b1, pal, 1.5);
        go(pal, t, 8.0, 12.0, [4.5, 4.5], [5, 7]);
      }
    }
    // ── me: bank shot off the glass ──
    else if (t < 16.5) {
      phase = t < 15.06 ? 'live' : 'scored';
      offense = 0;
      go(me, t, 12.2, 13.4, [1.1, 8.0], [-3.2, 7.4]);
      me.action = t < 13.4 ? 'dribble' : 'idle';
      faceRim(me);
      if (t < 13.4) hold(me);
      if (act(me, t, 13.4, 13.7, 'gather')) {
        me.meter = 0.8 * k01(t, 13.4, 13.7);
        hold(me);
      }
      if (act(me, t, 13.7, 14.3, 'jumpshot')) {
        jump(me, t, 13.7, 14.3, 0.55);
        if (t < 13.85) {
          hold(me);
          me.meter = 0.8;
        }
      }
      at(13.85, t, { type: 'shot', id: 'me', value: 2, quality: 0.8, kind: 'jumper' });
      const glass: V3 = [-0.3, K.rimHeight + 0.42, BOARD_Z - BR - 0.01];
      if (t >= 13.85) {
        if (!fly(t, 13.85, 14.75, [-3.0, 2.8, 7.6], glass))
          if (!fly(t, 14.75, 15.06, glass, [0, K.rimHeight - 0.05, RIM_Z]))
            if (!fly(t, 15.06, 15.45, [0, K.rimHeight - 0.05, RIM_Z], below, 'loose'))
              fly(t, 15.45, 16.5, below, [-0.8, BR, 8.8], 'loose');
        ball.shooter = t < 15.06 ? 'me' : null;
        ball.value = 2;
      }
      at(14.75, t, { type: 'backboard', strength: 0.55 });
      at(15.03, t, { type: 'net' });
      at(15.06, t, { type: 'score', team: 0, id: 'me', points: 2, how: 'bank' });
      at(15.45, t, { type: 'bounce', strength: 0.5 });
      if (t >= 15.06 && score[0] === 14) score = [16, 14];
      guard(b0, me, 1.5);
      if (t >= 15.06) {
        act(me, t, 15.06, 16.5, 'celebrate');
        act(b0, t, 15.06, 16.5, 'dejected');
      }
      guard(b1, pal, 1.6);
    }
    // ── b1 brings it up, me pokes it away (steal) → drive → DUNK ──
    else if (t < 22.2) {
      phase = t < 20.05 ? 'live' : 'scored';
      at(16.5, t, { type: 'checkball', team: 1 });
      offense = t < 17.55 ? 1 : 0;
      if (t < 17.55) {
        go(b1, t, 16.5, 17.55, [1, 3], [-0.6, 4.8]);
        b1.action = 'dribble';
        faceRim(b1);
        hold(b1);
        go(me, t, 16.5, 17.3, [-1.5, 7.0], [-0.7, 6.0]);
        face(me, b1.x, b1.z);
        me.action = 'defend';
        act(me, t, 17.3, 17.7, 'steal');
      } else {
        act(b1, t, 17.55, 18.4, 'stumble');
        if (t < 19.4) {
          go(me, t, 17.55, 19.4, [-0.7, 6.0], [0, 9.25], false);
          me.action = 'dribble';
          act(me, t, 17.55, 17.7, 'steal');
          faceRim(me);
          hold(me);
        }
      }
      at(17.55, t, { type: 'steal', id: 'me', from: 'bot:1' });
      at(19.4, t, { type: 'shot', id: 'me', value: 2, quality: 1, kind: 'dunk' });
      if (act(me, t, 19.4, 20.85, 'dunk')) {
        faceRim(me);
        me.x = 0;
        me.z = 9.25 + 0.95 * ease(k01(t, 19.4, 20.0));
        // Rise to the rim, hang, drop
        const up = 1.55;
        if (t < 20.0) me.y = up * Math.sin((k01(t, 19.4, 20.0) * Math.PI) / 2);
        else if (t < 20.6) me.y = up - 0.08 * Math.sin(k01(t, 20.0, 20.6) * Math.PI);
        else me.y = up * (1 - ease(k01(t, 20.6, 20.85)));
        if (t < 20.0) hold(me);
        else {
          if (!fly(t, 20.0, 20.32, [0, K.rimHeight + 0.1, RIM_Z], below, 'loose'))
            if (!fly(t, 20.32, 21.0, below, [-0.4, BR, 8.9], 'loose'))
              fly(t, 21.0, 22.2, [-0.4, BR, 8.9], [-0.9, BR, 7.6], 'loose');
          ball.shooter = null;
        }
      }
      if (t >= 20.85) {
        act(me, t, 20.85, 22.2, 'celebrate');
        me.x = 0;
        me.z = 10.2;
        face(me, 0, 0);
        if (!fly(t, 20.32, 21.0, below, [-0.4, BR, 8.9], 'loose'))
          fly(t, 21.0, 22.2, [-0.4, BR, 8.9], [-0.9, BR, 7.6], 'loose');
      }
      at(20.0, t, { type: 'rim', strength: 1 });
      at(20.0, t, { type: 'backboard', strength: 0.9 });
      at(20.04, t, { type: 'net' });
      at(20.05, t, { type: 'score', team: 0, id: 'me', points: 2, how: 'dunk' });
      at(20.32, t, { type: 'bounce', strength: 0.8 });
      if (t >= 20.05 && score[0] === 16) score = [18, 14];
      go(b0, t, 16.5, 20.0, [0, 4], [0.9, 8.3]);
      face(b0, me.x, me.z);
      if (t < 20.05) b0.action = 'defend';
      else act(b0, t, 20.05, 22.2, 'dejected');
      guard(b1, pal, 1.5);
      if (t >= 17.55 && t < 18.4) act(b1, t, 17.55, 18.4, 'stumble');
    }
    // ── b1 drives for a layup, pal sends it back: REJECTED ──
    else if (t < 25.4) {
      phase = 'live';
      offense = t < 24.32 ? 1 : 0;
      at(22.2, t, { type: 'checkball', team: 1 });
      go(b1, t, 22.2, 24.0, [0.5, 3], [0.6, 8.6]);
      if (t < 24.0) {
        b1.action = 'dribble';
        hold(b1);
      }
      faceRim(b1);
      if (act(b1, t, 24.0, 24.75, 'layup')) {
        jump(b1, t, 24.0, 24.75, 0.95);
        b1.z = 8.6 + 0.6 * k01(t, 24.0, 24.75);
        if (t < 24.25) hold(b1);
      }
      at(24.25, t, { type: 'shot', id: 'bot:1', value: 2, quality: 0.6, kind: 'layup' });
      go(pal, t, 22.2, 24.0, [5, 7], [1.3, 9.8]);
      face(pal, b1.x, b1.z);
      if (act(pal, t, 24.05, 24.75, 'block')) {
        pal.x = 1.2;
        pal.z = 9.8;
        jump(pal, t, 24.05, 24.75, 1.05);
      }
      at(24.32, t, { type: 'block', id: 'pal', on: 'bot:1' });
      if (t >= 24.25) {
        const top: V3 = [0.75, 3.05, 9.55];
        if (!fly(t, 24.25, 24.32, [0.6, 2.75, 9.1], top))
          if (!fly(t, 24.32, 24.9, top, [-2.4, BR, 6.0], 'loose'))
            fly(t, 24.9, 25.4, [-2.4, BR, 6.0], [-3.6, BR, 4.6], 'loose');
      }
      at(24.9, t, { type: 'bounce', strength: 0.7 });
      go(me, t, 22.2, 25.4, [-2, 6], [-3.6, 4.4]);
      face(me, ball.x, ball.z);
      me.action = t > 24.3 ? 'run' : 'defend';
      guard(b0, pal, 1.8);
      if (t < 22.6) act(b0, t, 22.2, 22.6, 'idle');
    }
    // ── me catches fire, pulls up from downtown: on-fire swish → final ──
    else if (t < 28.9) {
      phase = t < 28.77 ? 'live' : 'scored';
      offense = 0;
      at(25.4, t, { type: 'onFire', id: 'me' });
      go(me, t, 25.4, 27.0, [-3.6, 4.4], [-5.5, 5.2]);
      faceRim(me);
      if (t < 27.0) {
        me.action = 'dribble';
        hold(me);
      }
      if (act(me, t, 27.0, 27.45, 'gather')) {
        me.meter = 0.86 * k01(t, 27.0, 27.45);
        hold(me);
      }
      if (act(me, t, 27.45, 28.05, 'jumpshot')) {
        jump(me, t, 27.45, 28.05, 0.62);
        if (t < 27.6) {
          hold(me);
          me.meter = 0.86;
        }
      }
      at(27.6, t, { type: 'shot', id: 'me', value: 3, quality: 1, kind: 'jumper' });
      if (t >= 27.6) {
        if (!fly(t, 27.6, 28.75, [-5.3, 2.9, 5.45], rim)) fly(t, 28.75, 29.2, rim, below, 'loose');
        ball.shooter = 'me';
        ball.value = 3;
      }
      at(28.75, t, { type: 'net' });
      at(28.77, t, { type: 'score', team: 0, id: 'me', points: 3, how: 'swish' });
      if (t >= 28.77 && score[0] === 18) score = [21, 14];
      guard(b0, me, 1.7);
      go(b1, t, 25.4, 27, [0.6, 8.6], [2.5, 6.5]);
      guard(b1, pal, 1.6);
      go(pal, t, 25.4, 27, [1.2, 9.8], [5.5, 6.0]);
    }
    // ── Final ──
    else {
      phase = 'final';
      at(28.9, t, { type: 'final', winner: 0, score: [21, 14] });
      if (!fly(t, 28.75, 29.2, rim, below, 'loose'))
        fly(t, 29.2, 30.0, below, [0.5, BR, 9.2], 'loose');
      ball.state = t < 30 ? 'loose' : 'dead';
      for (const p of players) {
        p.action = p.team === 0 ? 'celebrate' : 'dejected';
        p.actionT = Math.min(1, (t - 28.9) / 2.5);
      }
    }
    if (t >= 25.4) me.onFire = true;

    // Velocity + default facing from motion
    players.forEach((p, j) => {
      p.vx = (p.x - prev[j].x) / SIM_DT;
      p.vz = (p.z - prev[j].z) / SIM_DT;
      if (i === 0) p.vx = p.vz = 0;
      prev[j].x = p.x;
      prev[j].z = p.z;
      if (!yawSet.has(p.id) && Math.hypot(p.vx, p.vz) > 0.4) p.yaw = Math.atan2(p.vx, p.vz);
      else if (!yawSet.has(p.id)) p.yaw = Math.atan2(ball.x - p.x, ball.z - p.z);
      if (p.action === 'idle' && Math.hypot(p.vx, p.vz) > 0.6) p.action = 'run';
    });
    for (const p of players) p.hasBall = ball.state === 'held' && ball.holder === p.id;
    if (ball.state === 'held') {
      const h = P[ball.holder!];
      if (h !== undefined) {
        ball.x = h.x + Math.sin(h.yaw) * 0.45;
        ball.z = h.z + Math.cos(h.yaw) * 0.45;
        ball.y = h.y + 1.0;
      }
    }
    states.push({
      tick: i,
      time: t,
      phase,
      phaseT: phase === 'scored' ? 1 : 0,
      score: [score[0], score[1]],
      offense,
      shotClock: Math.max(0, 14 - ((t * 1.0) % 14)),
      players: players.map(p => ({ ...p })),
      ball: { ...ball },
      events,
    });
    tPrev = t;
  }
  void b0;
  void b1;
  return {
    config,
    states,
    duration: MARKS.end,
    marks: { ...MARKS },
    at(t: number) {
      const i = Math.max(0, Math.min(states.length - 1, Math.round(t / SIM_DT)));
      return states[i];
    },
  };
}
