// ── Custom decks: who has what, and keeping every board's graphic current ──
//
// `deckStore` is the player's own decks (3 slots, in this browser and, with a
// wallet, on the `world-decks` function) plus which one they ride. React reads
// it with useSyncExternalStore; the game reads it every frame through
// DeckSync, which also shares `address:slot:savedAt` over the network and
// fetches + caches other riders' decks by address.

import type { NounCharacter } from './NounCharacter';
import type { Net } from '../net/Net';
import type * as THREE from 'three';

import { designTexture } from './deckArt';
import { DECK_SLOTS, SHARE_RE, validateDesign, type DeckDesign, type DeckSlot } from './deckSchema';

export const DECKS_URL = '/.netlify/functions/world-decks';
const LOCAL_KEY = 'noun-world-v2-decks';
const SELECT_KEY = 'noun-world-v2-deck-pick';

type Slots = (DeckSlot | null)[];

export interface DeckState {
  /** Connected wallet (lowercase) or null. */
  address: string | null;
  /** This browser's copies. */
  local: Slots;
  /** The wallet's saved slots (null until fetched / no wallet). */
  remote: Slots | null;
  /** Slot being ridden, −1 = the stock deck. */
  selected: number;
}

const empty = (): Slots => Array.from({ length: DECK_SLOTS }, () => null);

function cleanSlots(raw: unknown): Slots {
  const out = empty();
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < DECK_SLOTS; i++) {
    const s = raw[i] as { d?: unknown; at?: unknown } | null | undefined;
    if (s === null || s === undefined || typeof s.at !== 'number') continue;
    const v = validateDesign(s.d);
    if (v.ok) out[i] = { d: v.design, at: s.at };
  }
  return out;
}

function readLocal(): Pick<DeckState, 'local' | 'selected'> {
  let local = empty();
  let selected = -1;
  try {
    local = cleanSlots(JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null'));
    const s = Number(localStorage.getItem(SELECT_KEY) ?? '-1');
    if (Number.isInteger(s) && s >= -1 && s < DECK_SLOTS) selected = s;
  } catch {
    // storage blocked: designs live for this visit only
  }
  return { local, selected };
}

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url);
  // Local dev without functions serves the SPA's index.html
  if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return null;
  return r.json();
}

class DeckStore {
  state: DeckState = { address: null, remote: null, ...readLocal() };
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getState = () => this.state;

  private set(patch: Partial<DeckState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  setAddress(address: string | null) {
    const a = address?.toLowerCase() ?? null;
    if (a === this.state.address) return;
    this.set({ address: a, remote: null });
    if (a !== null) void this.refreshRemote();
  }

  async refreshRemote() {
    const a = this.state.address;
    if (a === null) return;
    try {
      const res = (await getJson(`${DECKS_URL}?address=${a}`)) as { slots?: unknown } | null;
      if (res !== null && this.state.address === a) this.set({ remote: cleanSlots(res.slots) });
    } catch {
      // offline: local copies still work
    }
  }

  /** Newest copy of a slot (this browser vs the wallet's). */
  slot(i: number): DeckSlot | null {
    const l = this.state.local[i] ?? null;
    const r = this.state.remote?.[i] ?? null;
    if (l === null) return r;
    if (r === null) return l;
    return r.at >= l.at ? r : l;
  }

  active(): DeckSlot | null {
    return this.state.selected >= 0 ? this.slot(this.state.selected) : null;
  }

  select(i: number) {
    const s = Math.max(-1, Math.min(DECK_SLOTS - 1, Math.round(i)));
    try {
      localStorage.setItem(SELECT_KEY, String(s));
    } catch {
      // fine
    }
    this.set({ selected: s });
  }

  saveLocal(i: number, design: DeckDesign, at = Date.now()) {
    const local = this.state.local.slice();
    local[i] = { d: design, at };
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
    } catch {
      // fine
    }
    this.set({ local });
  }

  /** After a signed save: the server's copy of that slot. */
  setRemoteSlot(i: number, slot: DeckSlot) {
    const remote = (this.state.remote ?? empty()).slice();
    remote[i] = slot;
    this.set({ remote });
  }

  /** What other riders fetch: only decks the server holds. */
  shareKey(): string {
    const { address, remote, selected } = this.state;
    if (address === null || selected < 0) return '';
    const r = remote?.[selected] ?? null;
    return r !== null ? `${address}:${selected}:${r.at}` : '';
  }
}

export const deckStore = new DeckStore();

// ── Other riders' decks (batched GET ?addresses=) ──

const remoteDocs = new Map<string, { slots: Slots | null; at: number }>();
const pending = new Set<string>();
let flushTimer: number | null = null;

function flush() {
  flushTimer = null;
  const batch = [...pending].slice(0, 50);
  for (const a of batch) pending.delete(a);
  if (pending.size > 0) flushTimer = window.setTimeout(flush, 50);
  if (batch.length === 0) return;
  getJson(`${DECKS_URL}?addresses=${batch.join(',')}`)
    .then(res => {
      const decks = ((res as { decks?: Record<string, unknown> } | null)?.decks ?? {}) as Record<
        string,
        unknown
      >;
      const now = performance.now();
      for (const a of batch)
        remoteDocs.set(a, { slots: a in decks ? cleanSlots(decks[a]) : null, at: now });
    })
    .catch(() => {
      const now = performance.now();
      for (const a of batch) remoteDocs.set(a, { slots: null, at: now });
    });
}

/** A rider's shared deck, or undefined while it's being fetched. */
function remoteDeck(share: string): DeckSlot | null | undefined {
  const m = SHARE_RE.exec(share);
  if (m === null) return null;
  const [, address, slotS, atS] = m;
  const doc = remoteDocs.get(address);
  const slot = doc?.slots?.[Number(slotS)] ?? null;
  // Fetch when unknown, or when they've saved a newer one (retry ≤ 1/min)
  const stale = doc === undefined || (slot?.at ?? 0) < Number(atS);
  if (
    stale &&
    !pending.has(address) &&
    (doc === undefined || performance.now() - doc.at > 60_000)
  ) {
    pending.add(address);
    if (flushTimer === null) flushTimer = window.setTimeout(flush, 300);
  }
  if (doc === undefined) return undefined;
  return slot;
}

// ── Textures (shared between riders on the same deck) ──

const texCache = new Map<string, THREE.CanvasTexture>();

function textureFor(key: string, design: DeckDesign): THREE.CanvasTexture {
  let t = texCache.get(key);
  if (t === undefined) {
    t = designTexture(design);
    texCache.set(key, t);
    if (texCache.size > 48) {
      const [oldKey, old] = texCache.entries().next().value as [string, THREE.CanvasTexture];
      texCache.delete(oldKey);
      old.dispose();
    }
  }
  return t;
}

/** Keeps the local and remote boards wearing the right deck. */
export class DeckSync {
  private applied = new WeakMap<NounCharacter, string>();

  private apply(ch: NounCharacter, key: string, slot: DeckSlot | null) {
    const want = `${key}|${ch.boardType}`;
    if (this.applied.get(ch) === want) return;
    this.applied.set(ch, want);
    if (slot === null) ch.setDeckGraphic(null, null);
    else ch.setDeckGraphic(textureFor(key, slot.d), slot.d.grip);
  }

  tick(me: NounCharacter | null, net: Net, remotes: Map<string, { character: NounCharacter }>) {
    const mine = deckStore.active();
    if (me !== null)
      this.apply(me, mine !== null ? `me:${deckStore.state.selected}:${mine.at}` : '', mine);
    net.deck = deckStore.shareKey();
    for (const [id, rp] of net.players) {
      const r = remotes.get(id);
      if (r === undefined) continue;
      const share = rp.deck ?? '';
      const slot = share !== '' ? remoteDeck(share) : null;
      if (slot === undefined) continue;
      this.apply(r.character, slot !== null ? `${share}:${slot.at}` : '', slot);
    }
  }
}
