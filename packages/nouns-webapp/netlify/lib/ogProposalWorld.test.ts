import { afterEach, describe, expect, it, vi } from 'vitest';

import { handler, WORLD_FRAME_ANCESTORS } from '../functions/og-proposal';

const SHELL =
  '<!doctype html><html><head><title>Nouns DAO</title></head><body><div id="root"></div></body></html>';

function stubShell(ok = true) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(String(url));
    return ok ? new Response(SHELL, { status: 200 }) : new Response('', { status: 500 });
  });
  return calls;
}

/** The JSON inside a meta tag, attribute-unescaped. */
function metaJson(html: string, name: string) {
  const m = new RegExp(`<meta name="${name}" content="([^"]+)"`).exec(html);
  expect(m).not.toBeNull();
  return JSON.parse(m![1]!.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
}

afterEach(() => vi.unstubAllGlobals());

describe('og-proposal: /world and play-as links', () => {
  it('unfurls a play-as link as the rider, with the Farcaster embed, in the SPA shell', async () => {
    const calls = stubShell();
    const res = await handler({
      path: '/world',
      rawUrl: 'https://noun.wtf/world?seed=0-1-2-3-4-m&name=zed',
      queryStringParameters: { seed: '0-1-2-3-4-m', name: 'zed' },
    });
    expect(res.statusCode).toBe(200);
    expect(calls).toContain('https://noun.wtf/index.html');
    expect(res.body).toContain('<div id="root"></div>');
    expect(res.body).toContain(
      '<meta property="og:image" content="https://noun.wtf/og/world/0-1-2-3-4-m.png" />',
    );
    expect(res.body).toContain('Play as zed in Noun World');
    const fc = metaJson(res.body, 'fc:miniapp');
    expect(fc.version).toBe('1');
    expect(fc.imageUrl).toBe('https://noun.wtf/og/world/fc/0-1-2-3-4-m.png');
    expect(fc.button.title).toBe('PLAY AS ME');
    expect(fc.button.action).toMatchObject({
      type: 'launch_miniapp',
      url: 'https://noun.wtf/world?seed=0-1-2-3-4-m&name=zed',
    });
    expect(metaJson(res.body, 'fc:frame').button.action.type).toBe('launch_frame');
    // Farcaster's web client frames mini apps; the cache keys on the rider
    expect(res.headers['Content-Security-Policy']).toContain(WORLD_FRAME_ANCESTORS);
    expect(res.headers['Netlify-Vary']).toBe('query=seed|name');
  });

  it('plain /world gets the game card; the dev site serves its own shell', async () => {
    const calls = stubShell();
    const res = await handler({ path: '/world', rawUrl: 'https://dev-noun-wtf.netlify.app/world' });
    expect(calls).toContain('https://dev-noun-wtf.netlify.app/index.html');
    expect(res.body).toContain('https://noun.wtf/fc/world-og.png');
    expect(metaJson(res.body, 'fc:miniapp').button.action.url).toBe('https://noun.wtf/world');
  });

  it('a bad seed falls back to the game card, a missing shell still answers with tags and retries', async () => {
    stubShell(false);
    const res = await handler({ path: '/world', queryStringParameters: { seed: '<script>' } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('<script>');
    expect(res.body).toContain('fc:miniapp');
    expect(res.body).toContain('http-equiv="refresh"');
  });

  it('leaves other pages framed by noun.wtf only', async () => {
    stubShell();
    const res = await handler({ path: '/noun/1' });
    expect(res.headers['Content-Security-Policy']).toBeUndefined();
    expect(res.body).not.toContain('fc:miniapp');
  });
});
