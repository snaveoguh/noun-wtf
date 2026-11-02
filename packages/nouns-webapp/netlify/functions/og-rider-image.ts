/**
 * The play-as share card: /og/world/<key>.png (1200 × 630, og / twitter)
 * and /og/world/fc/<key>.png (1200 × 800, the Farcaster embed's 3:2), for a
 * rider seed key (`bg-body-acc-head-glasses`, `-m` for a missingnoun). A
 * key fully decides the picture, so it caches for a year. og-proposal
 * points /world?seed=<key>'s og:image and fc:miniapp image here.
 */
import { parseRiderKey } from '../../src/miniapps/world2/share/playLink';
import { riderGrid } from '../lib/riderGrid';
import { CARD_SIZES, renderRiderCard } from '../lib/riderOg';

interface HandlerEvent {
  path: string;
  queryStringParameters?: Record<string, string | undefined> | null;
}

interface HandlerResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const m = /^\/og\/world\/(fc\/)?([0-9m-]{9,40})\.png$/.exec(event.path);
  const seed = m === null ? null : parseRiderKey(m[2]);
  if (m === null || seed === null) {
    return { statusCode: 404, headers: { 'Cache-Control': 'public, max-age=300' }, body: '' };
  }
  const size = m[1] !== undefined ? CARD_SIZES.fc : CARD_SIZES.og;
  const png = renderRiderCard(riderGrid(seed), { ...size, missingnoun: seed.missingnoun });
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    body: png.toString('base64'),
    isBase64Encoded: true,
  };
}
