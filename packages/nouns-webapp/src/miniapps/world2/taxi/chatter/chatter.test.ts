import { describe, expect, it } from 'vitest';

import { TOWN_SPECS } from '../../trade/towns';
import { LANDMARKS } from '../../world/landmarks/sites';

import {
  BANK,
  GENERIC_LANDMARK,
  GENERIC_TOWN,
  LANDMARK_FACTS,
  TOD_LINES,
  TOWN_FACTS,
} from './bank';
import {
  ChatterGen,
  EMPTY_TALLY,
  LINE_MAX,
  LINE_MIN,
  personaOf,
  spokenName,
  type ChatContext,
  type ChatLine,
  type ChatPlace,
} from './generator';
import { Decks, expand, GrammarError, lineKey, symbols, tidy } from './grammar';
import { cleanLines, llmWanted, parseAsk, parseLlmLines } from './llm';
import {
  gapAfter,
  gate,
  houseTuning,
  MUTE_KEY,
  readMuted,
  voicePlan,
  voiceStatus,
  writeMuted,
  type VoicePlanIn,
} from './rules';

const PLACES: ChatPlace[] = [
  ...Object.values(TOWN_SPECS).map(t => ({
    id: `town:${t.id}`,
    name: spokenName(t.name.toUpperCase()),
    kind: 'town' as const,
    style: t.style,
    makes: t.market.makes,
  })),
  ...LANDMARKS.map(l => ({
    id: `land:${l.id}`,
    name: spokenName(l.name.toUpperCase()),
    kind: 'landmark' as const,
    landmark: l.id,
  })),
  { id: 'spot:camp', name: 'Nouns Camp Tower', kind: 'spot' },
  { id: 'town:new', name: 'Brand New Town', kind: 'town', style: 'mystery', makes: ['WATER'] },
];

const TODS = ['afternoon', 'golden', 'blue', 'night'] as const;

function ctxAt(i: number): ChatContext {
  const st = { ...EMPTY_TALLY };
  if (i % 9 === 4) st.air = 1;
  if (i % 13 === 6) st.crash = 1;
  if (i % 11 === 2) st.nearMiss = 2;
  if (i % 17 === 8) st.drift = 1;
  return {
    dest: i % 5 === 0 ? null : PLACES[i % PLACES.length]!.name,
    tod: TODS[Math.floor(i / 50) % 4]!,
    kmh: (i * 37) % 240,
    stunts: st,
    places: PLACES,
  };
}

/** A long session: a new speaker every 40 lines, cabbies and passengers. */
function session(n: number, seed = 42): ChatLine[] {
  const g = new ChatterGen(seed);
  const out: ChatLine[] = [];
  for (let i = 0; i < n; i++) {
    if (i % 40 === 0)
      g.cast({
        role: (i / 40) % 3 === 0 ? 'cabbie' : 'passenger',
        name: `RIDER ${i}`,
        seed: [i % 2, (i * 7) % 30, (i * 13) % 137, (i * 31) % 234, (i * 3) % 21],
      });
    const l = g.next(ctxAt(i));
    expect(l, `line ${i}`).not.toBeNull();
    out.push(l!);
  }
  return out;
}

describe('grammar', () => {
  it('expands, captures and calls back', () => {
    const caught: Record<string, string> = {};
    const r = { a: ['x {b>slot}'], b: ['y'] };
    expect(expand('{a} {@slot}', r, (_k, o) => o[0]!, {}, caught)).toBe('x y y');
    expect(caught.slot).toBe('y');
  });
  it('throws on a broken template', () => {
    expect(() => expand('{nope}', {}, (_k, o) => o[0]!, {}, {})).toThrow(GrammarError);
    expect(() => expand('{@nope}', {}, (_k, o) => o[0]!, {}, {})).toThrow(GrammarError);
  });
  it('tidies into a spoken line', () => {
    expect(tidy('so .  this  is it ,ok')).toBe('So. This is it, ok.');
    expect(tidy('wow! . next')).toBe('Wow! Next.');
  });
  it('deals every option before repeating', () => {
    const d = new Decks(() => 0.3);
    const opts = ['a', 'b', 'c', 'd'];
    const got = new Set([0, 1, 2, 3].map(() => d.pick('k', opts)));
    expect(got.size).toBe(4);
  });
  it('every rule every template mentions exists (no broken templates)', () => {
    const perLine = new Set([
      'name',
      'dest',
      'place',
      'town',
      'townFact',
      'townFact_lc',
      'good',
      'landmark',
      'landmarkFact',
      'todLine',
      'driveYou',
      'driveMe',
    ]);
    const all = [
      ...Object.values(BANK).flat(),
      ...Object.values(TOWN_FACTS).flat(),
      ...GENERIC_TOWN,
      ...Object.values(LANDMARK_FACTS).flat(),
      ...GENERIC_LANDMARK,
      ...Object.values(TOD_LINES).flat(),
    ];
    for (const t of all)
      for (const s of symbols(t))
        expect(BANK[s] !== undefined || perLine.has(s), `${s} in "${t}"`).toBe(true);
  });
  it('every landmark has its own facts', () => {
    for (const l of LANDMARKS) expect(LANDMARK_FACTS[l.id]?.length ?? 0, l.id).toBeGreaterThan(0);
  });
  it('every town style has facts', () => {
    for (const t of Object.values(TOWN_SPECS)) expect(TOWN_FACTS[t.style], t.style).toBeDefined();
  });
});

describe('ChatterGen', () => {
  const lines = session(6000);

  it('6,000 lines, none repeated', () => {
    const keys = new Set(lines.map(l => lineKey(l.text)));
    expect(keys.size).toBe(lines.length);
  });

  it('no unfilled slots, sensible length, tidy punctuation', () => {
    for (const l of lines) {
      expect(l.text, l.text).not.toMatch(/[@{}]|undefined|null|NaN|\s{2}|\s[!,.?]|,,|\.\.\.\./);
      expect(l.text.length).toBeGreaterThanOrEqual(LINE_MIN);
      expect(l.text.length).toBeLessThanOrEqual(LINE_MAX);
      expect(l.text).toMatch(/^["'A-Z]/);
      expect(l.text).toMatch(/[!.?]$/);
    }
  });

  it('whole-sentence pools are never reused', () => {
    // every once-pool sentence appears in at most one line
    const once = [
      ...Object.values(TOD_LINES).flat(),
      ...(BANK.loreLine ?? []).filter(t => !t.includes('{')),
      ...(BANK.musing ?? []),
      ...(BANK.question ?? []),
      ...(BANK.foodTake ?? []),
      ...(BANK.driveYou_air ?? []),
    ];
    for (const s of once) {
      const n = lines.filter(l => l.text.includes(s.slice(0, 40))).length;
      expect(n, s).toBeLessThanOrEqual(1);
    }
  });

  it('keeps it varied: many topics, no topic twice running early on, 4-gram variety', () => {
    const topics = new Set(lines.slice(0, 300).map(l => l.topic));
    expect(topics.size).toBeGreaterThanOrEqual(9);
    let runs = 0;
    for (let i = 1; i < 400; i++) if (lines[i]!.topic === lines[i - 1]!.topic) runs++;
    expect(runs).toBeLessThan(8);
    const grams = new Map<string, number>();
    let total = 0;
    for (const l of lines.slice(0, 500)) {
      const w = lineKey(l.text).split(' ');
      for (let i = 0; i + 4 <= w.length; i++) {
        const g = w.slice(i, i + 4).join(' ');
        grams.set(g, (grams.get(g) ?? 0) + 1);
        total++;
      }
    }
    expect(grams.size / total).toBeGreaterThan(0.55);
  });

  it('callbacks reference earlier lines by the same speaker, and repeat what they said', () => {
    const cbs = lines.filter(l => l.topic === 'callback');
    expect(cbs.length).toBeGreaterThan(100);
    for (const c of cbs) {
      expect(c.refs.length).toBeGreaterThan(0);
      for (const r of c.refs) {
        expect(r).toBeLessThan(c.id);
        // same speaker: refs never reach back past this speaker's first line
        expect(Math.floor(r / 40)).toBe(Math.floor(c.id / 40));
      }
      // something remembered from a referenced line is in the callback
      const said = c.refs.map(r => lines[r]!.text.toLowerCase()).join(' ');
      const words = lineKey(c.text)
        .split(' ')
        .filter(w => w.length > 3 && /^[a-z]/.test(w));
      expect(
        words.some(w => said.includes(w)),
        `${c.text} ← ${said}`,
      ).toBe(true);
    }
  });

  it('driving banter follows the driving', () => {
    const g = new ChatterGen(3);
    g.cast({ role: 'passenger', name: 'PIP', seed: [1, 2, 3, 4, 5], persona: 'nervous' });
    let drive = 0;
    for (let i = 0; i < 30; i++) {
      const l = g.next({ ...ctxAt(1), stunts: { ...EMPTY_TALLY, crash: 1 } })!;
      if (l.topic === 'drive') {
        drive++;
        expect(BANK.driveYou_crash!.some(s => l.text.startsWith(s.slice(0, 20)))).toBe(true);
      }
    }
    expect(drive).toBeGreaterThan(2);
  });

  it('cabbies talk about their own driving, passengers about yours', () => {
    const g = new ChatterGen(5);
    g.cast({ role: 'cabbie', name: 'MOSS', seed: [9], persona: 'hype' });
    for (let i = 0; i < 40; i++) {
      const l = g.next({ ...ctxAt(i), stunts: { ...EMPTY_TALLY, air: 1 } })!;
      if (l.topic === 'drive')
        expect(BANK.driveMe_air!.some(s => l.text.startsWith(s.slice(0, 20)))).toBe(true);
    }
  });

  it('a new town in the registry gets gossip with no new writing', () => {
    expect(lines.some(l => l.text.includes('Brand New Town'))).toBe(true);
  });

  it('same seed, same persona', () => {
    expect(personaOf([1, 2, 3, 4, 5])).toBe(personaOf([1, 2, 3, 4, 5]));
    const ps = new Set(Array.from({ length: 60 }, (_, i) => personaOf([i, i * 3, 7, i, 2])));
    expect(ps.size).toBeGreaterThanOrEqual(5);
  });

  it('speaks registry names in mixed case', () => {
    expect(spokenName('DRY GULCH')).toBe('Dry Gulch');
    expect(spokenName('THE NOGGLE ARCH')).toBe('The Noggle Arch');
    expect(spokenName('NOUNS CAMP TOWER')).toBe('Nouns Camp Tower');
    expect(spokenName('Puerto Noun')).toBe('Puerto Noun');
  });
});

describe('rules', () => {
  it('gate: muted beats radio beats events', () => {
    expect(gate({ active: false, muted: false, radioOn: false, eventLeft: 0 })).toBe('off');
    expect(gate({ active: true, muted: true, radioOn: true, eventLeft: 1 })).toBe('muted');
    expect(gate({ active: true, muted: false, radioOn: true, eventLeft: 1 })).toBe('radio');
    expect(gate({ active: true, muted: false, radioOn: false, eventLeft: 1 })).toBe('event');
    expect(gate({ active: true, muted: false, radioOn: false, eventLeft: 0 })).toBe('talk');
  });
  it('gaps: a breath, and a longer silence every sixth line', () => {
    for (let n = 0; n < 12; n++) {
      const g = gapAfter(4, n, 0.5);
      if (n % 6 === 5) expect(g).toBeGreaterThanOrEqual(2.5);
      else expect(g).toBeLessThan(2.5);
      expect(g).toBeGreaterThan(0.4);
    }
  });
  it('mute is remembered', () => {
    const store = new Map<string, string>();
    expect(readMuted(k => store.get(k) ?? null)).toBe(false);
    writeMuted((k, v) => store.set(k, v), true);
    expect(store.get(MUTE_KEY)).toBe('1');
    expect(readMuted(k => store.get(k) ?? null)).toBe(true);
    expect(
      readMuted(() => {
        throw new Error('blocked');
      }),
    ).toBe(false);
  });
  const base: VoicePlanIn = {
    mode: 'auto',
    device: { coarse: false, saveData: false, effectiveType: '4g', memory: 8 },
    weak: false,
    realOn: true,
    houseFailed: false,
  };
  it('voice: borrows the shared house when real voices are on', () => {
    expect(voicePlan(base)).toBe('shared');
  });
  it('voice: a touch device loads its own copy for the ride', () => {
    expect(voicePlan({ ...base, realOn: false, device: { coarse: true, saveData: false } })).toBe(
      'private',
    );
  });
  it('voice: falls back on off / data saver / slow link / weak phone / failure', () => {
    expect(voicePlan({ ...base, mode: 'off', realOn: false })).toBe('none');
    expect(voicePlan({ ...base, realOn: false, device: { coarse: true, saveData: true } })).toBe(
      'none',
    );
    expect(
      voicePlan({
        ...base,
        realOn: false,
        device: { coarse: true, saveData: false, effectiveType: '3g' },
      }),
    ).toBe('none');
    expect(voicePlan({ ...base, realOn: false, weak: true })).toBe('none');
    expect(voicePlan({ ...base, houseFailed: true })).toBe('none');
  });
  it('voice status for the HUD', () => {
    expect(voiceStatus('none', false)).toBe('fallback');
    expect(voiceStatus('private', false)).toBe('loading');
    expect(voiceStatus('shared', true)).toBe('house');
  });
  it('house tuning: stable per seed, cabbies lower than passengers', () => {
    expect(houseTuning([1, 2], 'cabbie')).toEqual(houseTuning([1, 2], 'cabbie'));
    for (let i = 0; i < 50; i++) {
      const c = houseTuning([i, 3], 'cabbie');
      const p = houseTuning([i, 3], 'passenger');
      expect(c.pitch).toBeLessThan(p.pitch);
      expect(c.rate).toBeGreaterThan(0.9);
      expect(p.rate).toBeLessThan(1.15);
    }
  });
});

describe('llm (optional source)', () => {
  it('parses a fenced JSON reply', () => {
    expect(parseLlmLines('```json\n{"lines":["One.","Two."]}\n```')).toEqual(['One.', 'Two.']);
    expect(parseLlmLines('nope')).toEqual([]);
  });
  it('cleans: bounds, links, emoji, repeats', () => {
    const said = new Set([lineKey('Old line here.')]);
    const out = cleanLines(
      [
        '"A perfectly fine line about Dry Gulch."',
        'too short',
        'Visit https://example.com today, friend.',
        'Emoji are not spoken 🚕 at all here.',
        'Old line here!',
        'A perfectly fine line about Dry Gulch.',
        'x'.repeat(300),
      ],
      t => said.has(lineKey(t)),
    );
    expect(out).toEqual(['A perfectly fine line about Dry Gulch.']);
  });
  it('validates a request', () => {
    expect(parseAsk(null)).toBeNull();
    expect(parseAsk({ role: 'pilot' })).toBeNull();
    const a = parseAsk({
      role: 'cabbie',
      persona: 'evil',
      tod: 'noon',
      places: ['a', 1],
      recent: [],
    })!;
    expect(a.persona).toBe('chatty');
    expect(a.tod).toBe('afternoon');
    expect(a.places).toEqual(['a', '']);
  });
  it('off unless asked for', () => {
    expect(llmWanted('', null)).toBe(false);
    expect(llmWanted('?play=taxi&chatllm=1', null)).toBe(true);
    expect(llmWanted('', '1')).toBe(true);
  });
});
