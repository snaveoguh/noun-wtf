import { describe, expect, it } from 'vitest';

import {
  composeAlert,
  composeScript,
  emptyDao,
  fmtEth,
  speakable,
  unbackedNumbers,
  type DjFacts,
} from './djScript';
import voice from './djVoice.json';

const AT = Date.UTC(2026, 9, 19, 12);

function facts(over: (f: DjFacts) => void = () => undefined): DjFacts {
  const f: DjFacts = { at: AT, fromBlock: 100, toBlock: 7299, v1: emptyDao(), v2: emptyDao() };
  over(f);
  return f;
}

const BUSY = facts(f => {
  f.v1.settled.push({ nounId: 2049, winner: '0xabc', name: 'memevalue.eth', eth: '3.25' });
  f.v1.opened.push(2050);
  f.v1.bids = 7;
  f.v1.topBid = { nounId: 2050, eth: '1.1', bidder: '0xdef', name: null };
  f.v1.executed.push(1001);
  f.v1.created.push(1004);
  f.v1.votes = { count: 23, for: 18, against: 4, abstain: 1 };
  f.v2.settled.push({ nounId: 412, winner: '0x123', name: null, eth: '0.08' });
});

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('DJ script', () => {
  it('formats ETH honestly', () => {
    expect(fmtEth(3_250_000_000_000_000_000n)).toBe('3.25');
    expect(fmtEth(1_100_000_000_000_000_000n)).toBe('1.1');
    expect(fmtEth(2n * 10n ** 18n)).toBe('2');
    expect(fmtEth(1n)).toBe('0.01');
    expect(fmtEth(0n)).toBe('0');
  });

  it('is ~10 s (25-35 words), facts first, in voice', () => {
    const s = composeScript(BUSY);
    expect(words(s)).toBeGreaterThanOrEqual(22);
    expect(words(s)).toBeLessThanOrEqual(38);
    expect(s).toContain('noun 2049 went to memevalue.eth for 3.25 eth');
    expect(voice.openers.some(o => s.startsWith(o))).toBe(true);
    expect(voice.closers.some(c => s.endsWith(c))).toBe(true);
  });

  it('is deterministic for the same facts', () => {
    expect(composeScript(BUSY)).toBe(composeScript(structuredClone(BUSY)));
  });

  it('says an unnamed wallet is an anon wallet (no ENS)', () => {
    const f = facts(x =>
      x.v2.settled.push({ nounId: 412, winner: '0x123', name: null, eth: '0.08' }),
    );
    const s = composeScript(f);
    expect(s).toContain('V2 noun 412 went to an anon wallet for 0.08 eth');
    expect(s).not.toMatch(/0x/);
  });

  it('on a quiet day says so, in voice, with no numbers at all', () => {
    const s = composeScript(facts());
    expect(voice.quiet.some(q => s.includes(q))).toBe(true);
    expect(s).not.toMatch(/\d/);
    expect(composeAlert(facts())).not.toMatch(/\d/);
  });

  it('a no-bid settle is news too (treasury), never a sale', () => {
    const s = composeScript(facts(x => x.v1.unsold.push(2050)));
    expect(s).toContain('noun 2050 got no bids, off to the treasury');
    expect(s).not.toContain('went to');
  });

  it('never fabricates a number, across many slots and fact mixes', () => {
    for (let i = 0; i < 200; i++) {
      const f = structuredClone(BUSY);
      f.at = AT + i * 12 * 3600_000;
      f.toBlock = 7299 + i;
      if (i % 3 === 0) f.v1.settled = [];
      if (i % 5 === 0) f.v1.executed = [];
      if (i % 7 === 0) f.v2.settled = [];
      for (const s of [composeScript(f), composeAlert(f)])
        expect(unbackedNumbers(s, f)).toEqual([]);
    }
  });

  it('catches a fabricated number', () => {
    expect(unbackedNumbers('noun 2049 went for 99 eth', BUSY)).toEqual(['99']);
    // ENS names with digits don't count
    const f = facts(x =>
      x.v1.settled.push({ nounId: 1, winner: '0x1', name: 'tm0b1l.eth', eth: '2' }),
    );
    expect(unbackedNumbers('noun 1 went to tm0b1l.eth for 2 eth', f)).toEqual([]);
  });

  it('the phrase banks hold no numbers or claims', () => {
    for (const [k, v] of Object.entries(voice))
      if (Array.isArray(v)) for (const line of v) expect(line, k).not.toMatch(/\d/);
  });

  it('alerts lead with the biggest item', () => {
    const a = composeAlert(BUSY);
    expect(voice.alert.some(h => a.startsWith(h))).toBe(true);
    expect(a).toContain('noun 2049 went to memevalue.eth for 3.25 eth');
  });

  it('expands shorthand for speech', () => {
    expect(speakable('noun f-m. looks legit imo. gl. V2 noun 4 for 1.5 eth')).toBe(
      'Noun F M. looks legit I M O. good luck. V two noun 4 for 1.5 E T H',
    );
  });
});
