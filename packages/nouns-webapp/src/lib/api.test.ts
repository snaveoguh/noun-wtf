import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_BASE, apiFetch } from './api';

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches API_BASE + path and returns parsed JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch<{ ok: number }>('/api/thing')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith(`${API_BASE}/api/thing`, undefined);
  });

  it('throws with the status on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503 })));
    await expect(apiFetch('/api/thing')).rejects.toThrow('503');
  });

  it('API_BASE never ends in /graphql', () => {
    expect(API_BASE).not.toMatch(/\/graphql\/?$/);
    expect(API_BASE.length).toBeGreaterThan(0);
  });
});
