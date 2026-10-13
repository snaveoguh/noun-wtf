import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StatsTracker } from './Stats';

const BEST_KEY = 'noun-world-stats-best';
const PENDING_KEY = 'noun-world-stats-pending';

type Body = { best: Record<string, number>; proofs: { keys: string[]; d: string }[] };

function rider() {
  return { pos: { x: 0, y: 0, z: 0 }, speed: 0, mode: 'board', state: 'ground', respawns: 0 };
}
const combo = { lastBanked: null, session: 0 };

/** Skate in a straight line, speeding up, for `s` seconds. */
function ride(t: StatsTracker, p: ReturnType<typeof rider>, s: number) {
  const dt = 1 / 60;
  for (let i = 0; i < s * 60; i++) {
    p.speed += 3 * dt;
    p.pos.x += p.speed * dt;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t.update(dt, p as any, combo as any, 0);
  }
}

describe('StatsTracker: a record survives a reload', () => {
  let posts: Body[];
  beforeEach(() => {
    localStorage.clear();
    posts = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: { body?: string }) => {
        if (init?.body) posts.push(JSON.parse(init.body) as Body);
        return { ok: true, json: async () => ({ you: { best: {} } }) };
      }),
    );
    Object.defineProperty(navigator, 'sendBeacon', { value: () => true, configurable: true });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('never saves an unproven record, and posts its proof after the reload', async () => {
    const a = new StatsTracker(
      () => 'T',
      () => false,
    );
    ride(a, rider(), 2);
    const claimed = a.mine.best.kmh!;
    expect(claimed).toBeGreaterThan(0);
    // The page goes away before the proof is posted
    a.flush(true);
    const saved = JSON.parse(localStorage.getItem(BEST_KEY)!) as { best: Record<string, number> };
    expect(saved.best.kmh).toBeUndefined();
    expect(localStorage.getItem(PENDING_KEY)).not.toBeNull();
    expect(posts.every(b => b.best.kmh === undefined)).toBe(true);

    // Next load: the record comes back with its proof and gets posted
    const b = new StatsTracker(
      () => 'T',
      () => false,
    );
    expect(b.mine.best.kmh).toBe(claimed);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.update(1 / 60, { ...rider(), mode: 'walk' } as any, combo as any, 0);
    b.flush(false);
    const last = posts.at(-1)!;
    expect(last.best.kmh).toBe(claimed);
    expect(last.proofs.map(p => p.keys)).toEqual([['kmh']]);
    await vi.waitFor(() => expect(localStorage.getItem(PENDING_KEY)).toBeNull());
    const after = JSON.parse(localStorage.getItem(BEST_KEY)!) as { best: Record<string, number> };
    expect(after.best.kmh).toBe(claimed);
  });
});
