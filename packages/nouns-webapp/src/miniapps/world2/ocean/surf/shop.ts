// ── Puerto Noun's surf shop: which boards you own, which one you ride ────
//
// The foamie is the free rental. Longboards and shortboards are bought
// like the dragon (dragon/pay.ts): a trade `upgrade` (trade/upgrades.ts
// 'longboard' / 'shortboard'), so the server ledger takes the coin and
// keeps the board with your rider id. The board you've picked is a local
// preference (null = no board: you swim).

import type { TradeApi } from '../../trade/contract';

import { BOARDS, isBoardId, type BoardId } from './boards';

const KEY = 'noun-surf-board-v1';

function tradeOf(game: object): TradeApi | null {
  return (game as { trade?: TradeApi | null }).trade ?? null;
}

/** Owned boards (the foamie always). */
export function ownedBoards(game: object): BoardId[] {
  const ups = tradeOf(game)?.state?.upgrades ?? [];
  const out: BoardId[] = ['foamie'];
  if (ups.includes('longboard')) out.push('longboard');
  if (ups.includes('shortboard')) out.push('shortboard');
  return out;
}

export function ownsBoard(game: object, id: BoardId): boolean {
  return ownedBoards(game).includes(id);
}

/** Coin on hand (null while the economy hasn't loaded). */
export function coinOf(game: object): number | null {
  return tradeOf(game)?.state?.coin ?? null;
}

/** The board picked last time (null: none picked yet / swimming). */
export function savedBoard(): BoardId | null {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'none') return null;
    return isBoardId(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveBoard(id: BoardId | null) {
  try {
    localStorage.setItem(KEY, id ?? 'none');
  } catch {
    /* private mode: fine */
  }
}

/** Buy a board at the shop. */
export async function buyBoard(
  game: object,
  id: BoardId,
): Promise<{ ok: boolean; reason?: string }> {
  if (id === 'foamie') return { ok: true };
  if (ownsBoard(game, id)) return { ok: true };
  const t = tradeOf(game);
  if (t === null) return { ok: false, reason: 'the shop is closed' };
  const coin = t.state?.coin;
  if (coin !== undefined && coin < BOARDS[id].price)
    return { ok: false, reason: `costs ${BOARDS[id].price}, you have ${coin}` };
  const r = await t.act({ t: 'upgrade', town: 'beach', up: id });
  return { ok: r.ok, reason: r.reason };
}
