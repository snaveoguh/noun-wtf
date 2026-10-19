// ── NOUN FM's DJ update: read the chain, write the script, voice it ──────
//
// Shared by netlify/functions/fm-dj-update.ts (scheduled every 12 h) and
// netlify/functions/fm-dj.ts (GET for the game). Everything comes straight
// from Ethereum mainnet over free public RPCs (the Railway indexer isn't
// needed): the last ~24 h (7200 blocks) of logs from
//   Nouns V1 auction house   AuctionBid / AuctionSettled
//   Nouns DAO governor       ProposalCreated / VoteCast / Queued / Executed / Canceled
//   NounV2 auction house     AuctionBid / AuctionSettled
//   NounV2 treasury (gov)    ProposalCreated / VoteCast / Queued / Executed / Canceled
// in a handful of bounded getLogs calls, plus reverse ENS for at most four
// winners / bidders. The script is templated from those facts in the DJ's
// voice (src/miniapps/world2/radio/djScript.ts + djVoice.json).
//
// Optional, from Netlify env (never from the repo):
//   ANTHROPIC_API_KEY   polish the template with Claude (kept only if every
//                       number / name survives and nothing new appears)
//   OPENAI_API_KEY      server-side TTS (mp3 into Blobs); OPENAI_TTS_VOICE,
//                       OPENAI_TTS_MODEL override the defaults
//   ELEVENLABS_API_KEY  TTS via ElevenLabs instead; ELEVENLABS_VOICE_ID,
//                       ELEVENLABS_MODEL override the defaults
// Without them the template script is served and the browser speaks it.

import { createPublicClient, decodeEventLog, fallback, http, parseAbi, type Abi } from 'viem';
import { mainnet } from 'viem/chains';

import {
  composeAlert,
  composeScript,
  emptyDao,
  fmtEth,
  speakable,
  unbackedNumbers,
  type DjDao,
  type DjFacts,
} from '../../src/miniapps/world2/radio/djScript';

/** Same free endpoints the webapp uses (src/config.ts / wagmi), plus two more that serve logs. */
export const DJ_RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://1rpc.io/eth',
  'https://eth.merkle.io',
  'https://rpc.flashbots.net',
  'https://rpc.mevblocker.io',
];

export const DJ_ADDR = {
  v1Auction: '0x830BD73E4184ceF73443C15111a1DF14e495C706',
  v1Gov: '0x6f3E6272A167e8AcCb32072d08E0957F9c79223d',
  v2Auction: '0x9a6ddb16e23967d5482e5bfd7444a04a5d5145fc',
  v2Gov: '0x2cdeb0d251674710840d9fa990d1de138dfe7c00',
} as const;

/** ~24 h of mainnet blocks (12 s slots). */
export const DAY_BLOCKS = 7200n;
/** Blocks per getLogs call (three calls a day; every public RPC above takes this). */
export const LOG_CHUNK = 2400n;
/** Reverse-ENS lookups per run. */
export const MAX_ENS = 4;
/** Regenerate on read when the stored update is older than this. */
export const DJ_STALE_MS = 13 * 3600_000;

const AUCTION_ABI = parseAbi([
  'event AuctionCreated(uint256 indexed nounId, uint256 startTime, uint256 endTime)',
  'event AuctionBid(uint256 indexed nounId, address sender, uint256 value, bool extended)',
  'event AuctionSettled(uint256 indexed nounId, address winner, uint256 amount)',
]);
const V1_GOV_ABI = parseAbi([
  'event ProposalCreated(uint256 id, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
  'event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 votes, string reason)',
  'event ProposalQueued(uint256 id, uint256 eta)',
  'event ProposalExecuted(uint256 id)',
  'event ProposalCanceled(uint256 id)',
]);
const V2_GOV_ABI = parseAbi([
  'event ProposalCreated(uint256 indexed id, address indexed proposer, uint256 startBlock, uint256 endBlock, string description)',
  'event VoteCast(address indexed voter, uint256 indexed proposalId, uint8 support, uint256 votes, string reason)',
  'event ProposalQueued(uint256 indexed id, uint256 eta)',
  'event ProposalExecuted(uint256 indexed id)',
  'event ProposalCanceled(uint256 indexed id)',
]);

export interface RawLog {
  address: string;
  topics: readonly string[];
  data: string;
  blockNumber: bigint | null;
  logIndex: number | null;
}

/** What the update needs from chain (a viem client in production, a fake in tests). */
export interface ChainReader {
  blockNumber(): Promise<bigint>;
  logs(address: string[], fromBlock: bigint, toBlock: bigint): Promise<RawLog[]>;
  ensName(address: string): Promise<string | null>;
}

export function viemReader(rpcs: string[] = DJ_RPCS): ChainReader {
  const client = createPublicClient({
    chain: mainnet,
    transport: fallback(rpcs.map(u => http(u, { timeout: 12_000, retryCount: 1 }))),
  });
  return {
    blockNumber: () => client.getBlockNumber(),
    logs: async (address, fromBlock, toBlock) =>
      (await client.getLogs({
        address: address as `0x${string}`[],
        fromBlock,
        toBlock,
      })) as unknown as RawLog[],
    ensName: address => client.getEnsName({ address: address as `0x${string}` }),
  };
}

const ZERO = /^0x0{40}$/i;

/** A name worth saying on air (plain .eth, short, no oddities). */
export function cleanEns(n: string | null): string | null {
  if (n === null) return null;
  const s = n.toLowerCase();
  return /^[\da-z-]{1,24}(\.[\da-z-]{1,24})?\.eth$/.test(s) ? s : null;
}

function decode(abi: Abi, l: RawLog): { eventName: string; args: Record<string, unknown> } | null {
  try {
    const d = decodeEventLog({
      abi,
      data: l.data as `0x${string}`,
      topics: l.topics as [`0x${string}`, ...`0x${string}`[]],
      strict: true,
    });
    return { eventName: String(d.eventName), args: (d.args ?? {}) as Record<string, unknown> };
  } catch {
    return null;
  }
}

/** The exact top bid per DAO (the facts only keep the formatted amount). */
const topWei = new WeakMap<DjDao, bigint>();

function addAuction(d: DjDao, ev: { eventName: string; args: Record<string, unknown> }) {
  const a = ev.args;
  if (ev.eventName === 'AuctionCreated') d.opened.push(Number(a.nounId));
  else if (ev.eventName === 'AuctionBid') {
    d.bids++;
    const value = a.value as bigint;
    if (value > (topWei.get(d) ?? -1n)) {
      topWei.set(d, value);
      d.topBid = {
        nounId: Number(a.nounId),
        eth: fmtEth(value),
        bidder: String(a.sender),
        name: null,
      };
    }
  } else if (ev.eventName === 'AuctionSettled') {
    const amount = a.amount as bigint;
    // no-bid settles (V4: routed to the treasury) aren't sales
    if (amount <= 0n || ZERO.test(String(a.winner))) {
      d.unsold.push(Number(a.nounId));
      return;
    }
    d.settled.push({
      nounId: Number(a.nounId),
      winner: String(a.winner),
      name: null,
      eth: fmtEth(amount),
    });
  }
}

function addGov(d: DjDao, ev: { eventName: string; args: Record<string, unknown> }) {
  const a = ev.args;
  const id = Number(a.id ?? a.proposalId);
  switch (ev.eventName) {
    case 'ProposalCreated':
      d.created.push(id);
      break;
    case 'ProposalQueued':
      d.queued.push(id);
      break;
    case 'ProposalExecuted':
      d.executed.push(id);
      break;
    case 'ProposalCanceled':
      d.canceled.push(id);
      break;
    case 'VoteCast': {
      d.votes.count++;
      const s = Number(a.support);
      if (s === 1) d.votes.for++;
      else if (s === 0) d.votes.against++;
      else d.votes.abstain++;
      break;
    }
    default:
      break;
  }
}

/** The last ~24 h of Nouns activity, straight from chain. */
export async function readFacts(r: ChainReader, now: number): Promise<DjFacts> {
  const head = await r.blockNumber();
  const from = head - DAY_BLOCKS + 1n;
  const addrs = Object.values(DJ_ADDR).map(a => a.toLowerCase());
  const logs: RawLog[] = [];
  for (let f = from; f <= head; f += LOG_CHUNK) {
    const t = f + LOG_CHUNK - 1n > head ? head : f + LOG_CHUNK - 1n;
    logs.push(...(await r.logs([...Object.values(DJ_ADDR)], f, t)));
  }
  logs.sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? (a.logIndex ?? 0) - (b.logIndex ?? 0)
      : Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)),
  );
  const facts: DjFacts = {
    at: now,
    fromBlock: Number(from),
    toBlock: Number(head),
    v1: emptyDao(),
    v2: emptyDao(),
  };
  for (const l of logs) {
    const a = l.address.toLowerCase();
    if (!addrs.includes(a)) continue;
    if (a === DJ_ADDR.v1Auction.toLowerCase()) {
      const ev = decode(AUCTION_ABI, l);
      if (ev !== null) addAuction(facts.v1, ev);
    } else if (a === DJ_ADDR.v2Auction.toLowerCase()) {
      const ev = decode(AUCTION_ABI, l);
      if (ev !== null) addAuction(facts.v2, ev);
    } else if (a === DJ_ADDR.v1Gov.toLowerCase()) {
      const ev = decode(V1_GOV_ABI, l);
      if (ev !== null) addGov(facts.v1, ev);
    } else {
      const ev = decode(V2_GOV_ABI, l);
      if (ev !== null) addGov(facts.v2, ev);
    }
  }
  // Names for the latest winners + top bidders (capped, best effort)
  const want = new Map<string, string | null>();
  for (const d of [facts.v1, facts.v2]) {
    const s = d.settled.slice(-1)[0];
    if (s !== undefined) want.set(s.winner.toLowerCase(), null);
    if (d.topBid !== null) want.set(d.topBid.bidder.toLowerCase(), null);
  }
  await Promise.all(
    [...want.keys()].slice(0, MAX_ENS).map(async a => {
      try {
        want.set(a, cleanEns(await r.ensName(a)));
      } catch {
        // no name: "an anon wallet"
      }
    }),
  );
  for (const d of [facts.v1, facts.v2]) {
    for (const s of d.settled) s.name = want.get(s.winner.toLowerCase()) ?? null;
    if (d.topBid !== null) d.topBid.name = want.get(d.topBid.bidder.toLowerCase()) ?? null;
  }
  return facts;
}

// ── Optional polish (Claude) ─────────────────────────────────────────────

/** Claude's rewrite of `draft`, or null (no key / error / refusal / it changed the facts). */
export async function polishScript(
  draft: string,
  facts: DjFacts,
  apiKey: string | undefined,
): Promise<string | null> {
  if (apiKey === undefined || apiKey === '') return null;
  try {
    const { claudeRewrite } = await import('./fmDjPolish');
    const text = await claudeRewrite(draft, apiKey);
    return text !== null && acceptPolish(draft, text, facts) ? text : null;
  } catch (e) {
    console.warn('[fm-dj] polish failed, using the template', (e as Error).message);
    return null;
  }
}

/** A rewrite is kept only if it's the right length and carries exactly the draft's facts. */
export function acceptPolish(draft: string, text: string, facts: DjFacts): boolean {
  const n = text.split(/\s+/).filter(Boolean).length;
  if (n < 15 || n > 45) return false;
  if (unbackedNumbers(text, facts).length > 0) return false;
  const nums = (s: string) =>
    (s.replace(/\bV2\b/g, '').match(/\d+(?:\.\d+)?/g) ?? []).sort().join(',');
  if (nums(draft) !== nums(text)) return false;
  const names = draft.match(/\b[\da-z-]+(?:\.[\da-z-]+)?\.eth\b/g) ?? [];
  return names.every(nm => text.includes(nm));
}

// ── Optional server voice (TTS) ──────────────────────────────────────────

const TTS_STYLE =
  'Late-night pirate radio DJ: relaxed, warm, a bit raspy, upbeat, quick delivery, a smile in the voice.';

export async function renderVoice(
  script: string,
  env: Record<string, string | undefined>,
  f: typeof fetch = fetch,
): Promise<ArrayBuffer | null> {
  const input = speakable(script);
  const signal = AbortSignal.timeout(25_000);
  try {
    if (env.OPENAI_API_KEY !== undefined && env.OPENAI_API_KEY !== '') {
      const r = await f('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        signal,
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
          voice: env.OPENAI_TTS_VOICE ?? 'ash',
          input,
          instructions: TTS_STYLE,
          response_format: 'mp3',
        }),
      });
      return r.ok ? await r.arrayBuffer() : null;
    }
    if (env.ELEVENLABS_API_KEY !== undefined && env.ELEVENLABS_API_KEY !== '') {
      const voice = env.ELEVENLABS_VOICE_ID ?? 'pNInz6obpgDQGcFmaJgB';
      const r = await f(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`,
        {
          method: 'POST',
          signal,
          headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
          body: JSON.stringify({
            text: input,
            model_id: env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2',
          }),
        },
      );
      return r.ok ? await r.arrayBuffer() : null;
    }
  } catch (e) {
    console.warn('[fm-dj] tts failed, the browser will speak it', (e as Error).message);
  }
  return null;
}

// ── Storage + handlers ───────────────────────────────────────────────────

export interface DjDoc {
  script: string;
  alert: string;
  at: number;
  polished: boolean;
  /** Blob key of the rendered voice (audio/<at>.mp3), if any. */
  audio: string | null;
  facts: DjFacts;
}

/** The slice of a Netlify Blobs store this uses. */
export interface DjStore {
  get(key: string, opts: { type: 'json' }): Promise<unknown>;
  get(key: string, opts: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>;
  setJSON(key: string, value: unknown): Promise<unknown>;
  set(key: string, value: ArrayBuffer): Promise<unknown>;
}

export interface DjDeps {
  reader: ChainReader;
  store: DjStore;
  env: Record<string, string | undefined>;
  now: () => number;
  fetch?: typeof fetch;
}

/** Facts are JSON-safe already (numbers / strings): store them for the record. */
export async function runDjUpdate(d: DjDeps): Promise<DjDoc> {
  const at = d.now();
  const facts = await readFacts(d.reader, at);
  const draft = composeScript(facts);
  const polished = await polishScript(draft, facts, d.env.ANTHROPIC_API_KEY);
  const script = polished ?? draft;
  let audio: string | null = null;
  const voice = await renderVoice(script, d.env, d.fetch ?? fetch);
  if (voice !== null && voice.byteLength > 1000) {
    audio = `audio/${at}.mp3`;
    await d.store.set(audio, voice);
  }
  const doc: DjDoc = {
    script,
    alert: composeAlert(facts),
    at,
    polished: polished !== null,
    audio,
    facts,
  };
  await d.store.setJSON('latest', doc);
  return doc;
}

function isDoc(v: unknown): v is DjDoc {
  const d = v as Partial<DjDoc> | null;
  return typeof d?.script === 'string' && typeof d.at === 'number';
}

export const DJ_PATH = '/.netlify/functions/fm-dj';

export function publicView(doc: DjDoc) {
  return {
    script: doc.script,
    alert: doc.alert,
    at: doc.at,
    audioUrl: doc.audio !== null ? `${DJ_PATH}?audio=${encodeURIComponent(doc.audio)}` : null,
  };
}

const json = (status: number, body: unknown, maxAge = 0) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store',
    },
  });

/** GET: the latest update (regenerated if stale), or `?audio=<key>` its voice. */
export async function handleDjGet(url: URL, d: DjDeps): Promise<Response> {
  const audio = url.searchParams.get('audio');
  if (audio !== null) {
    if (!/^audio\/\d{10,16}\.mp3$/.test(audio)) return json(400, { error: 'bad key' });
    const buf = await d.store.get(audio, { type: 'arrayBuffer' });
    if (buf === null) return json(404, { error: 'gone' });
    return new Response(buf, {
      headers: {
        'content-type': 'audio/mpeg',
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  }
  let doc: DjDoc | null = null;
  try {
    const v = await d.store.get('latest', { type: 'json' });
    if (isDoc(v)) doc = v;
  } catch {
    // treat as missing
  }
  if (doc === null || d.now() - doc.at > DJ_STALE_MS) {
    try {
      doc = await runDjUpdate(d);
    } catch (e) {
      console.warn('[fm-dj] update failed', (e as Error).message);
      if (doc === null) return json(503, { error: 'no update yet' });
    }
  }
  return json(200, publicView(doc), 300);
}
