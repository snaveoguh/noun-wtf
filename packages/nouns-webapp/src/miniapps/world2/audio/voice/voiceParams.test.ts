import { describe, expect, it } from 'vitest';

import { NPC_IDS, NPCS } from '../../missions/defs';

import { npcVoice } from './cast';
import {
  charTimes,
  deriveVoice,
  hashSeed,
  lineDuration,
  revealed,
  syllablePlan,
  vowelOf,
  VOWELS,
} from './voiceParams';

describe('voices from seeds', () => {
  it('the same seed always gives the same voice (array or object form)', () => {
    const a = deriveVoice([1, 13, 18, 65, 20]);
    const b = deriveVoice([1, 13, 18, 65, 20]);
    const c = deriveVoice({ background: 1, body: 13, accessory: 18, head: 65, glasses: 20 });
    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect(hashSeed([1, 13, 18, 65, 20])).toBe(hashSeed([1, 13, 18, 65, 20]));
  });

  it('different seeds sound different, within sane ranges', () => {
    const seen = new Set<string>();
    for (let h = 0; h < 40; h++) {
      const v = deriveVoice([h % 2, h, h * 3, h * 7, h % 23]);
      expect(v.base).toBeGreaterThanOrEqual(130);
      expect(v.base).toBeLessThanOrEqual(300);
      expect(v.speed).toBeGreaterThanOrEqual(15);
      expect(v.speed).toBeLessThanOrEqual(23);
      expect(['square', 'sawtooth', 'triangle']).toContain(v.wave);
      seen.add(`${v.base.toFixed(1)}:${v.wave}`);
    }
    expect(seen.size).toBeGreaterThan(30);
  });

  it('the cast: Oracle low, slow and shimmering; the Twins in unison; all distinct', () => {
    const o = npcVoice('oracle');
    expect(o.base).toBeLessThan(110);
    expect(o.shimmer).toBeGreaterThan(0);
    for (const id of NPC_IDS)
      if (id !== 'oracle') expect(npcVoice(id).speed).toBeGreaterThan(o.speed);
    expect(npcVoice('twins').unison).toBe(2);
    const keys = new Set(NPC_IDS.map(id => JSON.stringify(npcVoice(id))));
    expect(keys.size).toBe(NPC_IDS.length);
    // derived from their own seed (a preset only overrides some fields)
    expect(npcVoice('keymaker').breath).toBeDefined();
    expect(deriveVoice(NPCS.dj.seeds[0]!).wave).toBeDefined();
  });
});

describe('timing', () => {
  it('characters arrive in order; punctuation adds a beat', () => {
    const { times, total } = charTimes('Hi. Yes', 10);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]!);
    // "." then " ": the gap after the full stop is longer than a letter
    expect(times[4]! - times[2]!).toBeGreaterThan(0.3);
    expect(total).toBeGreaterThan(times[times.length - 1]!);
    expect(charTimes('Hi Yes', 10).total).toBeLessThan(total);
  });

  it('faster voices finish sooner', () => {
    expect(lineDuration('Every door has a key.', { speed: 20 })).toBeLessThan(
      lineDuration('Every door has a key.', { speed: 12 }),
    );
  });

  it('the typewriter reveal follows the same clock', () => {
    const { times } = charTimes('abc def', 10);
    expect(revealed(times, -1)).toBe(0);
    expect(revealed(times, 0)).toBe(1);
    expect(revealed(times, times[3]!)).toBe(4);
    expect(revealed(times, 99)).toBe(7);
  });
});

describe('syllables', () => {
  const v = npcVoice('keymaker');

  it('fire on letters, in step with the text reveal', () => {
    const text = 'Every door has a key.';
    const p = syllablePlan(text, v);
    expect(p.syllables.length).toBeGreaterThan(5);
    const times = new Set(p.times);
    for (const s of p.syllables) {
      expect(times.has(s.t)).toBe(true); // each blip lands on a character's reveal time
      expect(s.dur).toBeGreaterThan(0.03);
      expect(s.dur).toBeLessThanOrEqual(0.14);
      expect(s.vowel).toBeGreaterThanOrEqual(0);
      expect(s.vowel).toBeLessThan(VOWELS.length);
    }
    // deterministic
    expect(syllablePlan(text, v)).toEqual(p);
  });

  it('questions rise at the end, statements settle', () => {
    const q = syllablePlan('Are you any good?', v).syllables;
    const lastQ = q[q.length - 1]!;
    expect(lastQ.f1).toBeGreaterThan(lastQ.f0);
    expect(lastQ.f0).toBeGreaterThan(v.base);
  });

  it('vowels map letters stably', () => {
    expect(vowelOf('a')).toBe(0);
    expect(vowelOf('I')).toBe(2);
    expect(vowelOf('k')).toBe(vowelOf('K'));
  });
});
