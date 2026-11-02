import { describe, expect, it } from 'vitest';

import { decodeSf, encodeSf, NO_SURF, WIRE_PHASES, type SurfAnim } from './sf';

describe('the sf pose key', () => {
  it('sends nothing on land', () => {
    expect(encodeSf(NO_SURF)).toBeNull();
  });

  it('round-trips every phase and board', () => {
    for (const phase of WIRE_PHASES.slice(1)) {
      for (const board of [null, 'foamie', 'longboard', 'shortboard'] as const) {
        const a: SurfAnim = { phase, board, lean: -0.42, crouch: 0.8, stroke: 7.5, sit: 0.3, t: 1.234 };
        const b = decodeSf(JSON.parse(JSON.stringify(encodeSf(a))));
        expect(b).not.toBeNull();
        expect(b!.phase).toBe(phase);
        expect(b!.board).toBe(board);
        expect(b!.lean).toBeCloseTo(-0.42, 2);
        expect(b!.stroke).toBeCloseTo(7.5 - Math.PI * 2, 2);
        expect(b!.t).toBeCloseTo(1.23, 2);
      }
    }
  });

  it('ignores junk (older / other clients never crash it)', () => {
    for (const v of [undefined, null, 3, 'x', [], [1, 2], [0, 1, 0, 0, 0, 0, 0], [99, 1, 0, 0, 0, 0, 0], ['a', 1, 0, 0, 0, 0, 0]])
      expect(decodeSf(v)).toBeNull();
    // clamps what it does take
    expect(decodeSf([6, 9, 5, -2, 99, 3, 999])).toMatchObject({ phase: 'ride', board: 'shortboard', lean: 1, crouch: 0, sit: 1, t: 60 });
  });

  it('wire order is append-only', () => {
    expect(WIRE_PHASES.slice(0, 9)).toEqual(['off', 'wade', 'swim', 'paddle', 'duck', 'pop', 'ride', 'air', 'wipeout']);
  });
});
