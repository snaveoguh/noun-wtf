import { describe, expect, it } from 'vitest';

import { FrameGuard } from './frameGuard';

describe('FrameGuard', () => {
  it('reports each distinct error once and ends the intro on the first', () => {
    const g = new FrameGuard();
    expect(g.failed(new TypeError('x is null'))).toEqual({ report: true, abortIntro: true });
    expect(g.failed(new TypeError('x is null'))).toEqual({ report: false, abortIntro: false });
    expect(g.failed(new Error('other'))).toEqual({ report: true, abortIntro: false });
    expect(g.errors).toBe(3);
    expect(g.streak).toBe(3);
    g.ok();
    expect(g.streak).toBe(0);
  });
  it('stops logging after 20 distinct messages (no console flood)', () => {
    const g = new FrameGuard();
    for (let i = 0; i < 20; i++) expect(g.failed(`e${i}`).report).toBe(true);
    expect(g.failed('e99').report).toBe(false);
  });
});
