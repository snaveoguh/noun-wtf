// Audius lookups against a mocked public API (the container can't reach it),
// plus the idents' deterministic pick.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUDIUS_APP, audiusHost, audiusStreamUrl, resetAudiusHost, resolveAudius } from './audius';
import { IDENT_KINDS, pickIdent } from './idents';

const json = (body: unknown, ok = true) =>
  Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

beforeEach(() => resetAudiusHost());

describe('Audius', () => {
  it('discovers a host, resolves the permalink, builds a stream url with app_name', async () => {
    const f = vi.fn((url: string) => {
      if (url === 'https://api.audius.co')
        return json({ data: ['https://discovery-a.example.org', 'not a host'] });
      if (url.startsWith('https://discovery-a.example.org/v1/resolve'))
        return json({
          data: { id: 'Ab12c', title: 'Plaza Dub', duration: 187, user: { name: 'Noun DJ' } },
        });
      return json({}, false);
    });
    const t = await resolveAudius('https://audius.co/noundj/plaza-dub', f);
    expect(t).toEqual({ id: 'Ab12c', title: 'Plaza Dub', artist: 'Noun DJ', dur: 187 });
    const resolveUrl = f.mock.calls[1]![0];
    expect(resolveUrl).toContain(`app_name=${AUDIUS_APP}`);
    expect(resolveUrl).toContain(encodeURIComponent('https://audius.co/noundj/plaza-dub'));
    expect(await audiusHost(f)).toBe('https://discovery-a.example.org');
    expect(f).toHaveBeenCalledTimes(2); // host cached
    expect(audiusStreamUrl('https://discovery-a.example.org', 'Ab12c')).toBe(
      `https://discovery-a.example.org/v1/tracks/Ab12c/stream?app_name=${AUDIUS_APP}`,
    );
  });

  it('fails cleanly: unreachable, no hosts, not a track, not streamable', async () => {
    await expect(audiusHost(() => json({}, false))).rejects.toThrow(/unreachable/);
    await expect(audiusHost(() => json({ data: ['http://insecure.example'] }))).rejects.toThrow(
      /unreachable/,
    );
    const f = (data: unknown) => (url: string) =>
      url === 'https://api.audius.co' ? json({ data: ['https://h.example.org'] }) : json({ data });
    resetAudiusHost();
    await expect(resolveAudius('https://audius.co/a/b', f({ kind: 'playlist' }))).rejects.toThrow(
      /not a track/,
    );
    resetAudiusHost();
    await expect(
      resolveAudius('https://audius.co/a/b', f({ id: 'x', is_streamable: false })),
    ).rejects.toThrow(/streamable/);
  });
});

describe('idents', () => {
  it('everyone gets the same ident for a play, and they vary across plays', () => {
    expect(pickIdent('abc:1')).toEqual(pickIdent('abc:1'));
    const kinds = new Set(Array.from({ length: 60 }, (_, i) => pickIdent(`play${i}`).kind));
    expect(kinds.size).toBe(IDENT_KINDS.length);
    const lines = new Set(Array.from({ length: 60 }, (_, i) => pickIdent(`p${i}`).line));
    expect(lines.size).toBeGreaterThan(2);
  });
});
