import { connectLambda, getStore } from '@netlify/blobs';

import { blobLedger, cleanRider, type KV } from '../lib/tradeClaim';
import { depositService, type DepositDeps } from '../lib/tradeDeposit';
import { readTradeConfig, TRADE_STORE, viemChainPort } from '../lib/tradeOnchain';

// Noun Trade deposit: credit tokens burned on Base back into the game
// (../lib/tradeDeposit.ts).
//
// POST { rider, tx }   tx = hash of a NounTradeGoods.deposit(..., riderTag(rider)) call
//   → 200 { ok, already, credited: { goods, coin }, unknownIds }
//   → 202 { retry: true } not deep enough yet; 404 { retry: true } not mined yet
//   → 400 / 403 / 503 { error }
// Idempotent by tx hash: posting the same tx again credits nothing.

interface HandlerEvent {
  body: string | null;
  blobs?: string;
  headers?: Record<string, string>;
  httpMethod: string;
}

interface HandlerResponse {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
}

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
const json = (status: number, body: unknown): HandlerResponse => ({
  statusCode: status,
  headers,
  body: JSON.stringify(body),
});

export function makeHandler(over: Partial<DepositDeps> = {}) {
  return async function handler(event: HandlerEvent): Promise<HandlerResponse> {
    const method = event.httpMethod || 'GET';
    if (method === 'OPTIONS') return json(204, {});
    if (method !== 'POST') return json(405, { error: 'Method not allowed' });
    let input: Record<string, unknown>;
    try {
      input = JSON.parse(event.body ?? '{}');
    } catch {
      return json(400, { error: 'Bad JSON' });
    }
    const rider = cleanRider(input.rider);
    if (!rider) return json(400, { error: 'Bad rider' });

    connectLambda({ blobs: event.blobs ?? '', headers: event.headers ?? {} });
    const store = over.store ?? (getStore(TRADE_STORE) as unknown as KV);
    const cfg = over.cfg ?? readTradeConfig();
    let chain = over.chain ?? null;
    if (!chain && cfg.goods && cfg.rpc) {
      try {
        chain = viemChainPort(cfg);
      } catch {
        chain = null;
      }
    }
    const svc = depositService({
      store,
      ledger: over.ledger ?? blobLedger(store),
      chain,
      cfg,
      now: over.now,
    });
    try {
      const r = await svc.verify(rider, input.tx);
      return json(r.status, r.body);
    } catch (e) {
      console.error('world-trade-deposit', e);
      return json(500, { error: 'Deposit check failed, try again' });
    }
  };
}

export const handler = makeHandler();
