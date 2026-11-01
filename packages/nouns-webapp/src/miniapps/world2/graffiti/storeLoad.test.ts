import { afterEach, describe, expect, it, vi } from 'vitest';

import { prefetchWalls, STORE_BATCH, takePrefetched } from './storeLoad';

const wall = (i: number) => `plaza|0,0,1|${i}|0|0`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('graffiti prefetch', () => {
  it('reads the index, then every wall, and hands them over once', async () => {
    const ids = Array.from({ length: STORE_BATCH + 5 }, (_, i) => wall(i));
    const fetch = vi.fn(async (url: string) => {
      const q = new URL(url, 'https://x').searchParams.get('ids');
      const body =
        q === null
          ? { walls: ids }
          : {
              walls: Object.fromEntries(
                (JSON.parse(q) as string[])
                  .filter(id => id !== wall(3))
                  .map(id => [id, [`tag:${id}`]]),
              ),
            };
      return { ok: true, json: async () => body } as Response;
    });
    vi.stubGlobal('fetch', fetch);
    prefetchWalls('plaza-test', { x: 0, y: 0, z: 0 });
    prefetchWalls('plaza-test', { x: 0, y: 0, z: 0 }); // once per level
    const pre = takePrefetched('plaza-test')!;
    expect(pre).not.toBeNull();
    expect(takePrefetched('plaza-test')).toBeNull();
    expect(await pre.index).toEqual(ids);
    expect(pre.walls.size).toBe(ids.length);
    expect(await pre.walls.get(wall(0))).toEqual({ tags: [`tag:${wall(0)}`] });
    // a wall the store had nothing for: fetched, empty
    expect(await pre.walls.get(wall(3))).toEqual({ tags: [] });
    // the index once + two batches
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('a batch that fails leaves its walls null (the game fetches them again)', async () => {
    vi.useFakeTimers();
    const ids = [wall(1), wall(2)];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('&ids=')
          ? ({ ok: false } as Response)
          : ({ ok: true, json: async () => ({ walls: ids }) } as Response),
      ),
    );
    prefetchWalls('plaza-fail', { x: 0, y: 0, z: 0 });
    const pre = takePrefetched('plaza-fail')!;
    await pre.index;
    const got = pre.walls.get(wall(1))!;
    await vi.runAllTimersAsync(); // the retries' backoff
    expect(await got).toBeNull();
  });
});
