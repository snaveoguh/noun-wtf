import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StatsTracker } from './Stats';

const BEST_KEY = 'noun-world-stats-best';
const PENDING_KEY = 'noun-world-stats-pending';
const PROVED = ['kmh', 'airM', 'airS'];
/** What one post may carry per proof (the server takes 2M; Netlify bodies stop at 6 MB). */
const PROOF_CHARS = 700_000;

type Body = {
  best: Record<string, number>;
  proofs: { keys: string[]; d: string }[];
};

function rider() {
  return { pos: { x: 0, y: 0, z: 0 }, speed: 0, mode: 'board', state: 'ground', respawns: 0 };
}
const combo = { lastBanked: null, session: 0 };

/** Skate in a straight line, speeding up by `accel` m/s², for `s` seconds. */
function ride(t: StatsTracker, p: ReturnType<typeof rider>, s: number, accel = 3, c = combo) {
  const dt = 1 / 60;
  for (let i = 0; i < s * 60; i++) {
    p.speed += accel * dt;
    p.pos.x += p.speed * dt;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t.update(dt, p as any, c as any, 0);
  }
}

const tracker = () =>
  new StatsTracker(
    () => 'T',
    () => false,
  );

/**
 * The server as the client sees it. Each post gets the next queued answer
 * (default: everything accepted). Every post is checked for the rule this
 * suite is about: a proved record is never claimed without its proof.
 */
let posts: Body[];
let answers: ((b: Body) => unknown)[];
let held: Record<string, number>;
const unproven: string[] = [];

function accept(b: Body) {
  for (const [k, v] of Object.entries(b.best)) if (v > (held[k] ?? 0)) held[k] = v;
  return { ok: true, json: async () => ({ you: { best: { ...held } } }) };
}

beforeEach(() => {
  localStorage.clear();
  posts = [];
  answers = [];
  held = {};
  unproven.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_u: string, init?: { body?: string }) => {
      if (!init?.body) return { ok: true, json: async () => ({}) };
      const b = JSON.parse(init.body) as Body;
      posts.push(b);
      for (const k of PROVED) {
        if (b.best[k] === undefined) continue;
        const proof = b.proofs.find(p => p.keys.includes(k));
        if (!proof || proof.d.length === 0) unproven.push(`${k}=${b.best[k]}`);
      }
      const next = answers.shift();
      return next ? next(b) : accept(b);
    }),
  );
  Object.defineProperty(navigator, 'sendBeacon', { value: () => true, configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

const settle = () => new Promise(r => setTimeout(r, 0));

describe('StatsTracker: a record survives a reload', () => {
  it('never saves an unproven record, and posts its proof after the reload', async () => {
    const a = tracker();
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
    const b = tracker();
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
    expect(unproven).toEqual([]);
  });
});

describe('StatsTracker: a proved record never goes out without its proof', () => {
  it('a post whose answer never arrives readable keeps the proof for the next one', async () => {
    const t = tracker();
    const p = rider();
    ride(t, p, 2);
    const claimed = t.mine.best.kmh!;
    // The server answers 200 but the body is lost (tab backgrounded, proxy…)
    answers.push(() => ({
      ok: true,
      json: async () => {
        throw new Error('aborted');
      },
    }));
    t.flush(false);
    await settle();
    await settle();
    // Something else to post (a combo session score), no faster ride
    ride(t, { ...p, speed: 1 }, 0.1, 0, { lastBanked: null, session: 50 });
    t.flush(false);
    await settle();
    expect(posts.length).toBe(2);
    expect(posts[1].best.kmh).toBe(claimed);
    expect(unproven).toEqual([]);
    expect(held.kmh).toBe(claimed);
  });

  it("a proved best this browser has but the server doesn't is never claimed bare", async () => {
    // Saved by an older build, a tab that lost its proof, a row that moved…
    localStorage.setItem(
      BEST_KEY,
      JSON.stringify({ best: { kmh: 900, combo: 10 }, comboLabel: '' }),
    );
    held = { kmh: 866.7 };
    const t = tracker();
    ride(t, rider(), 1);
    t.flush(false);
    await settle();
    expect(posts.length).toBe(1);
    expect(unproven).toEqual([]);
    // …and the local best falls back to what the server holds
    await vi.waitFor(() => expect(t.mine.best.kmh).toBe(866.7));
  });

  it('a refused record keeps its ride (for replay and appeal) and says why', async () => {
    const t = tracker();
    const events: { kind: string; key: string; value: number; reason?: string; n: number }[] = [];
    t.onRecord = e => events.push({ ...e, n: e.run.samples.length / 6 });
    ride(t, rider(), 2);
    const claimed = t.mine.best.kmh!;
    answers.push(() => ({
      ok: true,
      json: async () => ({ rejected: { kmh: 'gains energy from nowhere' }, you: { best: {} } }),
    }));
    t.flush(false);
    await vi.waitFor(() => expect(events.length).toBe(1));
    expect(events[0]).toMatchObject({ kind: 'refused', key: 'kmh', value: claimed });
    expect(events[0].reason).toBe('gains energy from nowhere');
    expect(events[0].n).toBeGreaterThan(10);
    expect(t.mine.best.kmh).toBeUndefined();
  });
});

describe('StatsTracker: long rides', () => {
  it('a record still counts after more than a full trace (60k samples) of riding', async () => {
    const t = tracker();
    const p = rider();
    // 55 min of steady acceleration: a new top speed every frame, so the
    // trace samples 20-30 times a second (66k samples)
    ride(t, p, 55 * 60, 0.05);
    const top = Math.floor(p.speed * 36) / 10;
    expect(t.mine.best.kmh).toBeGreaterThanOrEqual(top - 0.2);
    // (the post from early in the ride answers first)
    await settle();
    t.flush(false);
    await settle();
    const last = posts.at(-1)!;
    expect(last.best.kmh).toBeGreaterThanOrEqual(top - 0.2);
    expect(unproven).toEqual([]);
    for (const pr of last.proofs) expect(pr.d.length).toBeLessThanOrEqual(PROOF_CHARS);
  });
});
