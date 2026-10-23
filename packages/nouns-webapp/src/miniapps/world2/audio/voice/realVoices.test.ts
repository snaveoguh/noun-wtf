import { describe, expect, it } from 'vitest';

import { NPC_IDS } from '../../missions/defs';

import {
  bank,
  CALLOUTS,
  CalloutBrain,
  COOLDOWN,
  GAP,
  isProfane,
  SPEED_DOWN_KMH,
  SPEED_UP_KMH,
} from './callouts';
import { npcVoice, seedVoice } from './cast';
import { cleanText, clauses, toIds, toPhonemes } from './piperText';
import { hyped, lineKey, modelScales, pitchFactor, SPEAKERS, ttsVoiceOf } from './ttsVoice';
import { autoVoicesOk, realVoicesOn } from './voicePrefs';

describe('real voices from seeds', () => {
  it('the same seed always gets the same real voice', () => {
    const a = ttsVoiceOf(seedVoice([1, 13, 18, 65, 20]));
    const b = ttsVoiceOf(
      seedVoice({ background: 1, body: 13, accessory: 18, head: 65, glasses: 20 }),
    );
    expect(a).toEqual(b);
    expect(lineKey('Hi.', a)).toBe(lineKey('Hi.', b));
  });

  it('different seeds get different speakers, within sane pitch and pace', () => {
    const speakers = new Set<number>();
    const voices = new Set<string>();
    for (let h = 0; h < 200; h++) {
      const t = ttsVoiceOf(seedVoice([h % 2, h, (h * 3) % 140, (h * 7) % 240, h % 23]));
      expect(t.speaker).toBeGreaterThanOrEqual(0);
      expect(t.speaker).toBeLessThan(SPEAKERS);
      expect(Number.isInteger(t.speaker)).toBe(true);
      expect(t.pitch).toBeGreaterThanOrEqual(-300);
      expect(t.pitch).toBeLessThanOrEqual(220);
      expect(t.rate).toBeGreaterThanOrEqual(0.8);
      expect(t.rate).toBeLessThanOrEqual(1.2);
      expect(t.noise).toBeGreaterThanOrEqual(0.5);
      expect(t.noise).toBeLessThanOrEqual(0.8);
      speakers.add(t.speaker);
      voices.add(lineKey('', t));
    }
    // 200 Nouns: nearly all distinct speakers, all distinct voices
    expect(speakers.size).toBeGreaterThan(170);
    expect(voices.size).toBe(200);
  });

  it('the cast all sound different; the Oracle low with an echo, the Twins in unison', () => {
    const keys = new Set(NPC_IDS.map(id => lineKey('', ttsVoiceOf(npcVoice(id)))));
    expect(keys.size).toBe(NPC_IDS.length);
    const oracle = ttsVoiceOf(npcVoice('oracle'));
    expect(oracle.pitch).toBeLessThan(-200);
    expect(oracle.echo).toBeGreaterThan(0);
    expect(oracle.rate).toBeLessThan(ttsVoiceOf(npcVoice('courier')).rate);
    expect(ttsVoiceOf(npcVoice('twins')).unison).toBeGreaterThan(0);
    expect(ttsVoiceOf(npcVoice('keymaker')).unison).toBe(0);
  });

  it('a pitch shift does not change the pace (synthesis is slowed to match)', () => {
    const t = ttsVoiceOf(npcVoice('oracle'));
    const [, length] = modelScales(t);
    // audible length = synth length / playback factor = 1 / rate
    expect(length / pitchFactor(t.pitch)).toBeCloseTo(1 / t.rate, 6);
    const up = { ...t, pitch: 300 };
    expect(modelScales(up)[1] / pitchFactor(300)).toBeCloseTo(1 / t.rate, 6);
  });

  it('the rider hypes up, but only so far', () => {
    const t = ttsVoiceOf(seedVoice([0, 1, 2, 3, 4]));
    expect(hyped(t).rate).toBeGreaterThan(t.rate);
    expect(hyped({ ...t, rate: 1.3 }, 2).rate).toBeLessThanOrEqual(1.35);
    expect(hyped(t).speaker).toBe(t.speaker);
  });
});

describe('text for Piper', () => {
  it('cleans emoji, dashes, quotes and long lines', () => {
    expect(cleanText('Hi 🪩 there — "friend"…')).toBe('Hi there, friend...');
    const long = 'Word word word. '.repeat(40);
    const c = cleanText(long, 100);
    expect(c.length).toBeLessThanOrEqual(100);
    expect(c.endsWith('.')).toBe(true);
  });

  it('splits clauses and keeps one punctuation mark each', () => {
    expect(clauses('Ahh, shit!')).toEqual([
      { words: 'Ahh', punct: ',' },
      { words: 'shit', punct: '!' },
    ]);
    expect(clauses('What?! No')).toEqual([
      { words: 'What', punct: '?' },
      { words: 'No', punct: '' },
    ]);
  });

  it('phonemizes each clause and puts the punctuation back', async () => {
    const calls: string[] = [];
    const ph = await toPhonemes('Ahh, shit!', async t => {
      calls.push(t);
      return t.toLowerCase();
    });
    expect(calls).toEqual(['Ahh', 'shit']);
    expect(ph).toBe('ahh, shit!');
  });

  it('ids: ^ then each phoneme followed by a pad, then $; unknown symbols dropped', () => {
    const map = { _: [0], '^': [1], $: [2], a: [14], b: [15], '!': [4] };
    expect(toIds('ab!', map)).toEqual([1, 0, 14, 0, 15, 0, 4, 0, 2]);
    expect(toIds('a☃b', map)).toEqual([1, 0, 14, 0, 15, 0, 2]);
  });
});

describe('rider callouts', () => {
  const fixed = (x: number) => () => x;

  it('each event has a bank, and clean mode never swears', () => {
    for (const ev of ['bail', 'speed', 'record'] as const) {
      expect(bank(ev, false).length).toBeGreaterThanOrEqual(5);
      for (const t of bank(ev, true)) expect(isProfane(t)).toBe(false);
      // every swearing line has a clean alternative
      for (const l of CALLOUTS[ev]) if (isProfane(l.say)) expect(l.clean).toBeDefined();
    }
    expect(bank('bail', false)).toContain('Ahh, shit!');
    expect(bank('record', false)).toContain('Fuck yeah, baby!');
    expect(bank('record', true)).toContain('Heck yeah, baby!');
  });

  it('cooldowns: one bail per cooldown, a gap between any two callouts', () => {
    const b = new CalloutBrain(fixed(0));
    expect(b.fire('bail', 10)).not.toBeNull();
    expect(b.fire('bail', 10 + COOLDOWN.bail - 0.1)).toBeNull();
    expect(b.fire('speed', 10 + GAP - 0.1)).toBeNull(); // too soon after the bail
    expect(b.fire('speed', 10 + GAP + 0.1)).not.toBeNull();
    expect(b.fire('bail', 10 + COOLDOWN.bail + 0.1)).not.toBeNull();
  });

  it('a record cuts through the gap (but not its own cooldown)', () => {
    const b = new CalloutBrain(fixed(0));
    expect(b.fire('bail', 5)).not.toBeNull();
    expect(b.fire('record', 5.5)).not.toBeNull();
    expect(b.fire('record', 5.5 + COOLDOWN.record - 1)).toBeNull();
  });

  it('never says the same line twice running', () => {
    const b = new CalloutBrain(fixed(0.01));
    const first = b.fire('bail', 0);
    const second = b.fire('bail', 100);
    expect(second).not.toBe(first);
  });

  it('clean mode swaps the swearing', () => {
    const b = new CalloutBrain(fixed(0)); // first bail line: "Ahh, shit!"
    b.clean = true;
    expect(b.fire('bail', 0)).toBe('Ahh, shoot!');
    const r = new CalloutBrain(fixed(0));
    expect(r.fire('record', 0)).toBe('Fuck yeah, baby!');
  });

  it('speed fires once crossing up, re-arms only after slowing right down', () => {
    const b = new CalloutBrain(fixed(0.5));
    let t = 0;
    const said: string[] = [];
    const feed = (kmh: number, secs: number) => {
      for (let i = 0; i < secs * 10; i++) {
        t += 0.1;
        const l = b.speed(kmh, t);
        if (l !== null) said.push(l);
      }
    };
    feed(SPEED_UP_KMH - 5, 5);
    expect(said).toHaveLength(0);
    feed(SPEED_UP_KMH + 10, 60); // a long fast run: one callout
    expect(said).toHaveLength(1);
    feed(SPEED_DOWN_KMH + 2, 5); // eased off, not slow enough
    feed(SPEED_UP_KMH + 10, 5);
    expect(said).toHaveLength(1);
    feed(SPEED_DOWN_KMH - 5, 2); // slowed right down: re-armed
    feed(SPEED_UP_KMH + 10, 2);
    expect(said).toHaveLength(2);
  });
});

describe('when real voices load', () => {
  const desk = { coarse: false, saveData: false };
  it('auto: desktops on fast links only', () => {
    expect(autoVoicesOk(desk)).toBe(true);
    expect(autoVoicesOk({ ...desk, effectiveType: '4g', memory: 8 })).toBe(true);
    expect(autoVoicesOk({ ...desk, coarse: true })).toBe(false);
    expect(autoVoicesOk({ ...desk, saveData: true })).toBe(false);
    expect(autoVoicesOk({ ...desk, effectiveType: '3g' })).toBe(false);
    expect(autoVoicesOk({ ...desk, memory: 2 })).toBe(false);
  });
  it('on always, off never', () => {
    const phone = { coarse: true, saveData: true, effectiveType: '2g' };
    expect(realVoicesOn('on', phone)).toBe(true);
    expect(realVoicesOn('off', desk)).toBe(false);
    expect(realVoicesOn('auto', phone)).toBe(false);
    expect(realVoicesOn('auto', desk)).toBe(true);
  });
});
