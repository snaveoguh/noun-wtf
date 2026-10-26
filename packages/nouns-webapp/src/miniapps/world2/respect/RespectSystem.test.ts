import type { RespectSyncPort, ServerBook, PendingEvent } from './sync';

import { describe, expect, it, vi } from 'vitest';

import { RespectSystem, STORAGE_KEY, TICKER_MS, type StorageLike } from './RespectSystem';
import { HALF_LIFE_MS } from './rules';

const T0 = Date.UTC(2026, 9, 26, 12);

function memStorage(
  init: Record<string, string> = {},
): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: k => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

function clock(t = T0) {
  const c = { t, now: () => c.t };
  return c;
}

const make = (
  o: { storage?: StorageLike | null; now?: () => number; sync?: RespectSyncPort | null } = {},
) =>
  new RespectSystem({
    storage: o.storage ?? null,
    now: o.now ?? (() => T0),
    sync: o.sync ?? null,
    timers: false,
  });

describe('RespectSystem', () => {
  it('starts as a stranger at 0', () => {
    const r = make();
    expect(r.state()).toMatchObject({ score: 0, tier: 'stranger', recent: [] });
    // 40 of the 90 points from −40 to 50
    expect(r.state().progress).toBeCloseTo(40 / 90);
  });

  it('add returns the delta, records history and tells subscribers', () => {
    const r = make();
    const on = vi.fn();
    const sub = vi.fn();
    r.on(on);
    r.subscribe(sub);
    expect(r.add({ kind: 'gift', to: 'Nadia', coin: 5 })).toBe(4);
    expect(r.state().score).toBe(4);
    expect(r.state().recent[0]).toMatchObject({ label: 'gave Nadia 5 COIN', delta: 4 });
    expect(on).toHaveBeenCalledWith(r.state(), 4, { kind: 'gift', to: 'Nadia', coin: 5 });
    expect(sub).toHaveBeenCalledTimes(1);
  });

  it('a rate-limited add returns 0 and tells nobody', () => {
    const r = make();
    const on = vi.fn();
    r.on(on);
    r.add({ kind: 'bail_into', who: 'Z' });
    expect(r.add({ kind: 'bail_into', who: 'Z' })).toBe(0);
    expect(on).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes', () => {
    const r = make();
    const on = vi.fn();
    const off = r.on(on);
    off();
    r.add({ kind: 'hoops_win' });
    expect(on).not.toHaveBeenCalled();
  });

  it('state() is stable between changes (for useSyncExternalStore)', () => {
    const r = make();
    expect(r.state()).toBe(r.state());
    const before = r.state();
    r.add({ kind: 'hoops_win' });
    expect(r.state()).not.toBe(before);
  });

  it('fires onTier on a tier change, both ways', () => {
    const c = clock();
    const r = make({ now: c.now });
    const tier = vi.fn();
    r.onTier(tier);
    for (let i = 0; i < 7; i++) {
      c.t += 31_000;
      r.add({ kind: 'hoops_win' });
    }
    expect(r.state().tier).toBe('local');
    expect(tier).toHaveBeenCalledWith('local', 'stranger');
    for (let i = 0; i < 4; i++) {
      c.t += 61_000;
      r.add({ kind: 'stole', at: `s${i}`, coin: 1000 });
    }
    expect(r.state().tier).toBe('outcast');
    expect(tier).toHaveBeenCalledWith('stranger', 'local');
    expect(tier).toHaveBeenLastCalledWith('outcast', 'stranger');
  });

  it('persists and restores (versioned key)', () => {
    const s = memStorage();
    const a = make({ storage: s });
    a.add({ kind: 'helped', who: 'Ziggy' });
    expect(JSON.parse(s.data[STORAGE_KEY]!)).toMatchObject({ v: 1, book: { score: 5 } });
    const b = make({ storage: s });
    expect(b.state().score).toBe(5);
    expect(b.state().recent[0]!.label).toBe('helped Ziggy');
    // The restored rate-limit log still applies
    expect(b.add({ kind: 'helped', who: 'Ziggy' })).toBe(0);
  });

  it.each([
    ['not JSON', '{oops'],
    ['wrong version', JSON.stringify({ v: 9, book: { score: 900 } })],
    ['junk book', JSON.stringify({ v: 1, book: 'lots', recent: 'x', pending: 7 })],
    ['null', 'null'],
  ])('a corrupt store (%s) starts fresh', (_n, raw) => {
    const r = make({ storage: memStorage({ [STORAGE_KEY]: raw }) });
    expect(r.state().score).toBe(0);
    expect(r.state().tier).toBe('stranger');
    expect(r.add({ kind: 'hoops_win' })).toBe(8);
  });

  it('survives a storage that throws', () => {
    const bad: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const r = make({ storage: bad });
    expect(r.add({ kind: 'hoops_win' })).toBe(8);
  });

  it('applies the idle drift on load and on tick', () => {
    const s = memStorage();
    const c = clock();
    const a = make({ storage: s, now: c.now });
    for (let i = 0; i < 20; i++) {
      c.t += 31_000;
      a.add({ kind: 'hoops_win' });
    }
    expect(a.state().score).toBeCloseTo(160, 0);
    c.t += HALF_LIFE_MS;
    const b = make({ storage: s, now: c.now });
    expect(b.state().score).toBeCloseTo(105, 0);
    c.t += HALF_LIFE_MS;
    b.tick();
    expect(b.state().score).toBeCloseTo(77.5, 0);
    expect(b.state().tier).toBe('local');
  });

  it('the ticker shows recent changes and notes, then lets them go', () => {
    const c = clock();
    const r = make({ now: c.now });
    r.add({ kind: 'gift', to: 'Nadia', coin: 5 });
    c.t += 100;
    r.note('Ziggy: "Legend!"');
    expect(r.ticker().map(t => t.label)).toEqual(['Ziggy: "Legend!"', 'gave Nadia 5 COIN']);
    c.t += TICKER_MS;
    expect(r.ticker()).toEqual([]);
  });
});

describe('RespectSystem sync', () => {
  function fakeSync(server: { score: number; tier: ServerBook['tier'] }) {
    const posted: PendingEvent[][] = [];
    let fail = false;
    const port: RespectSyncPort = {
      load: async () => ({ ...server, at: T0, known: true }),
      post: async batch => {
        posted.push(batch);
        if (fail) return { book: null, retry: true };
        // The server scores them its own way (here: a flat +1 each)
        server.score += batch.length;
        return { book: { ...server, at: T0, known: true }, retry: false };
      },
    };
    return { port, posted, setFail: (f: boolean) => (fail = f) };
  }

  it('queues events and adopts the server score on flush', async () => {
    const f = fakeSync({ score: 100, tier: 'local' });
    const r = make({ sync: f.port });
    await r.load();
    expect(r.state().score).toBe(100);
    r.add({ kind: 'hoops_win' });
    expect(r.state().score).toBe(108);
    expect(r.queued).toBe(1);
    await r.flush();
    expect(f.posted[0]![0]!.e).toEqual({ kind: 'hoops_win' });
    expect(r.queued).toBe(0);
    // The server's +1 wins over the client's +8
    expect(r.state().score).toBe(101);
  });

  it('keeps the queue on a failed post and resends it', async () => {
    const f = fakeSync({ score: 0, tier: 'stranger' });
    const s = memStorage();
    const r = make({ sync: f.port, storage: s });
    r.add({ kind: 'helped', who: 'a' });
    f.setFail(true);
    await r.flush();
    expect(r.queued).toBe(1);
    // A reload keeps the queue (it was persisted)
    const r2 = make({ sync: f.port, storage: s });
    expect(r2.queued).toBe(1);
    f.setFail(false);
    await r2.flush();
    expect(r2.queued).toBe(0);
    expect(f.posted.at(-1)![0]!.id).toBe(f.posted[0]![0]!.id);
  });

  it('adopting adds what is still queued on top of the server score', async () => {
    const f = fakeSync({ score: 300, tier: 'regular' });
    const r = make({ sync: f.port });
    r.add({ kind: 'hoops_win' });
    await r.load(); // load, then flush: 300 + 1
    expect(r.state().score).toBe(301);
    expect(r.state().tier).toBe('regular');
    expect(r.synced).toBe(true);
  });

  it('a server that refuses a batch outright drops it (no endless resend)', async () => {
    const r = make({
      sync: { load: async () => null, post: async () => ({ book: null, retry: false }) },
    });
    r.add({ kind: 'hoops_win' });
    await r.flush();
    expect(r.queued).toBe(0);
    expect(r.state().score).toBe(8);
  });

  it('local only (no sync): nothing is queued', () => {
    const r = make();
    r.add({ kind: 'hoops_win' });
    expect(r.queued).toBe(0);
  });
});
