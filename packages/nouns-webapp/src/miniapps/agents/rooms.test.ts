import { describe, expect, it } from 'vitest';

import { agentForRoom, withAgent } from './rooms';

describe('agents in rooms', () => {
  it('is deterministic and covers about half the eligible rooms', () => {
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const a = agentForRoom(`door-${i}`, 'shop');
      expect(agentForRoom(`door-${i}`, 'shop')?.id).toBe(a?.id);
      if (a !== null) {
        n++;
        expect(a.rooms).toContain('shop');
      }
    }
    expect(n).toBeGreaterThan(140);
    expect(n).toBeLessThan(260);
    expect(agentForRoom('door-1', 'laundromat')).toBeNull();
  });

  it('replaces the owner, leaves everyone else', () => {
    const id = Array.from({ length: 50 }, (_, i) => `d${i}`).find(
      d => agentForRoom(d, 'cafe') !== null,
    )!;
    type Def = {
      name: string;
      seed: [number, number, number, number, number];
      role: string;
      agent?: string;
    };
    const defs: Def[] = [
      {
        name: 'Guest',
        seed: [0, 0, 0, 0, 0] as [number, number, number, number, number],
        role: 'guest',
      },
      {
        name: 'Boss',
        seed: [0, 0, 0, 0, 0] as [number, number, number, number, number],
        role: 'owner',
      },
    ];
    const out = withAgent(defs, id, 'cafe');
    expect(out[0]).toEqual(defs[0]);
    expect(out[1]!.agent).toMatch(/^agent:/);
    expect(out[1]!.name).not.toBe('Boss');
  });
});
