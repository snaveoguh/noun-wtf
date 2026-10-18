// ── Noun Trade towns at runtime: TownsApi, customers, serving, HUD ───────
//
// Exposed on Game as `game.towns`. Per frame it:
//   • works out which town the player (or the van they drive) is in, fires
//     enter / leave, and drops the arrival banner ("DRY GULCH — ICE CREAM ↑
//     WATER ↑") through the game's toast;
//   • spawns the town's customers (real Nouns, cast.ts) once you're within
//     a few hundred metres — one character per frame, disposed when you
//     leave — and runs their order board (orders.ts): an order bubble with
//     the good's icon and a countdown over each waiting customer;
//   • serves on the move, Crazy Taxi style: hold E (or the SERVE button on
//     touch) and any waiting customer within 6 m gets their item thrown to
//     them; the tip grows with your speed and the time left. With the
//     trade/ economy merged the sale goes through `game.trade.act({ t:
//     'serve' })` (and needs the good in the van); without it the coin is a
//     local street score;
//   • points a compass arrow at the nearest waiting customer while in town.
//
// The van and the economy are optional seams (trade/contract.ts): read off
// the game object if present, so this works before they're merged.

import type { CharacterAssets } from '../character/NounCharacter';
import type { Quality } from '../render/Graphics';
import type {
  GoodId,
  TownId,
  TownPlacement,
  TownsApi,
  TradeApi,
  VanDriveApi,
} from '../trade/contract';

import * as THREE from 'three';

import { NounCharacter } from '../character/NounCharacter';
import { inkExcluded, toonify } from '../render/Toon';
import { NJ, njFrame, njInCore, njToWorld } from '../world/mountain/nounJersey';

import { townAnimators } from './build';
import { CAST, type CustomerDef } from './cast';
import {
  NEAR_R,
  OrderBoard,
  SERVE_R,
  fracLeft,
  inServeRange,
  melts,
  streetPrice,
  timeLeft,
  type Order,
  type OrderEvent,
} from './orders';
import {
  CITY_PLACEMENT,
  GROWN_TOWNS,
  IN_TOWN_R,
  placementOf,
  townFrame,
  townFrameNow,
  townToWorld,
  townYaw,
  type GrownTown,
  type TownFrame,
} from './site';
import { GOOD_LABEL, TOWNS, hotGoods } from './specs';

export interface TownHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  labelLayer: HTMLElement;
  toon: boolean;
  quality: Quality;
  assets(): CharacterAssets | null;
  /** The rider (feet position, velocity). */
  player: { pos: THREE.Vector3; vel: THREE.Vector3 };
  controlYaw(): number;
  toast(text: string, tag: string): void;
  /** The Game itself: `van2` / `trade` are read off it when those parts exist. */
  game: object;
}

const SPAWN_R = 380;
const DESPAWN_R = 480;
const DRAW_DIST = 220;
const BUBBLE_DIST = 120;
const Y = new THREE.Vector3(0, 1, 0);
const LOCAL_KEY = 'noun-trade-street-coin';

interface Customer {
  def: CustomerDef;
  ch: NounCharacter;
  pos: THREE.Vector3;
  yaw: number;
  bubble: HTMLDivElement;
  bubbleKey: string;
  waveT: number;
  sadT: number;
}

interface LiveTown {
  id: GrownTown;
  f: TownFrame;
  board: OrderBoard;
  customers: Customer[];
  pending: CustomerDef[];
}

interface Flight {
  sprite: THREE.Sprite;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
}

export class TownSystem implements TownsApi {
  private listeners = {
    enter: new Set<(t: TownId) => void>(),
    leave: new Set<(t: TownId) => void>(),
  };
  private current: TownId | null = null;
  private checkT = 0;
  private live = new Map<GrownTown, LiveTown>();
  /** Game-time clock (s): pauses with the game. */
  private t = 0;
  private holdKey = false;
  private holdTouch = false;
  private serveCool = 0;
  private flights: Flight[] = [];
  private spriteMats = new Map<GoodId, THREE.SpriteMaterial>();
  private hud: HTMLDivElement;
  private arrow: HTMLDivElement;
  private serveBtn: HTMLButtonElement;
  private hint: HTMLDivElement;
  private noteT = 0;
  /** Nearest open order within NEAR_R (the E / SERVE zone), if any. */
  private near: { town: LiveTown; c: Customer; o: Order; d: number } | null = null;
  /** Local street coin when the economy isn't merged (or for the HUD). */
  localCoin = 0;
  /** Serves this session (tests / HUD). */
  served = 0;
  private disposed = false;

  constructor(private host: TownHost) {
    try {
      this.localCoin = Number(localStorage.getItem(LOCAL_KEY) ?? 0) || 0;
    } catch {
      this.localCoin = 0;
    }
    injectCss();
    const hud = document.createElement('div');
    hud.className = 'nt-hud';
    this.arrow = document.createElement('div');
    this.arrow.className = 'nt-arrow';
    this.arrow.style.display = 'none';
    this.serveBtn = document.createElement('button');
    this.serveBtn.type = 'button';
    this.serveBtn.className = 'nt-serve';
    this.serveBtn.textContent = 'SERVE';
    this.serveBtn.style.display = 'none';
    const down = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.holdTouch = true;
    };
    const up = () => {
      this.holdTouch = false;
    };
    this.serveBtn.addEventListener('pointerdown', down);
    this.serveBtn.addEventListener('pointerup', up);
    this.serveBtn.addEventListener('pointercancel', up);
    this.serveBtn.addEventListener('pointerleave', up);
    this.hint = document.createElement('div');
    this.hint.className = 'nt-hint';
    this.hint.style.display = 'none';
    hud.append(this.arrow, this.hint, this.serveBtn);
    host.labelLayer.appendChild(hud);
    this.hud = hud;
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
  }

  // ── TownsApi ──

  placed(): TownPlacement[] {
    const out: TownPlacement[] = [CITY_PLACEMENT];
    const nj = njFrame();
    if (nj !== null) {
      const c = njToWorld(nj, NJ.W / 2, NJ.L / 2, { x: 0, z: 0 });
      out.push({ id: 'jersey', x: c.x, z: c.z, y: nj.P, r: 110 });
    }
    for (const id of GROWN_TOWNS) {
      const f = townFrame(id);
      if (f !== null) out.push(placementOf(f));
    }
    return out;
  }

  townAt(x: number, z: number): TownId | null {
    if (Math.max(Math.abs(x), Math.abs(z)) < CITY_PLACEMENT.r) return 'city';
    for (const id of GROWN_TOWNS) {
      const f = townFrame(id);
      if (f === null) continue;
      const p = placementOf(f);
      if ((x - p.x) ** 2 + (z - p.z) ** 2 <= p.r * p.r) return id;
    }
    if (njInCore(x, z, 20)) return 'jersey';
    return null;
  }

  on(ev: 'enter' | 'leave', fn: (town: TownId) => void): () => void {
    this.listeners[ev].add(fn);
    return () => this.listeners[ev].delete(fn);
  }

  /** Town pins for the map (B). `grow`: resolve sites not reached yet (full map only). */
  mapPoints(grow = false): { x: number; z: number; name: string; km: number }[] {
    const out: { x: number; z: number; name: string; km: number }[] = [];
    for (const id of GROWN_TOWNS) {
      const f = grow ? townFrameNow(id) : townFrame(id);
      if (f === null) continue;
      const p = placementOf(f);
      out.push({
        x: p.x,
        z: p.z,
        name: TOWNS[id].name,
        km: Math.round(Math.hypot(p.x, p.z) / 1000),
      });
    }
    return out;
  }

  /** Compass entries (top of the HUD) for towns within reach. */
  landmarks(lm: { name: string; dist: number; bearing: number }[]) {
    const p = this.host.player.pos;
    for (const id of GROWN_TOWNS) {
      const f = townFrame(id);
      if (f === null) continue;
      const pl = placementOf(f);
      const dx = pl.x - p.x;
      const dz = pl.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 1500 && d > IN_TOWN_R * 0.6)
        lm.unshift({
          name: TOWNS[id].name,
          dist: Math.round(d),
          bearing: Math.atan2(dx, dz) - this.host.controlYaw(),
        });
    }
  }

  // ── Seams ──

  private get van(): VanDriveApi | null {
    return (this.host.game as { van2?: VanDriveApi | null }).van2 ?? null;
  }

  private get trade(): TradeApi | null {
    return (this.host.game as { trade?: TradeApi | null }).trade ?? null;
  }

  /** Where serving happens from: the van while driving, else the rider. */
  private source(out: THREE.Vector3): { pos: THREE.Vector3; speed: number } {
    const v = this.van;
    if (v !== null && v.driving) {
      out.set(v.pos.x, v.pos.y, v.pos.z);
      return { pos: out, speed: Math.abs(v.speed) };
    }
    const p = this.host.player;
    out.copy(p.pos);
    return { pos: out, speed: Math.hypot(p.vel.x, p.vel.z) };
  }

  // ── Per frame ──

  private _src = new THREE.Vector3();

  update(dt: number) {
    if (this.disposed) return;
    this.t += dt;
    for (const a of townAnimators) a(dt);
    const src = this.source(this._src);
    // Enter / leave (4× a second is plenty)
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.25;
      this.checkTown(src.pos);
      this.stream(src.pos);
    }
    this.serveCool -= dt;
    this.near = null;
    for (const lt of this.live.values()) this.stepTown(lt, dt, src.pos);
    if (this.near !== null && (this.holdKey || this.holdTouch)) this.tryServe(src.pos, src.speed);
    this.stepFlights(dt);
    this.updateHud(src.pos);
  }

  private checkTown(pos: THREE.Vector3) {
    const now = this.townAt(pos.x, pos.z);
    if (now === this.current) return;
    const prev = this.current;
    this.current = now;
    if (prev !== null) for (const fn of this.listeners.leave) fn(prev);
    if (now !== null) {
      for (const fn of this.listeners.enter) fn(now);
      if (now === 'cowboy' || now === 'beach') {
        const hot = hotGoods(now)
          .slice(0, 2)
          .map(g => `${GOOD_LABEL[g].name} ↑`)
          .join('  ');
        this.host.toast(TOWNS[now].name.toUpperCase(), `🍦 NOUN TRADE · ${hot}`);
      }
    }
  }

  /** Spawn / despawn the customers of towns within reach. */
  private stream(pos: THREE.Vector3) {
    for (const id of GROWN_TOWNS) {
      const f = townFrame(id);
      const lt = this.live.get(id);
      if (f === null) continue;
      const pl = placementOf(f);
      const d = Math.hypot(pl.x - pos.x, pl.z - pos.z);
      if (lt === undefined && d < SPAWN_R && this.host.assets() !== null) {
        const defs = CAST[id].slice(0, this.host.quality === 'low' ? 5 : 6);
        this.live.set(id, {
          id,
          f,
          board: new OrderBoard(
            id,
            defs.map(c => c.id),
            Math.random,
            { maxOpen: 3, cooldown: [6, 18] },
            this.t,
          ),
          customers: [],
          pending: [...defs],
        });
      } else if (lt !== undefined && d > DESPAWN_R) {
        for (const c of lt.customers) this.disposeCustomer(c);
        this.live.delete(id);
      }
    }
  }

  private stepTown(lt: LiveTown, dt: number, src: THREE.Vector3) {
    // One character per frame (no hitch)
    const next = lt.pending.shift();
    if (next !== undefined) {
      const c = this.makeCustomer(lt.f, next);
      if (c !== null) lt.customers.push(c);
    }
    for (const ev of lt.board.update(this.t)) this.onOrderEvent(lt, ev);
    const cam = this.host.camera.position;
    for (const c of lt.customers) {
      const dc = cam.distanceTo(c.pos);
      c.ch.root.visible = dc < DRAW_DIST;
      const o = lt.board.open.get(c.def.id);
      if (o !== undefined) {
        const d = Math.hypot(src.x - c.pos.x, src.z - c.pos.z);
        if (d < NEAR_R && (this.near === null || d < this.near.d))
          this.near = { town: lt, c, o, d };
      }
      this.renderBubble(c, o, dc);
      if (!c.ch.root.visible) continue;
      // Turn to watch the player when close, wave on a fresh order / a serve
      const dx = src.x - c.pos.x;
      const dz = src.z - c.pos.z;
      const close = dx * dx + dz * dz < 14 * 14;
      const want = close ? Math.atan2(dx, dz) : c.yaw;
      _q.setFromAxisAngle(Y, want);
      c.ch.root.quaternion.slerp(_q, 1 - Math.exp(-4 * dt));
      c.waveT -= dt;
      c.sadT -= dt;
      c.ch.play({ clip: c.waveT > 0 ? 'wave' : 'idle', fade: 0.3 });
      c.ch.update(dt, { lean: 0, travelled: 0, riding: false, grounded: true });
    }
  }

  private onOrderEvent(lt: LiveTown, ev: OrderEvent) {
    const c = lt.customers.find(q => q.def.id === ev.order.customer);
    if (c === undefined) return;
    if (ev.t === 'open') c.waveT = 1.6;
    else if (ev.t === 'expire') c.sadT = 2.5;
  }

  private tryServe(src: THREE.Vector3, speed: number) {
    if (this.serveCool > 0 || this.near === null) return;
    const { town: lt, c, o } = this.near;
    if (!inServeRange(src, c.pos, SERVE_R)) {
      this.note(`GET CLOSER — ${Math.round(this.near.d)} m`);
      return;
    }
    const trade = this.trade;
    const have = trade?.state?.cargo[o.good];
    if (trade !== null && trade.state !== null && (have ?? 0) < 1) {
      this.note(`NO ${GOOD_LABEL[o.good].name} IN THE VAN`);
      return;
    }
    const price = trade?.quote(lt.id, o.good)?.bid ?? streetPrice(lt.id, o.good);
    const ev = lt.board.serve(c.def.id, this.t, speed, price);
    if (ev === null || ev.t !== 'served') return;
    this.serveCool = 0.35;
    this.served++;
    c.waveT = 2.2;
    this.throwItem(o.good, src, c.pos);
    this.popText(c.pos, `+${ev.tip.total} ${ev.tip.grade}`, ev.tip.grade !== 'SERVED');
    if (trade !== null) {
      trade
        .act({ t: 'serve', town: lt.id, good: o.good, customer: c.def.id })
        .then(r => {
          if (!r.ok) this.note(r.reason !== undefined ? r.reason.toUpperCase() : 'SALE REFUSED');
        })
        .catch(() => this.note('OFFLINE: SALE NOT SAVED'));
    } else {
      this.localCoin += ev.tip.total;
      try {
        localStorage.setItem(LOCAL_KEY, String(this.localCoin));
      } catch {
        /* private mode: score just isn't kept */
      }
    }
  }

  // ── Customers ──

  private makeCustomer(f: TownFrame, def: CustomerDef): Customer | null {
    const assets = this.host.assets();
    if (assets === null) return null;
    const s = def.seed;
    const ch = new NounCharacter(
      { background: s[0], body: s[1], accessory: s[2], head: s[3], glasses: s[4] },
      assets,
    );
    ch.setBoardType('skate');
    ch.board.visible = false;
    if (this.host.toon) toonify(ch.root);
    const shadows = this.host.quality !== 'low';
    ch.root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = shadows && m.castShadow;
      if (!shadows) m.receiveShadow = false;
    });
    const w = townToWorld(f, def.vp, def.u, { x: 0, z: 0 });
    const pos = new THREE.Vector3(w.x, f.P + def.y, w.z);
    const yaw = townYaw(f, -Math.sign(def.vp), 0);
    ch.root.position.copy(pos);
    ch.root.quaternion.setFromAxisAngle(Y, yaw);
    this.host.scene.add(ch.root);
    const bubble = document.createElement('div');
    bubble.className = 'nt-bubble';
    bubble.style.display = 'none';
    this.host.labelLayer.appendChild(bubble);
    return { def, ch, pos, yaw, bubble, bubbleKey: '', waveT: 0, sadT: 0 };
  }

  private disposeCustomer(c: Customer) {
    c.ch.dispose();
    c.ch.body.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const src = mat.userData.toonSrc as THREE.Material | undefined;
        const sm = mat as THREE.MeshStandardMaterial;
        if (/nounbody/i.test(sm.name)) sm.map?.dispose();
        src?.dispose();
        mat.dispose();
      }
    });
    c.bubble.remove();
  }

  private _v = new THREE.Vector3();

  /** Screen position of a world point (null when off screen). */
  private project(p: THREE.Vector3, up: number): { x: number; y: number } | null {
    const v = this._v.copy(p);
    v.y += up;
    v.project(this.host.camera);
    if (v.z >= 1 || v.z <= -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return null;
    const w = this.host.canvas.clientWidth;
    const h = this.host.canvas.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  private renderBubble(c: Customer, o: Order | undefined, dist: number) {
    const b = c.bubble;
    let show = (o !== undefined || c.sadT > 0) && dist < BUBBLE_DIST;
    const sp = show ? this.project(c.pos, 2.45) : null;
    show = sp !== null;
    if (!show) {
      if (b.style.display !== 'none') b.style.display = 'none';
      return;
    }
    b.style.display = 'block';
    b.style.transform = `translate(-50%, -100%) translate(${sp!.x}px, ${sp!.y}px)`;
    let key: string;
    let html: string;
    if (o === undefined) {
      key = 'sad';
      html = `<div class="nt-b nt-sad">😞 too slow</div>`;
    } else {
      const left = Math.ceil(timeLeft(o, this.t));
      const frac = fracLeft(o, this.t);
      const g = GOOD_LABEL[o.good];
      const hurry = frac < 0.35;
      key = `${o.good}:${left}:${hurry}:${dist < 30}`;
      const name = dist < 30 ? `<i>${escapeHtml(c.def.name)} · #${c.def.noun}</i>` : '';
      html =
        `<div class="nt-b${hurry ? ' nt-hurry' : ''}${melts(o.good) ? ' nt-melt' : ''}">` +
        `<b>${g.icon}</b><span>${left}</span>` +
        `<u style="width:${Math.round(frac * 100)}%"></u></div>${name}`;
    }
    if (key !== c.bubbleKey) {
      c.bubbleKey = key;
      b.innerHTML = html;
    } else if (o !== undefined) {
      const bar = b.querySelector('u') as HTMLElement | null;
      if (bar !== null) bar.style.width = `${Math.round(fracLeft(o, this.t) * 100)}%`;
    }
  }

  // ── Effects ──

  private spriteMat(good: GoodId) {
    let m = this.spriteMats.get(good);
    if (m === undefined) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 96;
      const g = cv.getContext('2d')!;
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(48, 48, 44, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 6;
      g.strokeStyle = '#111';
      g.stroke();
      const icon = GOOD_LABEL[good].icon;
      g.font = icon.length > 2 ? '900 24px "Arial Black", sans-serif' : '54px sans-serif';
      g.fillStyle = good === 'NOGGLES' ? '#d22209' : '#111';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(icon, 48, 52);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      m = new THREE.SpriteMaterial({ map: tex, depthTest: false });
      this.spriteMats.set(good, m);
    }
    return m;
  }

  private throwItem(good: GoodId, from: THREE.Vector3, to: THREE.Vector3) {
    const sprite = new THREE.Sprite(this.spriteMat(good));
    sprite.scale.setScalar(0.9);
    sprite.renderOrder = 10;
    inkExcluded.add(sprite);
    this.host.scene.add(sprite);
    this.flights.push({
      sprite,
      from: from.clone().add(new THREE.Vector3(0, 1.4, 0)),
      to: to.clone().add(new THREE.Vector3(0, 1.6, 0)),
      t: 0,
    });
  }

  private stepFlights(dt: number) {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const fl = this.flights[i];
      fl.t += dt / 0.45;
      const k = Math.min(1, fl.t);
      fl.sprite.position.lerpVectors(fl.from, fl.to, k);
      fl.sprite.position.y += Math.sin(k * Math.PI) * 2.2;
      fl.sprite.scale.setScalar(0.9 * (1 - 0.4 * k));
      if (fl.t >= 1) {
        this.host.scene.remove(fl.sprite);
        inkExcluded.delete(fl.sprite);
        this.flights.splice(i, 1);
      }
    }
  }

  private popText(at: THREE.Vector3, text: string, big: boolean) {
    const sp = this.project(at, 2.6);
    if (sp === null) return;
    const el = document.createElement('div');
    el.className = `nt-pop${big ? ' nt-pop-big' : ''}`;
    el.textContent = text;
    el.style.left = `${sp.x}px`;
    el.style.top = `${sp.y}px`;
    this.hud.appendChild(el);
    window.setTimeout(() => el.remove(), 1400);
  }

  private note(text: string) {
    if (this.t - this.noteT < 1.2) return;
    this.noteT = this.t;
    this.hint.textContent = text;
    this.hint.style.display = 'block';
    this.hint.dataset.until = String(this.t + 1.4);
  }

  private updateHud(src: THREE.Vector3) {
    // Compass arrow to the nearest waiting customer while in a grown town
    const lt =
      this.current === 'cowboy' || this.current === 'beach'
        ? this.live.get(this.current)
        : undefined;
    let best: { c: Customer; o: Order; d: number } | null = null;
    if (lt !== undefined)
      for (const c of lt.customers) {
        const o = lt.board.open.get(c.def.id);
        if (o === undefined) continue;
        const d = Math.hypot(c.pos.x - src.x, c.pos.z - src.z);
        if (best === null || d < best.d) best = { c, o, d };
      }
    if (best !== null && best.d > SERVE_R) {
      const bearing =
        Math.atan2(best.c.pos.x - src.x, best.c.pos.z - src.z) - this.host.controlYaw();
      const deg = (((((bearing * 180) / Math.PI) % 360) + 540) % 360) - 180;
      const g = GOOD_LABEL[best.o.good];
      const key = `${g.icon}:${Math.round(best.d)}`;
      if (this.arrow.dataset.key !== key) {
        this.arrow.dataset.key = key;
        this.arrow.innerHTML = `<b>➤</b><span>${g.icon} ${Math.round(best.d)} m</span>`;
      }
      (this.arrow.firstChild as HTMLElement).style.transform = `rotate(${deg - 90}deg)`;
      this.arrow.style.display = 'flex';
    } else this.arrow.style.display = 'none';
    // Serve prompt: touch button / desktop hint
    const touch = matchMedia?.('(pointer: coarse)').matches === true;
    const canServe = this.near !== null;
    const want = canServe && touch ? 'block' : 'none';
    if (this.serveBtn.style.display !== want) this.serveBtn.style.display = want;
    if (!canServe) this.holdTouch = false;
    const until = Number(this.hint.dataset.until ?? 0);
    if (this.t < until) return;
    if (canServe && !touch) {
      const g = GOOD_LABEL[this.near!.o.good];
      this.hint.textContent = `HOLD E — SERVE ${g.icon} ${g.name}`;
      this.hint.style.display = 'block';
    } else if (this.hint.style.display !== 'none') this.hint.style.display = 'none';
  }

  // ── Input ──

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code !== 'KeyE') return;
    const el = e.target as HTMLElement | null;
    if (el !== null && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable))
      return;
    // Only near a waiting customer: elsewhere E stays the board / van key
    if (this.near === null && !this.holdKey) return;
    e.stopPropagation();
    e.preventDefault();
    this.holdKey = true;
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyE') this.holdKey = false;
  };

  private onBlur = () => {
    this.holdKey = false;
    this.holdTouch = false;
  };

  /** Test / automation hook: hold (or release) the serve button. */
  hold(on: boolean) {
    this.holdKey = on;
  }

  /** Debug / tests: the live order boards. */
  get boards(): Map<GrownTown, OrderBoard> {
    return new Map([...this.live].map(([k, v]) => [k, v.board]));
  }

  /** Debug / tests: world positions of a town's spawned customers. */
  customersOf(id: GrownTown): { id: string; pos: THREE.Vector3 }[] {
    return (this.live.get(id)?.customers ?? []).map(c => ({ id: c.def.id, pos: c.pos }));
  }

  dispose() {
    this.disposed = true;
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    for (const lt of this.live.values()) for (const c of lt.customers) this.disposeCustomer(c);
    this.live.clear();
    for (const fl of this.flights) this.host.scene.remove(fl.sprite);
    this.flights = [];
    for (const m of this.spriteMats.values()) {
      m.map?.dispose();
      m.dispose();
    }
    this.hud.remove();
  }
}

const _q = new THREE.Quaternion();

function escapeHtml(s: string) {
  return s.replace(
    /["&'<>]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = document.createElement('style');
  s.id = 'noun-towns-css';
  s.textContent = `
.nt-hud{position:absolute;inset:0;pointer-events:none;font-family:system-ui,sans-serif}
.nt-bubble{position:absolute;left:0;top:0;text-align:center;white-space:nowrap;pointer-events:none}
.nt-bubble i{display:block;font-style:normal;font-size:10px;color:#fff;text-shadow:0 1px 2px #000;margin-top:2px}
.nt-b{position:relative;display:inline-flex;align-items:center;gap:6px;background:#fff;color:#111;border:2px solid #111;border-radius:12px;padding:3px 10px 6px;box-shadow:3px 3px 0 #d22209;font-weight:900;overflow:hidden}
.nt-b:after{content:"";position:absolute;left:50%;bottom:-8px;margin-left:-6px;border:6px solid transparent;border-top-color:#111}
.nt-b b{font-size:20px;line-height:1}
.nt-b span{font-size:15px;font-style:italic}
.nt-b u{position:absolute;left:0;bottom:0;height:4px;background:#2fbf71;text-decoration:none}
.nt-b.nt-hurry u{background:#f3322c}
.nt-b.nt-hurry{animation:ntshake .4s infinite}
.nt-b.nt-melt.nt-hurry b{filter:saturate(.4)}
.nt-sad{box-shadow:3px 3px 0 #555;font-size:12px}
@keyframes ntshake{0%,100%{transform:translateX(0)}50%{transform:translateX(2px)}}
.nt-arrow{position:absolute;left:50%;top:17%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:2px}
.nt-arrow b{display:block;font-size:38px;line-height:1;color:#ffd400;text-shadow:3px 3px 0 #d22209,0 0 2px #000}
.nt-arrow span{background:rgba(0,0,0,.6);color:#fff;font-size:12px;font-weight:800;padding:2px 9px;border-radius:999px}
.nt-hint{position:absolute;left:50%;bottom:24%;transform:translateX(-50%);background:#ffd400;color:#000;font-weight:900;font-style:italic;padding:6px 14px;box-shadow:5px 5px 0 #d22209;font-size:15px;white-space:nowrap}
.nt-serve{pointer-events:auto;position:absolute;right:22px;bottom:40%;width:86px;height:86px;border-radius:50%;background:#ffd400;color:#000;border:3px solid #000;box-shadow:5px 5px 0 #d22209;font-weight:900;font-style:italic;font-size:17px;touch-action:none;user-select:none;-webkit-user-select:none}
.nt-serve:active{transform:translate(3px,3px);box-shadow:2px 2px 0 #d22209}
.nt-pop{position:absolute;transform:translate(-50%,-100%);color:#ffd400;font-weight:900;font-style:italic;font-size:18px;text-shadow:2px 2px 0 #d22209,0 0 3px #000;white-space:nowrap;animation:ntpop 1.4s ease-out forwards}
.nt-pop-big{font-size:24px}
@keyframes ntpop{0%{opacity:0;margin-top:10px}12%{opacity:1;margin-top:0}100%{opacity:0;margin-top:-50px}}
`;
  document.head.appendChild(s);
}
