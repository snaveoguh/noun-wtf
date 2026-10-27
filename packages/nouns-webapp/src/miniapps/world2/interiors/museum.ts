// ── The PROP MUSEUM: real Nouns DAO proposals on display ─────────────────
//
// One plaza gallery is the Prop Museum (`markPropMuseum`). Its plinths carry
// the famous props (FEATURED), its wall placards the latest ones. They come
// from the same Ponder API the vote pages read (`API_BASE`), over GraphQL so
// only the few fields shown travel: fetched lazily the first time you walk
// in, cached for the session (and in localStorage for the next one). Until
// then, or offline, the placards show a snapshot taken 2026-10-26.
//
// The indexer stores events, so a vote that just ended unexecuted still
// reads PENDING there; `label` derives what happened from the votes, the
// quorum and the age instead of ever showing a stale PENDING.

import type { BuildingDoor } from './contract';

import { API_BASE } from '@/lib/api';

export interface Exhibit {
  id: number;
  title: string;
  /** Indexer status (EXECUTED, CANCELLED, VETOED, QUEUED, PENDING, ACTIVE…). */
  status: string;
  forVotes: number;
  againstVotes: number;
  quorum: number;
  /** Unix seconds. */
  created: number;
  /** ETH sent out (not counting stakes, wraps, USDC buys or treasury moves), USDC paid. */
  eth: number;
  usdc: number;
  /** ETH converted (staked, wrapped, swapped for USDC) rather than spent. */
  converted: number;
}

const DAY = 86_400;

/** What a placard says happened: EXECUTED, DEFEATED, PASSED, VOTING, CANCELLED… */
export function label(e: Exhibit, now = Date.now() / 1000): string {
  const s = e.status.toUpperCase();
  if (['EXECUTED', 'CANCELLED', 'VETOED', 'QUEUED', 'EXPIRED'].includes(s)) return s;
  // Voting closes within about two weeks of a prop going up
  if (now - e.created < 14 * DAY) return 'VOTING';
  const passed = e.forVotes > e.againstVotes && e.forVotes >= e.quorum;
  return passed ? 'PASSED' : 'DEFEATED';
}

/** Placard colour per outcome. */
export function labelColor(l: string): string {
  switch (l) {
    case 'EXECUTED':
    case 'PASSED':
    case 'QUEUED':
      return '#1f8a4c';
    case 'DEFEATED':
    case 'VETOED':
      return '#d22209';
    case 'VOTING':
      return '#2c6fb0';
    default:
      return '#6b6b6b';
  }
}

/** "Ξ 30 · $2,098,600 USDC", or what the money did when nothing was asked. */
export function askText(e: Exhibit): string {
  const parts: string[] = [];
  if (e.eth >= 0.01) parts.push(`Ξ ${fmt(e.eth)}`);
  if (e.usdc >= 1) parts.push(`$${fmt(e.usdc)} USDC`);
  if (parts.length > 0) return parts.join(' · ');
  if (e.converted >= 0.01) return `Ξ ${fmt(e.converted)} staked, swapped or moved in-house`;
  return 'no funds asked';
}

function fmt(n: number): string {
  return n >= 100
    ? Math.round(n).toLocaleString('en-US')
    : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const ex = (
  id: number,
  title: string,
  status: string,
  forVotes: number,
  againstVotes: number,
  created: number,
  eth = 0,
  usdc = 0,
  converted = 0,
  quorum = 0,
): Exhibit => ({
  id,
  title,
  status,
  forVotes,
  againstVotes,
  quorum,
  created,
  eth,
  usdc,
  converted,
});

/**
 * The famous ones, centre stage (by what they did: the first prop, the
 * biggest stake, the V3 upgrade and fork, the largest USDC asks, the most
 * contested vote, …). Amounts from their executed transactions.
 */
export const FEATURED: readonly Exhibit[] = [
  ex(1, 'Donate 5 ETH each to 6 Charities', 'EXECUTED', 7, 0, 1629393904, 30),
  ex(3, 'Nouns Party', 'EXECUTED', 14, 0, 1630529009, 96),
  ex(
    100,
    'Make Nouns VISIBLE FROM SPACE + Ubiquitous at the Largest Charity Beer Garden & Tailgate in the Country',
    'EXECUTED',
    43,
    1,
    1656259638,
    225.15,
  ),
  ex(332, 'Stake 10000 ETH to Lido', 'EXECUTED', 230, 104, 1689196343, 0, 0, 10000),
  ex(
    356,
    'Nouns DAO V3 upgrade, including Nouns Fork (Will Not Cancel)',
    'EXECUTED',
    201,
    54,
    1692008639,
    0,
    0,
    2500,
  ),
  ex(466, 'Nouns Esports 2024', 'EXECUTED', 114, 11, 1702712183, 0, 2098600, 1809.79),
  ex(687, 'Nouns Movie - The Final Prop ⌐◨-◨', 'EXECUTED', 139, 41, 1730994107, 0, 1125000, 335.24),
  ex(955, 'Set Auction Reserve Price to 2.8 ETH', 'EXECUTED', 333, 280, 1776273347),
];

/** The latest props as of 2026-10-26, for the walls until (or unless) the API answers. */
export const SNAPSHOT: readonly Exhibit[] = [
  ex(999, 'Bring Offline AI Research to Android', 'PENDING', 56, 101, 1790527199, 2, 0, 0, 136),
  ex(998, 'Unwrap & Stake Treasury WETH', 'EXECUTED', 220, 73, 1789682183, 0, 0, 142.81, 136),
  ex(996, 'Camp operational costs 2026/2027', 'PENDING', 83, 93, 1788853583, 0, 8500, 0, 136),
  ex(
    995,
    'Nouns Treasury: Keep USDC Liquid, Earn Yield While It Waits',
    'PENDING',
    65,
    103,
    1788369299,
    0,
    0,
    0,
    136,
  ),
  ex(993, 'Nounworks for Nouns', 'PENDING', 154, 278, 1787840039, 0, 300000, 0, 136),
  ex(992, 'Fake World Assets', 'PENDING', 155, 311, 1787409227, 30, 0, 0, 136),
  ex(991, 'Cancel the Endaoment Stream', 'EXECUTED', 359, 34, 1787248031, 0, 0, 0, 136),
  ex(
    990,
    'Nouns scooter : irl public goods at noyo gimbal view, indonesia',
    'PENDING',
    98,
    92,
    1787052275,
    0,
    7015,
    0,
    136,
  ),
];

// ── Which gallery is the museum ──────────────────────────────────────────

export const MUSEUM_NAME = 'Prop Museum';

/**
 * Make one plaza gallery the Prop Museum: one already called a museum if
 * there is one, else the gallery nearest the plaza's centre. Returns its id.
 */
export function markPropMuseum(doors: BuildingDoor[]): string | null {
  const galleries = doors.filter(d => d.area === 'plaza' && d.kind === 'gallery');
  if (galleries.length === 0) return null;
  const named = galleries.find(d => /museum/i.test(d.name ?? ''));
  const pick =
    named ??
    [...galleries].sort(
      (a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z) || (a.id < b.id ? -1 : 1),
    )[0]!;
  pick.name = MUSEUM_NAME;
  return pick.id;
}

export function isPropMuseum(door: Pick<BuildingDoor, 'name' | 'area'>): boolean {
  return door.area === 'plaza' && door.name === MUSEUM_NAME;
}

// ── Live data ────────────────────────────────────────────────────────────

const CACHE_KEY = 'noun-world-prop-museum-v1';
const CACHE_MS = 6 * 3600 * 1000;
let live: Exhibit[] | null = null;
let loading: Promise<Exhibit[] | null> | null = null;

/** Latest props from the API (cached), or null when it can't be reached. */
export function latestProps(count = 12): Promise<Exhibit[] | null> {
  if (live !== null) return Promise.resolve(live);
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw !== null) {
      const c = JSON.parse(raw) as { at: number; items: Exhibit[] };
      if (Date.now() - c.at < CACHE_MS && Array.isArray(c.items) && c.items.length > 0) {
        live = c.items;
        return Promise.resolve(live);
      }
    }
  } catch {
    // (no storage: just fetch)
  }
  loading ??= fetchLatest(count)
    .then(items => {
      live = items;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), items }));
      } catch {
        // (fine)
      }
      return items;
    })
    .catch(() => null)
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Tokens the treasury converts into rather than spends (Lido, WETH, Token Buyer, mETH) and its own timelocks. */
const NOT_SPENT = new Set([
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
  '0x4f2acdc74f6941390d9b1804fabc3e780388cfe5',
  '0xe3cbd06d7dadb3f4e6557bab7edd924cd1489e8f',
  '0xb1a32fc9f9d8b2cf86c068cae13108809547ef71',
  '0x0bc3807ec262cb779b38d65b38158acc3bfede10',
]);
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';

interface RawTx {
  value: string | null;
  signature: string | null;
  calldata: string | null;
  target: string | null;
}
interface RawProp {
  id: string;
  status: string;
  description: string | null;
  forVotes: number | string;
  againstVotes: number | string;
  quorumVotes: number | string | null;
  createdAt: string | number;
  transactions?: { items: RawTx[] };
}

async function fetchLatest(count: number): Promise<Exhibit[]> {
  const query = `{ proposals(limit: ${count}, orderBy: "createdAt", orderDirection: "desc") { items { id status description forVotes againstVotes quorumVotes createdAt transactions { items { value signature calldata target } } } } }`;
  const res = await fetch(`${API_BASE}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { proposals?: { items?: RawProp[] } } };
  const items = json.data?.proposals?.items ?? [];
  if (items.length === 0) throw new Error('no proposals');
  return items.map(toExhibit);
}

/** A proposal row (+ its transactions) → an exhibit. */
export function toExhibit(p: RawProp): Exhibit {
  let eth = 0;
  let usdc = 0;
  let converted = 0;
  for (const t of p.transactions?.items ?? []) {
    const v = Number(BigInt(t.value ?? '0')) / 1e18;
    const target = (t.target ?? '').toLowerCase();
    if (NOT_SPENT.has(target)) converted += v;
    else eth += v;
    const sig = t.signature ?? '';
    const data = (t.calldata ?? '0x').slice(2);
    // USDC: the Payer's sendOrRegisterDebt(to, amount), or a plain USDC transfer(to, amount)
    if (
      data.length >= 128 &&
      (sig.startsWith('sendOrRegisterDebt') || (sig.startsWith('transfer(') && target === USDC))
    )
      usdc += Number(BigInt(`0x${data.slice(64, 128)}`)) / 1e6;
  }
  return {
    id: Number(p.id),
    title: titleOf(p.description),
    status: p.status,
    forVotes: Number(p.forVotes ?? 0),
    againstVotes: Number(p.againstVotes ?? 0),
    quorum: Number(p.quorumVotes ?? 0),
    created: Number(p.createdAt ?? 0),
    eth,
    usdc,
    converted,
  };
}

/** A proposal's title: the first non-empty line of its description, minus markdown heading marks. */
export function titleOf(description: string | null | undefined): string {
  for (const line of (description ?? '').replace(/\\n/g, '\n').split('\n')) {
    const t = line.replace(/^#+\s*/, '').trim();
    if (t !== '') return t.slice(0, 140);
  }
  return 'Untitled';
}
