/**
 * useOnchainFeed — polls the nouns-api onchain activity feed
 * (`/api/onchain-feed`) every 20s via TanStack Query.
 *
 * The API endpoint is being built in parallel; until it ships (or whenever it
 * errors/404s) the hook falls back to a bundled mock dataset so the homepage
 * feed UI still renders. `isMock` on the return value tells consumers which
 * mode they're looking at.
 */
import { useQuery } from '@tanstack/react-query';

// ─── Types (API contract) ─────────────────────────────────────────────────────

export type FeedSource = 'nouns' | 'nounv2' | 'punks' | 'ens' | 'toadz';

/** 'sale' | 'registration' | 'bid' | 'settled' | 'transfer' | 'proposal' | 'grant' | 'mint' */
export type FeedKind = string;

export interface FeedItem {
  id: string;
  source: FeedSource;
  kind: FeedKind;
  /** 0x address, main actor (buyer / bidder / registrant) */
  actor: string | null;
  /** seller / from */
  counterparty: string | null;
  tokenId: string | null;
  /** e.g. ENS name 'aiboomer.eth', proposal title */
  name: string | null;
  /** price/bid in wei, decimal string */
  valueWei: string | null;
  /** unix seconds */
  timestamp: number;
  txHash: string;
  via?: string; // marketplace name for detected sales
}

export interface FeedResponse {
  items: FeedItem[];
  /** address(lowercase) -> display name (ENS etc.) */
  resolved: Record<string, string>;
}

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';

// ─── Mock data ────────────────────────────────────────────────────────────────

/** n ETH → wei decimal string (6dp precision is plenty for mock data) */
const eth = (n: number): string => `${Math.round(n * 1e6)}000000000000`;

const MOCK_ADDR = {
  aiboomer: '0x1d2c4cd9bee9dfe088430b95d274e765151c32db',
  pranksy: '0xd387a6e4e84a6c86bd90c158c6028a58cc8ac459',
  vault: '0x8bc47be1e3abbaba182069c89d08a61fa6c2b292',
  toadgod: '0x11a22b262e505d355f975e1e48a365b5d4811ae0',
  fresh: '0x6b2b3e0f47e2c1a02c7d1f1c9204d8a44a2c68f3',
  degen: '0xf476cd75be8fdd197ae0b466a2ec2ae44da41897',
  quiet: '0x2573c60a6d127755aa2dc85e342f7da2378a0cc5',
  bidderA: '0x699bfac97c962db31238b429ba53b45443a3d2c2',
  bidderB: '0x83fe9065f6c1bd79d12b7c8f613a1b8b48c9b183',
  minter: '0x47bfe4d67bed576a20a3d7b34f0dcbf1af3ae874',
  seaport: '0x0000000000000068f116a894984e2db1123eb395',
  blur: '0x39da41747a83aee658334415666f3ef92dd0d541',
  nounsAuction: '0x830bd73e4184cef73443c15111a1df14e495c706',
  nounsTreasury: '0xb1a32fc9f9d8b2cf86c068cae13108809547ef71',
  nounv2Treasury: '0x2cdeb0d251674710840d9fa990d1de138dfe7c00',
  memevalue: '0xae4705dc0816ee6d8a13f1c72780ec5021915fed',
} as const;

const MOCK_RESOLVED: Record<string, string> = {
  [MOCK_ADDR.aiboomer]: 'aiboomer.eth',
  [MOCK_ADDR.pranksy]: 'pranksy.eth',
  [MOCK_ADDR.vault]: 'vault.pixel.eth',
  [MOCK_ADDR.toadgod]: 'toadgod.eth',
  [MOCK_ADDR.fresh]: 'freshmeat.eth',
  [MOCK_ADDR.degen]: 'degenspartan.eth',
  [MOCK_ADDR.bidderA]: 'noun40.eth',
  [MOCK_ADDR.bidderB]: 'brianj.eth',
};

interface MockSpec {
  source: FeedSource;
  kind: FeedKind;
  actor?: string | null;
  counterparty?: string | null;
  tokenId?: string | null;
  name?: string | null;
  ethValue?: number | null;
  /** minutes ago */
  ago: number;
}

// ~40 realistic items covering all sources/kinds, spread over the last ~6h.
const MOCK_SPECS: MockSpec[] = [
  {
    source: 'nouns',
    kind: 'bid',
    actor: MOCK_ADDR.bidderA,
    tokenId: '1687',
    ethValue: 12.34,
    ago: 2,
  },
  {
    source: 'ens',
    kind: 'registration',
    actor: MOCK_ADDR.aiboomer,
    name: 'aiboomer.eth',
    ethValue: 0.004,
    ago: 4,
  },
  {
    source: 'punks',
    kind: 'sale',
    actor: MOCK_ADDR.pranksy,
    counterparty: MOCK_ADDR.seaport,
    tokenId: '8348',
    ethValue: 45,
    ago: 7,
  },
  {
    source: 'toadz',
    kind: 'sale',
    actor: MOCK_ADDR.toadgod,
    counterparty: MOCK_ADDR.blur,
    tokenId: '3352',
    ethValue: 1.19,
    ago: 11,
  },
  {
    source: 'nounv2',
    kind: 'bid',
    actor: MOCK_ADDR.memevalue,
    tokenId: '96',
    ethValue: 0.042,
    ago: 13,
  },
  {
    source: 'nouns',
    kind: 'bid',
    actor: MOCK_ADDR.bidderB,
    tokenId: '1687',
    ethValue: 11.9,
    ago: 16,
  },
  {
    source: 'ens',
    kind: 'registration',
    actor: MOCK_ADDR.fresh,
    name: 'onchainsummer.eth',
    ethValue: 0.062,
    ago: 21,
  },
  {
    source: 'nounv2',
    kind: 'settled',
    actor: MOCK_ADDR.memevalue,
    tokenId: '95',
    ethValue: 0.031,
    ago: 27,
  },
  {
    source: 'punks',
    kind: 'transfer',
    actor: MOCK_ADDR.vault,
    counterparty: MOCK_ADDR.pranksy,
    tokenId: '2140',
    ago: 33,
  },
  {
    source: 'nouns',
    kind: 'proposal',
    actor: MOCK_ADDR.bidderA,
    name: 'Nouns Esports S4 continuation',
    tokenId: '972',
    ago: 38,
  },
  { source: 'toadz', kind: 'mint', actor: MOCK_ADDR.minter, tokenId: '6901', ago: 44 },
  {
    source: 'ens',
    kind: 'sale',
    actor: MOCK_ADDR.degen,
    counterparty: MOCK_ADDR.seaport,
    name: 'oil.eth',
    ethValue: 3.2,
    ago: 49,
  },
  {
    source: 'nouns',
    kind: 'grant',
    actor: MOCK_ADDR.nounsTreasury,
    name: 'Small grant: noun schools pilot',
    ethValue: 5,
    ago: 55,
  },
  {
    source: 'punks',
    kind: 'sale',
    actor: MOCK_ADDR.quiet,
    counterparty: MOCK_ADDR.blur,
    tokenId: '5217',
    ethValue: 41.5,
    ago: 62,
  },
  {
    source: 'nouns',
    kind: 'settled',
    actor: MOCK_ADDR.bidderB,
    tokenId: '1686',
    ethValue: 10.05,
    ago: 71,
  },
  {
    source: 'ens',
    kind: 'registration',
    actor: MOCK_ADDR.quiet,
    name: 'quietwhale.eth',
    ethValue: 0.004,
    ago: 78,
  },
  { source: 'nounv2', kind: 'mint', actor: MOCK_ADDR.nounv2Treasury, tokenId: '96', ago: 84 },
  {
    source: 'toadz',
    kind: 'sale',
    actor: MOCK_ADDR.fresh,
    counterparty: MOCK_ADDR.seaport,
    tokenId: '112',
    ethValue: 0.88,
    ago: 91,
  },
  {
    source: 'nouns',
    kind: 'transfer',
    actor: MOCK_ADDR.vault,
    counterparty: MOCK_ADDR.degen,
    tokenId: '421',
    ago: 99,
  },
  {
    source: 'ens',
    kind: 'registration',
    actor: MOCK_ADDR.bidderB,
    name: 'lilnounish.eth',
    ethValue: 0.004,
    ago: 107,
  },
  {
    source: 'punks',
    kind: 'bid',
    actor: MOCK_ADDR.pranksy,
    tokenId: '7804',
    ethValue: 380,
    ago: 116,
  },
  {
    source: 'nouns',
    kind: 'bid',
    actor: MOCK_ADDR.memevalue,
    tokenId: '1686',
    ethValue: 9.2,
    ago: 124,
  },
  {
    source: 'toadz',
    kind: 'transfer',
    actor: MOCK_ADDR.toadgod,
    counterparty: MOCK_ADDR.minter,
    tokenId: '450',
    ago: 133,
  },
  {
    source: 'ens',
    kind: 'sale',
    actor: MOCK_ADDR.vault,
    counterparty: MOCK_ADDR.blur,
    name: '888.eth',
    ethValue: 12,
    ago: 141,
  },
  {
    source: 'nounv2',
    kind: 'bid',
    actor: MOCK_ADDR.bidderA,
    tokenId: '95',
    ethValue: 0.028,
    ago: 150,
  },
  {
    source: 'nouns',
    kind: 'proposal',
    actor: MOCK_ADDR.degen,
    name: 'Prop House: open round 24',
    tokenId: '971',
    ago: 158,
  },
  {
    source: 'punks',
    kind: 'sale',
    actor: MOCK_ADDR.minter,
    counterparty: MOCK_ADDR.seaport,
    tokenId: '1190',
    ethValue: 52.7,
    ago: 167,
  },
  {
    source: 'ens',
    kind: 'registration',
    actor: MOCK_ADDR.degen,
    name: 'basedagent.eth',
    ethValue: 0.032,
    ago: 176,
  },
  {
    source: 'nouns',
    kind: 'grant',
    actor: MOCK_ADDR.nounsTreasury,
    name: 'Grant: precompiles audit',
    ethValue: 18,
    ago: 185,
  },
  {
    source: 'toadz',
    kind: 'sale',
    actor: MOCK_ADDR.quiet,
    counterparty: MOCK_ADDR.blur,
    tokenId: '2221',
    ethValue: 1.02,
    ago: 195,
  },
  {
    source: 'nounv2',
    kind: 'settled',
    actor: MOCK_ADDR.bidderB,
    tokenId: '94',
    ethValue: 0.019,
    ago: 206,
  },
  {
    source: 'ens',
    kind: 'transfer',
    actor: MOCK_ADDR.fresh,
    counterparty: MOCK_ADDR.vault,
    name: 'mfer.eth',
    ago: 216,
  },
  {
    source: 'nouns',
    kind: 'bid',
    actor: MOCK_ADDR.bidderA,
    tokenId: '1686',
    ethValue: 8.69,
    ago: 228,
  },
  {
    source: 'punks',
    kind: 'transfer',
    actor: MOCK_ADDR.degen,
    counterparty: MOCK_ADDR.quiet,
    tokenId: '9982',
    ago: 239,
  },
  {
    source: 'ens',
    kind: 'registration',
    actor: MOCK_ADDR.minter,
    name: 'gmgnfren.eth',
    ethValue: 0.004,
    ago: 251,
  },
  { source: 'toadz', kind: 'mint', actor: MOCK_ADDR.fresh, tokenId: '6900', ago: 264 },
  {
    source: 'nouns',
    kind: 'transfer',
    actor: MOCK_ADDR.nounsTreasury,
    counterparty: MOCK_ADDR.nounsAuction,
    tokenId: '1685',
    ago: 278,
  },
  {
    source: 'punks',
    kind: 'sale',
    actor: MOCK_ADDR.vault,
    counterparty: MOCK_ADDR.blur,
    tokenId: '660',
    ethValue: 47.77,
    ago: 292,
  },
  {
    source: 'nounv2',
    kind: 'transfer',
    actor: MOCK_ADDR.memevalue,
    counterparty: MOCK_ADDR.nounv2Treasury,
    tokenId: '93',
    ago: 310,
  },
  {
    source: 'ens',
    kind: 'registration',
    actor: MOCK_ADDR.pranksy,
    name: 'nounoclock.eth',
    ethValue: 0.004,
    ago: 330,
  },
  {
    source: 'nouns',
    kind: 'settled',
    actor: MOCK_ADDR.memevalue,
    tokenId: '1685',
    ethValue: 13.37,
    ago: 349,
  },
];

export function buildMockFeed(): FeedResponse {
  const now = Math.floor(Date.now() / 1000);
  const items: FeedItem[] = MOCK_SPECS.map((s, i) => ({
    id: `mock-${i}`,
    source: s.source,
    kind: s.kind,
    actor: s.actor ?? null,
    counterparty: s.counterparty ?? null,
    tokenId: s.tokenId ?? null,
    name: s.name ?? null,
    valueWei: s.ethValue != null ? eth(s.ethValue) : null,
    timestamp: now - Math.round(s.ago * 60),
    txHash: `0x${(i + 1).toString(16).padStart(4, '0')}${'ab'.repeat(30)}`.slice(0, 66),
  }));
  return { items, resolved: MOCK_RESOLVED };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface OnchainFeedData extends FeedResponse {
  isMock: boolean;
}

export function useOnchainFeed() {
  const query = useQuery<OnchainFeedData>({
    queryKey: ['onchainFeed'],
    queryFn: async (): Promise<OnchainFeedData> => {
      try {
        const res = await fetch(`${API_URL}/api/onchain-feed?limit=120`);
        if (!res.ok) throw new Error(`onchain-feed ${res.status}`);
        const json = (await res.json()) as FeedResponse;
        if (!Array.isArray(json.items)) throw new Error('onchain-feed: bad shape');
        return { items: json.items, resolved: json.resolved ?? {}, isMock: false };
      } catch {
        // Endpoint not shipped yet / transient failure → bundled mock so the
        // UI stays renderable and screenshot-able.
        return { ...buildMockFeed(), isMock: true };
      }
    },
    refetchInterval: 20_000,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return {
    items: query.data?.items ?? [],
    resolved: query.data?.resolved ?? {},
    /** true when the bundled mock dataset is being shown (API missing/erroring) */
    isMock: query.data?.isMock ?? false,
    isLoading: query.isLoading,
  };
}
