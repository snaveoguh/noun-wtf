// ── Respect: the rules (pure, shared with netlify/functions/world-respect) ──
//
// One number for the whole game. Events (interiors/contract.ts RespectEvent)
// become points through RULES below; the same module runs in the browser
// (instant feedback, the HUD) and in the function (the authoritative score),
// so both agree on every delta, limit and tier.
//
// Gains (base deltas; `custom` carries its own, clamped to ±10):
//   gift         2·√coin, max 12; the same recipient within an hour halves it
//                each time (1st full, 2nd ½, 3rd ¼ …)            6 / min
//   ate          +1, +3 when you said thanks;  once per place per 5 min
//   bought       +1, +2 from 10 COIN, +3 from 50                  4 / min
//   sat          +1, once per place per 10 min
//   helped       +5, once per person per 2 min                    3 / min
//   trick        a banked combo ≥ 5k pts +1, ≥ 20k +2, ≥ 60k +3, ≥ 150k +4;
//                smaller combos are neutral                       3 / min
//   tagged_wall  +2: a real piece (the hook only reports one after a dozen
//                strokes on one wall; a scribble is neutral)      2 / min
//   served       +1, +2 when the tip is ≥ 8 COIN, +3 when ≥ 20    6 / min
//   hoops_win    +8                                               2 / min
//   break_win    +4 + crew size, max +10                          3 / min
// Losses:
//   refused_food −2, once per place per 2 min
//   overstayed   −4, once per place per 5 min
//   stole        −15 − coin/5, max −30                            3 / min
//   bail_into    −3, once per person per 30 s                     4 / min
//   tagged_home  −10, once per building per 3 min                 3 / min
//   hoops_loss   −1                                               2 / min
//   break_loss   −1                                               3 / min
//
// Over all kinds, at most +40 a minute is gained (the rest is clipped) and
// at most −60 a minute lost (so one glitchy loop can't sink anyone).
// A rate-limited event scores 0 and isn't logged.
//
// Drift (applied before every event and on a timer):
//   above the drift floor of your tier (stranger 0, local 50, regular 200,
//   legend 600) the excess halves every 3 days you're away. Never across a
//   tier boundary: being idle only costs progress inside the tier.
//   below 0 the score recovers +1 per 5 minutes toward 0: outcasts are
//   forgiven, slowly (−100 is back to neutral in ~8 h).
//
// Tiers: outcast < −40 ≤ stranger < 50 ≤ local < 200 ≤ regular < 600 ≤ legend.
// Up the moment you reach a threshold; down only once you're SLACK below the
// tier you hold (stranger/local 10, regular 25, legend 60), so a score
// hovering at a line doesn't flicker.

import type { RespectEvent, RespectTier } from '../interiors/contract';

export const TIERS: readonly RespectTier[] = ['outcast', 'stranger', 'local', 'regular', 'legend'];

/** Where each tier starts on the way up. */
export const TIER_AT: Record<RespectTier, number> = {
  outcast: -Infinity,
  stranger: -40,
  local: 50,
  regular: 200,
  legend: 600,
};

/** How far below its start a held tier survives (hysteresis). */
export const TIER_SLACK: Record<RespectTier, number> = {
  outcast: 0,
  stranger: 10,
  local: 10,
  regular: 25,
  legend: 60,
};

/** Idle drift pulls the excess back to this (never below the tier's start). */
export const DRIFT_FLOOR: Record<RespectTier, number> = {
  outcast: 0,
  stranger: 0,
  local: 50,
  regular: 200,
  legend: 600,
};

/** Progress-bar ends for the open tiers. */
const OUTCAST_BOTTOM = -200;
const LEGEND_TOP = 1500;

export const HALF_LIFE_MS = 3 * 24 * 3600_000;
export const FORGIVE_MS = 5 * 60_000;
export const MINUTE = 60_000;
export const GAIN_PER_MIN = 40;
export const LOSS_PER_MIN = 60;
/** The log keeps an hour (the gift window) and at most this many entries. */
export const LOG_MS = 3600_000;
export const LOG_MAX = 240;

export type RespectKind = RespectEvent['kind'];

interface Rule {
  /** Points before limits (gift diminishing is applied separately). */
  base(e: RespectEvent): number;
  /** Scoring events of this kind per rolling minute. */
  perMin: number;
  /** Same-target dedup: one scoring event per key per `cooldown` ms. */
  key?(e: RespectEvent): string | null;
  cooldown?: number;
  label(e: RespectEvent): string;
}

/** The event type for one kind (members like hoops_win | hoops_loss share a type). */
type Of<K extends RespectKind> = RespectEvent extends infer E
  ? E extends { kind: infer EK }
    ? K extends EK
      ? E
      : never
    : never
  : never;
const as = <K extends RespectKind>(e: RespectEvent) => e as Of<K>;

/** 12345 → "12,345" (locale-free, so tests and the server agree). */
export function groupDigits(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export const TRICK_STEPS: readonly [number, number][] = [
  [150_000, 4],
  [60_000, 3],
  [20_000, 2],
  [5_000, 1],
];

export const RULES: Record<RespectKind, Rule> = {
  gift: {
    base: e => Math.min(12, Math.round(2 * Math.sqrt(Math.max(0, as<'gift'>(e).coin)))),
    perMin: 6,
    label: e => `gave ${as<'gift'>(e).to} ${groupDigits(as<'gift'>(e).coin)} COIN`,
  },
  ate: {
    base: e => (as<'ate'>(e).thanked ? 3 : 1),
    perMin: 3,
    key: e => `ate:${as<'ate'>(e).at}`,
    cooldown: 5 * MINUTE,
    label: e =>
      as<'ate'>(e).thanked ? `ate at ${as<'ate'>(e).at}, said thanks` : `ate at ${as<'ate'>(e).at}`,
  },
  refused_food: {
    base: () => -2,
    perMin: 3,
    key: e => `refused:${as<'refused_food'>(e).at}`,
    cooldown: 2 * MINUTE,
    label: e => `turned down food at ${as<'refused_food'>(e).at}`,
  },
  bought: {
    base: e => {
      const c = as<'bought'>(e).coin;
      return c >= 50 ? 3 : c >= 10 ? 2 : 1;
    },
    perMin: 4,
    label: e => `bought local at ${as<'bought'>(e).at}`,
  },
  stole: {
    base: e => -Math.min(30, 15 + Math.floor(Math.max(0, as<'stole'>(e).coin) / 5)),
    perMin: 3,
    label: e => `stole from ${as<'stole'>(e).at}`,
  },
  sat: {
    base: () => 1,
    perMin: 2,
    key: e => `sat:${as<'sat'>(e).at}`,
    cooldown: 10 * MINUTE,
    label: e => `sat a while at ${as<'sat'>(e).at}`,
  },
  overstayed: {
    base: () => -4,
    perMin: 2,
    key: e => `over:${as<'overstayed'>(e).at}`,
    cooldown: 5 * MINUTE,
    label: e => `overstayed at ${as<'overstayed'>(e).at}`,
  },
  helped: {
    base: () => 5,
    perMin: 3,
    key: e => `helped:${as<'helped'>(e).who}`,
    cooldown: 2 * MINUTE,
    label: e => `helped ${as<'helped'>(e).who}`,
  },
  trick: {
    base: e => {
      const s = as<'trick'>(e).score;
      return TRICK_STEPS.find(([at]) => s >= at)?.[1] ?? 0;
    },
    perMin: 3,
    label: e => `landed a ${groupDigits(as<'trick'>(e).score)} combo`,
  },
  bail_into: {
    base: () => -3,
    perMin: 4,
    key: e => `bail:${as<'bail_into'>(e).who}`,
    cooldown: 30_000,
    label: e => `bailed into ${as<'bail_into'>(e).who}`,
  },
  tagged_home: {
    base: () => -10,
    perMin: 3,
    key: e => `home:${as<'tagged_home'>(e).building}`,
    cooldown: 3 * MINUTE,
    label: () => `tagged someone's home`,
  },
  tagged_wall: {
    base: () => 2,
    perMin: 2,
    key: e => `wall:${as<'tagged_wall'>(e).building ?? ''}`,
    cooldown: MINUTE,
    label: () => 'put up a piece',
  },
  served: {
    base: e => {
      const t = as<'served'>(e).tip;
      return t >= 20 ? 3 : t >= 8 ? 2 : 1;
    },
    perMin: 6,
    label: e =>
      as<'served'>(e).tip >= 8
        ? `served in ${as<'served'>(e).town}, big tip`
        : `served in ${as<'served'>(e).town}`,
  },
  hoops_win: { base: () => 8, perMin: 2, label: () => 'won at hoops' },
  hoops_loss: { base: () => -1, perMin: 2, label: () => 'lost at hoops' },
  break_win: {
    base: e => Math.min(10, 4 + Math.max(0, Math.floor(as<'break_win'>(e).crewSize))),
    perMin: 3,
    label: () => 'won a breakdance battle',
  },
  break_loss: { base: () => -1, perMin: 3, label: () => 'lost a breakdance battle' },
  custom: {
    base: e => Math.max(-10, Math.min(10, Math.round(as<'custom'>(e).amount))),
    perMin: 4,
    label: e => as<'custom'>(e).label,
  },
};

export const KINDS = Object.keys(RULES) as RespectKind[];

// ── The book: everything the limits need, serializable ─────────────────

export interface LogEntry {
  /** Kind. */
  k: RespectKind;
  /** Dedup / recipient key. */
  key?: string;
  /** Delta it scored. */
  d: number;
  at: number;
}

export interface RespectBook {
  score: number;
  tier: RespectTier;
  /** Time the score was last brought up to date (drift applied to). */
  at: number;
  log: LogEntry[];
}

export const newBook = (now: number): RespectBook => ({
  score: 0,
  tier: 'stranger',
  at: now,
  log: [],
});

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Tiers ───────────────────────────────────────────────────────────────

const idx = (t: RespectTier) => TIERS.indexOf(t);

/** The tier for `score`, given the tier held before (hysteresis on the way down). */
export function tierFor(score: number, prev?: RespectTier): RespectTier {
  let raw: RespectTier = 'outcast';
  for (const t of TIERS) if (score >= TIER_AT[t]) raw = t;
  if (prev === undefined || idx(raw) >= idx(prev)) return raw;
  // Falling: keep the highest tier at or below the old one whose slack still holds
  for (let i = idx(prev); i > idx(raw); i--) {
    const t = TIERS[i];
    if (score >= TIER_AT[t] - TIER_SLACK[t]) return t;
  }
  return raw;
}

/** 0..1 through the tier (for the meter). */
export function progressOf(score: number, tier: RespectTier): number {
  const i = idx(tier);
  const lo = tier === 'outcast' ? OUTCAST_BOTTOM : TIER_AT[tier];
  const hi = tier === 'legend' ? LEGEND_TOP : TIER_AT[TIERS[i + 1]];
  return Math.max(0, Math.min(1, (score - lo) / (hi - lo)));
}

/** The next tier and the score it starts at (null at the top). */
export function nextTier(tier: RespectTier): { tier: RespectTier; at: number } | null {
  const n = TIERS[idx(tier) + 1];
  return n === undefined ? null : { tier: n, at: TIER_AT[n] };
}

// ── Drift ───────────────────────────────────────────────────────────────

/** Bring the score up to `now`: the idle drift described in the header. */
export function drift(book: RespectBook, now: number): RespectBook {
  const dt = Math.min(30 * 24 * 3600_000, now - book.at);
  if (!(dt > 0)) return book;
  let score = book.score;
  const floor = DRIFT_FLOOR[book.tier];
  if (score > floor) {
    // Never decay below where the tier starts (no tier lost to idling)
    const keep = Math.max(floor, TIER_AT[book.tier]);
    score = keep + (score - keep) * Math.pow(0.5, dt / HALF_LIFE_MS);
  } else if (score < 0) {
    score = Math.min(0, score + dt / FORGIVE_MS);
  }
  score = round2(score);
  return { ...book, score, tier: tierFor(score, book.tier), at: now };
}

// ── Scoring ─────────────────────────────────────────────────────────────

export type Why = 'rate' | 'cooldown' | 'cap' | 'neutral';

export interface Scored {
  book: RespectBook;
  delta: number;
  label: string;
  /** Why it scored 0 (when it did). */
  why?: Why;
}

/** Score one event at `now`. Pure: returns the next book. */
export function apply(book0: RespectBook, e: RespectEvent, now: number): Scored {
  const rule = RULES[e.kind];
  const label = rule.label(e);
  const book = drift(book0, Math.max(book0.at, now));
  const log = book.log.filter(l => now - l.at < LOG_MS);
  const lastMin = log.filter(l => now - l.at < MINUTE);
  let d = rule.base(e);
  if (d === 0) return { book, delta: 0, label, why: 'neutral' };
  if (lastMin.filter(l => l.k === e.kind).length >= rule.perMin)
    return { book, delta: 0, label, why: 'rate' };
  let key: string | undefined;
  if (rule.key !== undefined) {
    key = rule.key(e) ?? undefined;
    const cd = rule.cooldown ?? MINUTE;
    if (key !== undefined && log.some(l => l.key === key && now - l.at < cd))
      return { book, delta: 0, label, why: 'cooldown' };
  }
  if (e.kind === 'gift') {
    // Diminishing per recipient over the last hour
    key = `gift:${e.to}`;
    const n = log.filter(l => l.key === key).length;
    d = Math.round(d * Math.pow(0.5, n));
    if (d === 0) return { book, delta: 0, label, why: 'cooldown' };
  }
  // The all-kinds caps per minute
  if (d > 0) {
    const gained = lastMin.reduce((s, l) => s + Math.max(0, l.d), 0);
    d = Math.min(d, GAIN_PER_MIN - gained);
  } else {
    const lost = lastMin.reduce((s, l) => s + Math.min(0, l.d), 0);
    d = Math.max(d, -LOSS_PER_MIN - lost);
  }
  if (Math.sign(d) !== Math.sign(rule.base(e)) || d === 0)
    return { book, delta: 0, label, why: 'cap' };
  const score = round2(book.score + d);
  const entry: LogEntry =
    key !== undefined ? { k: e.kind, key, d, at: now } : { k: e.kind, d, at: now };
  return {
    book: {
      score,
      tier: tierFor(score, book.tier),
      at: book.at,
      log: [...log, entry].slice(-LOG_MAX),
    },
    delta: d,
    label,
  };
}

// ── Validation (the server's door, and storage) ─────────────────────────

const MAX_STR = 48;

/** A name / place / id from the outside: printable, short. */
export function cleanStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;

  const s = v
    .replace(/[\u0000-\u001f<>\u007f]/g, '')
    .trim()
    .slice(0, MAX_STR);
  return s.length > 0 ? s : null;
}

function num(v: unknown, lo: number, hi: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}

/** A RespectEvent from untrusted JSON (null if it isn't one). */
export function parseEvent(v: unknown): RespectEvent | null {
  if (v === null || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const k = o.kind;
  switch (k) {
    case 'gift': {
      const to = cleanStr(o.to);
      const coin = num(o.coin, 0, 1e6);
      return to !== null && coin !== null ? { kind: k, to, coin } : null;
    }
    case 'ate': {
      const at = cleanStr(o.at);
      return at !== null ? { kind: k, at, thanked: o.thanked === true } : null;
    }
    case 'refused_food':
    case 'sat':
    case 'overstayed': {
      const at = cleanStr(o.at);
      return at !== null ? { kind: k, at } : null;
    }
    case 'bought':
    case 'stole': {
      const at = cleanStr(o.at);
      const coin = num(o.coin, 0, 1e6);
      return at !== null && coin !== null ? { kind: k, at, coin } : null;
    }
    case 'helped':
    case 'bail_into': {
      const who = cleanStr(o.who);
      return who !== null ? { kind: k, who } : null;
    }
    case 'trick': {
      const score = num(o.score, 0, 1e9);
      return score !== null ? { kind: k, score } : null;
    }
    case 'tagged_home': {
      const building = cleanStr(o.building);
      return building !== null ? { kind: k, building } : null;
    }
    case 'tagged_wall': {
      const building = cleanStr(o.building);
      return building !== null ? { kind: k, building } : { kind: k };
    }
    case 'served': {
      const town = cleanStr(o.town);
      const tip = num(o.tip, 0, 1e5);
      return town !== null && tip !== null ? { kind: k, town, tip } : null;
    }
    case 'hoops_win':
    case 'hoops_loss':
      return { kind: k };
    case 'break_win':
    case 'break_loss': {
      const crewSize = num(o.crewSize, 0, 64);
      return crewSize !== null ? { kind: k, crewSize } : null;
    }
    case 'custom': {
      const label = cleanStr(o.label);
      const amount = num(o.amount, -1e6, 1e6);
      return label !== null && amount !== null ? { kind: k, label, amount } : null;
    }
    default:
      return null;
  }
}

const isTier = (v: unknown): v is RespectTier =>
  typeof v === 'string' && (TIERS as string[]).includes(v);

/** A book from storage / the blob store (a fresh one if it's junk). */
export function normalizeBook(v: unknown, now: number): RespectBook {
  if (v === null || typeof v !== 'object') return newBook(now);
  const o = v as Record<string, unknown>;
  const score = num(o.score, -1e7, 1e7);
  const at = num(o.at, 0, now + MINUTE);
  if (score === null || at === null) return newBook(now);
  const log: LogEntry[] = [];
  if (Array.isArray(o.log))
    for (const l of o.log.slice(-LOG_MAX)) {
      if (l === null || typeof l !== 'object') continue;
      const r = l as Record<string, unknown>;
      const d = num(r.d, -1e3, 1e3);
      const lat = num(r.at, 0, now + MINUTE);
      if (!(KINDS as unknown[]).includes(r.k) || d === null || lat === null) continue;
      const key = typeof r.key === 'string' ? r.key.slice(0, 80) : undefined;
      log.push(
        key !== undefined
          ? { k: r.k as RespectKind, key, d, at: lat }
          : { k: r.k as RespectKind, d, at: lat },
      );
    }
  return { score, tier: isTier(o.tier) ? tierFor(score, o.tier) : tierFor(score), at, log };
}

/** "+4 RESPECT, gave Nadia 5 COIN" */
export function tickerText(delta: number, label: string): string {
  return `${delta > 0 ? '+' : '−'}${Math.abs(delta)} RESPECT, ${label}`;
}

/** What each tier is called on the HUD. */
export const TIER_NAME: Record<RespectTier, string> = {
  outcast: 'OUTCAST',
  stranger: 'STRANGER',
  local: 'LOCAL',
  regular: 'REGULAR',
  legend: 'LEGEND',
};
