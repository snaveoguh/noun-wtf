import { boardHandler, type HandlerEvent, type HandlerResponse } from '../lib/board';

// Noun World's fastest-of-all-time board (km/h, metres downhill). It used to
// ride the PartyKit room's leaderboard, but the deployed party server drops
// it whenever the room goes idle, so records vanished. Blobs keep it.

const MIN_KMH = 40;
// The mountain has no speed cap, but nothing real gets near this
const MAX_KMH = 2000;

export function handler(event: HandlerEvent): Promise<HandlerResponse> {
  return boardHandler(event, {
    store: 'noun-world-fastest',
    parse: input => {
      const kmh = Math.round(Number(input.kmh) * 10) / 10;
      if (!Number.isFinite(kmh) || kmh < MIN_KMH || kmh > MAX_KMH) return 'Speed out of range';
      return { kmh, downM: Math.max(0, Math.round(Number(input.downM) || 0)) };
    },
    score: f => f.kmh,
  });
}
