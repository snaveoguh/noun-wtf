// ── The bag ─────────────────────────────────────────────────────────────
//
// Fourteen clubs with numbers close to a good amateur's (scratch-ish, a
// ~105 mph driver): ball speed, launch, backspin at a full pure strike.
// `carry` / `total` are what sim/physics.ts actually flies them on a still
// day off a flat fairway (tee for the driver), checked by clubs.test.ts, so
// the HUD's yardages and the CPU's first guesses match the ball.

import type { ClubId, ClubSpec, Lie } from '../contract';

export interface ClubData extends ClubSpec {
  /** Launch angle off the face at a full, pure strike (deg). */
  launch: number;
  /** Roughly where it ends up on a still day, roll included (m). */
  total: number;
  /** Push / pull (deg) and spin-axis tilt (deg) at |accuracy| = 1. */
  push: number;
  tilt: number;
  /** A wedge (plays out of sand well, opens up the face). */
  wedge: boolean;
  wood: boolean;
}

export const clubOrder: readonly ClubId[] = [
  'D',
  '3W',
  '5W',
  '4H',
  '5i',
  '6i',
  '7i',
  '8i',
  '9i',
  'PW',
  'GW',
  'SW',
  'LW',
  'P',
];

const c = (
  id: ClubId,
  name: string,
  loft: number,
  speed: number,
  launch: number,
  spin: number,
  carry: number,
  total: number,
  push: number,
  tilt: number,
  extra: Partial<ClubData> = {},
): ClubData => ({
  id,
  name,
  loft,
  speed,
  launch,
  spin,
  carry,
  total,
  push,
  tilt,
  wedge: false,
  wood: false,
  ...extra,
});

export const CLUBS: Record<ClubId, ClubData> = {
  D: c('D', 'DRIVER', 10.5, 70, 12.5, 2700, 233, 255, 6, 22, { wood: true }),
  '3W': c('3W', '3 WOOD', 15, 65, 11, 3600, 211, 228, 5.5, 20, { wood: true }),
  '5W': c('5W', '5 WOOD', 18, 63, 12, 4300, 196, 207, 5, 18, { wood: true }),
  '4H': c('4H', '4 HYBRID', 21, 60.5, 13, 4700, 183, 193, 5, 17),
  '5i': c('5i', '5 IRON', 26, 58, 13.5, 5300, 170, 180, 4.5, 16),
  '6i': c('6i', '6 IRON', 30, 55.5, 15, 6100, 158, 167, 4.5, 15),
  '7i': c('7i', '7 IRON', 34, 53, 17, 6900, 147, 155, 4, 14),
  '8i': c('8i', '8 IRON', 38, 50, 19, 7700, 135, 144, 4, 13),
  '9i': c('9i', '9 IRON', 42, 46.5, 21.5, 8400, 123, 132, 3.5, 12),
  PW: c('PW', 'PITCHING WEDGE', 46, 43, 24, 9000, 112, 120, 3.5, 11, { wedge: true }),
  GW: c('GW', 'GAP WEDGE', 50, 39, 27, 9500, 99, 107, 3, 10, { wedge: true }),
  SW: c('SW', 'SAND WEDGE', 56, 35, 31, 9500, 86, 92, 3, 9, { wedge: true }),
  LW: c('LW', 'LOB WEDGE', 60, 31, 35, 9200, 72, 77, 3, 8, { wedge: true }),
  P: c('P', 'PUTTER', 3, 8, 0, 0, 0, 46, 1.2, 0),
};

/** How far a lie lets a club go, as a fraction of its still-air total (rough guide). */
export function lieFactor(club: ClubId, lie: Lie): number {
  const k = CLUBS[club];
  switch (lie) {
    case 'tee':
    case 'fairway':
    case 'fringe':
    case 'green':
      return club === 'D' && lie !== 'tee' ? 0.9 : 1;
    case 'path':
      return 0.95;
    case 'rough':
      return 0.92;
    case 'deep':
      return k.wedge ? 0.7 : k.wood ? 0.45 : 0.6;
    case 'sand':
      return club === 'SW' || club === 'LW'
        ? 0.85
        : k.wedge || club === '9i'
          ? 0.75
          : k.wood
            ? 0.35
            : 0.55;
    default:
      return 0.6;
  }
}

/**
 * The club for a shot of `distance` metres (to where the ball should end
 * up) from `lie`: the shortest club that gets there, or the longest that
 * makes sense from the lie. The putter on the green (and from the fringe
 * when close).
 */
export function suggestClub(distance: number, lie: Lie): ClubId {
  if (lie === 'green') return 'P';
  if (lie === 'fringe' && distance < 12) return 'P';
  const bag = clubOrder.filter(id => id !== 'P' && !(id === 'D' && lie !== 'tee'));
  // Woods out of sand / deep grass are a bad idea
  const ok = bag.filter(id => !((lie === 'sand' || lie === 'deep') && CLUBS[id].wood));
  for (let i = ok.length - 1; i >= 0; i--) {
    const id = ok[i];
    const reach = CLUBS[id].total * lieFactor(id, lie);
    if (reach >= distance) return id;
  }
  return ok[0];
}
