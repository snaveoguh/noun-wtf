import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  apply,
  constrain,
  corner,
  cornerAt,
  dragProgress,
  firstPageOf,
  foldAt,
  inv,
  mul,
  neighbourPages,
  pageLabel,
  searchPages,
  settles,
  turnPages,
  viewAt,
  viewCount,
  viewOfPage,
  type Mat,
  type Pt,
} from './bookMath';

const N = 252;

describe('spreads (desktop)', () => {
  it('opens closed: the front cover alone on the right', () => {
    expect(viewAt(0, N, 'spread')).toEqual({ left: null, right: 1 });
  });
  it('pairs even pages on the left with the next odd page on the right', () => {
    expect(viewAt(1, N, 'spread')).toEqual({ left: 2, right: 3 });
    expect(viewAt(6, N, 'spread')).toEqual({ left: 12, right: 13 });
  });
  it('ends with the back cover alone on the left', () => {
    expect(viewCount(N, 'spread')).toBe(127);
    expect(viewAt(126, N, 'spread')).toEqual({ left: 252, right: null });
  });
  it('an odd page count ends on a full spread', () => {
    expect(viewCount(5, 'spread')).toBe(3);
    expect(viewAt(2, 5, 'spread')).toEqual({ left: 4, right: 5 });
  });
  it('finds the view for any page, and back', () => {
    for (let p = 1; p <= N; p++) {
      const v = viewAt(viewOfPage(p, N, 'spread'), N, 'spread');
      expect([v.left, v.right]).toContain(p);
    }
    expect(viewOfPage(0, N, 'spread')).toBe(0);
    expect(viewOfPage(999, N, 'spread')).toBe(126);
    expect(firstPageOf(6, N, 'spread')).toBe(12);
    expect(firstPageOf(0, N, 'spread')).toBe(1);
  });
  it('labels the counter', () => {
    expect(pageLabel(viewAt(6, N, 'spread'), N)).toBe('12–13 / 252');
    expect(pageLabel(viewAt(0, N, 'spread'), N)).toBe('1 / 252');
  });
});

describe('single pages (phone)', () => {
  it('shows one page per view, on the right', () => {
    expect(viewCount(N, 'single')).toBe(N);
    expect(viewAt(0, N, 'single')).toEqual({ left: null, right: 1 });
    expect(viewAt(11, N, 'single')).toEqual({ left: null, right: 12 });
    expect(viewOfPage(12, N, 'single')).toBe(11);
  });
  it('keeps the page when switching layouts', () => {
    const p = firstPageOf(viewOfPage(13, N, 'spread'), N, 'spread');
    expect(firstPageOf(viewOfPage(p, N, 'single'), N, 'single')).toBe(12);
  });
});

describe('turnPages', () => {
  it('opening the cover lifts page 1, shows 2 on its back and reveals 3', () => {
    expect(turnPages(0, N, 'spread')).toEqual({ left: null, under: 3, front: 1, back: 2 });
  });
  it('a mid-book turn keeps the left page and reveals the next right', () => {
    expect(turnPages(6, N, 'spread')).toEqual({ left: 12, under: 15, front: 13, back: 14 });
  });
  it('closing onto the back cover reveals nothing on the right', () => {
    expect(turnPages(125, N, 'spread')).toEqual({ left: 250, under: null, front: 251, back: 252 });
  });
  it('single layout: the next page sits underneath, the back is paper', () => {
    expect(turnPages(4, N, 'single')).toEqual({ left: null, under: 6, front: 5, back: null });
  });
});

describe('neighbourPages', () => {
  it('lists the view first, then its neighbours, without repeats', () => {
    expect(neighbourPages(6, N, 'spread', 1)).toEqual([12, 13, 14, 15, 10, 11]);
    expect(neighbourPages(0, N, 'spread', 1)).toEqual([1, 2, 3]);
    expect(neighbourPages(0, N, 'single', 2)).toEqual([1, 2, 3]);
  });
});

describe('drag → turn', () => {
  const W = 400;
  const H = 400;
  it('progress runs 0 at the corner to 1 at the mirror corner', () => {
    expect(dragProgress({ x: W, y: H }, W)).toBe(0);
    expect(dragProgress({ x: 0, y: H }, W)).toBe(0.5);
    expect(dragProgress({ x: -W, y: H }, W)).toBe(1);
    expect(dragProgress({ x: -3 * W, y: H }, W)).toBe(1);
    expect(dragProgress({ x: 2 * W, y: H }, W)).toBe(0);
  });
  it('the turn path starts and ends on the corners and lifts in the middle', () => {
    expect(cornerAt(0, W, H, false)).toEqual({ x: W, y: H });
    const end = cornerAt(1, W, H, false);
    expect(end.x).toBe(-W);
    expect(end.y).toBeCloseTo(H);
    expect(cornerAt(0.5, W, H, false).y).toBeLessThan(H);
    expect(cornerAt(0.5, W, H, true).y).toBeGreaterThan(0);
    for (let t = 0; t <= 1; t += 0.1)
      expect(dragProgress(cornerAt(t, W, H, false), W)).toBeCloseTo(t);
  });
  it('keeps the corner within reach of the spine', () => {
    const left = constrain({ x: -900, y: H }, W, H, false);
    expect(left).toEqual({ x: -W, y: H });
    const far = constrain({ x: -900, y: H + 500 }, W, H, false);
    expect(Math.hypot(far.x, far.y - H)).toBeLessThanOrEqual(W + 1e-9);
    expect(Math.hypot(far.x, far.y)).toBeLessThanOrEqual(Math.hypot(W, H) + 1e-9);
    const ok = { x: 100, y: 300 };
    expect(constrain(ok, W, H, false)).toEqual(ok);
    const up = constrain({ x: 0, y: -2000 }, W, H, false);
    expect(Math.hypot(up.x, up.y - H)).toBeLessThanOrEqual(W + 1e-9);
  });
  it('settles past half way or on a flick', () => {
    expect(settles(0.6, 0, W)).toBe(true);
    expect(settles(0.4, 0, W)).toBe(false);
    expect(settles(0.2, -2, W)).toBe(true);
    expect(settles(0.8, 2, W)).toBe(false);
  });
});

describe('foldAt', () => {
  const W = 400;
  const H = 500;
  const BIG = 4000;
  const near = (a: Pt, b: Pt) => {
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
  };

  it('is null with the corner at rest', () => {
    expect(foldAt(corner(W, H, false), W, H, false, BIG)).toBeNull();
  });

  it('brings the folded corner to the pointer and keeps the front in place', () => {
    const P = { x: 150, y: 380 };
    const f = foldAt(P, W, H, false, BIG)!;
    const backBook: Mat = mul(f.clip, f.back);
    const frontBook: Mat = mul(f.clip, f.front);
    // the leaf's front is unmoved: front ∘ clip = identity
    near(apply(frontBook, { x: 10, y: 20 }), { x: 10, y: 20 });
    // the corner (W, H) of the leaf is back-image (0, H); it lands on P
    near(apply(backBook, { x: 0, y: H }), P);
    // points on the fold line don't move
    near(apply(backBook, { x: W - f.mid.x, y: f.mid.y }), f.mid);
    // the fold line is the right edge of the clip box
    near(apply(inv(f.clip), f.mid), { x: BIG, y: BIG / 2 });
  });

  it('finishes with the back flat on the left page', () => {
    const f = foldAt({ x: -W, y: H }, W, H, false, BIG)!;
    const backBook = mul(f.clip, f.back);
    near(apply(backBook, { x: 0, y: 0 }), { x: -W, y: 0 });
    near(apply(backBook, { x: W, y: H }), { x: 0, y: H });
    expect(f.progress).toBe(1);
  });

  it('works from the top corner too', () => {
    const P = { x: 200, y: 60 };
    const f = foldAt(P, W, H, true, BIG)!;
    near(apply(mul(f.clip, f.back), { x: 0, y: 0 }), P);
  });
});

describe('searchPages', () => {
  const pages = [
    { n: 1, text: '“MEME VALUE”\nLIL 67' },
    { n: 2, text: 'VIRAL PUBLIC LICENSE\nCopyleft All Rights Reversed. meme meme' },
    { n: 3, text: 'Café culture and the Meme\nplex' },
  ];
  it('finds pages case- and accent-insensitively, in page order', () => {
    expect(searchPages(pages, 'meme').map(h => h.page)).toEqual([1, 2, 3]);
    expect(searchPages(pages, 'CAFE')[0]?.page).toBe(3);
    expect(searchPages(pages, 'meme')[1]?.count).toBe(2);
  });
  it('matches across line breaks and curly quotes', () => {
    expect(searchPages(pages, 'meme plex')[0]?.page).toBe(3);
    expect(searchPages(pages, '"meme value"')[0]?.page).toBe(1);
  });
  it('gives a snippet with the match marked', () => {
    const h = searchPages(pages, 'rights')[0]!;
    expect(h.snippet.slice(h.start, h.end).toLowerCase()).toBe('rights');
  });
  it('ignores blank and one-letter queries', () => {
    expect(searchPages(pages, ' ')).toEqual([]);
    expect(searchPages(pages, 'm')).toEqual([]);
  });

  it('searches the real book', () => {
    const json = JSON.parse(
      readFileSync(resolve(__dirname, '../../../public/books/meme-value/pages.json'), 'utf8'),
    ) as { pageCount: number; pages: { n: number; text: string }[] };
    expect(json.pageCount).toBe(252);
    expect(json.pages).toHaveLength(252);
    expect(searchPages(json.pages, 'viral public license')[0]?.page).toBe(2);
    expect(searchPages(json.pages, 'requisite variety').length).toBeGreaterThan(0);
  });
});
