// ── 3D Grand Exchange: the trading floor scene ──────────────────────────
//
// Ties it together: the hall, the crowd sim and its two LOD tiers, the live
// feed (real orders / fills / bot lines) plus the labelled simulated flow,
// the trade scheduler and its effects, bubbles, cameras and input, sound.
// React only mounts it and draws the HUD from `onHud` (4 Hz).
//
// WALK (walkMode.ts): you on foot as your Noun World rider, the other
// players in the Exchange live, and click / tap anyone to trade with them
// (sim/tradeForm.ts → source.act → the world-exchange function).

import type { AgentPublic, LedgerEntry } from '../../agents/contract';
import type { ActReply, ClientAction } from '../../exchange/client';
import type { DealsView, GoodId, Ticker, YouView } from '../../exchange/engine/types';
import type { TradeTarget } from '../sim/tradeForm';

import * as THREE from 'three';

import { AGENT_BY_ID, AGENTS } from '../../agents/roster';
import { BOT_BY_ID, ROSTER } from '../../exchange/engine/bots/roster';
import { GOOD_INFO } from '../../exchange/engine/goods';
import {
  alive,
  BUBBLE_TTL,
  fillText,
  orderText,
  pickBubbles,
  type Bubble,
  type BubbleCand,
} from '../sim/bubbles';
import {
  type CamMode,
  type Orbit,
  chaseAz,
  fitInHall,
  modeForKey,
  orbitEye,
  pan,
  preset,
  rotate,
  stepOrbit,
  WALK_R,
  zoom,
} from '../sim/cameras';
import { Crowd, type Trader } from '../sim/crowd';
import {
  FeedTracker,
  fillKey,
  refPrices,
  SimFlow,
  spreadDelays,
  type FeedMode,
  type FloorFrame,
  type PriceRef,
} from '../sim/feed';
import { hallCopies, PIT_BY_GOOD, PIT_GOODS, PITS } from '../sim/layout';
import { copyRings, pickRigs, type Budget } from '../sim/lod';
import { hashStr, seedFromArray, seedFromId, type Seed } from '../sim/looks';
import { outfitFor } from '../sim/outfit';
import { TIMING, TradeScheduler, type FillJob, type TradeEvent } from '../sim/trades';
import { inTheWay } from '../sim/walker';
import { FloorSource } from '../source';

import { FloorAudio } from './audio';
import { ART, CrowdMesh, LOW } from './crowdMesh';
import { Fx } from './fx';
import { buildGround, buildHall, liteHallGeometry, liteHallMaterial, type HallParts } from './hall';
import { Labels, type LabelSpec } from './labels';
import { RigPool, type RigAct } from './rigs';
import { MAX_PEERS, WalkMode, type MeLook } from './walkMode';

export interface FollowInfo {
  i: number;
  id: string;
  name: string;
  kind: Trader['kind'];
  seed: Seed;
  real: boolean;
  /** What they're shouting now. */
  now: string | null;
  recent: { text: string; real: boolean; ago: number }[];
  blurb: string | null;
}

export interface HudState {
  mode: CamMode;
  pit: GoodId;
  feed: FeedMode;
  connected: boolean;
  traders: number;
  rigs: number;
  bubbles: number;
  trades: number;
  fillsPerMin: number;
  realPerMin: number;
  follow: FollowInfo | null;
  fps: number;
  /** Mean CPU ms per frame (sim + scene + render submit). */
  frameMs: number;
  sound: boolean;
  news: string | null;
  vastHalls: number;
  /** Walking: who you clicked to trade with, your balances, your offers in / out. */
  walking: boolean;
  target: TradeTarget | null;
  you: YouView | null;
  deals: DealsView;
  tickers: Ticker[];
  /** Other players here, and whether the multiplayer room is connected. */
  peers: number;
  online: boolean;
  /** The good of the pit nearest you. */
  nearPit: GoodId;
  now: number;
  /** The city's agents (shop boards) and their recent trades. */
  agents: AgentPublic[];
  ledger: LedgerEntry[];
}

export interface FloorSceneOpts {
  offline: boolean;
  speed?: number;
  budget: Budget;
  phone: boolean;
  onHud: (h: HudState) => void;
  /** 'descent': open looking straight down through the roof (arriving from the fountain). */
  intro?: 'swoop' | 'descent';
  /** You, as your Noun World rider (the WALK camera). */
  me: MeLook;
  /** Join the Exchange's multiplayer room (see net/). */
  online: boolean;
}

/** Riders shown on the floor at once (older ones hand their slot on). */
const MAX_RIDERS = 40;
const BG = new THREE.Color('#9cc9f0');
const FOV = 50;

const isBig = (j: { good: GoodId; qty: number; price: number }) =>
  j.qty * j.price >= Math.max(240, GOOD_INFO[j.good].base * 14);

export class FloorScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly crowd: Crowd;
  readonly mesh: CrowdMesh;
  readonly rigs: RigPool;
  readonly fx = new Fx();
  readonly hall: HallParts;
  readonly sched: TradeScheduler;
  readonly source: FloorSource;
  readonly audio = new FloorAudio();
  private flow: SimFlow;
  private tracker = new FeedTracker();
  private labels: Labels;
  private bubbles: (Bubble | null)[] = [];
  private shake: number[] = [];
  private hist = new Map<number, { text: string; real: boolean; at: number }[]>();
  private refs: Record<GoodId, PriceRef>;
  private tickers: Ticker[] = [];
  private lastPx: Partial<Record<GoodId, number>> = {};
  private pending: { at: number; job: FillJob }[] = [];
  private pendingSay: { at: number; t: Trader; b: Bubble; pit?: number }[] = [];
  private fillLog: { t: number; real: boolean }[] = [];
  private news: { text: string; at: number } | null = null;
  private connected = false;

  private cur: Orbit;
  private want: Orbit;
  mode: CamMode = 'wide';
  private pitIx = 0;
  followI: number | null = null;
  private idle = 0;

  private rigSet = new Set<number>();
  private rigWant = new Set<number>();
  private rigTimer = 0;
  private dist = new Float32Array(0);
  private showing = new Set<number>();
  private bubbleTimer = 0;
  private shown: number[] = [];

  private copies: { g: THREE.Group; ring: number }[] = [];
  private copyGeo: THREE.BufferGeometry | null = null;
  private copyMat: THREE.Material | null = null;
  private vastHalls = 0;
  readonly walk: WalkMode;
  private youI = -1;
  /** Traders hidden this frame: in the way of the WALK camera. */
  private blockers = new Set<number>();
  target: TradeTarget | null = null;
  /** Where VAST goes back to when toggled off (V again). */
  private vastBack: CamMode | null = null;

  /** Dev / tests: the loop only renders; the caller steps (`step(dt)`). */
  paused = false;
  private raf = 0;
  private last = 0;
  private hudTimer = 0;
  private pollTimer: number | null = null;
  private frameMs = 0;
  private fps = 0;
  private disposed = false;
  private ro: ResizeObserver;
  private pitLists: number[][] = PITS.map(() => []);
  private pitListTimer = 0;
  private readonly budget: Budget;
  private readonly phone: boolean;
  private readonly onHud: (h: HudState) => void;
  private v = new THREE.Vector3();
  private fwd = new THREE.Vector3();

  constructor(
    private readonly host: HTMLElement,
    layer: HTMLElement,
    o: FloorSceneOpts,
  ) {
    this.budget = o.budget;
    this.phone = o.phone;
    this.onHud = o.onHud;
    this.renderer = new THREE.WebGLRenderer({
      antialias: !o.phone,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, o.budget.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'gx3d-canvas';
    host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.3, 6000);
    this.scene.background = BG;
    this.scene.fog = new THREE.Fog(BG, 200, 900);

    this.scene.add(new THREE.HemisphereLight('#fff6e6', '#6a5a48', 1.7));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(60, 140, 40);
    this.scene.add(sun);

    this.hall = buildHall();
    this.scene.add(this.hall.group, buildGround());

    const capacity = o.budget.traders + ROSTER.length + 1 + MAX_RIDERS;
    this.mesh = new CrowdMesh(capacity);
    this.crowd = new Crowd({
      count: o.budget.traders,
      seed: 11,
      balcony: 0.12,
      floaters: 0.12,
      look: id => seedFromId(id, ART),
    });
    for (const t of this.crowd.traders) {
      this.mesh.setLook(t.i, t.seed);
      this.mesh.setOutfit(t.i, outfitFor(t.seed));
    }
    // The regulars (real bots, real seeds) and you
    for (const b of ROSTER) this.realTrader(b.id, PIT_GOODS[hashStr(b.id) % PIT_GOODS.length]!);
    // The agents (src/miniapps/agents): on the floor at their first good's pit
    for (const a of AGENTS) this.realTrader(a.id, a.goods[0]!);
    this.source = new FloorSource(o.offline, o.speed ?? 1);
    // You: your own rider, walking (the floor's 'you' trader is pinned to you)
    this.walk = new WalkMode(o.me, () => this.source.tag, o.online);
    const net = this.walk.net;
    if (net !== null) {
      net.onPinged = () => this.pinged();
      // Someone else is here, so they could offer you a deal: open your
      // account on the live exchange (once). Not for every visitor on load:
      // accounts are capped, and a spectator doesn't need one.
      net.onPeers = () => {
        if (net.peers.size > 0) void this.source.join();
      };
    }
    this.youI = this.realTrader('you', 'ICECREAM')?.i ?? -1;
    this.mesh.commitLooks();
    this.scene.add(this.mesh.shadows, this.mesh.mesh);

    this.rigs = new RigPool(Math.round(o.budget.rigs * 1.5));
    this.scene.add(this.rigs.group, this.fx.group, this.walk.walkers.group);
    this.labels = new Labels(layer, o.budget.bubbles + MAX_PEERS);

    this.sched = new TradeScheduler(
      {
        pos: i => this.crowd.traders[i]!,
        free: i => this.crowd.free(this.crowd.traders[i]!),
        arrived: i => this.crowd.traders[i]!.arrived,
        hold: (i, trade, s) => this.crowd.hold(this.crowd.traders[i]!, trade, s.x, s.z, s.face),
        release: (i, trade) => this.crowd.release(this.crowd.traders[i]!, trade),
        pit: g => PIT_BY_GOOD[g],
      },
      { maxActive: o.phone ? 8 : 16 },
    );
    this.flow = new SimFlow({
      seed: 5,
      shoutsPerSec: o.budget.traders / 25,
      fillsPerMin: o.phone ? 20 : 36,
    });
    this.refs = refPrices(null, Date.now());

    const aspect = this.aspect();
    const ctx = { pit: PITS[0]!, follow: null, aspect, az: Math.PI * 0.8 };
    // Open on the aerial and swoop down to the hall; from the fountain, drop
    // in through the roof
    this.cur =
      o.intro === 'descent'
        ? { tx: 0, ty: 0, tz: 0, r: 70, az: ctx.az, el: 1.5 }
        : preset('vast', ctx);
    this.mode = 'walk';
    this.want = preset('walk', { ...ctx, me: this.walk.walker });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.bindInput();
    void this.poll();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    if (import.meta.env.DEV) (window as unknown as { __gx3d?: FloorScene }).__gx3d = this;
  }

  // ── Real traders ──

  private realTrader(owner: string, good: GoodId): Trader | null {
    if (owner === 'gx' || owner === '') return null;
    const hit = this.crowd.get(owner);
    if (hit !== undefined) return hit;
    const pit = PIT_BY_GOOD[good].ix;
    let kind: Exclude<Trader['kind'], 'sim'>;
    let name: string;
    let seed: Seed;
    if (owner.startsWith('agent:')) {
      // Agents walk the floor like the bots do (kind 'bot'); targetOf tells them apart
      const def = AGENT_BY_ID[owner];
      kind = 'bot';
      name = def !== undefined ? `${def.name} · AGENT` : owner.slice(6);
      seed = def !== undefined ? seedFromArray(def.seed) : seedFromId(owner, ART);
    } else if (owner.startsWith('bot:')) {
      const def = BOT_BY_ID[owner];
      kind = 'bot';
      name = def?.name ?? owner.slice(4);
      seed = def !== undefined ? seedFromArray(def.seed) : seedFromId(owner, ART);
    } else if (owner === 'you') {
      kind = 'you';
      name = 'YOU';
      seed = this.walk?.look.seed ?? seedFromId(this.source?.rider ?? 'you', ART);
    } else {
      kind = 'rider';
      name = `RIDER ${owner.replace(/^r:/, '').slice(0, 4).toUpperCase()}`;
      seed = seedFromId(owner, ART);
    }
    let reuse: number | undefined;
    const riders = this.crowd.traders.filter(t => t.kind === 'rider');
    if (kind === 'rider' && riders.length >= MAX_RIDERS) {
      const free = riders.filter(t => this.crowd.free(t) && !this.sched?.busy(t.i));
      free.sort((a, b) => a.active - b.active);
      reuse = free[0]?.i;
      if (reuse === undefined) return null;
    }
    const t = this.crowd.addReal(owner, kind, name, seed, pit, reuse);
    this.mesh.setLook(t.i, seed);
    this.mesh.setOutfit(t.i, outfitFor(seed, owner === 'you' ? this.walk?.look.outfit : null));
    this.mesh.commitLooks();
    this.bubbles[t.i] = null;
    this.hist.delete(t.i);
    return t;
  }

  private say(t: Trader, b: Bubble) {
    const cur = this.bubbles[t.i];
    // A real line isn't talked over by the simulated crowd
    if (!b.real && alive(cur, this.crowd.t) && cur.real) return;
    this.bubbles[t.i] = b;
    if (b.kind === 'buy' || b.kind === 'sell' || b.kind === 'say') t.shout = Math.max(t.shout, 1.1);
  }

  private remember(i: number, text: string, real: boolean) {
    const h = this.hist.get(i) ?? [];
    h.unshift({ text, real, at: this.crowd.t });
    if (h.length > 6) h.length = 6;
    this.hist.set(i, h);
  }

  // ── Feed ──

  private polling = false;

  private async poll() {
    if (this.disposed || this.polling) return;
    this.polling = true;
    try {
      const f = await this.source.poll();
      if (!this.disposed) this.take(f);
      this.connected = true;
    } catch {
      // try again next poll
    }
    this.polling = false;
    if (this.disposed) return;
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = window.setTimeout(() => {
      if (document.visibilityState === 'visible') void this.poll();
      else this.pollTimer = window.setTimeout(() => void this.poll(), 1000);
    }, this.source.pollMs);
  }

  /** A player here in person, by their public tag. */
  private peerAt(tag: string) {
    return tag.startsWith('r:') ? (this.walk.peers.find(p => p.tag === tag) ?? null) : null;
  }

  /** Where an owner stands, if they're you or a player here in person. */
  private personAt(owner: string): { x: number; y: number; z: number } | null {
    if (owner === 'you') return this.walk.walker;
    return this.peerAt(owner);
  }

  private take(f: FloorFrame) {
    this.tickers = f.tickers;
    this.refs = refPrices(f.tickers, f.now);
    for (const t of f.tickers)
      if (this.lastPx[t.good] === undefined && t.last !== null) this.lastPx[t.good] = t.last;
    const news = this.tracker.take(f);
    const now = this.crowd.t;
    const win = this.source.pollMs;
    // Real orders: their owners shout them (bots walk to that pit)
    const od = spreadDelays(
      news.orders.map(o => o.at),
      win,
      180,
    );
    news.orders.forEach((o, k) => {
      if (this.peerAt(o.owner) !== null) return; // they're here: no stand-in
      const t = this.realTrader(o.owner, o.good);
      if (t === null) return;
      this.pendingSay.push({
        at: now + od[k]! / 1000,
        t,
        pit: PIT_BY_GOOD[o.good].ix,
        b: {
          kind: o.side,
          text: orderText(o, hashStr(t.id) + Math.floor(o.price)),
          real: true,
          at: 0,
          ttl: BUBBLE_TTL.order,
        },
      });
    });
    for (const e of news.says) {
      if (e.who === 'gx') {
        this.news = { text: e.text, at: now };
        continue;
      }
      if (this.peerAt(e.who) !== null) continue;
      const t = this.realTrader(e.who, e.good ?? 'ICECREAM');
      if (t === null) continue;
      const text = e.text.length > 64 ? `${e.text.slice(0, 61)}…` : e.text;
      this.pendingSay.push({
        at: now + Math.random() * 1.5,
        t,
        b: { kind: 'say', text, real: true, at: 0, ttl: BUBBLE_TTL.say },
      });
    }
    // Real fills: the two traders meet and trade
    const fd = spreadDelays(
      news.fills.map(x => x.at),
      win,
    );
    news.fills.forEach((x, k) => {
      // A trade with a player who's here in person: it flies between the two of you
      const pb = this.personAt(x.buyer);
      const ps = this.personAt(x.seller);
      if (
        pb !== null &&
        ps !== null &&
        (this.peerAt(x.buyer) !== null || this.peerAt(x.seller) !== null)
      ) {
        this.handTrade(x.good, x.qty, x.price, ps, pb, x.buyer === 'you' || x.seller === 'you');
        return;
      }
      const b = this.realTrader(x.buyer, x.good);
      const s = this.realTrader(x.seller, x.good);
      if (b === null || s === null) return;
      this.pending.push({
        at: now + fd[k]! / 1000,
        job: {
          key: fillKey(x),
          good: x.good,
          qty: x.qty,
          price: x.price,
          buyer: b.i,
          seller: s.i,
          real: true,
        },
      });
    });
  }

  /** Goods fly seller → buyer, COIN back: a deal between people standing here. */
  private handTrade(
    good: GoodId,
    qty: number,
    price: number,
    s: { x: number; y: number; z: number },
    b: { x: number; y: number; z: number },
    mine: boolean,
  ) {
    const head = (p: { x: number; y: number; z: number }) => ({
      x: p.x,
      y: p.y + LOW.top + 0.35,
      z: p.z,
    });
    const size = Math.min(1.5, 0.7 + Math.log10(1 + qty) * 0.4);
    this.fx.fly(good, head(s), head(b), 0.9, size);
    this.fx.fly('COIN', head(b), head(s), 1, size * 0.85);
    const prev = this.lastPx[good] ?? price;
    this.lastPx[good] = price;
    this.hall.boards[PIT_BY_GOOD[good].ix]!.ping(price >= prev, isBig({ good, qty, price }));
    this.fillLog.push({ t: this.crowd.t, real: true });
    if (mine && this.youI >= 0) {
      const you = this.crowd.traders[this.youI]!;
      this.say(you, {
        kind: 'filled',
        text: `DEAL! ${qty} ${good} @ ${price}`,
        real: true,
        at: this.crowd.t,
        ttl: BUBBLE_TTL.fill,
        pop: true,
      });
    }
  }

  // ── The simulated crowd ──

  private refreshPitLists() {
    for (const l of this.pitLists) l.length = 0;
    for (const t of this.crowd.traders)
      if (t.kind === 'sim' && t.mode === 'mill' && t.arrived && !this.sched.busy(t.i))
        this.pitLists[t.home % PITS.length]!.push(t.i);
  }

  private simIn(good: GoodId, not = -1): Trader | null {
    const l = this.pitLists[PIT_BY_GOOD[good].ix]!;
    for (let k = 0; k < 6 && l.length > 0; k++) {
      const i = l[Math.floor(Math.random() * l.length)]!;
      const t = this.crowd.traders[i]!;
      if (i !== not && this.crowd.free(t) && !this.sched.busy(i)) return t;
    }
    return null;
  }

  private realPerMin() {
    let n = 0;
    for (const f of this.fillLog) if (f.real && this.crowd.t - f.t < 60) n++;
    return n;
  }

  private stepFlow(dt: number) {
    this.pitListTimer -= dt;
    if (this.pitListTimer <= 0) {
      this.pitListTimer = 0.5;
      this.refreshPitLists();
    }
    const o = this.flow.step(dt, this.refs, this.realPerMin());
    for (const s of o.shouts) {
      const t = this.simIn(s.good);
      if (t === null) continue;
      this.say(t, {
        kind: s.side,
        text: orderText(s, t.i),
        real: false,
        at: this.crowd.t,
        ttl: BUBBLE_TTL.order * (0.7 + Math.random() * 0.5),
      });
    }
    for (const f of o.fills) {
      const b = this.simIn(f.good);
      const s = b !== null ? this.simIn(f.good, b.i) : null;
      if (b === null || s === null) continue;
      this.sched.push(
        {
          key: `sim${Math.random()}`,
          good: f.good,
          qty: f.qty,
          price: f.price,
          buyer: b.i,
          seller: s.i,
          real: false,
        },
        this.crowd.t,
      );
    }
  }

  // ── Trades on the floor ──

  private head(t: Trader) {
    return { x: t.x, y: t.y + LOW.top + 0.35, z: t.z };
  }

  private onTrade(e: TradeEvent) {
    const j = e.a.job;
    const b = this.crowd.traders[j.buyer]!;
    const s = this.crowd.traders[j.seller]!;
    if (e.t === 'meet') {
      this.shake[b.i] = TIMING.MEET + 0.25;
      this.shake[s.i] = TIMING.MEET + 0.25;
    } else if (e.t === 'swap') {
      const size = Math.min(1.5, 0.7 + Math.log10(1 + j.qty) * 0.4);
      this.fx.fly(j.good, this.head(s), this.head(b), e.a.quick ? 1.1 : 0.8, size);
      this.fx.fly('COIN', this.head(b), this.head(s), e.a.quick ? 1.2 : 0.95, size * 0.85);
      const prev = this.lastPx[j.good] ?? j.price;
      const up = j.price >= prev;
      if (j.real) this.lastPx[j.good] = j.price;
      const big = isBig(j);
      this.hall.boards[PIT_BY_GOOD[j.good].ix]!.ping(up, big);
      this.hall.tower.ping(j.good, up);
    } else if (e.t === 'done') {
      const now = this.crowd.t;
      const sold = fillText('sell', j);
      const got = fillText('buy', j);
      this.say(s, {
        kind: 'filled',
        text: sold,
        real: j.real,
        at: now,
        ttl: BUBBLE_TTL.fill,
        pop: true,
      });
      this.say(b, {
        kind: 'got',
        text: got,
        real: j.real,
        at: now,
        ttl: BUBBLE_TTL.fill,
        pop: true,
      });
      this.remember(s.i, `SOLD ${j.qty} ${j.good} @ ${j.price}`, j.real);
      this.remember(b.i, `BOUGHT ${j.qty} ${j.good} @ ${j.price}`, j.real);
      if (j.real) {
        s.active = now;
        b.active = now;
      }
      this.fillLog.push({ t: now, real: j.real });
      if (isBig(j)) {
        const m = e.a.meet;
        this.crowd.cheerNear(m.x, m.z, 9, 2.6);
        this.fx.burst({ x: m.x, y: 2.6, z: m.z }, j.real ? 160 : 90);
        this.audio.roar((j.qty * j.price) / 300);
      }
    }
  }

  // ── Camera ──

  private aspect() {
    return Math.max(0.2, this.host.clientWidth / Math.max(1, this.host.clientHeight));
  }

  private presetCtx() {
    const f = this.followI !== null ? this.crowd.traders[this.followI] : undefined;
    return {
      pit: PITS[this.pitIx]!,
      follow: f !== undefined ? { x: f.x, y: f.y, z: f.z } : null,
      aspect: this.aspect(),
      az: this.cur.az,
      me: this.walk.walker,
    };
  }

  setMode(m: CamMode) {
    // V toggles VAST: off again goes back to where you were (walking, say)
    if (m === 'vast' && this.mode !== 'vast') this.vastBack = this.mode;
    else if (m === 'vast' && this.mode === 'vast' && this.vastBack !== null) m = this.vastBack;
    if (m !== 'vast') this.vastBack = null;
    if (m === 'floor' && this.mode === 'floor') this.pitIx = (this.pitIx + 1) % PITS.length;
    if (m === 'follow' && this.followI === null) this.followI = this.pickSomeone();
    if (m !== 'follow') this.followI = null;
    this.mode = m;
    this.idle = 0;
    if (m === 'free') this.want = { ...this.cur };
    else this.want = preset(m, this.presetCtx());
    this.emitHud();
  }

  /** Floor camera on a given pit. */
  floorPit(good: GoodId) {
    this.pitIx = PIT_BY_GOOD[good].ix;
    this.mode = 'floor';
    this.want = preset('floor', this.presetCtx());
    this.emitHud();
  }

  follow(i: number | null) {
    this.followI = i;
    if (i === null) {
      if (this.mode === 'follow') this.setMode('free');
      return;
    }
    this.mode = 'follow';
    this.want = preset('follow', this.presetCtx());
    this.emitHud();
  }

  /** Someone worth following: a real trader that's been busy, else anyone near the middle. */
  private pickSomeone(): number {
    const real = this.crowd.traders.filter(t => t.kind !== 'sim' && t.kind !== 'you');
    real.sort((a, b) => b.active - a.active);
    if (real.length > 0 && Math.random() < 0.8)
      return real[Math.floor(Math.random() * Math.min(3, real.length))]!.i;
    const floor = this.crowd.traders.filter(t => t.mode !== 'balcony');
    return floor[Math.floor(Math.random() * floor.length)]!.i;
  }

  private stepCamera(dt: number) {
    this.idle += dt;
    if (this.mode === 'walk') {
      const w = this.walk.walker;
      this.want.tx = w.x;
      this.want.ty = w.y + 1.5;
      this.want.tz = w.z;
      // Walking and not dragging the view: it swings round behind you
      if (this.idle > 0.8 && w.speed > 0.5) this.want.az = chaseAz(this.want.az, w.heading, dt);
    }
    if (this.mode === 'follow' && this.followI !== null) {
      const t = this.crowd.traders[this.followI];
      if (t !== undefined) {
        this.want.tx = t.x;
        this.want.ty = t.y + 1.7;
        this.want.tz = t.z;
      }
    }
    if (this.idle > 4) {
      if (this.mode === 'floor') this.want.az += dt * 0.07;
      else if (this.mode === 'vast' || this.mode === 'wide') this.want.az += dt * 0.025;
    }
    this.cur = stepOrbit(
      this.cur,
      this.want,
      dt,
      this.mode === 'walk' ? 9 : this.mode === 'follow' ? 3.2 : 2.4,
    );
    // Walking: the camera comes in rather than through a wall or the tower
    if (this.mode === 'walk') this.cur = fitInHall(this.cur);
    const eye = orbitEye(this.cur);
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.lookAt(this.cur.tx, this.cur.ty, this.cur.tz);
    const near = Math.min(20, Math.max(0.25, this.cur.r * 0.015));
    const far = this.cur.r * 4 + 2500;
    if (
      Math.abs(near - this.camera.near) > 0.05 * near ||
      Math.abs(far - this.camera.far) > 0.05 * far
    ) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    const fog = this.scene.fog as THREE.Fog;
    // Close in, the hall is clear; pulled out, the far halls fade to sky so
    // the floor seems to go on forever
    fog.near = this.cur.r * 0.55 + 110;
    fog.far = this.cur.r * 1.75 + 300;
  }

  // ── VAST: copies of the hall ──

  private stepCopies() {
    const rings = copyRings(this.cur.r, this.phone);
    if (rings > 0 && this.copies.length === 0) {
      this.copyGeo = liteHallGeometry(this.hall);
      this.copyMat = liteHallMaterial();
      for (const c of hallCopies(this.phone ? 2 : 4)) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(this.copyGeo, this.copyMat), this.mesh.copy());
        g.position.set(c.x, 0, c.z);
        if (c.flip) g.rotation.y = Math.PI;
        g.matrixAutoUpdate = false;
        g.updateMatrix();
        this.scene.add(g);
        this.copies.push({
          g,
          ring: Math.max(Math.abs(Math.round(c.x / 150)), Math.abs(Math.round(c.z / 104))),
        });
      }
    }
    let n = 0;
    for (const c of this.copies) {
      c.g.visible = c.ring <= rings;
      if (c.g.visible) n++;
    }
    this.vastHalls = n;
  }

  // ── Per frame ──

  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const t0 = performance.now();
    if (!this.paused) this.step(dt);
    this.renderer.render(this.scene, this.camera);
    const ms = performance.now() - t0;
    this.frameMs += (ms - this.frameMs) * 0.05;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.25;
      this.emitHud();
    }
  };

  /** One frame of everything but the render (tests and the dev handle call it). */
  step(dt: number) {
    const crowd = this.crowd;
    crowd.step(dt);
    const now = crowd.t;
    // You walk (only with the WALK camera on); the floor's 'you' stays on you
    this.walk.step(dt, this.cur.az, this.mode === 'walk');
    const you = this.crowd.traders[this.youI];
    if (you !== undefined) this.walk.pin(you);
    this.walk.shove(crowd.traders, this.youI);
    // Release real fills and lines as their spread delay comes up
    if (this.pending.length > 0) {
      const due = this.pending.filter(p => p.at <= now);
      if (due.length > 0) {
        this.pending = this.pending.filter(p => p.at > now);
        for (const p of due) this.sched.push(p.job, now);
      }
    }
    if (this.pendingSay.length > 0) {
      const keep: typeof this.pendingSay = [];
      for (const p of this.pendingSay) {
        if (p.at > now) {
          keep.push(p);
          continue;
        }
        if (p.pit !== undefined && p.t.kind === 'bot') crowd.sendToPit(p.t, p.pit);
        p.b.at = now;
        p.t.active = now;
        this.say(p.t, p.b);
      }
      this.pendingSay = keep;
    }
    this.stepFlow(dt);
    for (const e of this.sched.step(now)) this.onTrade(e);
    while (this.fillLog.length > 0 && now - this.fillLog[0]!.t > 60) this.fillLog.shift();
    for (let i = 0; i < this.shake.length; i++) if (this.shake[i]! > 0) this.shake[i]! -= dt;

    this.stepCamera(dt);
    this.stepCopies();
    this.stepLod(dt);
    this.poseCrowd();
    this.walk.draw(dt, true);
    this.fx.update(dt);
    this.stepBoards(dt);
    this.stepLabels(dt);
    this.audio.setLevel((this.fillLog.length / 60) * 0.9);
  }

  private stepLod(dt: number) {
    const ts = this.crowd.traders;
    if (this.dist.length < ts.length) this.dist = new Float32Array(this.mesh.capacity);
    this.rigTimer -= dt;
    if (this.rigTimer <= 0) {
      this.rigTimer = 0.25;
      const cam = this.camera.position;
      this.camera.getWorldDirection(this.fwd);
      for (let i = 0; i < ts.length; i++) {
        const t = ts[i]!;
        const dx = t.x - cam.x;
        const dy = t.y + 1 - cam.y;
        const dz = t.z - cam.z;
        const d = Math.hypot(dx, dy, dz);
        // Behind the camera: never rigged
        this.dist[i] = dx * this.fwd.x + dy * this.fwd.y + dz * this.fwd.z < -2 ? Infinity : d;
      }
      // You are drawn as your own rider, never a crowd rig
      if (this.youI >= 0) this.dist[this.youI] = Infinity;
      // Pulled right out (VAST): no rigs, and the crowd drops to its far LOD
      this.mesh.setFar(this.cur.r > 200);
      const max = this.cur.r > 200 || !this.rigs.ready ? 0 : this.budget.rigs;
      this.rigWant = pickRigs(
        this.dist.subarray(0, ts.length),
        this.rigSet,
        max,
        this.budget.rigDist,
        this.followI,
      );
    }
    this.rigSet = this.rigs.sync(
      this.rigWant,
      ts,
      t => this.rigAct(t),
      dt,
      this.budget.rigsPerFrame,
    );
    // Walking: whoever stands between the camera and you steps out of view
    this.blockers.clear();
    if (this.mode === 'walk') {
      const e = this.camera.position;
      const w = this.walk.walker;
      for (const t of ts) {
        if (t.i === this.youI || !inTheWay(e.x, e.z, w.x, w.z, t.x, t.z)) continue;
        this.blockers.add(t.i);
        this.rigs.hide(t.i);
      }
    }
  }

  private rigAct(t: Trader): { act: RigAct; speed: number } {
    if (t.cheer > 0) return { act: t.i % 3 === 0 ? 'dance' : 'celebrate', speed: 0 };
    if ((this.shake[t.i] ?? 0) > 0) return { act: 'wave', speed: 0 };
    if (t.speed > 2) return { act: 'run', speed: t.speed };
    if (t.speed > 0.15) return { act: 'walk', speed: t.speed };
    if (t.shout > 0) return { act: 'wave', speed: 0 };
    return { act: 'idle', speed: 0 };
  }

  private poseCrowd() {
    const ts = this.crowd.traders;
    const time = this.crowd.t;
    this.mesh.update(ts.length, (i, p) => {
      const t = ts[i]!;
      p.x = t.x;
      p.y = t.y;
      p.z = t.z;
      p.yaw = t.heading;
      p.hidden = this.rigSet.has(i) || i === this.youI || this.blockers.has(i);
      // Legs swing with the walk (crowdMesh's shader), a smaller bob on top
      p.phase = t.phase;
      p.stride = t.walk * Math.min(1, t.speed / 1.2 + 0.35);
      p.lift = Math.abs(Math.sin(t.phase)) * 0.05 * t.walk;
      p.roll = Math.sin(t.phase) * 0.04 * t.walk;
      if (t.cheer > 0) p.lift += Math.abs(Math.sin(time * 8 + i)) * 0.55;
      else if (t.shout > 0) {
        p.lift += Math.abs(Math.sin(time * 11 + i)) * 0.14;
        p.pitch = -0.08;
      }
      if ((this.shake[i] ?? 0) > 0) {
        p.pitch = 0.22;
        p.lift += Math.abs(Math.sin(time * 14)) * 0.1;
      }
    });
  }

  private quote(g: GoodId) {
    const t = this.tickers.find(x => x.good === g);
    return t
      ? { good: g, last: t.last, chg: t.chg, bid: t.bid, ask: t.ask, vol: t.vol }
      : {
          good: g,
          last: this.refs[g].last,
          chg: null,
          bid: this.refs[g].bid,
          ask: this.refs[g].ask,
          vol: 0,
        };
  }

  private stepBoards(dt: number) {
    const quotes = PIT_GOODS.map(g => this.quote(g));
    for (const b of this.hall.boards) b.update(quotes[PIT_GOODS.indexOf(b.good)]!, dt);
    const real = this.realPerMin();
    this.hall.tower.update(
      {
        quotes,
        status: this.feedLabel(),
        live: this.source.mode === 'live',
        fillsPerMin: this.fillLog.length,
        realPerMin: real,
        traders: this.crowd.traders.length,
      },
      dt,
    );
    this.hall.band.update(quotes, dt);
    const time = this.crowd.t;
    this.hall.boardMeshes.forEach((m, k) => {
      m.rotation.y = Math.sin(time * 0.25 + k) * 0.08;
    });
  }

  feedLabel() {
    return this.source.mode === 'live'
      ? 'LIVE EXCHANGE'
      : this.source.mode === 'offline'
        ? 'OFFLINE SIM'
        : 'SIM (SERVER AWAY)';
  }

  private project(x: number, y: number, z: number): { x: number; y: number; ok: boolean } {
    const v = this.v.set(x, y, z).project(this.camera);
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const ok = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && v.y < 1.15 && v.y > -1.05;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, ok };
  }

  private stepLabels(dt: number) {
    const ts = this.crowd.traders;
    const now = this.crowd.t;
    const cam = this.camera.position;
    this.bubbleTimer -= dt;
    // VAST: the crowd is specks, no bubbles
    const far = this.cur.r > 260;
    if (this.bubbleTimer <= 0) {
      this.bubbleTimer = 0.2;
      const cands: BubbleCand[] = [];
      if (!far)
        for (const t of ts) {
          const b = this.bubbles[t.i];
          const named = t.kind !== 'sim';
          const followed = t.i === this.followI;
          if (!alive(b, now) && !named && !followed) continue;
          const d = Math.hypot(t.x - cam.x, t.y - cam.y, t.z - cam.z);
          if (d > 140 && !followed) continue;
          const p = this.project(t.x, t.y + LOW.top + 0.35, t.z);
          cands.push({
            i: t.i,
            dist: d,
            onScreen: p.ok,
            bubble: b ?? null,
            named,
            you: t.kind === 'you',
            followed,
          });
        }
      this.shown = pickBubbles(cands, this.budget.bubbles, now, this.showing);
      this.showing = new Set(this.shown);
    }
    const specs: LabelSpec[] = [];
    for (const i of this.shown) {
      const t = ts[i]!;
      const p = this.project(t.x, t.y + LOW.top + 0.35 + (t.cheer > 0 ? 0.4 : 0), t.z);
      if (!p.ok) continue;
      const b = this.bubbles[i];
      const live = alive(b, now) ? b : null;
      const d = Math.hypot(t.x - cam.x, t.y - cam.y, t.z - cam.z);
      specs.push({
        i,
        x: p.x,
        y: p.y,
        scale: Math.min(1.15, Math.max(0.62, 1.25 - d / 70)),
        name: t.name,
        text: live?.text ?? null,
        kind: live?.kind ?? 'name',
        real: live?.real ?? t.kind !== 'sim',
        you: t.kind === 'you',
        followed: i === this.followI,
        stamp: live?.at ?? 0,
        pop: live?.pop === true && now - live.at < 0.6,
      });
    }
    for (const s of this.walk.labels((x, y, z) => this.project(x, y, z), cam)) specs.push(s);
    this.labels.render(specs);
  }

  // ── Input ──

  private pointers = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; t: number; moved: number; button: number } | null = null;
  private pinch: { d: number; mx: number; my: number } | null = null;

  private bindInput() {
    const el = this.renderer.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.noMenu);
    window.addEventListener('keydown', this.onKey);
  }

  private noMenu = (e: Event) => e.preventDefault();

  private touched(kind: 'rotate' | 'zoom' | 'pan') {
    this.idle = 0;
    if (this.mode === 'walk') return; // look round / zoom without leaving WALK
    if (this.mode === 'wide' || this.mode === 'vast' || (kind === 'pan' && this.mode !== 'free')) {
      if (this.mode === 'follow') this.followI = null;
      this.mode = 'free';
      this.emitHud();
    }
  }

  private apply(f: (o: Orbit) => Orbit) {
    this.cur = f(this.cur);
    this.want = f(this.want);
  }

  private onDown = (e: PointerEvent) => {
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1)
      this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, button: e.button };
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = {
        d: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        mx: (a!.x + b!.x) / 2,
        my: (a!.y + b!.y) / 2,
      };
      if (this.down !== null) this.down.moved = 99;
    }
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (p === undefined) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size >= 2 && this.pinch !== null) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mx = (a!.x + b!.x) / 2;
      const my = (a!.y + b!.y) / 2;
      if (d > 1 && this.pinch.d > 1) {
        const k = this.pinch.d / d;
        this.touched('zoom');
        this.apply(o => zoom(o, k));
      }
      const pdx = mx - this.pinch.mx;
      const pdy = my - this.pinch.my;
      if (Math.abs(pdx) + Math.abs(pdy) > 0.5) {
        this.touched('pan');
        this.apply(o => pan(o, pdx, pdy, (FOV * Math.PI) / 180, this.host.clientHeight));
      }
      this.pinch = { d, mx, my };
      return;
    }
    if (this.down === null) return;
    this.down.moved += Math.abs(dx) + Math.abs(dy);
    if (this.down.moved < 4) return;
    const panning = this.down.button === 2 || e.shiftKey || e.ctrlKey;
    if (panning && this.mode !== 'walk') {
      this.touched('pan');
      this.apply(o => pan(o, dx, dy, (FOV * Math.PI) / 180, this.host.clientHeight));
    } else {
      this.touched('rotate');
      this.apply(o => rotate(o, dx, dy, this.phone ? 0.007 : 0.005));
    }
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    const d = this.down;
    if (this.pointers.size === 0) {
      this.down = null;
      if (d !== null && d.moved < 6 && performance.now() - d.t < 450)
        this.tap(e.clientX, e.clientY);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.touched('zoom');
    const k = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0015)));
    this.apply(o => this.walkZoom(zoom(o, k)));
  };

  /** WALK keeps the camera close behind you. */
  private walkZoom(o: Orbit): Orbit {
    if (this.mode !== 'walk') return o;
    return { ...o, r: Math.min(WALK_R.max, Math.max(WALK_R.min, o.r)) };
  }

  private onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey
    )
      return;
    if (!this.host.isConnected || this.host.offsetParent === null) return;
    const walking = this.mode === 'walk';
    if (walking && WalkMode.isWalkKey(e)) return; // WASD / arrows / Shift: walkMode's
    const m = modeForKey(e.key, walking);
    if (m !== null) {
      this.setMode(m);
      return;
    }
    const step = 0.08;
    if (e.key === 'ArrowLeft') this.apply(o => rotate(o, -step / 0.005, 0));
    else if (e.key === 'ArrowRight') this.apply(o => rotate(o, step / 0.005, 0));
    else if (e.key === 'ArrowUp') this.apply(o => rotate(o, 0, -step / 0.005));
    else if (e.key === 'ArrowDown') this.apply(o => rotate(o, 0, step / 0.005));
    else if (e.key === '+' || e.key === '=') {
      this.touched('zoom');
      this.apply(o => zoom(o, 0.8));
    } else if (e.key === '-' || e.key === '_') {
      this.touched('zoom');
      this.apply(o => zoom(o, 1.25));
    } else if (e.key === 'Escape' && this.target !== null) this.setTarget(null);
    else if (e.key === 'Escape' && this.followI !== null) this.follow(null);
    else if (e.key === ']' || e.key === '[') {
      this.pitIx = (this.pitIx + (e.key === ']' ? 1 : PITS.length - 1)) % PITS.length;
      this.mode = 'floor';
      this.want = preset('floor', this.presetCtx());
      this.emitHud();
    } else return;
    this.idle = 0;
  };

  /**
   * Tap / click: walking, open a trade with whoever's under the pointer (a
   * player first, then a trader); with the other cameras, follow them.
   */
  private tap(cx: number, cy: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const x = cx - r.left;
    const y = cy - r.top;
    const within = this.phone ? 34 : 26;
    const peer = this.walk.pick((a, b, c) => this.project(a, b, c), x, y, within);
    if (peer !== null) {
      this.setTarget({
        kind: 'peer',
        key: `peer:${peer.id}`,
        name: peer.name.toUpperCase(),
        tag: peer.tag,
        seedKey: peer.seedKey,
      });
      return;
    }
    let best = -1;
    let bestD = within;
    for (const t of this.crowd.traders) {
      // Mid-body and head: whichever is nearer the tap
      for (const h of [1, 1.6]) {
        const p = this.project(t.x, t.y + h, t.z);
        if (!p.ok) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) {
          bestD = d;
          best = t.i;
        }
      }
    }
    if (best < 0 || best === this.youI) return;
    if (this.mode === 'walk') this.setTarget(this.targetOf(best));
    else this.follow(best);
  }

  // ── Trading with someone on the floor ──

  /** The trade target for crowd trader i. */
  targetOf(i: number): TradeTarget | null {
    const t = this.crowd.traders[i];
    if (t === undefined || t.kind === 'you') return null;
    const name = t.name ?? `TRADER #${t.i + 1}`;
    if (t.kind === 'bot' && t.id.startsWith('agent:'))
      return {
        kind: 'agent',
        key: t.id,
        name: AGENT_BY_ID[t.id]?.name.toUpperCase() ?? name,
        agent: t.id,
      };
    if (t.kind === 'bot') return { kind: 'bot', key: t.id, name, bot: t.id };
    if (t.kind === 'rider') return { kind: 'rider', key: t.id, name, tag: t.id };
    return { kind: 'sim', key: t.id, name, good: PITS[t.home % PITS.length]!.good };
  }

  setTarget(t: TradeTarget | null) {
    this.target = t;
    this.emitHud();
  }

  /** Send a trade (the panel's order or offer, or an answer to one). */
  async act(a: ClientAction): Promise<ActReply> {
    const r = await this.source.act(a);
    // Tell the player you offered it to, so their screen shows it now
    if (r.ok && a.t === 'offer' && a.to.startsWith('r:')) this.walk.net?.pingOffer(a.to);
    if (r.ok && a.t === 'accept') {
      const d = this.source.deals.incoming.find(x => x.id === a.deal) ?? r.deal;
      if (d !== undefined) this.walk.net?.pingOffer(d.who);
    }
    this.emitHud();
    void this.pollNow();
    return r;
  }

  private lastPing = 0;

  /**
   * A player says they just sent you an offer: look now. Anyone can claim
   * that (it's only a hint in their pose blob), so at most every 2 s.
   */
  private pinged() {
    const now = performance.now();
    if (now - this.lastPing < 2_000) return;
    this.lastPing = now;
    this.pollNow();
  }

  /** Poll the exchange now (someone pinged you an offer, or you just traded). */
  pollNow() {
    if (this.disposed) return;
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    void this.poll();
  }

  setStick(side: number, fwd: number) {
    this.walk.setStick(side, fwd);
  }

  /** A display name for a tag in your offers list. */
  nameOf(tag: string): string {
    const p = this.walk.nameOf(tag);
    if (p !== null) return p.toUpperCase();
    const t = this.crowd.get(tag);
    return (
      t?.name ??
      (tag.startsWith('bot:')
        ? (BOT_BY_ID[tag]?.name ?? tag)
        : `RIDER ${tag.slice(2, 6).toUpperCase()}`)
    );
  }

  private nearPit(): GoodId {
    const w = this.walk.walker;
    let best = PITS[0]!;
    for (const p of PITS)
      if (Math.hypot(p.x - w.x, p.z - w.z) < Math.hypot(best.x - w.x, best.z - w.z)) best = p;
    return best.good;
  }

  // ── HUD ──

  toggleSound() {
    this.audio.setOn(!this.audio.on);
    this.emitHud();
  }

  private followInfo(): FollowInfo | null {
    if (this.followI === null) return null;
    const t = this.crowd.traders[this.followI];
    if (t === undefined) return null;
    const b = this.bubbles[t.i];
    const now = this.crowd.t;
    const def = BOT_BY_ID[t.id];
    return {
      i: t.i,
      id: t.id,
      name: t.name ?? `TRADER #${t.i + 1}`,
      kind: t.kind,
      seed: t.seed,
      real: t.kind !== 'sim',
      now: alive(b, now) ? b.text : null,
      recent: (this.hist.get(t.i) ?? []).map(h => ({
        text: h.text,
        real: h.real,
        ago: Math.round(now - h.at),
      })),
      blurb: def?.blurb ?? null,
    };
  }

  private emitHud() {
    this.onHud({
      mode: this.mode,
      pit: PITS[this.pitIx]!.good,
      feed: this.source.mode,
      connected: this.connected,
      traders: this.crowd.traders.length,
      rigs: this.rigSet.size,
      bubbles: this.shown.length,
      trades: this.sched.active.length,
      fillsPerMin: this.fillLog.length,
      realPerMin: this.realPerMin(),
      follow: this.followInfo(),
      fps: Math.round(this.fps),
      frameMs: Math.round(this.frameMs * 10) / 10,
      sound: this.audio.on,
      news: this.news !== null && this.crowd.t - this.news.at < 8 ? this.news.text : null,
      vastHalls: this.vastHalls,
      walking: this.mode === 'walk',
      target: this.target,
      you: this.source.you,
      deals: this.source.deals,
      tickers: this.tickers,
      peers: this.walk.peers.length,
      online: this.walk.net?.connected === true,
      nearPit: this.nearPit(),
      now: Date.now(),
      agents: this.source.agents,
      ledger: this.source.ledger,
    });
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.ro.disconnect();
    window.removeEventListener('keydown', this.onKey);
    this.labels.dispose();
    this.walk.dispose();
    this.rigs.dispose();
    this.fx.dispose();
    this.mesh.dispose();
    this.audio.dispose();
    this.copyGeo?.dispose();
    this.copyMat?.dispose();
    this.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry?.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        (mat as THREE.MeshBasicMaterial).map?.dispose();
        mat.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    if (import.meta.env.DEV) delete (window as unknown as { __gx3d?: FloorScene }).__gx3d;
  }
}
