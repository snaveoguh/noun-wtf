/**
 * The share-card image for a Noun: /og/noun/:id.png (V1) and
 * /og/v2/noun/:id.png (V2), a 1200 × 630 PNG of the Noun big on its own
 * background (netlify/lib/nounOg.ts). og-proposal points /noun/:id and
 * /v2/noun/:id's og:image here, so a noun.wtf/noun/N link unfurls as Noun N
 * on X, Slack, Discord, iMessage.
 *
 * The seed is read from the token (`seeds(id)`); the art is the trait data
 * the site already bundles. A minted Noun's seed never changes, so the image
 * caches for a year. A Noun that isn't minted yet (the next one, or a V2
 * that was burned) 404s and the card falls back to the site image.
 */
import { decodeAbiParameters, encodeFunctionData, parseAbi } from 'viem';

import { pickNounAssets } from '../../src/lib/nounAssets';
import { nounGrid, renderNounCard } from '../lib/nounOg';

interface HandlerEvent {
  path: string;
}

interface HandlerResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

const NOUNS_TOKEN = '0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03';
/** NounV2Token (also baked into the webapp as VITE_NOUNV2_TOKEN_ADDRESS). */
const NOUNV2_TOKEN = '0xb1d6bdf9326dd09183c2e9d25af5e22c637293b9';
const RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://gateway.tenderly.co/public/mainnet',
  'https://rpc.mevblocker.io',
];
const ABI = parseAbi([
  'function seeds(uint256) view returns (uint48,uint48,uint48,uint48,uint48)',
  'function ownerOf(uint256) view returns (address)',
]);

async function call(to: string, data: string): Promise<`0x${string}` | null> {
  for (const rpc of RPCS) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 4000);
      const res = await fetch(rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to, data }, 'latest'],
        }),
        signal: ac.signal,
      });
      clearTimeout(t);
      const j = (await res.json()) as { result?: `0x${string}`; error?: { code?: number } };
      if (typeof j.result === 'string') return j.result;
      // A revert is an answer (the Noun doesn't exist), not a flaky RPC
      if (j.error?.code === 3) return null;
    } catch {
      // next RPC
    }
  }
  return null;
}

/** The Noun's seed, or null when it isn't minted (or was burned). */
async function seedOf(token: string, id: bigint) {
  // `seeds` answers zeros for a Noun that doesn't exist; ownerOf reverts
  const owner = await call(
    token,
    encodeFunctionData({ abi: ABI, functionName: 'ownerOf', args: [id] }),
  );
  if (owner === null) return null;
  const raw = await call(
    token,
    encodeFunctionData({ abi: ABI, functionName: 'seeds', args: [id] }),
  );
  if (raw === null) return null;
  const [background, body, accessory, head, glasses] = decodeAbiParameters(
    [
      { type: 'uint48' },
      { type: 'uint48' },
      { type: 'uint48' },
      { type: 'uint48' },
      { type: 'uint48' },
    ],
    raw,
  );
  return { background, body, accessory, head, glasses };
}

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const m = /^\/og\/(v2\/)?noun\/(\d{1,6})\.png$/.exec(event.path);
  if (m === null) return { statusCode: 404, headers: {}, body: '' };
  const isV2 = m[1] !== undefined;
  const id = BigInt(m[2]!);
  const seed = await seedOf(isV2 ? NOUNV2_TOKEN : NOUNS_TOKEN, id);
  if (seed === null) {
    return {
      statusCode: 404,
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' },
      body: '',
    };
  }
  const { ImageData, getNounData } = pickNounAssets(isV2);
  const { parts, background } = getNounData(seed);
  const png = renderNounCard(nounGrid(parts, ImageData.palette, background));
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'image/png',
      // A minted Noun's seed never changes
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    body: png.toString('base64'),
    isBase64Encoded: true,
  };
}
