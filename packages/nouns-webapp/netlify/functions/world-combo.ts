import { boardHandler, type HandlerEvent, type HandlerResponse } from '../lib/board';

// Noun World's best-combo-of-all-time board: a rider's highest single
// banked combo, with the trick chain that scored it.

const MIN_POINTS = 100;
// Long mountain runs stack big multipliers, but not this big
const MAX_POINTS = 100_000_000;

export function handler(event: HandlerEvent): Promise<HandlerResponse> {
  return boardHandler(event, {
    store: 'noun-world-combo',
    parse: input => {
      const points = Math.round(Number(input.points));
      if (!Number.isFinite(points) || points < MIN_POINTS || points > MAX_POINTS) {
        return 'Points out of range';
      }
      const label = String(input.label ?? '')
        .replace(/[\u0000-\u001f]/g, '')
        .slice(0, 200);
      return { points, label };
    },
    score: f => f.points,
  });
}
