import {
  claimService,
  cleanRider,
  parseClaimRequest,
  type ClaimDeps,
  type KV,
} from '../lib/tradeClaim';
import { rowLedger, strongStore, TRADE_LEDGER_STORE } from '../lib/tradeLedger';
import { readTradeConfig, signerFromKey, TRADE_STORE, viemChainPort } from '../lib/tradeOnchain';

// Noun Trade cash-out: turn game balance into tokens on Base (../lib/tradeClaim.ts).
//
// POST { action: 'claim', rider, address, goods: { ICECREAM: 3, ... }, coin: 120 }
//   → 200 { ok, claim: { chainId, contract, voucher, signature }, state }
//     The ledger is debited before the voucher is returned. The player then calls
//     NounTradeGoods.claim(voucher, signature) from `address` before voucher.expiry.
//   → 409 { error, pending } a voucher is already live for this rider (resume it)
//   → 400 / 429 / 503 { error } refused (balance, caps, off / unconfigured, Base down)
// POST { action: 'pending', rider }
//   → 200 { ok, pending: claim | null, refunded: delta | null } (an expired, unused
//     voucher is refunded to the ledger here)
//
// Off unless TRADE_ONCHAIN=on; needs TRADE_SIGNER_KEY and TRADE_GOODS_ADDRESS
// (see ../lib/tradeOnchain.ts for every env var).
//
// The ledger is the game's own (rowLedger over world-trade's rider rows): a cash-out
// debits exactly the balance the HUD shows. The starter purse and ICECREAM (it melts)
// can't be cashed out. Rider auth follows world-trade (a rider id is a bearer id, like
// world-stats).

interface HandlerEvent {
  body: string | null;
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

/** Build a handler; tests pass fakes for any of the dependencies. */
export function makeHandler(over: Partial<ClaimDeps> = {}) {
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

    const store = over.store ?? (strongStore(TRADE_STORE) as unknown as KV);
    const cfg = over.cfg ?? readTradeConfig();
    let chain = over.chain ?? null;
    if (!chain && cfg.goods && cfg.rpc) {
      try {
        chain = viemChainPort(cfg);
      } catch {
        chain = null;
      }
    }
    const svc = claimService({
      store,
      ledger: over.ledger ?? rowLedger(strongStore(TRADE_LEDGER_STORE)),
      signer: over.signer !== undefined ? over.signer : signerFromKey(process.env.TRADE_SIGNER_KEY),
      chain,
      cfg,
      now: over.now,
      randomNonce: over.randomNonce,
    });

    try {
      if (input.action === 'claim') {
        const req = parseClaimRequest(input);
        if (typeof req === 'string') return json(400, { error: req });
        const r = await svc.claim(req);
        return json(r.status, r.body);
      }
      if (input.action === 'pending') {
        const rider = cleanRider(input.rider);
        if (!rider) return json(400, { error: 'Bad rider' });
        const r = await svc.pending(rider);
        return json(r.status, r.body);
      }
    } catch (e) {
      console.error('world-trade-claim', e);
      return json(500, { error: 'Cash-out failed, try again' });
    }
    return json(400, { error: 'Unknown action' });
  };
}

/** The Netlify v2 entry (v2 so the Blobs stores can read their own writes). */
export default async (req: Request): Promise<Response> => {
  const out = await makeHandler()({
    httpMethod: req.method,
    body: req.method === 'POST' ? await req.text() : null,
  });
  return new Response(out.statusCode === 204 ? null : out.body, {
    status: out.statusCode,
    headers: out.headers,
  });
};
