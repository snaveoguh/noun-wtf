// ── NOUN TAXI chatter: endless lines that never repeat (pure) ─────────────
//
// One ChatterGen per session (TaxiSystem owns it), so nobody in any cab says
// the same line twice while the page is open. `cast()` sets who is talking
// (cabbie or passenger, their persona from their seed, where they're going)
// and clears what they remember; `next(ctx)` writes their next line.
//
// Each line picks a topic (weighted by persona and what's happening: stunts
// since the last line make driving banter likely; a remembered person or
// town makes a callback possible), expands one of its templates from the
// bank with the world's places bound in, and is kept only if its words
// haven't been said this session (grammar.lineKey). Captured slots
// ({sym>slot}) become memories, and a callback ({@slot}) records the line it
// refers back to in `refs`.

import type { Persona, Role, Topic, DriveMoment } from './bank';

import {
  BANK,
  CITY_PLACES,
  GENERIC_LANDMARK,
  GENERIC_TOWN,
  GOOD_NAMES,
  LANDMARK_FACTS,
  PERSONA_TAGS,
  PERSONAS,
  TOD_LINES,
  TOPIC_WEIGHT,
  TOWN_FACTS,
} from './bank';
import { Decks, expand, lineKey, needs, tidy, type Rules } from './grammar';

export type Tod = 'afternoon' | 'golden' | 'blue' | 'night';

/** A place the chatter can name (from the taxi's destination registry). */
export interface ChatPlace {
  id: string;
  /** Spoken name ("Dry Gulch", not "DRY GULCH"). */
  name: string;
  kind: 'town' | 'landmark' | 'spot' | 'door';
  /** Towns: TOWN_SPECS style + what they make. Landmarks: their def id. */
  style?: string;
  makes?: readonly string[];
  landmark?: string;
}

/** Stunts since the last line (TaxiSystem counts them). */
export interface StuntTally {
  air: number;
  drift: number;
  nearMiss: number;
  crash: number;
}

export interface ChatContext {
  /** Where the ride is going (spoken name), if anywhere. */
  dest: string | null;
  tod: Tod;
  kmh: number;
  stunts: StuntTally;
  places: readonly ChatPlace[];
}

export interface Cast {
  role: Role;
  name: string;
  /** Their Noun seed (or anything stable): picks the persona. */
  seed: readonly number[];
  persona?: Persona;
}

export interface ChatLine {
  /** Index in this session (0, 1, 2 …). */
  id: number;
  text: string;
  topic: Topic;
  role: Role;
  persona: Persona;
  /** Earlier lines (ids) this one calls back to. */
  refs: number[];
}

/** Lines are kept between these lengths (characters). */
export const LINE_MIN = 12;
export const LINE_MAX = 240;

const TOPICS: readonly Topic[] = [
  'story',
  'gossip',
  'landmark',
  'dest',
  'drive',
  'tod',
  'lore',
  'musing',
  'question',
  'food',
  'callback',
];

/** A memory can be called back to this many lines after it was made. */
const CALLBACK_AFTER = 3;

/**
 * Pools of whole sentences: each option is said at most once a session (the
 * rest are fragments, reused in new combinations). When one runs dry its
 * templates fail and the topic rests (DRY_FOR lines).
 */
export const ONCE_RULES: ReadonlySet<string> = new Set([
  'featLine',
  'townFact',
  'townFact_lc',
  'landmarkFact',
  'todLine',
  'loreLine',
  'musing',
  'question',
  'foodTake',
  'driveYou',
  'driveMe',
]);
const DRY_FOR = 25;

export const EMPTY_TALLY: StuntTally = { air: 0, drift: 0, nearMiss: 0, crash: 0 };

/** Persona from a seed: same Noun, same personality. */
export function personaOf(seed: readonly number[]): Persona {
  let h = 2166136261;
  for (const v of seed) h = Math.imul(h ^ (v | 0), 16777619) >>> 0;
  return PERSONAS[h % PERSONAS.length]!;
}

/** What the driving's been like lately, worst first. */
export function driveMoment(kmh: number, s: StuntTally): DriveMoment {
  if (s.crash > 0) return 'crash';
  if (s.air > 0) return 'air';
  if (s.nearMiss > 0) return 'miss';
  if (s.drift > 0) return 'drift';
  if (kmh > 110) return 'fast';
  return 'calm';
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "DRY GULCH" → "Dry Gulch"; names already in mixed case are left alone. */
export function spokenName(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/(^|[\s'\-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())
    .replace(/(?!^)\b(Of|The|And)\b/g, (m: string, _w: string, i: number) =>
      i === 0 ? m : m.toLowerCase(),
    );
}

interface Memory {
  value: string;
  at: number;
}

export class ChatterGen {
  private rand: () => number;
  private decks: Decks;
  private said = new Set<string>();
  private lines: ChatLine[] = [];
  private mem = new Map<string, Memory>();
  private cast_: Cast & { persona: Persona } = {
    role: 'passenger',
    name: 'Passenger',
    seed: [0],
    persona: 'chatty',
  };
  private lastTopic: Topic | null = null;
  private sinceCast = 0;
  /** Once-rule sentences already said (lineKey of the sentence). */
  private onceUsed = new Set<string>();
  /** Topic → line index it rests until (its pools ran dry). */
  private dry = new Map<Topic, number>();
  private fails = new Map<Topic, number>();

  constructor(seed = 1) {
    let s = seed >>> 0 || 1;
    this.rand = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    this.decks = new Decks(this.rand);
  }

  /** Lines written this session. */
  get count(): number {
    return this.lines.length;
  }

  get persona(): Persona {
    return this.cast_.persona;
  }

  /** A new speaker: their persona, and a clean memory (lines already said stay said). */
  cast(c: Cast) {
    this.cast_ = { ...c, persona: c.persona ?? personaOf(c.seed) };
    this.mem.clear();
    this.sinceCast = 0;
  }

  /** Whether `text` (by its words) has been said this session. */
  hasSaid(text: string): boolean {
    return this.said.has(lineKey(text));
  }

  /** Mark a line said elsewhere (an LLM line, an event line) so it isn't repeated. */
  markSaid(text: string) {
    this.said.add(lineKey(text));
  }

  /** The next line, or null if nothing new could be written (never in practice). */
  next(ctx: ChatContext): ChatLine | null {
    for (let attempt = 0; attempt < 80; attempt++) {
      const topic = this.pickTopic(ctx, attempt);
      const made = this.write(topic, ctx);
      const key = made === null ? '' : lineKey(made.text);
      if (
        made === null ||
        this.said.has(key) ||
        made.text.length < LINE_MIN ||
        made.text.length > LINE_MAX
      ) {
        const f = (this.fails.get(topic) ?? 0) + 1;
        this.fails.set(topic, f);
        if (f >= 4) {
          this.dry.set(topic, this.lines.length + DRY_FOR);
          this.fails.set(topic, 0);
        }
        continue;
      }
      this.fails.set(topic, 0);
      this.said.add(key);
      for (const o of made.once) this.onceUsed.add(o);
      const line: ChatLine = {
        id: this.lines.length,
        text: made.text,
        topic,
        role: this.cast_.role,
        persona: this.cast_.persona,
        refs: made.refs,
      };
      for (const [k, v] of Object.entries(made.caught)) this.mem.set(k, { value: v, at: line.id });
      this.lines.push(line);
      this.lastTopic = topic;
      this.sinceCast++;
      return line;
    }
    return null;
  }

  // ── internals ──

  private weightOf(t: Topic, ctx: ChatContext): number {
    if ((this.dry.get(t) ?? -1) > this.lines.length) return 0;
    const per = TOPIC_WEIGHT[this.cast_.persona][t] ?? 1;
    const stunts = ctx.stunts.air + ctx.stunts.drift + ctx.stunts.nearMiss + ctx.stunts.crash;
    switch (t) {
      case 'drive':
        return per * (stunts > 0 ? 6 : ctx.kmh > 110 ? 1.4 : 0.35);
      case 'callback':
        return this.callbackSlots().length > 0 ? per * 1.6 : 0;
      case 'dest':
        return ctx.dest === null ? 0 : per * (this.sinceCast < 3 ? 1.6 : 0.6);
      case 'gossip':
        return ctx.places.some(p => p.kind === 'town') ? per * 1.4 : 0;
      case 'landmark':
        return ctx.places.some(p => p.kind === 'landmark') ? per * 0.8 : 0;
      case 'story':
        return per * 1.6;
      default:
        return per;
    }
  }

  private pickTopic(ctx: ChatContext, attempt: number): Topic {
    let total = 0;
    const w = TOPICS.map(t => {
      // never the same topic twice running (unless we're struggling)
      const v = t === this.lastTopic && attempt < 40 ? 0 : this.weightOf(t, ctx);
      total += v;
      return v;
    });
    if (total <= 0) return 'story';
    let r = this.rand() * total;
    for (let i = 0; i < TOPICS.length; i++) {
      r -= w[i]!;
      if (r <= 0) return TOPICS[i]!;
    }
    return 'story';
  }

  /** Memories old enough to call back to. */
  private callbackSlots(): string[] {
    const out: string[] = [];
    for (const [k, m] of this.mem) if (this.lines.length - m.at >= CALLBACK_AFTER) out.push(k);
    return out;
  }

  private choose<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rand() * xs.length)]!;
  }

  /** The bank plus this line's world: places, the hour, the driving. */
  private rulesFor(ctx: ChatContext): Rules {
    const towns = ctx.places.filter(p => p.kind === 'town');
    const marks = ctx.places.filter(p => p.kind === 'landmark');
    const town = towns.length > 0 ? this.choose(towns) : null;
    const mark = marks.length > 0 ? this.choose(marks) : null;
    const goods = (town?.makes ?? []).map(g => GOOD_NAMES[g] ?? g.toLowerCase());
    const facts = town !== null ? (TOWN_FACTS[town.style ?? ''] ?? GENERIC_TOWN) : GENERIC_TOWN;
    const markFacts = [
      ...(mark?.landmark !== undefined ? (LANDMARK_FACTS[mark.landmark] ?? []) : []),
      ...GENERIC_LANDMARK,
    ];
    const moment = driveMoment(ctx.kmh, ctx.stunts);
    const places = [...CITY_PLACES, ...ctx.places.filter(p => p.kind !== 'door').map(p => p.name)];
    return {
      ...BANK,
      name: [this.cast_.name],
      dest: [ctx.dest ?? 'wherever we are going'],
      place: places,
      town: [town?.name ?? 'the next town'],
      townFact: facts,
      townFact_lc: facts.map(lowerFirst),
      good: goods.length > 0 ? goods : ['souvenirs'],
      landmark: [mark?.name ?? 'the big statue'],
      landmarkFact: markFacts,
      todLine: TOD_LINES[ctx.tod],
      driveYou: BANK[`driveYou_${moment}`] ?? BANK.driveYou_calm!,
      driveMe: BANK[`driveMe_${moment}`] ?? BANK.driveMe_calm!,
    };
  }

  private topRule(topic: Topic): string {
    const role = this.cast_.role;
    const own = `top_${topic}_${role}`;
    return BANK[own] !== undefined ? own : `top_${topic}`;
  }

  private write(
    topic: Topic,
    ctx: ChatContext,
  ): { text: string; caught: Record<string, string>; refs: number[]; once: string[] } | null {
    const rules = this.rulesFor(ctx);
    const top = this.topRule(topic);
    let templates = rules[top] ?? [];
    const mem: Record<string, string> = {};
    for (const [k, m] of this.mem) mem[k] = m.value;
    if (topic === 'callback') {
      const ok = new Set(this.callbackSlots());
      templates = templates.filter(t => needs(t).every(s => ok.has(s)));
    }
    if (templates.length === 0) return null;
    const t = this.decks.pick(`${top}:${templates.length}`, templates);
    const caught: Record<string, string> = {};
    const once: string[] = [];
    // once-rules skip what's been said (and what this line already took)
    const pick = (key: string, opts: readonly string[]): string => {
      if (!ONCE_RULES.has(key)) return this.decks.pick(key, opts);
      const fresh = opts.filter(o => {
        const k = lineKey(o);
        return !this.onceUsed.has(k) && !once.includes(k);
      });
      if (fresh.length === 0) throw new Error(`dry: ${key}`);
      const v = this.decks.pick(`${key}:fresh`, fresh);
      once.push(lineKey(v));
      return v;
    };
    let text: string;
    try {
      text = expand(t, rules, pick, mem, caught);
    } catch {
      return null;
    }
    // a persona sign-off now and then
    if (topic !== 'callback' && this.rand() < 0.18) {
      const tags = PERSONA_TAGS[this.cast_.persona];
      text = `${text} ${this.choose(tags)}`;
    }
    const refs = [...new Set(needs(t).map(s => this.mem.get(s)!.at))];
    // callbacks don't capture: what they name is already remembered
    return { text: tidy(text), caught: topic === 'callback' ? {} : caught, refs, once };
  }
}

/** A session seed for the generator (different every page load). */
export function sessionSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
}
