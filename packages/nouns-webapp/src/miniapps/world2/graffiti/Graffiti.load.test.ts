import type { CollisionWorld } from '../physics/Collision';

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Graffiti, type GraffitiNet } from './Graffiti';
import { FAR_W } from './lod';
import { encodeStrokes, type Stroke } from './strokes';

// What a visitor sees on arrival: the permanent store's copy of a wall
// merged with what PartyKit holds for it, without anyone spraying.

const WALL = 'plaza|0.00,0.00,-1.00|-38.75|-3|0';

function tag(k: number) {
  const s: Stroke = {
    color: 0x203040 + k,
    r: 40,
    hard: false,
    opacity: 16,
    pts: [100, 200, 900, 1200 + k],
  };
  return encodeStrokes({ id: (0x100000000000 + k).toString(16).slice(-12), strokes: [s] });
}

// jsdom has no 2D canvas: a context whose every call is a no-op
const noopCtx = new Proxy(
  {},
  {
    get: (_t, k) =>
      k === 'createRadialGradient'
        ? () => ({ addColorStop: () => undefined })
        : k === 'getImageData'
          ? () => ({ data: new Uint8ClampedArray(4) })
          : () => undefined,
    set: () => true,
  },
);

/** The store's GETs answer from `stored`; POSTs are recorded. */
function fakeStore(stored: Record<string, string[]>, posts: { wallId: string; data: string }[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return new Response('{"ok":true}', { status: 200 });
    }
    const q = new URL(url, 'http://x').searchParams;
    if (q.get('ids') === null) return Response.json({ walls: Object.keys(stored) });
    const ids = JSON.parse(q.get('ids')!) as string[];
    return Response.json({ walls: Object.fromEntries(ids.map(id => [id, stored[id] ?? []])) });
  });
}

const flushAsync = async () => {
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0));
};

describe('Graffiti: loading a wall on arrival', () => {
  let started: number;
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(noopCtx as never);
    started = Date.now();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('merges PartyKit layers the permanent store missed, and carries them over', async () => {
    // The store kept only the first layer of a piece; PartyKit has all four
    const party = [0, 1, 2, 3].map(k => ({ imageData: tag(k), timestamp: started - 60_000 + k }));
    const posts: { wallId: string; data: string }[] = [];
    vi.stubGlobal('fetch', fakeStore({ [WALL]: [tag(0)] }, posts));

    const loads: string[] = [];
    let g: Graffiti | null = null;
    const net: GraffitiNet = {
      save: () => undefined,
      // PartyKit answers a load with the wall's tags (index buckets are empty)
      load: id => {
        loads.push(id);
        queueMicrotask(() => g?.onTags(id, id === WALL ? party : []));
      },
    };
    g = new Graffiti({} as CollisionWorld, 'plaza', net);
    g.loadAll();
    await flushAsync();

    const cell = g.cells.get(WALL)!;
    expect(cell).toBeDefined();
    expect(loads).toContain(WALL);
    // All four layers are on the wall, nobody sprayed
    expect(cell.log.count).toBe(4);
    // ...and the three the store missed go back into it
    expect(posts.map(p => p.data).sort()).toEqual([tag(1), tag(2), tag(3)].sort());
    expect(posts.every(p => p.wallId === WALL)).toBe(true);
    g.dispose();
  });

  it('asks PartyKit about each wall once per connection', async () => {
    vi.stubGlobal('fetch', fakeStore({ [WALL]: [tag(0)] }, []));
    const loads: string[] = [];
    let g: Graffiti | null = null;
    const net: GraffitiNet = {
      save: () => undefined,
      load: id => {
        loads.push(id);
        // Every index bucket lists the wall too
        if (id.startsWith('w2idx:')) queueMicrotask(() => g?.onTags(id, [{ imageData: WALL }]));
      },
    };
    g = new Graffiti({} as CollisionWorld, 'plaza', net);
    g.loadAll();
    await flushAsync();
    expect(loads.filter(id => id === WALL)).toHaveLength(1);
    // A reconnect asks again (the room may have moved on while we were away)
    g.loadAll();
    await flushAsync();
    expect(loads.filter(id => id === WALL)).toHaveLength(2);
    g.dispose();
  });

  it('loads the store on arrival, before PartyKit ever connects', async () => {
    vi.stubGlobal('fetch', fakeStore({ [WALL]: [tag(0), tag(1)] }, []));
    const loads: string[] = [];
    // The socket never opens: loadAll() is never called
    const g = new Graffiti({} as CollisionWorld, 'plaza', {
      save: () => undefined,
      load: id => loads.push(id),
    });
    await flushAsync();
    expect(g.cells.get(WALL)?.log.count).toBe(2);
    expect(loads).toHaveLength(0);
    g.dispose();
  });

  it('says when the arrival load is done: every listed wall fetched and painted', async () => {
    const OTHER = 'plaza|0.00,0.00,-1.00|-38.75|-2|0';
    vi.stubGlobal('fetch', fakeStore({ [WALL]: [tag(0)], [OTHER]: [tag(1), tag(2)] }, []));
    const g = new Graffiti({} as CollisionWorld, 'plaza', {
      save: () => undefined,
      load: () => undefined,
    });
    expect(g.loadProgress).toEqual({ done: 0, total: null });
    let arrived = false;
    void g.arrived.then(() => (arrived = true));
    await flushAsync();
    expect(arrived).toBe(true);
    expect(g.loadProgress).toEqual({ done: 2, total: 2 });
    // ...and by then the paint is on the walls (the world loader relies on it)
    expect(g.cells.get(WALL)?.log.count).toBe(1);
    expect(g.cells.get(OTHER)?.log.count).toBe(2);
    g.dispose();
  });

  it('offline, it has arrived as soon as the local copy is painted', async () => {
    const g = new Graffiti({} as CollisionWorld, 'plaza', null);
    let arrived = false;
    void g.arrived.then(() => (arrived = true));
    await flushAsync();
    expect(arrived).toBe(true);
    expect(g.loadProgress).toEqual({ done: 0, total: 0 });
    g.dispose();
  });

  it('retries a store read that failed instead of leaving its walls bare', async () => {
    vi.useFakeTimers();
    try {
      const store = fakeStore({ [WALL]: [tag(0), tag(1), tag(2)] }, []);
      let fails = 2;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) => {
          // A cold or busy function: the first two batch reads 502
          if (url.includes('ids=') && fails-- > 0) return new Response('', { status: 502 });
          return store(url, init);
        }),
      );
      const g = new Graffiti({} as CollisionWorld, 'plaza', {
        save: () => undefined,
        load: () => undefined,
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(g.cells.get(WALL)?.log.count).toBe(3);
      g.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks the store again later for walls it still owes', async () => {
    vi.useFakeTimers();
    try {
      const store = fakeStore({ [WALL]: [tag(0)] }, []);
      let down = true;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init?: RequestInit) =>
          down && url.includes('ids=') ? new Response('', { status: 503 }) : store(url, init),
        ),
      );
      const g = new Graffiti({} as CollisionWorld, 'plaza', {
        save: () => undefined,
        load: () => undefined,
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(g.cells.get(WALL)).toBeUndefined();
      // The outage ends: the wall comes up without anyone spraying it
      down = false;
      await vi.advanceTimersByTimeAsync(40_000);
      expect(g.cells.get(WALL)?.log.count).toBe(1);
      g.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('draws a far wall straight away, small, and sharpens it when the rider comes near', async () => {
    vi.stubGlobal('fetch', fakeStore({ [WALL]: [tag(0)] }, []));
    const g = new Graffiti({ raycast: () => null } as unknown as CollisionWorld, 'plaza', {
      save: () => undefined,
      load: () => undefined,
    });
    await flushAsync();
    const cell = g.cells.get(WALL)!;
    expect(cell.log.count).toBe(1);
    // Painted at once, on a small canvas, and queued for upload
    expect(cell.canvas.width).toBe(FAR_W);
    expect(cell.dirty || cell.texture.version > 0).toBe(true);
    const dir = [new THREE.Vector3(0, 0, -1)];
    // From far off it stays small
    const away = cell.mesh.position.clone().add(new THREE.Vector3(0, 0, 200));
    g.update(1 / 60, false, away, dir, away);
    expect(cell.canvas.width).toBe(FAR_W);
    // Walk up to it: full size, redrawn from its log
    const close = cell.mesh.position.clone().add(new THREE.Vector3(0, 0, 10));
    g.update(1, false, close, dir, close);
    expect(cell.canvas.width).toBe(512);
    expect(cell.near).toBe(true);
    g.dispose();
  });
});
