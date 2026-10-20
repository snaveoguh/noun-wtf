// ── Noun World service worker (installed app + offline shell) ────────────
//
// Built per deploy by vite/worldPwa.ts into /world-sw.js (scope /world): the
// plugin transpiles this file, drops the `export`s, defines BUILD (this
// deploy's id) and PRECACHE (the app shell + the world2 chunks) and calls
// start(self). Nothing here runs at import time, so tests can import it.
//
// Never serves stale code after a deploy:
//   - pages (navigations) are network-first; the cached shell is only the
//     offline fallback,
//   - /assets/* are content-hashed by Vite, so cache-first is safe. They live
//     in one long-lived cache (not per deploy), so a tab still running an old
//     build can lazy-load its own chunks after Netlify drops them,
//   - a new deploy ships a new /world-sw.js (BUILD changes), which installs,
//     precaches, takes over and deletes the old shell cache.
// Never touched: other origins (PartyKit, RPCs, YouTube), non-GET, Range
// requests (audio seeking), Netlify functions and API proxies.

export type Route = 'skip' | 'page' | 'immutable' | 'asset';

/** Same-origin paths the worker must never cache. */
const LIVE = ['/.netlify/', '/api/', '/pooter-api/', '/world-sw.js'];
/** Static game files: cache, refresh in the background. */
const ASSET_DIRS = ['/world2/', '/world-app/', '/fonts/', '/sounds/', '/audio/'];

export function routeOf(
  url: URL,
  origin: string,
  method: string,
  mode: string,
  range: boolean,
): Route {
  if (method !== 'GET' || range || url.origin !== origin) return 'skip';
  const p = url.pathname;
  if (LIVE.some(x => p.startsWith(x))) return 'skip';
  if (mode === 'navigate') return 'page';
  if (p.startsWith('/assets/')) return 'immutable';
  if (ASSET_DIRS.some(x => p.startsWith(x))) return 'asset';
  return 'skip';
}

/** Keep the long-lived chunk cache from growing forever (oldest out first). */
export const MAX_IMMUTABLE = 600;
export const MAX_ASSETS = 400;
export const SHELL_URL = '/world';

export function cacheNames(build: string) {
  return { shell: `nw-shell-${build}`, immutable: 'nw-immutable', assets: 'nw-assets' };
}

/** Caches a new worker should delete on activate. */
export function staleCaches(keys: string[], build: string): string[] {
  const keep = new Set(Object.values(cacheNames(build)));
  return keys.filter(k => k.startsWith('nw-') && !keep.has(k));
}

interface SwScope {
  location: { origin: string };
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: string, fn: (e: never) => void): void;
}

interface FetchLike extends Event {
  request: Request;
  respondWith(r: Promise<Response>): void;
}

interface Extendable extends Event {
  waitUntil(p: Promise<unknown>): void;
}

async function trim(name: string, max: number) {
  const c = await caches.open(name);
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await c.delete(k);
}

export function start(sw: SwScope, build: string, precache: string[]) {
  const names = cacheNames(build);

  sw.addEventListener('install', (e: Extendable) => {
    e.waitUntil(
      (async () => {
        const shell = await caches.open(names.shell);
        const imm = await caches.open(names.immutable);
        // one by one: a missing file must not fail the whole install
        await Promise.all([
          shell.add(new Request(SHELL_URL, { cache: 'reload' })).catch(() => undefined),
          ...precache.map(u =>
            imm.match(u).then(hit => (hit ? undefined : imm.add(u).catch(() => undefined))),
          ),
        ]);
        await sw.skipWaiting();
      })(),
    );
  });

  sw.addEventListener('activate', (e: Extendable) => {
    e.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(staleCaches(keys, build).map(k => caches.delete(k)));
        await sw.clients.claim();
      })(),
    );
  });

  sw.addEventListener('fetch', (e: FetchLike) => {
    const req = e.request;
    const route = routeOf(
      new URL(req.url),
      sw.location.origin,
      req.method,
      req.mode,
      req.headers.has('range'),
    );
    if (route === 'skip') return;

    if (route === 'page') {
      e.respondWith(
        fetch(req)
          .then(r => {
            if (r.ok) {
              const copy = r.clone();
              void caches.open(names.shell).then(c => c.put(SHELL_URL, copy));
            }
            return r;
          })
          .catch(async () => (await caches.match(SHELL_URL)) ?? Response.error()),
      );
      return;
    }

    if (route === 'immutable') {
      e.respondWith(
        caches.match(req).then(
          hit =>
            hit ??
            fetch(req).then(r => {
              if (r.ok) {
                const copy = r.clone();
                void caches
                  .open(names.immutable)
                  .then(c => c.put(req, copy))
                  .then(() => trim(names.immutable, MAX_IMMUTABLE));
              }
              return r;
            }),
        ),
      );
      return;
    }

    // static game files: stale-while-revalidate
    e.respondWith(
      caches.match(req).then(hit => {
        const fresh = fetch(req)
          .then(r => {
            if (r.ok && r.status === 200) {
              const copy = r.clone();
              void caches
                .open(names.assets)
                .then(c => c.put(req, copy))
                .then(() => trim(names.assets, MAX_ASSETS));
            }
            return r;
          })
          .catch(() => hit ?? Response.error());
        return hit ?? fresh;
      }),
    );
  });
}
