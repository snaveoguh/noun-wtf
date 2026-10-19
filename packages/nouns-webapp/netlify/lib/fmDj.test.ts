import { encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { unbackedNumbers } from '../../src/miniapps/world2/radio/djScript';

// The Claude call (real one needs ANTHROPIC_API_KEY + the SDK); each test sets its answer
const rewrite = vi.hoisted(() => ({
  fn: (async () => null) as (draft: string, key: string) => Promise<string | null>,
}));
vi.mock('./fmDjPolish', () => ({ claudeRewrite: (d: string, k: string) => rewrite.fn(d, k) }));

import {
  acceptPolish,
  cleanEns,
  DAY_BLOCKS,
  DJ_ADDR,
  DJ_STALE_MS,
  handleDjGet,
  LOG_CHUNK,
  polishScript,
  readFacts,
  renderVoice,
  runDjUpdate,
  type ChainReader,
  type DjDeps,
  type DjDoc,
  type DjStore,
  type RawLog,
} from './fmDj';

// ── Fake chain: real ABI-encoded logs ──
const AH = parseAbi([
  'event AuctionCreated(uint256 indexed nounId, uint256 startTime, uint256 endTime)',
  'event AuctionBid(uint256 indexed nounId, address sender, uint256 value, bool extended)',
  'event AuctionSettled(uint256 indexed nounId, address winner, uint256 amount)',
]);
const GOV1 = parseAbi([
  'event ProposalCreated(uint256 id, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
  'event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 votes, string reason)',
  'event ProposalExecuted(uint256 id)',
]);
const GOV2 = parseAbi([
  'event ProposalCreated(uint256 indexed id, address indexed proposer, uint256 startBlock, uint256 endBlock, string description)',
  'event VoteCast(address indexed voter, uint256 indexed proposalId, uint8 support, uint256 votes, string reason)',
]);

const WINNER = '0x1111111111111111111111111111111111111111';
const BIDDER = '0x2222222222222222222222222222222222222222';
const V2WIN = '0x3333333333333333333333333333333333333333';
const ETH = 10n ** 18n;
const HEAD = 20_000_000n;

let n = 0;
function log(address: string, topics: string[], data: string, block: bigint): RawLog {
  return { address, topics, data, blockNumber: block, logIndex: n++ };
}

function busyLogs(): RawLog[] {
  const b = HEAD - 100n;
  return [
    log(
      DJ_ADDR.v1Auction,
      encodeEventTopics({ abi: AH, eventName: 'AuctionBid', args: { nounId: 2049n } }),
      encodeAbiParameters(parseAbiParameters('address, uint256, bool'), [BIDDER, 2n * ETH, false]),
      b,
    ),
    log(
      DJ_ADDR.v1Auction,
      encodeEventTopics({ abi: AH, eventName: 'AuctionBid', args: { nounId: 2049n } }),
      encodeAbiParameters(parseAbiParameters('address, uint256, bool'), [
        WINNER,
        (325n * ETH) / 100n,
        false,
      ]),
      b + 1n,
    ),
    log(
      DJ_ADDR.v1Auction,
      encodeEventTopics({ abi: AH, eventName: 'AuctionSettled', args: { nounId: 2049n } }),
      encodeAbiParameters(parseAbiParameters('address, uint256'), [WINNER, (325n * ETH) / 100n]),
      b + 2n,
    ),
    log(
      DJ_ADDR.v1Auction,
      encodeEventTopics({ abi: AH, eventName: 'AuctionCreated', args: { nounId: 2050n } }),
      encodeAbiParameters(parseAbiParameters('uint256, uint256'), [1n, 2n]),
      b + 2n,
    ),
    log(
      DJ_ADDR.v1Gov,
      encodeEventTopics({ abi: GOV1, eventName: 'ProposalExecuted' }),
      encodeAbiParameters(parseAbiParameters('uint256'), [1001n]),
      b + 3n,
    ),
    log(
      DJ_ADDR.v1Gov,
      encodeEventTopics({ abi: GOV1, eventName: 'VoteCast', args: { voter: BIDDER } }),
      encodeAbiParameters(parseAbiParameters('uint256, uint8, uint256, string'), [
        1004n,
        1,
        3n,
        'looks legit imo',
      ]),
      b + 4n,
    ),
    log(
      DJ_ADDR.v1Gov,
      encodeEventTopics({ abi: GOV1, eventName: 'VoteCast', args: { voter: WINNER } }),
      encodeAbiParameters(parseAbiParameters('uint256, uint8, uint256, string'), [
        1004n,
        0,
        1n,
        '',
      ]),
      b + 4n,
    ),
    log(
      DJ_ADDR.v2Auction,
      encodeEventTopics({ abi: AH, eventName: 'AuctionSettled', args: { nounId: 412n } }),
      encodeAbiParameters(parseAbiParameters('address, uint256'), [V2WIN, 8n * 10n ** 16n]),
      b + 5n,
    ),
    log(
      DJ_ADDR.v2Gov,
      encodeEventTopics({
        abi: GOV2,
        eventName: 'ProposalCreated',
        args: { id: 7n, proposer: WINNER },
      }),
      encodeAbiParameters(parseAbiParameters('uint256, uint256, string'), [1n, 2n, '# hi']),
      b + 6n,
    ),
    // a no-bid settle (V4 sends the noun to the treasury)
    log(
      DJ_ADDR.v1Auction,
      encodeEventTopics({ abi: AH, eventName: 'AuctionSettled', args: { nounId: 2048n } }),
      encodeAbiParameters(parseAbiParameters('address, uint256'), [
        '0x0000000000000000000000000000000000000000',
        0n,
      ]),
      b - 50n,
    ),
    // junk from an unrelated contract / undecodable data
    log('0x9999999999999999999999999999999999999999', ['0x01'], '0x', b),
    log(
      DJ_ADDR.v1Gov,
      ['0xdeadbeef00000000000000000000000000000000000000000000000000000000'],
      '0x',
      b,
    ),
  ];
}

function reader(
  logs: RawLog[],
  names: Record<string, string | null> = { [WINNER]: 'memevalue.eth' },
) {
  const calls: [bigint, bigint][] = [];
  const ens: string[] = [];
  const r: ChainReader = {
    blockNumber: async () => HEAD,
    logs: async (_a, from, to) => {
      calls.push([from, to]);
      return logs.filter(l => l.blockNumber! >= from && l.blockNumber! <= to);
    },
    ensName: async a => {
      ens.push(a);
      return names[a.toLowerCase()] ?? null;
    },
  };
  return { r, calls, ens };
}

function memStore() {
  const m = new Map<string, unknown>();
  const store: DjStore = {
    get: (async (k: string) => (m.has(k) ? m.get(k) : null)) as DjStore['get'],
    setJSON: async (k, v) => {
      m.set(k, JSON.parse(JSON.stringify(v)));
    },
    set: async (k, v) => {
      m.set(k, v);
    },
  };
  return { store, m };
}

beforeEach(() => {
  n = 0;
});

describe('reading the chain', () => {
  it('bounded: 24 h of blocks in a few chunked getLogs calls', async () => {
    const { r, calls } = reader([]);
    await readFacts(r, 0);
    expect(calls.length).toBe(Number(DAY_BLOCKS / LOG_CHUNK));
    expect(calls[0]![0]).toBe(HEAD - DAY_BLOCKS + 1n);
    expect(calls[calls.length - 1]![1]).toBe(HEAD);
    for (const [a, b] of calls) expect(b - a + 1n).toBeLessThanOrEqual(LOG_CHUNK);
  });

  it('turns logs into facts (V1 + V2, settles, no-bid settles, bids, props, votes, ENS)', async () => {
    const { r, ens } = reader(busyLogs());
    const f = await readFacts(r, 123);
    expect(f.v1.settled).toEqual([
      { nounId: 2049, winner: WINNER, name: 'memevalue.eth', eth: '3.25' },
    ]);
    expect(f.v1.unsold).toEqual([2048]);
    expect(f.v1.opened).toEqual([2050]);
    expect(f.v1.bids).toBe(2);
    expect(f.v1.topBid).toMatchObject({ nounId: 2049, eth: '3.25' });
    expect(f.v1.executed).toEqual([1001]);
    expect(f.v1.votes).toEqual({ count: 2, for: 1, against: 1, abstain: 0 });
    expect(f.v2.settled).toEqual([{ nounId: 412, winner: V2WIN, name: null, eth: '0.08' }]);
    expect(f.v2.created).toEqual([7]);
    expect(ens.length).toBeLessThanOrEqual(4);
  });

  it('keeps only sane ENS names', () => {
    expect(cleanEns('MemeValue.eth')).toBe('memevalue.eth');
    expect(cleanEns('a.b.c.d.eth')).toBeNull();
    expect(cleanEns('evil name.eth')).toBeNull();
    expect(cleanEns(null)).toBeNull();
  });
});

describe('the scheduled update', () => {
  it('writes a template script from chain facts into Blobs (no keys: no polish, no audio)', async () => {
    const { r } = reader(busyLogs());
    const { store, m } = memStore();
    const fetchSpy = vi.fn();
    const doc = await runDjUpdate({
      reader: r,
      store,
      env: {},
      now: () => 1_700_000_000_000,
      fetch: fetchSpy,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(doc.polished).toBe(false);
    expect(doc.audio).toBeNull();
    expect(doc.script).toContain('noun 2049 went to memevalue.eth for 3.25 eth');
    expect(unbackedNumbers(doc.script, doc.facts)).toEqual([]);
    expect(unbackedNumbers(doc.alert, doc.facts)).toEqual([]);
    expect((m.get('latest') as DjDoc).script).toBe(doc.script);
  });

  it('renders a voice into Blobs when a TTS key is set', async () => {
    const { r } = reader([]);
    const { store, m } = memStore();
    const mp3 = new Uint8Array(5000).buffer;
    const f = vi.fn(async () => new Response(mp3, { status: 200 }));
    const doc = await runDjUpdate({
      reader: r,
      store,
      env: { OPENAI_API_KEY: 'k' },
      now: () => 1_700_000_000_000,
      fetch: f as unknown as typeof fetch,
    });
    expect(doc.audio).toBe('audio/1700000000000.mp3');
    expect(m.get('audio/1700000000000.mp3')).toBeInstanceOf(ArrayBuffer);
    expect((m.get('audio/1700000000000.mp3') as ArrayBuffer).byteLength).toBe(5000);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect(JSON.parse(String(init.body)).input).not.toMatch(/\bimo\b/);
  });

  it('a TTS failure falls back to the browser voice', async () => {
    const f = vi.fn(async () => new Response('nope', { status: 500 }));
    expect(
      await renderVoice('hi', { ELEVENLABS_API_KEY: 'k' }, f as unknown as typeof fetch),
    ).toBeNull();
    expect(await renderVoice('hi', {}, f as unknown as typeof fetch)).toBeNull();
  });
});

describe('GET', () => {
  const deps = (r: ChainReader, store: DjStore, now: number): DjDeps => ({
    reader: r,
    store,
    env: {},
    now: () => now,
  });

  it('serves the stored update without touching the chain', async () => {
    const { store, m } = memStore();
    m.set('latest', {
      script: 'quiet one',
      alert: 'a',
      at: 1000,
      polished: false,
      audio: 'audio/1000000000000.mp3',
      facts: {},
    });
    const { r, calls } = reader([]);
    const res = await handleDjGet(
      new URL('https://x/.netlify/functions/fm-dj'),
      deps(r, store, 2000),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      script: 'quiet one',
      alert: 'a',
      at: 1000,
      audioUrl: '/.netlify/functions/fm-dj?audio=audio%2F1000000000000.mp3',
    });
    expect(calls.length).toBe(0);
  });

  it('regenerates when missing or stale', async () => {
    const { store, m } = memStore();
    const { r, calls } = reader(busyLogs());
    m.set('latest', { script: 'old', alert: '', at: 0, polished: false, audio: null, facts: {} });
    const res = await handleDjGet(new URL('https://x/f'), deps(r, store, DJ_STALE_MS + 1));
    expect(calls.length).toBeGreaterThan(0);
    expect((await res.json()).script).toContain('2049');
  });

  it('keeps serving the old update if the chain is down', async () => {
    const { store, m } = memStore();
    m.set('latest', { script: 'old', alert: '', at: 0, polished: false, audio: null, facts: {} });
    const down: ChainReader = {
      blockNumber: async () => Promise.reject(new Error('rpc down')),
      logs: async () => [],
      ensName: async () => null,
    };
    const res = await handleDjGet(new URL('https://x/f'), deps(down, store, DJ_STALE_MS + 1));
    expect((await res.json()).script).toBe('old');
    const { store: empty } = memStore();
    expect((await handleDjGet(new URL('https://x/f'), deps(down, empty, 1))).status).toBe(503);
  });

  it('serves audio only for well-formed keys', async () => {
    const { store, m } = memStore();
    m.set('audio/1700000000000.mp3', new Uint8Array(10).buffer);
    const { r } = reader([]);
    const ok = await handleDjGet(
      new URL('https://x/f?audio=audio/1700000000000.mp3'),
      deps(r, store, 0),
    );
    expect(ok.headers.get('content-type')).toBe('audio/mpeg');
    expect((await handleDjGet(new URL('https://x/f?audio=latest'), deps(r, store, 0))).status).toBe(
      400,
    );
    expect(
      (await handleDjGet(new URL('https://x/f?audio=audio/1700000000001.mp3'), deps(r, store, 0)))
        .status,
    ).toBe(404);
  });
});

describe('optional polish', () => {
  it('is skipped with no key', async () => {
    const { r } = reader(busyLogs());
    const f = await readFacts(r, 0);
    expect(await polishScript('draft', f, undefined)).toBeNull();
  });

  it('uses a faithful rewrite, falls back to the template on fabrication or errors', async () => {
    const { r } = reader(busyLogs());
    const { store } = memStore();
    const env = { ANTHROPIC_API_KEY: 'k' };
    rewrite.fn = async d => `${d} hear, hear.`;
    const good = await runDjUpdate({ reader: r, store, env, now: () => 1 });
    expect(good.polished).toBe(true);
    expect(good.script.endsWith('hear, hear.')).toBe(true);
    rewrite.fn = async d => `${d} 99 riders watched.`;
    const bad = await runDjUpdate({ reader: r, store, env, now: () => 1 });
    expect(bad.polished).toBe(false);
    expect(bad.script).not.toContain('99');
    rewrite.fn = async () => {
      throw new Error('overloaded');
    };
    expect((await runDjUpdate({ reader: r, store, env, now: () => 1 })).polished).toBe(false);
  });

  it('only keeps a rewrite that carries exactly the same facts', async () => {
    const { r } = reader(busyLogs());
    const f = await readFacts(r, 0);
    const draft =
      'noun f-m, quick one. noun 2049 went to memevalue.eth for 3.25 eth. looks legit imo. prop 1001 executed. send it. keep nouns weird, see you on the plaza.';
    expect(
      acceptPolish(
        draft,
        'yo, noun 2049 just went to memevalue.eth for 3.25 eth, banger imo, and prop 1001 is executed, send it, keep nouns weird riders, see you out on the plaza tonight.',
        f,
      ),
    ).toBe(true);
    // a new number
    expect(
      acceptPolish(
        draft,
        'yo, noun 2049 just went to memevalue.eth for 3.25 eth, banger imo, and prop 1001 is executed with 40 votes, send it, keep nouns weird riders, see you out there.',
        f,
      ),
    ).toBe(false);
    // a dropped name
    expect(
      acceptPolish(
        draft,
        'yo, noun 2049 just went to a collector for 3.25 eth, banger imo, and prop 1001 is executed, send it, keep nouns weird riders, see you out on the plaza.',
        f,
      ),
    ).toBe(false);
    // too short
    expect(acceptPolish(draft, 'noun 2049, 3.25, prop 1001, memevalue.eth', f)).toBe(false);
  });
});
