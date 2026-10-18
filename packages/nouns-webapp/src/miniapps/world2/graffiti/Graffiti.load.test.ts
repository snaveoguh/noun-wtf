import type { CollisionWorld } from '../physics/Collision';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Graffiti, type GraffitiNet } from './Graffiti';
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
});
