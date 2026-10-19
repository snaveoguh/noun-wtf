// ── NOUN FM DJ update: on-chain facts → a ~10 s script in the DJ's voice ──
//
// Pure, shared by the Netlify function (netlify/lib/fmDj.ts, which reads the
// facts from chain) and the tests. Templates + the phrase banks in
// djVoice.json (the owner's tone, see djVoice.md). Every number and name in
// the output comes from `DjFacts`; the banks hold no numbers or claims.

import voice from './djVoice.json';

export interface DjSettle {
  nounId: number;
  winner: string;
  /** ENS name, if it resolved. */
  name: string | null;
  /** ETH, formatted ("4.2"). */
  eth: string;
}

export interface DjDao {
  settled: DjSettle[];
  /** Settled with no bid (V4: the noun goes to the treasury). */
  unsold: number[];
  /** Auctions that opened. */
  opened: number[];
  bids: number;
  topBid: { nounId: number; eth: string; bidder: string; name: string | null } | null;
  created: number[];
  queued: number[];
  executed: number[];
  canceled: number[];
  votes: { count: number; for: number; against: number; abstain: number };
}

export interface DjFacts {
  /** When it was read (ms). */
  at: number;
  fromBlock: number;
  toBlock: number;
  v1: DjDao;
  v2: DjDao;
}

export function emptyDao(): DjDao {
  return {
    settled: [],
    unsold: [],
    opened: [],
    bids: 0,
    topBid: null,
    created: [],
    queued: [],
    executed: [],
    canceled: [],
    votes: { count: 0, for: 0, against: 0, abstain: 0 },
  };
}

/** Wei → "4.2" (at most 2 decimals, never "0" for a non-zero amount). */
export function fmtEth(wei: bigint): string {
  const cents = (wei * 100n + 5n * 10n ** 15n) / 10n ** 18n; // rounded to 0.01
  if (cents === 0n && wei > 0n) return '0.01';
  const whole = cents / 100n;
  const frac = cents % 100n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(2, '0').replace(/0$/, '')}`;
}

type Bank = keyof Omit<typeof voice, 'source' | 'anon'>;

/** Deterministic picker (same facts + slot → same words). */
function picker(seed: number) {
  let a = seed >>> 0;
  return (bank: Bank): string => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    const list = voice[bank] as string[];
    return list[Math.floor(r * list.length)]!;
  };
}

function who(name: string | null): string {
  return name ?? voice.anon;
}

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function list(ids: number[]): string {
  const xs = ids.slice(0, 2).map(i => `prop ${i}`);
  return xs.join(' and ');
}

/** Candidate lines, most newsworthy first. */
function segments(f: DjFacts, pick: (b: Bank) => string): string[] {
  const out: string[] = [];
  const daos: [string, DjDao][] = [
    ['', f.v1],
    ['V2 ', f.v2],
  ];
  for (const [tag, d] of daos) {
    const s = d.settled.slice(-1)[0];
    if (s !== undefined)
      out.push(
        `${tag}noun ${s.nounId} went to ${who(s.name)} for ${s.eth} eth. ${pick('verdicts')}`,
      );
  }
  for (const [tag, d] of daos) {
    const u = d.unsold.slice(-1)[0];
    if (u !== undefined) out.push(`${tag}noun ${u} got no bids, off to the treasury it goes.`);
    const o = d.opened.slice(-1)[0];
    if (o !== undefined && d.topBid?.nounId !== o)
      out.push(`${tag}noun ${o} is on the block right now. ${pick('openHype')}`);
  }
  for (const [tag, d] of daos) {
    if (d.executed.length > 0) out.push(`${tag}${list(d.executed)} ${pick('executed')}`);
    if (d.created.length > 0) out.push(`${tag}${list(d.created)} ${pick('created')}`);
  }
  for (const [tag, d] of daos)
    if (d.votes.count > 0)
      out.push(
        `${d.votes.count} ${tag}votes cast, ${d.votes.for} for, ${d.votes.against} against. ${pick('votes')}`,
      );
  for (const [tag, d] of daos) {
    if (d.queued.length > 0) out.push(`${tag}${list(d.queued)} ${pick('queued')}`);
    if (d.settled.length === 0 && d.topBid !== null)
      out.push(
        `${d.bids} ${tag}bids on noun ${d.topBid.nounId}, top one ${d.topBid.eth} eth. ${pick('bidHype')}`,
      );
    if (d.canceled.length > 0) out.push(`${tag}${list(d.canceled)} ${pick('canceled')}`);
  }
  return out;
}

function seedOf(f: DjFacts): number {
  // the 12-hour slot it was written in
  return Math.floor(f.at / (12 * 3600_000)) ^ (f.toBlock & 0xffff);
}

/** The ~10 s update: 25–35 words, facts only. */
export function composeScript(f: DjFacts): string {
  const pick = picker(seedOf(f));
  const open = pick('openers');
  const close = pick('closers');
  const segs = segments(f, pick);
  if (segs.length === 0) return `${open} ${pick('quiet')} ${close}`;
  const body: string[] = [];
  let n = words(open) + words(close);
  for (const s of segs) {
    if (body.length > 0 && n + words(s) > 35) continue;
    body.push(s);
    n += words(s);
    if (n >= 25) break;
  }
  return `${open} ${body.join(' ')} ${close}`;
}

/** The single most newsworthy item, for WORLDWIDE ALERT breaks. */
export function composeAlert(f: DjFacts): string {
  const pick = picker(seedOf(f) ^ 0x5bd1e995);
  const head = pick('alert');
  const segs = segments(f, pick);
  return segs.length > 0 ? `${head} ${segs[0]}` : `${head} ${pick('alertQuiet')}`;
}

/** What TTS / speechSynthesis should say (shorthand expanded so it sounds right). */
export function speakable(s: string): string {
  return s
    .replace(/noun f-m/gi, 'Noun F M')
    .replace(/\bimo\b/gi, 'I M O')
    .replace(/\bgl\b/gi, 'good luck')
    .replace(/\+1/g, 'plus one')
    .replace(/\bV2\b/g, 'V two')
    .replace(/\bs-tier\b/gi, 'S tier')
    .replace(/\beth\b/g, 'E T H')
    .replace(/⌐◨-◨/g, 'noggles');
}

/**
 * Every number token in `script` that the facts don't account for (should be
 * empty). Names are stripped first (ENS names can hold digits).
 */
export function unbackedNumbers(script: string, f: DjFacts): string[] {
  const allowed = new Set<string>();
  const names: string[] = [];
  for (const d of [f.v1, f.v2]) {
    for (const s of d.settled) {
      allowed.add(String(s.nounId));
      allowed.add(s.eth);
      if (s.name !== null) names.push(s.name);
    }
    if (d.topBid !== null) {
      allowed.add(String(d.topBid.nounId));
      allowed.add(d.topBid.eth);
      if (d.topBid.name !== null) names.push(d.topBid.name);
    }
    for (const x of [
      ...d.created,
      ...d.queued,
      ...d.executed,
      ...d.canceled,
      ...d.unsold,
      ...d.opened,
    ])
      allowed.add(String(x));
    allowed.add(String(d.bids));
    for (const v of Object.values(d.votes)) allowed.add(String(v));
  }
  let s = script.replace(/\bV2\b/g, '');
  for (const n of names) s = s.split(n).join('');
  return (s.match(/\d+(?:\.\d+)?/g) ?? []).filter(x => !allowed.has(x));
}
