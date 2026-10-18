// ── Noun Trade: which town the player is in ──────────────────────────────
//
// `game.towns` when the towns part is there; else the city square, Noun
// Jersey's core, or the dev override (`trade.devTown`, `?town=`).

import type { Game } from '../Game';
import type { TownId, TownsApi, VanDriveApi } from './contract';
import type { TradeClient } from './TradeClient';

import { edgeDistance } from '../world/mountain/config';
import { njInCore } from '../world/mountain/nounJersey';

/** Within this of a placed town's market square: at the stall (E opens the market). */
const STALL_R = 7;

/** The other parts' hooks on Game, if they're merged in. */
type WithSeams = { towns?: TownsApi; van2?: VanDriveApi };

/** Where the player is: the town, and whether they're at its market stall. */
export function locate(game: Game, trade: TradeClient): { town: TownId | null; stall: boolean } {
  if (trade.devTown !== null) return { town: trade.devTown, stall: false };
  const seams = game as unknown as WithSeams;
  const p = seams.van2?.driving === true ? seams.van2.pos : game.player.pos;
  const towns = seams.towns;
  if (towns !== undefined) {
    const t = towns.townAt(p.x, p.z);
    if (t !== null) {
      const at = towns.placed().find(pl => pl.id === t);
      const stall = at !== undefined && Math.hypot(p.x - at.x, p.z - at.z) < STALL_R;
      return { town: t, stall };
    }
  }
  if (edgeDistance(p.x, p.z) <= 0) return { town: 'city', stall: false };
  if (njInCore(p.x, p.z, 20)) return { town: 'jersey', stall: false };
  return { town: null, stall: false };
}
