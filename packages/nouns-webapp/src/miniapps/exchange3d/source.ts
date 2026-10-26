// ── 3D Grand Exchange: where the floor's real data comes from ───────────
//
//   live     — GET /.netlify/functions/world-exchange?floor=1 (the real
//              Grand Exchange: bots and riders, one shared order book)
//   offline  — `?offline=1`: the same engine and bots running in this tab
//   fallback — the server didn't answer twice running (no functions in a
//              plain vite dev server, or it's down): the engine runs here
//              and the HUD says so. It retries the server now and then.

import { LocalExchange, riderId } from '../exchange/client';
import { botsPublic, tick, tickers, type ExchangeSnapshot } from '../exchange/engine';

import { maskOwner, publicFloor, type FeedMode, type Floor3d, type FloorFrame } from './sim/feed';

const URL_ = '/.netlify/functions/world-exchange';
const RETRY_LIVE_MS = 60_000;

export class FloorSource {
  mode: FeedMode;
  readonly rider: string;
  private local: LocalExchange | null = null;
  private fails = 0;
  private lastTry = 0;

  constructor(
    offline: boolean,
    private readonly speed = 1,
  ) {
    this.mode = offline ? 'offline' : 'live';
    this.rider = offline ? 'you-offline' : riderId();
    if (offline) this.local = new LocalExchange(7, speed);
  }

  get pollMs() {
    return this.mode === 'live' ? 3_000 : 1_500;
  }

  async poll(): Promise<FloorFrame> {
    if (this.mode === 'fallback' && Date.now() - this.lastTry > RETRY_LIVE_MS) {
      this.lastTry = Date.now();
      try {
        const f = await this.fetchLive();
        this.mode = 'live';
        this.fails = 0;
        return f;
      } catch {
        // still down
      }
    }
    if (this.mode === 'live') {
      try {
        const f = await this.fetchLive();
        this.fails = 0;
        return f;
      } catch (e) {
        if (++this.fails < 2) throw e;
        this.mode = 'fallback';
        this.lastTry = Date.now();
      }
    }
    return this.fromLocal();
  }

  private async fetchLive(): Promise<FloorFrame> {
    const q = new URLSearchParams({ good: 'ICECREAM', tf: 'm', rider: this.rider, floor: '1' });
    const r = await fetch(`${URL_}?${q.toString()}`, { cache: 'no-store' });
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || !type.includes('json')) throw new Error(`exchange ${r.status}`);
    const s = (await r.json()) as ExchangeSnapshot & { floor3d?: Floor3d };
    if (!Array.isArray(s.tickers)) throw new Error('not an exchange');
    // An older server without floor3d: its one-good tape still drives the floor
    const fills =
      s.floor3d?.fills ??
      s.tape.map(f => ({
        ...f,
        buyer: maskOwner(f.buyer, this.rider),
        seller: maskOwner(f.seller, this.rider),
      }));
    return {
      mode: 'live',
      now: s.now,
      tickers: s.tickers,
      fills,
      orders: s.floor3d?.orders ?? [],
      floor: s.floor.map(e => ({ ...e, who: maskOwner(e.who, this.rider) })),
      bots: s.bots,
    };
  }

  private fromLocal(): FloorFrame {
    this.local ??= new LocalExchange(7, this.speed);
    const st = this.local.state;
    tick(st, this.local.now(), { maxSteps: 400 });
    const pub = publicFloor(st, this.local.owner);
    return {
      mode: this.mode,
      now: st.now,
      tickers: tickers(st),
      fills: pub.fills,
      orders: pub.orders,
      floor: st.floor.slice(-40).map(e => ({ ...e, who: maskOwner(e.who, this.local!.owner) })),
      bots: botsPublic(st),
    };
  }
}
