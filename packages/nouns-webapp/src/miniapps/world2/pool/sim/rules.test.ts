import type { BallId, FrameState, PocketId, ShotInput } from '../contract';
import type { ShotReport } from './physics';

import { describe, expect, it } from 'vitest';

import {
  canPlace,
  judge,
  legalFirst,
  newFrame,
  onEight,
  toBalls,
  validInput,
  type RuleOptions,
} from './rules';
import { FOOT_X, HEAD_X, R } from './table';

const SHOT: ShotInput = { shot: { dx: 1, dy: 0, power: 0.5, side: 0, top: 0 } };

/** A frame in play with only these balls on (id → x,y), groups optional. */
function frame(on: Record<number, [number, number]>, p: Partial<FrameState> = {}): FrameState {
  const st = newFrame(1, 0);
  st.balls = st.balls.map((_, id) =>
    on[id] !== undefined ? { x: on[id]![0], y: on[id]![1] } : null,
  );
  return { ...st, phase: 'play', inHand: null, ...p };
}

const ALL_ON: Record<number, [number, number]> = Object.fromEntries(
  [...Array(16).keys()].map(id => [id, [-0.8 + id * 0.1, id % 2 === 0 ? 0.3 : -0.3]]),
);

function report(
  first: BallId | null,
  potted: [BallId, PocketId][] = [],
  more: Partial<ShotReport> = {},
): ShotReport {
  return {
    first,
    potted: potted.map(([id, pocket], i) => ({ id, pocket, t: i })),
    railAfter: true,
    railBalls: 0,
    t: 1,
    escaped: 0,
    ...more,
  };
}

function run(st: FrameState, rep: ShotReport, input: ShotInput = SHOT, opts: RuleOptions = {}) {
  const final = toBalls(st);
  for (const p of rep.potted) final[p.id]!.on = false;
  return judge(st, input, rep, final, opts);
}

describe('8-ball: the break', () => {
  const brk = () => ({ ...newFrame(3, 0) });

  it('a ball down on a legal break: go again, table still open', () => {
    const r = run(brk(), report(1, [[9, 3]], { railBalls: 2 }));
    expect(r.outcome.foul).toBeNull();
    expect(r.outcome.again).toBe(true);
    expect(r.state.turn).toBe(0);
    expect(r.state.groups).toEqual([null, null]);
    expect(r.state.phase).toBe('play');
    expect(r.state.balls[9]).toBeNull();
  });

  it('nothing down but 4 balls to a cushion: legal, the turn passes', () => {
    const r = run(brk(), report(1, [], { railBalls: 4 }));
    expect(r.outcome.foul).toBeNull();
    expect(r.state.turn).toBe(1);
    expect(r.state.inHand).toBeNull();
  });

  it('a soft break (under 4 to a cushion, nothing down) is a foul: ball in hand', () => {
    const r = run(brk(), report(1, [], { railBalls: 2 }));
    expect(r.outcome.foul).toBe('bad_break');
    expect(r.state.turn).toBe(1);
    expect(r.state.inHand).toBe('anywhere');
    expect(r.state.fouls).toEqual([1, 0]);
  });

  it('scratching on the break: ball in hand in the kitchen', () => {
    const r = run(brk(), report(1, [[0, 2]], { railBalls: 5 }));
    expect(r.outcome.foul).toBe('scratch');
    expect(r.state.inHand).toBe('kitchen');
    expect(r.state.balls[0]).toBeNull();
    expect(r.state.turn).toBe(1);
  });

  it('the 8 on the break comes back to the foot spot and the breaker carries on', () => {
    const r = run(brk(), report(1, [[8, 0]], { railBalls: 4 }));
    expect(r.state.phase).toBe('play');
    expect(r.outcome.respotted).toBe(true);
    expect(r.state.balls[8]).not.toBeNull();
    expect(r.state.balls[8]!.y).toBe(0);
    expect(r.state.balls[8]!.x).toBeGreaterThanOrEqual(FOOT_X - 0.3);
    expect(r.state.turn).toBe(0);
    expect(r.outcome.again).toBe(true);
  });

  it('the 8 on the break with a scratch: respotted, and a foul', () => {
    const r = run(
      brk(),
      report(
        1,
        [
          [8, 0],
          [0, 1],
        ],
        { railBalls: 4 },
      ),
    );
    expect(r.state.phase).toBe('play');
    expect(r.state.balls[8]).not.toBeNull();
    expect(r.outcome.foul).toBe('scratch');
    expect(r.state.turn).toBe(1);
  });

  it("bar rules ('win'): the 8 on the break wins", () => {
    const r = run(brk(), report(1, [[8, 0]], { railBalls: 4 }), SHOT, { eightOnBreak: 'win' });
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe(0);
  });

  it('breaks from the kitchen only', () => {
    const st = brk();
    expect(canPlace(st, { x: HEAD_X - 0.1, y: 0 })).toBe(true);
    expect(canPlace(st, { x: HEAD_X + 0.1, y: 0 })).toBe(false);
  });
});

describe('8-ball: open table and groups', () => {
  it('the first ball potted legally decides the groups', () => {
    const st = frame(ALL_ON);
    const r = run(
      st,
      report(3, [
        [3, 2],
        [12, 4],
      ]),
    );
    expect(r.outcome.assigned).toBe(true);
    expect(r.state.groups).toEqual(['solids', 'stripes']);
    expect(r.outcome.again).toBe(true);
  });

  it('a stripe first decides stripes for the shooter (seat 1)', () => {
    const st = frame(ALL_ON, { turn: 1 });
    const r = run(st, report(11, [[11, 3]]));
    expect(r.state.groups).toEqual(['solids', 'stripes']);
    expect(r.state.turn).toBe(1);
  });

  it('hitting the 8 first on an open table is a foul', () => {
    const r = run(frame(ALL_ON), report(8, []));
    expect(r.outcome.foul).toBe('wrong_first');
    expect(r.state.inHand).toBe('anywhere');
    expect(r.state.turn).toBe(1);
  });

  it('no groups are decided on a foul', () => {
    const r = run(
      frame(ALL_ON),
      report(3, [
        [3, 2],
        [0, 1],
      ]),
    );
    expect(r.outcome.foul).toBe('scratch');
    expect(r.state.groups).toEqual([null, null]);
  });
});

describe('8-ball: fouls and turns', () => {
  const grouped = (p: Partial<FrameState> = {}) =>
    frame(ALL_ON, { groups: ['solids', 'stripes'], ...p });

  it('hitting nothing is a foul', () => {
    const r = run(grouped(), report(null, [], { railAfter: true }));
    expect(r.outcome.foul).toBe('no_contact');
    expect(r.state.inHand).toBe('anywhere');
  });

  it("hitting the other group's ball first is a foul", () => {
    const r = run(grouped(), report(10, []));
    expect(r.outcome.foul).toBe('wrong_first');
  });

  it('no cushion after contact (and nothing potted) is a foul', () => {
    const r = run(grouped(), report(2, [], { railAfter: false }));
    expect(r.outcome.foul).toBe('no_rail');
  });

  it('potting one of yours keeps the turn', () => {
    const r = run(grouped(), report(2, [[2, 5]], { railAfter: false }));
    expect(r.outcome.foul).toBeNull();
    expect(r.outcome.again).toBe(true);
    expect(r.state.turn).toBe(0);
  });

  it("potting only the other player's ball passes the turn (no foul)", () => {
    const r = run(grouped(), report(2, [[13, 5]]));
    expect(r.outcome.foul).toBeNull();
    expect(r.outcome.again).toBe(false);
    expect(r.state.turn).toBe(1);
    expect(r.state.balls[13]).toBeNull();
  });

  it('a scratch: ball in hand anywhere for the other player, potted balls stay down', () => {
    const r = run(
      grouped(),
      report(2, [
        [2, 5],
        [0, 3],
      ]),
    );
    expect(r.outcome.foul).toBe('scratch');
    expect(r.state.balls[2]).toBeNull();
    expect(r.state.balls[0]).toBeNull();
    expect(r.state.inHand).toBe('anywhere');
    expect(r.state.turn).toBe(1);
  });

  it('ball in hand: anywhere clear of the other balls, never on top of one', () => {
    const st = grouped({ inHand: 'anywhere' });
    expect(canPlace(st, { x: 0.5, y: 0 })).toBe(true);
    const b5 = st.balls[5]!;
    expect(canPlace(st, { x: b5.x + R, y: b5.y })).toBe(false);
    expect(canPlace(st, { x: 5, y: 0 })).toBe(false);
    expect(validInput(st, { ...SHOT, cue: { x: 0.5, y: 0 } })).toBe(true);
    expect(validInput(st, { ...SHOT, cue: { x: b5.x, y: b5.y } })).toBe(false);
    // Not in hand: no placing
    expect(validInput(grouped(), { ...SHOT, cue: { x: 0.5, y: 0 } })).toBe(false);
  });
});

describe('8-ball: the 8', () => {
  // Seat 0 on solids, all solids gone: on the 8
  const onThe8 = () =>
    frame(
      { 0: [-0.5, 0], 8: [0.4, 0.2], 9: [0.2, -0.2], 10: [0.6, -0.3] },
      { groups: ['solids', 'stripes'] },
    );

  it('knows who is on the 8 and that the 8 is the only legal ball', () => {
    const st = onThe8();
    expect(onEight(st, 0)).toBe(true);
    expect(onEight(st, 1)).toBe(false);
    expect(legalFirst(st, 0)).toEqual([8]);
    expect(legalFirst(st, 1)).toEqual([9, 10]);
  });

  it('the 8 in the called pocket wins', () => {
    const r = run(onThe8(), report(8, [[8, 3]]), { ...SHOT, call: 3 });
    expect(r.state.phase).toBe('over');
    expect(r.state.winner).toBe(0);
  });

  it('the 8 in another pocket loses', () => {
    const r = run(onThe8(), report(8, [[8, 2]]), { ...SHOT, call: 3 });
    expect(r.state.winner).toBe(1);
    expect(r.state.reason).toMatch(/wrong pocket/);
  });

  it('scratching on the 8 loses', () => {
    const r = run(
      onThe8(),
      report(8, [
        [8, 3],
        [0, 0],
      ]),
      { ...SHOT, call: 3 },
    );
    expect(r.state.winner).toBe(1);
    expect(r.state.reason).toMatch(/scratch/);
  });

  it('the 8 down before your group is cleared loses', () => {
    const st = frame(ALL_ON, { groups: ['solids', 'stripes'] });
    const r = run(
      st,
      report(3, [
        [3, 1],
        [8, 2],
      ]),
    );
    expect(r.state.winner).toBe(1);
    expect(r.state.reason).toMatch(/early/);
  });

  it('a miss on the 8 is just a miss; hitting a stripe first is a foul', () => {
    expect(run(onThe8(), report(8, []), { ...SHOT, call: 3 }).state.phase).toBe('play');
    const r = run(onThe8(), report(9, []), { ...SHOT, call: 3 });
    expect(r.outcome.foul).toBe('wrong_first');
    expect(r.state.turn).toBe(1);
  });

  it('nothing is played once the frame is over', () => {
    const r = run(onThe8(), report(8, [[8, 3]]), { ...SHOT, call: 3 });
    expect(validInput(r.state, SHOT)).toBe(false);
  });
});
