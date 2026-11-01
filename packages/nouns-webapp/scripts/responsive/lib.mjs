// Pure parts of the responsive width harness: widths, routes, scoring.
// No browser, no fs: imported by harness.mjs and by lib.test.mjs (vitest).

/** The 13 widths every route is checked at, in both modes. */
export const WIDTHS = [320, 360, 390, 430, 520, 640, 768, 900, 1024, 1280, 1440, 1920, 2560];

/** Container tier edges; must match src/lib/responsive/breakpoints.ts (the test checks). */
export const TIERS = { sm: 400, md: 560, lg: 760, xl: 1024, '2xl': 1440 };

/** Page mode: viewports under this are touch devices (isMobile + hasTouch, tap-target check). */
export const TOUCH_BELOW = 768;

/** Minimum tap target on touch, CSS px. */
export const MIN_TAP = 40;

export function tierOf(width) {
  let t = 'xs';
  for (const [name, px] of Object.entries(TIERS)) if (width >= px) t = name;
  return t;
}

/** A realistic viewport height for a page-mode width. */
export function viewportFor(width) {
  const heights = {
    320: 568,
    360: 740,
    390: 844,
    430: 932,
    520: 900,
    640: 960,
    768: 1024,
    900: 1000,
    1024: 768,
    1280: 800,
    1440: 900,
    1920: 1080,
    2560: 1440,
  };
  return { width, height: heights[width] ?? Math.round(Math.max(700, width * 0.6)) };
}

/**
 * Window mode: the desktop a navigator window of `width` sits on. A window
 * keeps 12 px clear of each screen edge (osStore clampRect), so widths up to
 * 1416 go on a 1440 × 1000 desktop and wider ones on a 2600 × 1440 one.
 */
export function desktopFor(width) {
  return width + 24 <= 1440 ? { width: 1440, height: 1000 } : { width: 2600, height: 1440 };
}

/** The navigator's rect for a window-mode shot (fits osStore's clamp). */
export function windowRect(width, desktop = desktopFor(width)) {
  return { x: 12, y: 12, w: width, h: desktop.height - 120 };
}

// ── Routes ──────────────────────────────────────────────────────────────

/**
 * Every route in App.tsx's <SiteRoutes>, with a sample URL. `kind`:
 *   page      opens in the navigator window (both modes)
 *   home      the NounOS homescreen, no window (page mode only)
 * A route can appear more than once with query variants (`/probe?tab=lils`).
 * `settle`: the most ms to wait for the network to go quiet after load, for a
 * route whose data is slow (the harness takes the larger of this and --settle).
 * Redirect-only routes are listed in REDIRECTS; the test checks the two lists
 * cover every `path=` in App.tsx, so a new route can't be forgotten.
 */
export const ROUTES = [
  { path: '/', url: '/', kind: 'home', group: 'home' },
  { path: 'noun/:id', url: '/noun/2062', group: 'auction' },
  { path: 'v2', url: '/v2', group: 'auction' },
  { path: 'v2/noun/:id', url: '/v2/noun/1', group: 'auction' },
  { path: 'nounders', url: '/nounders', group: 'info' },
  { path: 'create-proposal', url: '/create-proposal', group: 'governance-create' },
  { path: 'create-candidate', url: '/create-candidate', group: 'governance-create' },
  { path: 'vote', url: '/vote', group: 'governance' },
  { path: 'vote/:id', url: '/vote/1000', group: 'governance' },
  { path: 'vote/:id/history', url: '/vote/1000/history', group: 'governance' },
  { path: 'vote/:id/history/:versionNumber', url: '/vote/1000/history/1', group: 'governance' },
  { path: 'vote/:id/edit', url: '/vote/1000/edit', group: 'governance-create' },
  { path: 'candidates', url: '/candidates', group: 'governance', settle: 15000 },
  {
    path: 'candidates/*',
    url: '/candidates/0x0000000000000000000000000000000000000000-sample',
    group: 'governance',
  },
  { path: 'candidates/:id/edit', url: '/candidates/sample/edit', group: 'governance-create' },
  { path: 'playground', url: '/playground', group: 'tools' },
  { path: 'grants', url: '/grants', group: 'grants' },
  { path: 'grants/create', url: '/grants/create', group: 'grants' },
  { path: 'grants/:id', url: '/grants/1', group: 'grants' },
  { path: 'nounv2', url: '/nounv2', group: 'nounv2' },
  { path: 'nounv2/create', url: '/nounv2/create', group: 'nounv2' },
  { path: 'nounv2/:id', url: '/nounv2/1', group: 'nounv2' },
  { path: 'hackathons', url: '/hackathons', group: 'info' },
  { path: 'underground', url: '/underground', group: 'info' },
  { path: 'delegate', url: '/delegate', group: 'governance' },
  { path: 'traits', url: '/traits', group: 'art' },
  { path: 'cc0', url: '/cc0', group: 'art' },
  { path: 'probe', url: '/probe', group: 'explore' },
  // /probe's other tabs (?tab=) render different grids and menus
  ...['dreams', 'lils', 'borgs', 'bitnouns', 'terraforms', 'v2'].map(tab => ({
    path: 'probe',
    url: `/probe?tab=${tab}`,
    group: 'explore',
  })),
  { path: 'studio', url: '/studio', group: 'tools' },
  { path: 'settlers', url: '/settlers', group: 'stats' },
  { path: 'gas', url: '/gas', group: 'stats' },
  { path: 'stats', url: '/stats', group: 'stats' },
  { path: 'dashboard', url: '/dashboard', group: 'stats' },
  { path: 'nonsense', url: '/nonsense', group: 'stats' },
  { path: 'onchain', url: '/onchain', group: 'stats' },
  { path: 'explore/wallet', url: '/explore/wallet', group: 'wallet' },
  { path: 'explore/wallet/:identity', url: '/explore/wallet/nouns.eth', group: 'wallet' },
  { path: 'gamer', url: '/gamer', group: 'wallet' },
  { path: 'gamer/:identity', url: '/gamer/nouns.eth', group: 'wallet' },
  { path: 'crystal-ball', url: '/crystal-ball', group: 'auction' },
  { path: 'v2/crystal-ball', url: '/v2/crystal-ball', group: 'auction' },
  { path: 'feed', url: '/feed', group: 'explore' },
  { path: 'highway', url: '/highway', group: 'explore' },
  { path: 'terraforms', url: '/terraforms', group: 'art' },
  { path: 'terraforms/:id', url: '/terraforms/1', group: 'art' },
  { path: 'pip3', url: '/pip3', group: 'art' },
  { path: 'predictions', url: '/predictions', group: 'explore' },
  { path: 'marketplace', url: '/marketplace', group: 'marketplace' },
  { path: 'marketplace/:nounId', url: '/marketplace/1', group: 'marketplace' },
  { path: 'icecreamvan', url: '/icecreamvan', group: 'world' },
  { path: 'world/voice', url: '/world/voice', group: 'world' },
  { path: 'books/meme-value', url: '/books/meme-value', group: 'art' },
  { path: 'exchange', url: '/exchange', group: 'world' },
  { path: '*', url: '/this-page-does-not-exist', group: 'info' },
].map(r => ({ kind: 'page', ...r }));

/** Routes that only redirect (nothing to lay out). */
export const REDIRECTS = [
  'auction/:id',
  'explore',
  'nouns',
  'dreams',
  'dreams/create',
  'memevalue',
];

/** Route paths declared in App.tsx's SiteRoutes (string literals + the wallet alias array). */
export function routePathsFromApp(source) {
  const start = source.indexOf('function SiteRoutes');
  const end = source.indexOf('</Routes>', start);
  const body = start >= 0 && end > start ? source.slice(start, end) : source;
  const paths = new Set();
  for (const m of body.matchAll(/<Route\s+index\b/g)) if (m) paths.add('/');
  for (const m of body.matchAll(/path="([^"]+)"/g)) paths.add(m[1]);
  // {['explore/wallet', 'explore/wallet/:identity', ...].map(path => <Route path={path} …
  for (const m of body.matchAll(/\{\[([^\]]+)\]\.map\(\s*path\s*=>/g)) {
    for (const p of m[1].matchAll(/'([^']+)'/g)) paths.add(p[1]);
  }
  return [...paths];
}

/** How long to let `url` settle after load: the larger of the CLI default and the route's own. */
export function settleFor(url, fallback) {
  return Math.max(fallback, routeFor(url).settle ?? 0);
}

/** Folder name for a route URL: '/noun/2062?sections=heroTools' → 'noun-2062--sections-heroTools'. */
export function slugFor(url) {
  const [path, query] = url.split('?');
  const p = path.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9]+/g, '-') || 'home';
  const q = query ? '--' + query.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-+$/, '') : '';
  return (p + q).slice(0, 80);
}

/** Which route entry a URL belongs to (exact sample URL, else first path pattern that matches). */
export function routeFor(url) {
  const path = url.split('?')[0];
  const exact = ROUTES.find(r => r.url === url) ?? ROUTES.find(r => r.url === path);
  if (exact) return exact;
  const segs = path.replace(/^\/+/, '').split('/');
  for (const r of ROUTES) {
    if (r.path === '*' || r.path === '/') continue;
    const ps = r.path.split('/');
    if (ps[ps.length - 1] === '*' ? segs.length >= ps.length : ps.length === segs.length) {
      if (ps.every((p, i) => p === '*' || p.startsWith(':') || p === segs[i])) return r;
    }
  }
  return { path, url: path, kind: path === '/' ? 'home' : 'page', group: 'adhoc' };
}

// ── Scoring ─────────────────────────────────────────────────────────────

/**
 * Turn one shot's raw in-page collection (inpage.mjs `collect`) into issues.
 * `touch`: the shot is a touch device, so small tap targets count.
 */
export function analyse(raw, { touch = false } = {}) {
  if (!raw || raw.error) {
    return { error: raw?.error ?? 'no data', score: 0, counts: {}, issues: {} };
  }
  const c = raw.content;
  const overflowPx = Math.max(0, Math.round(c.scrollWidth - c.clientWidth));
  const overflow =
    overflowPx > 1
      ? { px: overflowPx, offenders: (raw.overflowOffenders ?? []).slice(0, 8) }
      : null;

  const clipped = dedupe(raw.clipped ?? [], x => `${x.selector}|${x.text ?? ''}`);
  const covered = dedupe(raw.covered ?? [], x => x.selector);
  const overArt = dedupe(raw.overArt ?? [], x => x.selector);
  const overlaps = dedupe(raw.overlaps ?? [], x => [x.a, x.b].sort().join('|'));
  const small = touch ? smallTargets(raw.controls ?? []) : [];

  const counts = {
    overflowPx,
    clipped: clipped.length,
    covered: covered.length,
    overArt: overArt.length,
    overlaps: overlaps.length,
    smallTargets: small.length,
  };
  return {
    counts,
    score: scoreOf(counts),
    issues: { overflow, clipped, covered, overArt, overlaps, smallTargets: small.slice(0, 20) },
  };
}

/** Controls under MIN_TAP on either side, excluding links inside running text. */
export function smallTargets(controls) {
  return controls
    .filter(k => !k.inlineInText && !k.hidden)
    .filter(k => k.w < MIN_TAP || k.h < MIN_TAP)
    .map(k => ({ selector: k.selector, w: Math.round(k.w), h: Math.round(k.h), label: k.label }));
}

/** Severity of one shot. 0 = clean. Weights favour what breaks a page outright. */
export function scoreOf(k) {
  let s = 0;
  if (k.overflowPx > 1) s += 8 + Math.min(12, k.overflowPx / 25);
  s += 3 * Math.min(k.clipped ?? 0, 6);
  s += 4 * Math.min(k.covered ?? 0, 5);
  s += 1.5 * Math.min(k.overArt ?? 0, 4);
  s += 2 * Math.min(k.overlaps ?? 0, 5);
  s += 0.3 * Math.min(k.smallTargets ?? 0, 30);
  return Math.round(s * 10) / 10;
}

/** Route severity: the mean shot score, plus the worst shots for context. */
export function routeSeverity(shots) {
  const ok = shots.filter(s => !s.error);
  if (ok.length === 0)
    return { score: 0, worst: [], clean: 0, total: shots.length, errors: shots.length };
  const mean = ok.reduce((a, s) => a + s.score, 0) / ok.length;
  const worst = [...ok]
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => `${s.mode}@${s.width}:${s.score}`);
  return {
    score: Math.round(mean * 10) / 10,
    worst,
    clean: ok.filter(s => s.score === 0).length,
    total: shots.length,
    errors: shots.length - ok.length,
  };
}

/** One-line description of the issues in a shot, for reports and the contact sheet. */
export function issueLine(counts) {
  if (!counts) return 'error';
  const bits = [];
  if (counts.overflowPx > 1) bits.push(`overflow ${counts.overflowPx}px`);
  if (counts.clipped) bits.push(`${counts.clipped} clipped`);
  if (counts.covered) bits.push(`${counts.covered} covered`);
  if (counts.overArt) bits.push(`${counts.overArt} on art`);
  if (counts.overlaps) bits.push(`${counts.overlaps} overlaps`);
  if (counts.smallTargets) bits.push(`${counts.smallTargets} small taps`);
  return bits.length ? bits.join(' · ') : 'clean';
}

function dedupe(list, key) {
  const seen = new Set();
  return list.filter(x => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
