import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CONTAINER_BREAKPOINTS, tierFor } from '../../src/lib/responsive/breakpoints';

import {
  REDIRECTS,
  ROUTES,
  TIERS,
  WIDTHS,
  analyse,
  desktopFor,
  issueLine,
  routeFor,
  routePathsFromApp,
  routeSeverity,
  scoreOf,
  slugFor,
  smallTargets,
  tierOf,
  windowRect,
} from './lib.mjs';

const appSource = fs.readFileSync(path.resolve(__dirname, '../../src/App.tsx'), 'utf8');

const clean = {
  content: { clientWidth: 390, scrollWidth: 390 },
  overflowOffenders: [],
  clipped: [],
  covered: [],
  overArt: [],
  overlaps: [],
  controls: [{ selector: 'button.bid', w: 300, h: 48, label: 'Bid', inlineInText: false, hidden: false }],
};

describe('tokens', () => {
  it('agree with src/lib/responsive/breakpoints.ts', () => {
    expect(TIERS).toEqual({ ...CONTAINER_BREAKPOINTS });
    for (const w of [0, 320, 399, 400, 559, 560, 620, 759, 760, 1023, 1024, 1439, 1440, 2560]) {
      expect(tierOf(w)).toBe(tierFor(w));
    }
  });

  it('checks 13 widths, ascending, phone to 2560', () => {
    expect(WIDTHS).toHaveLength(13);
    expect([...WIDTHS].sort((a, b) => a - b)).toEqual(WIDTHS);
    expect(WIDTHS[0]).toBe(320);
    expect(WIDTHS[12]).toBe(2560);
  });
});

describe('window mode geometry', () => {
  it('fits every width on a desktop with osStore clamp margins', () => {
    for (const w of WIDTHS) {
      const d = desktopFor(w);
      const r = windowRect(w, d);
      expect(r.w).toBe(w);
      expect(r.x + r.w).toBeLessThanOrEqual(d.width - 12);
      expect(r.h).toBeLessThanOrEqual(d.height - 100);
      expect([1440, 2600]).toContain(d.width);
    }
  });
});

describe('routes', () => {
  it('cover every path in App.tsx SiteRoutes (add new routes to lib.mjs ROUTES)', () => {
    const declared = routePathsFromApp(appSource);
    expect(declared.length).toBeGreaterThan(40);
    const known = new Set([...ROUTES.map(r => r.path), ...REDIRECTS]);
    const missing = declared.filter(p => !known.has(p));
    expect(missing).toEqual([]);
  });

  it('have unique sample URLs and slugs', () => {
    const urls = ROUTES.map(r => r.url);
    expect(new Set(urls).size).toBe(urls.length);
    const slugs = urls.map(slugFor);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('slugs a URL with a query', () => {
    expect(slugFor('/')).toBe('home');
    expect(slugFor('/noun/2062')).toBe('noun-2062');
    expect(slugFor('/noun/2062?sections=heroTools')).toBe('noun-2062--sections-heroTools');
  });

  it('resolves ad-hoc URLs to their route pattern', () => {
    expect(routeFor('/noun/1').path).toBe('noun/:id');
    expect(routeFor('/noun/2062?sections=heroTools').path).toBe('noun/:id');
    expect(routeFor('/candidates/a/b/c').path).toBe('candidates/*');
    expect(routeFor('/').kind).toBe('home');
    expect(routeFor('/v2/noun/7').path).toBe('v2/noun/:id');
  });
});

describe('analyse', () => {
  it('scores a clean shot 0', () => {
    const r = analyse(clean, { touch: true });
    expect(r.score).toBe(0);
    expect(issueLine(r.counts)).toBe('clean');
  });

  it('flags horizontal overflow with its offenders', () => {
    const r = analyse({
      ...clean,
      content: { clientWidth: 390, scrollWidth: 409 },
      overflowOffenders: [{ selector: 'div.title', px: 18, text: 'Noun 2062' }],
    });
    expect(r.counts.overflowPx).toBe(19);
    expect(r.issues.overflow.offenders[0].selector).toBe('div.title');
    expect(r.score).toBeGreaterThan(8);
    expect(issueLine(r.counts)).toBe('overflow 19px');
  });

  it('ignores 1px rounding overflow', () => {
    expect(analyse({ ...clean, content: { clientWidth: 390, scrollWidth: 391 } }).score).toBe(0);
  });

  it('dedupes repeated findings', () => {
    const r = analyse({
      ...clean,
      clipped: [
        { selector: 'h1', text: 'Noun' },
        { selector: 'h1', text: 'Noun' },
      ],
      overlaps: [
        { a: 'x', b: 'y', pct: 80 },
        { a: 'y', b: 'x', pct: 80 },
      ],
    });
    expect(r.counts.clipped).toBe(1);
    expect(r.counts.overlaps).toBe(1);
  });

  it('counts small tap targets only on touch, and not inline text links', () => {
    const controls = [
      { selector: 'a.vote', w: 30, h: 18, label: 'Vote', inlineInText: false },
      { selector: 'p > a', w: 30, h: 18, label: 'link', inlineInText: true },
      { selector: 'button.bid', w: 300, h: 48, label: 'Bid', inlineInText: false },
    ];
    expect(smallTargets(controls).map(c => c.label)).toEqual(['Vote']);
    expect(analyse({ ...clean, controls }, { touch: false }).counts.smallTargets).toBe(0);
    expect(analyse({ ...clean, controls }, { touch: true }).counts.smallTargets).toBe(1);
  });

  it('reports a collection error instead of scoring it', () => {
    const r = analyse({ error: 'no navigator .nos-content on the page' });
    expect(r.error).toMatch(/nos-content/);
    expect(r.score).toBe(0);
  });
});

describe('severity', () => {
  it('weights broken layouts above cosmetic ones', () => {
    const overflow = scoreOf({ overflowPx: 40 });
    const covered = scoreOf({ covered: 1 });
    const taps = scoreOf({ smallTargets: 4 });
    expect(overflow).toBeGreaterThan(covered);
    expect(covered).toBeGreaterThan(taps);
  });

  it('caps each kind so one noisy check cannot drown the rest', () => {
    expect(scoreOf({ smallTargets: 500 })).toBe(scoreOf({ smallTargets: 30 }));
  });

  it('averages a route over its shots and keeps the worst three', () => {
    const shots = [
      { mode: 'window', width: 320, score: 10 },
      { mode: 'window', width: 640, score: 0 },
      { mode: 'page', width: 390, score: 2 },
      { mode: 'page', width: 1024, error: 'timeout', score: 0 },
    ];
    const s = routeSeverity(shots);
    expect(s.score).toBe(4);
    expect(s.worst[0]).toBe('window@320:10');
    expect(s.clean).toBe(1);
    expect(s.errors).toBe(1);
  });
});
