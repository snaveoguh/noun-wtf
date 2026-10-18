// ── Noun Trade deposit: credit burned tokens back into the game ──
//
// The player burns goods / NTCOIN with NounTradeGoods.deposit(ids, amounts, coin,
// riderTag(rider)) and posts the tx hash. We read the receipt from Base (public RPC),
// require it succeeded and is `confirmations` deep, take only `Deposited` logs emitted
// by our contract whose `account` is this rider's tag, and credit the ledger once.
//
// Idempotent by tx hash: a `claims/deposits/<tx>/<riderTag>` marker records the credit,
// and each log is credited with opId `deposit:<tx>:<logIndex>`, which the LedgerPort
// applies at most once. Re-posting a tx answers `already: true` and credits nothing. A
// rider can only ever redeem logs tagged with their own riderTag, so one tx carrying
// deposits for several riders credits each of them once.

import type { KV, LedgerDelta, LedgerPort, Reply } from './tradeClaim';
import type { ChainPort, ReceiptLike, TradeChainConfig } from './tradeOnchain';
import type { GoodId } from '../../src/miniapps/world2/trade/contract';

import { parseEventLogs, type Hex } from 'viem';

import {
  GOOD_BY_TOKEN_ID,
  NOUN_TRADE_GOODS_ABI,
  riderTag,
} from '../../src/miniapps/world2/trade/onchain/tokens';

interface DepositMarker {
  status: 'crediting' | 'credited';
  credited: LedgerDelta | null;
  unknownIds: string[];
  at: number;
}

const markerKey = (tx: string, tag: string) => `claims/deposits/${tx}/${tag}`;

export interface DepositDeps {
  store: KV;
  ledger: LedgerPort;
  chain: ChainPort | null;
  cfg: TradeChainConfig;
  now?: () => number;
}

export function depositService(deps: DepositDeps) {
  const { store, ledger, cfg } = deps;
  const now = deps.now ?? Date.now;

  async function verify(rider: string, rawTx: unknown): Promise<Reply> {
    if (!cfg.enabled) return { status: 503, body: { error: 'Deposits are off' } };
    if (!cfg.goods || !deps.chain)
      return { status: 503, body: { error: 'Deposits are not configured' } };
    if (typeof rawTx !== 'string' || !/^0x[\dA-Fa-f]{64}$/.test(rawTx)) {
      return { status: 400, body: { error: 'Bad tx hash' } };
    }
    const tx = rawTx.toLowerCase() as Hex;
    const tag = riderTag(rider).toLowerCase();
    const key = markerKey(tx, tag);

    const seen = (await store.get(key, { type: 'json' })) as DepositMarker | null;
    if (seen?.status === 'credited') {
      return { status: 200, body: { ok: true, already: true, credited: seen.credited } };
    }

    let receipt: ReceiptLike | null;
    let head: bigint;
    try {
      receipt = await deps.chain.receipt(tx);
      head = await deps.chain.head();
    } catch {
      return { status: 503, body: { error: 'Could not reach Base, try again' } };
    }
    if (receipt === null)
      return { status: 404, body: { error: 'Transaction not found yet', retry: true } };
    if (receipt.status !== 'success') return { status: 400, body: { error: 'Transaction failed' } };
    const depth = head - receipt.blockNumber + 1n;
    if (depth < BigInt(cfg.confirmations)) {
      return {
        status: 202,
        body: {
          error: 'Waiting for confirmations',
          retry: true,
          depth: Number(depth),
          need: cfg.confirmations,
        },
      };
    }

    const goodsAddr = cfg.goods.toLowerCase();
    const ours = receipt.logs.filter(l => l.address.toLowerCase() === goodsAddr);
    const events = parseEventLogs({
      abi: NOUN_TRADE_GOODS_ABI,
      eventName: 'Deposited',
      logs: ours.map(l => ({ ...l, logIndex: l.logIndex ?? 0 })) as never,
      strict: true,
    });
    if (events.length === 0)
      return { status: 400, body: { error: 'No Noun Trade deposit in that transaction' } };
    const mine = events.filter(e => e.args.account.toLowerCase() === tag);
    if (mine.length === 0)
      return { status: 403, body: { error: 'That deposit is tagged for another rider' } };

    // Mark it in progress (a racing post of the same tx re-reads and waits its turn).
    if (!seen) {
      const marker: DepositMarker = {
        status: 'crediting',
        credited: null,
        unknownIds: [],
        at: now(),
      };
      const res = await store.setJSON(key, marker, { onlyIfNew: true });
      if (res && !res.modified) return verify(rider, rawTx);
    }

    const total: LedgerDelta = { goods: {}, coin: 0 };
    const unknownIds: string[] = [];
    for (const e of mine) {
      const d: LedgerDelta = { goods: {}, coin: Number(e.args.coin) };
      e.args.ids.forEach((id, i) => {
        const g = GOOD_BY_TOKEN_ID[Number(id)] as GoodId | undefined;
        if (!g) {
          unknownIds.push(String(id));
          return;
        }
        d.goods[g] = (d.goods[g] ?? 0) + Number(e.args.amounts[i]);
      });
      const res = await ledger.credit(rider, d, `deposit:${tx}:${e.logIndex}`);
      if (!res.ok) return { status: 503, body: { error: res.reason, retry: true } };
      total.coin += d.coin;
      for (const [g, n] of Object.entries(d.goods) as [GoodId, number][]) {
        total.goods[g] = (total.goods[g] ?? 0) + n;
      }
    }
    const done: DepositMarker = { status: 'credited', credited: total, unknownIds, at: now() };
    await store.setJSON(key, done);
    return { status: 200, body: { ok: true, already: false, credited: total, unknownIds } };
  }

  return { verify };
}
