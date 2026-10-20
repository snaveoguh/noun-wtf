import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isIosSafari, isStandalone } from './install';
import { buildId, worldPrecache, type BundleItem } from './precache';
import { cacheNames, routeOf, staleCaches } from './sw';

const O = 'https://noun.wtf';
const r = (
  p: string,
  o: { method?: string; mode?: string; range?: boolean; origin?: string } = {},
) => routeOf(new URL(p, o.origin ?? O), O, o.method ?? 'GET', o.mode ?? 'cors', o.range ?? false);

describe('service worker routes', () => {
  it('pages are network-first (never a stale shell while online)', () => {
    expect(r('/world', { mode: 'navigate' })).toBe('page');
    expect(r('/world?spot=beach', { mode: 'navigate' })).toBe('page');
  });

  it('hashed Vite chunks are cache-first; game files stale-while-revalidate', () => {
    expect(r('/assets/World2Page-abc123.js')).toBe('immutable');
    expect(r('/world2/level/plaza.glb')).toBe('asset');
    expect(r('/world2/fm/songs/manifest.json')).toBe('asset');
    expect(r('/world-app/icons/icon-192.png')).toBe('asset');
  });

  it('never touches live traffic, other origins, non-GET or Range requests', () => {
    expect(r('/.netlify/functions/world-trade')).toBe('skip');
    expect(r('/api/thing')).toBe('skip');
    expect(r('/pooter-api/x')).toBe('skip');
    expect(r('/world-sw.js')).toBe('skip');
    expect(r('/assets/x.js', { method: 'POST' })).toBe('skip');
    expect(r('/world2/fm/songs/a.mp3', { range: true })).toBe('skip');
    expect(r('/parties/main/room', { origin: 'https://noun-party.partykit.dev' })).toBe('skip');
    expect(r('/world', { mode: 'navigate', origin: 'https://www.youtube.com' })).toBe('skip');
    // other site files aren't the game's to cache
    expect(r('/logo512.png')).toBe('skip');
  });

  it('a new build drops the old shell cache but keeps the chunk caches', () => {
    const old = cacheNames('aaa');
    const keys = [old.shell, old.immutable, old.assets, 'stupidfont-v3', 'nw-shell-bbb'];
    expect(staleCaches(keys, 'bbb')).toEqual([old.shell]);
  });

  it('sw.ts has no top-level side effects (the plugin only strips exports and calls start)', () => {
    const src = readFileSync(path.resolve(__dirname, 'sw.ts'), 'utf8');
    expect(src).not.toMatch(/^self\./m);
    expect(src).not.toMatch(/^(addEventListener|start)\(/m);
    // the plugin removes `export` before declarations only
    for (const m of src.matchAll(/^export\s+(\w+)/gm))
      expect(['function', 'const', 'type', 'interface']).toContain(m[1]);
  });
});

describe('precache list', () => {
  const css = (...f: string[]) => ({ importedCss: new Set(f) });
  const bundle: Record<string, BundleItem> = {
    'assets/index-1.js': {
      type: 'chunk',
      fileName: 'assets/index-1.js',
      isEntry: true,
      imports: ['assets/vendor-2.js'],
      viteMetadata: css('assets/index-1.css'),
    },
    'assets/vendor-2.js': { type: 'chunk', fileName: 'assets/vendor-2.js', imports: [] },
    'assets/World2Page-3.js': {
      type: 'chunk',
      fileName: 'assets/World2Page-3.js',
      facadeModuleId: '/repo/packages/nouns-webapp/src/miniapps/world2/World2Page.tsx',
      imports: ['assets/three-4.js', 'assets/vendor-2.js'],
      viteMetadata: css('assets/World2Page-3.css'),
    },
    'assets/three-4.js': { type: 'chunk', fileName: 'assets/three-4.js', imports: [] },
    'assets/Warfare-5.js': {
      type: 'chunk',
      fileName: 'assets/Warfare-5.js',
      facadeModuleId: '/repo/src/miniapps/warfare/WarfarePage.tsx',
    },
    'assets/index-1.css': { type: 'asset', fileName: 'assets/index-1.css' },
  };

  it('is the entry + the World2Page chunk and their static imports, not other games', () => {
    expect(worldPrecache(bundle)).toEqual([
      '/assets/World2Page-3.css',
      '/assets/World2Page-3.js',
      '/assets/index-1.css',
      '/assets/index-1.js',
      '/assets/three-4.js',
      '/assets/vendor-2.js',
    ]);
  });

  it('build id changes with the files', () => {
    const a = worldPrecache(bundle);
    expect(buildId(a)).toBe(buildId([...a]));
    expect(buildId(a)).not.toBe(buildId([...a, '/assets/new-6.js']));
  });
});

describe('install helpers', () => {
  const safari =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  it('spots iOS Safari (incl. iPadOS desktop UA), not other iOS browsers or desktop', () => {
    expect(isIosSafari(safari, 5)).toBe(true);
    expect(
      isIosSafari(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        5,
      ),
    ).toBe(true);
    expect(
      isIosSafari(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        0,
      ),
    ).toBe(false);
    expect(isIosSafari(safari.replace('Version/18.0', 'CriOS/130.0'), 5)).toBe(false);
  });

  it('knows when it already runs as an app', () => {
    const w = (modes: string[], standalone?: boolean) => ({
      matchMedia: (q: string) => ({ matches: modes.some(m => q.includes(m)) }) as MediaQueryList,
      navigator: { standalone } as unknown as Navigator,
    });
    expect(isStandalone(w([]))).toBe(false);
    expect(isStandalone(w(['fullscreen']))).toBe(true);
    expect(isStandalone(w([], true))).toBe(true);
  });
});
