import { describe, expect, it } from 'vitest';

import { mint } from './book';
import { genesis, maskOwner, playerAct, pushFloor, riderAccount, snapshot } from './sim';

const T0 = Date.UTC(2026, 9, 18, 12);
const A = '11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = '22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('snapshot never leaks other riders’ ids', () => {
  it('masks B in A’s view (tape, floor, your fills) and keeps A, bots and gx', () => {
    const s = genesis(7, T0, 0);
    const now = s.now;
    riderAccount(s, A, now);
    riderAccount(s, B, now);
    mint(s, A, 5_000, {});
    mint(s, B, 0, { FISH: 3 });
    // B rests an offer far above the bots, A lifts it: a rider-to-rider fill
    const px = 900;
    expect(
      playerAct(
        s,
        B,
        { t: 'order', kind: 'limit', side: 'sell', good: 'FISH', qty: 1, price: px },
        now,
      ).ok,
    ).toBe(true);
    const hit = playerAct(
      s,
      A,
      { t: 'order', kind: 'limit', side: 'buy', good: 'FISH', qty: 1, price: px },
      now,
    );
    expect(hit.fills.some(f => f.seller === B && f.buyer === A)).toBe(true);
    // ...and back the other way, so B (the taker this time) gets a floor line
    const back = 899;
    expect(
      playerAct(
        s,
        A,
        { t: 'order', kind: 'limit', side: 'sell', good: 'FISH', qty: 1, price: back },
        now,
      ).ok,
    ).toBe(true);
    expect(
      playerAct(
        s,
        B,
        { t: 'order', kind: 'limit', side: 'buy', good: 'FISH', qty: 1, price: back },
        now,
      ).fills.length,
    ).toBe(1);
    pushFloor(s, { at: now, who: 'bot:abacus', text: 'hello floor' });

    const view = snapshot(s, { good: 'FISH', owner: A });
    const text = JSON.stringify(view);
    expect(text).not.toContain(B);
    expect(text).toContain(A);
    const tagB = maskOwner(B, A);
    expect(view.tape.some(f => f.buyer === A && f.seller === tagB)).toBe(true);
    expect(view.you?.fills.some(f => f.buyer === A && f.seller === tagB)).toBe(true);
    expect(view.floor.some(e => e.who === A)).toBe(true);
    expect(view.floor.some(e => e.who === tagB)).toBe(true);
    expect(view.floor.some(e => e.who === 'gx')).toBe(true);
    expect(view.floor.some(e => e.who === 'bot:abacus')).toBe(true);

    // An anonymous view masks everyone, A included
    const anon = JSON.stringify(snapshot(s, { good: 'FISH' }));
    expect(anon).not.toContain(A);
    expect(anon).not.toContain(B);
  });

  it('maskOwner is stable, one-way and leaves bots, gx and the viewer alone', () => {
    expect(maskOwner(B, A)).toBe(maskOwner(B, null));
    expect(maskOwner(B, A)).toMatch(/^rider:[\da-f]{8}$/);
    expect(maskOwner(B, A)).not.toBe(maskOwner(A, B));
    expect(maskOwner(A, A)).toBe(A);
    expect(maskOwner('gx', A)).toBe('gx');
    expect(maskOwner('bot:abacus', A)).toBe('bot:abacus');
  });
});
