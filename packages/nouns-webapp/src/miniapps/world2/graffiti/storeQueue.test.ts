import { describe, expect, it } from 'vitest';

import { type Outbox, type PostResult, type QueuedTag, StoreQueue } from './storeQueue';

const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('StoreQueue', () => {
  it('sends one tag at a time, in order', async () => {
    const inFlight: QueuedTag[] = [];
    const done: string[] = [];
    const gate: { release: (() => void) | null } = { release: null };
    const q = new StoreQueue(
      t =>
        new Promise<PostResult>(r => {
          inFlight.push(t);
          gate.release = () => {
            inFlight.splice(inFlight.indexOf(t), 1);
            done.push(t.data);
            r('ok');
          };
        }),
    );
    q.push('a', 'g3:1');
    q.push('b', 'g3:2');
    q.push('a', 'g3:3');
    await tick();
    expect(inFlight).toHaveLength(1);
    for (let i = 0; i < 3; i++) {
      gate.release!();
      await tick();
    }
    expect(done).toEqual(['g3:1', 'g3:2', 'g3:3']);
    expect(q.pending).toBe(0);
  });

  it('retries a busy or failed write instead of dropping it', async () => {
    const answers: (PostResult | Error)[] = ['retry', new Error('offline'), 'ok'];
    const tries: string[] = [];
    const waits: number[] = [];
    const q = new StoreQueue(
      async t => {
        tries.push(t.data);
        const a = answers.shift()!;
        if (a instanceof Error) throw a;
        return a;
      },
      async ms => {
        waits.push(ms);
      },
    );
    q.push('a', 'g3:1');
    await tick();
    expect(tries).toEqual(['g3:1', 'g3:1', 'g3:1']);
    expect(waits.length).toBe(2);
    expect(waits[1]).toBeGreaterThan(waits[0]);
    expect(q.pending).toBe(0);
  });

  it('gives up on a refused tag and after too many tries', async () => {
    const tries: string[] = [];
    const q = new StoreQueue(
      async t => {
        tries.push(t.data);
        return t.data === 'bad' ? 'drop' : 'retry';
      },
      async () => undefined,
      3,
    );
    q.push('a', 'bad');
    q.push('a', 'flaky');
    await tick();
    expect(tries).toEqual(['bad', 'flaky', 'flaky', 'flaky']);
    expect(q.pending).toBe(0);
  });

  it('skips a tag already waiting to go', async () => {
    const tries: string[] = [];
    const gate: { release: (() => void) | null } = { release: null };
    const q = new StoreQueue(
      t =>
        new Promise<PostResult>(r => {
          tries.push(t.data);
          gate.release = () => r('ok');
        }),
    );
    q.push('a', 'g3:1');
    q.push('a', 'g3:2');
    q.push('a', 'g3:2');
    for (let i = 0; i < 3; i++) {
      await tick();
      gate.release?.();
    }
    await tick();
    expect(tries).toEqual(['g3:1', 'g3:2']);
  });

  describe('outbox (paint survives a closed tab or an outage)', () => {
    const memOutbox = (start: QueuedTag[] = []) => {
      let saved = JSON.stringify(start);
      const box: Outbox & { now: () => QueuedTag[] } = {
        load: () => JSON.parse(saved) as QueuedTag[],
        save: t => {
          saved = JSON.stringify(t);
        },
        now: () => JSON.parse(saved) as QueuedTag[],
      };
      return box;
    };

    it('saves a tag before sending and clears it once stored', async () => {
      const box = memOutbox();
      const gate: { release: (() => void) | null } = { release: null };
      const q = new StoreQueue(
        () =>
          new Promise<PostResult>(r => {
            gate.release = () => r('ok');
          }),
        async () => undefined,
        5,
        box,
      );
      q.push('a', 'g3:1');
      await tick();
      expect(box.now()).toEqual([{ wallId: 'a', data: 'g3:1' }]);
      gate.release!();
      await tick();
      expect(box.now()).toEqual([]);
    });

    it('keeps a tag that kept failing for the next visit, and that visit sends it', async () => {
      const box = memOutbox();
      const first = new StoreQueue(
        async () => 'retry',
        async () => undefined,
        3,
        box,
      );
      first.push('a', 'g3:lost?');
      await tick();
      expect(first.pending).toBe(0);
      expect(box.now()).toEqual([{ wallId: 'a', data: 'g3:lost?' }]);

      const sent: string[] = [];
      const next = new StoreQueue(
        async t => {
          sent.push(t.data);
          return 'ok';
        },
        async () => undefined,
        3,
        box,
      );
      next.restore();
      await tick();
      expect(sent).toEqual(['g3:lost?']);
      expect(box.now()).toEqual([]);
    });

    it('forgets a tag the store refused for good', async () => {
      const box = memOutbox();
      const q = new StoreQueue(
        async () => 'drop',
        async () => undefined,
        3,
        box,
      );
      q.push('a', 'bad');
      await tick();
      expect(box.now()).toEqual([]);
    });

    it('ignores junk in a saved outbox', async () => {
      const box = memOutbox([
        { wallId: 'a', data: 'g3:1' },
        null as unknown as QueuedTag,
        { wallId: 3 } as unknown as QueuedTag,
      ]);
      const sent: string[] = [];
      const q = new StoreQueue(
        async t => {
          sent.push(t.data);
          return 'ok';
        },
        async () => undefined,
        3,
        box,
      );
      q.restore();
      await tick();
      expect(sent).toEqual(['g3:1']);
    });
  });
});
