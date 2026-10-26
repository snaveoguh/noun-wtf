// ── A visit: the interaction state machine (pure, tested) ───────────────
//
// Everything that happens between walking in and walking out, as a pure
// reducer: `step(visit, event, rnd)` → the next visit plus effects for the
// runtime to play (a resident says something, offers food, you eat, you're
// thrown out) and the RespectEvents to report. Residents' moods move with
// what you do; your tier (read at the door) sets how they start and what
// they offer. `menu()` lists what you can do right now, for the UI.
//
//   arrive ─▶ greeted ─▶ (offer ─▶ accept ─▶ eating ─▶ thank window ─▶ ate)
//                     │          └▶ refuse ─▶ refused_food
//                     ├▶ sit / stand (sat)
//                     ├▶ buy (bought), gift (gift)
//                     ├▶ steal (stole; caught → thrown out)
//                     └▶ welcome runs out ─▶ hint ─▶ overstayed ─▶ shown out
//   leaving while eating = walking out on food you were given (refused_food)

import type { InteriorKind, RespectEvent, RespectTier } from './contract';
import type { ResidentDef } from './residents';

import {
  CAUGHT,
  HINT,
  KICK,
  REFUSED,
  SIT,
  SOLD,
  THANKED,
  UNTHANKED,
  WALKED_OUT,
  chatter,
  giftLine,
  greeting,
  offerFood,
  offerLine,
  warmth,
  type Food,
} from './dialogue';
import { pick, type Rng } from './rng';

export interface VisitResident {
  id: string;
  name: string;
  role: ResidentDef['role'];
  mood: number;
  generous: number;
}

export interface Visit {
  door: string;
  kind: InteriorKind;
  tier: RespectTier;
  /** Seconds inside. */
  t: number;
  residents: VisitResident[];
  sitting: number | null;
  offer: { from: string; food: Food; until: number } | null;
  eating: { from: string; food: Food; until: number } | null;
  /** After eating: a few seconds to say thanks. */
  thanks: { from: string; until: number } | null;
  nextOfferAt: number;
  offers: number;
  /** When they'll start hinting you should go (s since arrival or last purchase). */
  welcome: number;
  /** The clock the welcome runs against (arrival, or your last purchase in a public place). */
  since: number;
  hintedAt: number | null;
  overstayed: boolean;
  /** You've been shown (or thrown) out: the runtime walks you out. */
  out: 'kicked' | 'caught' | null;
  sat: boolean;
  spent: number;
  stolen: number;
}

export type VisitEvent =
  /** Time passes. `near`: the resident you're beside (null if none). */
  | { t: 'tick'; dt: number; near: string | null }
  | { t: 'sit'; seat: number }
  | { t: 'stand' }
  | { t: 'accept' }
  | { t: 'refuse' }
  | { t: 'thank' }
  | { t: 'chat'; to: string }
  /** A purchase went through (COIN spent here). */
  | { t: 'bought'; coin: number }
  /** A gift went through. */
  | { t: 'gift'; to: string; coin: number }
  | { t: 'steal'; coin: number; caught: boolean }
  | { t: 'leave' };

export type Effect =
  | { t: 'say'; who: string; text: string; tone: 'happy' | 'plain' | 'sad' | 'angry' }
  | { t: 'offer'; who: string; food: Food }
  | { t: 'eat'; food: Food }
  | { t: 'done_eating' }
  | { t: 'out'; why: 'kicked' | 'caught' }
  | { t: 'respect'; e: RespectEvent };

/** Seconds: first offer after arriving, between offers, how long an offer stands. */
export const OFFER_FIRST: [number, number] = [5, 12];
export const OFFER_GAP: [number, number] = [35, 60];
export const OFFER_WAIT = 14;
export const EAT_S = 3.2;
export const THANK_S = 6;
/** After the hint, how long before it counts as overstaying, then being shown out. */
export const HINT_GRACE = 25;
export const SHOW_OUT = 14;

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/** How long you're welcome (s): homes by mood, public places while you're a customer. */
export function welcomeFor(kind: InteriorKind, tier: RespectTier, rnd: Rng): number {
  const w = warmth(tier);
  if (kind === 'home')
    return (w === 'cold' ? 35 : w === 'neutral' ? 80 : w === 'warm' ? 150 : 260) + rnd() * 40;
  return (w === 'cold' ? 60 : w === 'fan' ? 420 : 240) + rnd() * 60;
}

/** Does a home open its door to you? Outcasts get "not today" at most homes. */
export function answersDoor(kind: InteriorKind, tier: RespectTier, roll: number): boolean {
  if (kind !== 'home') return true;
  if (tier === 'outcast') return roll > 0.7;
  return true;
}

function between(rnd: Rng, [a, b]: [number, number]) {
  return a + rnd() * (b - a);
}

/** Arrive: everyone's first mood is already set from the tier; the host greets you. */
export function arrive(
  door: string,
  kind: InteriorKind,
  tier: RespectTier,
  folk: readonly ResidentDef[],
  rnd: Rng,
): { visit: Visit; effects: Effect[] } {
  const visit: Visit = {
    door,
    kind,
    tier,
    t: 0,
    residents: folk.map(r => ({
      id: r.id,
      name: r.name,
      role: r.role,
      mood: r.mood,
      generous: r.generous,
    })),
    sitting: null,
    offer: null,
    eating: null,
    thanks: null,
    nextOfferAt: between(rnd, OFFER_FIRST),
    offers: 0,
    welcome: welcomeFor(kind, tier, rnd),
    since: 0,
    hintedAt: null,
    overstayed: false,
    out: null,
    sat: false,
    spent: 0,
    stolen: 0,
  };
  const host = visit.residents[0];
  const effects: Effect[] = [];
  if (host !== undefined)
    effects.push({
      t: 'say',
      who: host.id,
      text: greeting(rnd, kind, warmth(tier)),
      tone: tier === 'outcast' ? 'angry' : 'happy',
    });
  return { visit, effects };
}

function mood(v: Visit, id: string, d: number): Visit {
  return {
    ...v,
    residents: v.residents.map(r => (r.id === id ? { ...r, mood: clamp(r.mood + d) } : r)),
  };
}

function moodAll(v: Visit, d: number): Visit {
  return { ...v, residents: v.residents.map(r => ({ ...r, mood: clamp(r.mood + d) })) };
}

/** Who reacts to things that aren't aimed at anyone: the owner, else the first resident. */
function hostOf(v: Visit): VisitResident | undefined {
  return v.residents.find(r => r.role === 'owner') ?? v.residents[0];
}

const respect = (e: RespectEvent): Effect => ({ t: 'respect', e });

/** Places that offer food unprompted (others only when they like you a lot). */
const HOSPITABLE: ReadonlySet<InteriorKind> = new Set(['home', 'cafe', 'bar']);

export function step(v0: Visit, ev: VisitEvent, rnd: Rng): { visit: Visit; effects: Effect[] } {
  let v = v0;
  const fx: Effect[] = [];
  if (v.out !== null && ev.t !== 'leave' && ev.t !== 'tick') return { visit: v, effects: fx };
  switch (ev.t) {
    case 'tick': {
      v = { ...v, t: v.t + ev.dt };
      // An offer nobody answered: quietly withdrawn
      if (v.offer !== null && v.t >= v.offer.until) {
        v = mood({ ...v, offer: null }, v.offer.from, -0.05);
      }
      // Finished eating: the thank-you window opens
      if (v.eating !== null && v.t >= v.eating.until) {
        v = { ...v, thanks: { from: v.eating.from, until: v.t + THANK_S }, eating: null };
        fx.push({ t: 'done_eating' });
      }
      // Never said thanks
      if (v.thanks !== null && v.t >= v.thanks.until) {
        const from = v.thanks.from;
        v = mood({ ...v, thanks: null }, from, 0.04);
        fx.push({ t: 'say', who: from, text: pick(rnd, UNTHANKED), tone: 'sad' });
        fx.push(respect({ kind: 'ate', at: v.door, thanked: false }));
      }
      if (v.out !== null) break;
      // Someone offers you food
      if (
        v.offer === null &&
        v.eating === null &&
        v.thanks === null &&
        v.t >= v.nextOfferAt &&
        v.offers < 3
      ) {
        const near = v.residents.find(r => r.id === ev.near);
        const giver =
          near ??
          (v.sitting !== null ? [...v.residents].sort((a, b) => b.mood - a.mood)[0] : undefined);
        const keen =
          giver !== undefined &&
          (HOSPITABLE.has(v.kind) ? giver.mood > -0.3 : giver.mood > 0.6) &&
          rnd() < 0.4 + giver.generous * 0.6;
        if (giver !== undefined && keen) {
          const w = warmth(v.tier);
          const food = offerFood(rnd, v.kind, giver.mood > 0.75 ? 'fan' : w);
          v = {
            ...v,
            offer: { from: giver.id, food, until: v.t + OFFER_WAIT },
            offers: v.offers + 1,
          };
          fx.push({ t: 'offer', who: giver.id, food });
          fx.push({ t: 'say', who: giver.id, text: offerLine(rnd, w, food), tone: 'happy' });
        }
        v = { ...v, nextOfferAt: v.t + between(rnd, OFFER_GAP) };
      }
      // Outstaying the welcome: a hint, then it counts, then you're shown out
      const host = hostOf(v);
      if (host !== undefined && v.eating === null) {
        if (v.hintedAt === null && v.t - v.since > v.welcome) {
          v = { ...v, hintedAt: v.t };
          fx.push({ t: 'say', who: host.id, text: pick(rnd, HINT), tone: 'plain' });
        } else if (v.hintedAt !== null && !v.overstayed && v.t - v.hintedAt > HINT_GRACE) {
          v = moodAll({ ...v, overstayed: true }, -0.25);
          fx.push(respect({ kind: 'overstayed', at: v.door }));
          fx.push({ t: 'say', who: host.id, text: pick(rnd, HINT), tone: 'sad' });
        } else if (
          v.overstayed &&
          v.hintedAt !== null &&
          v.t - v.hintedAt > HINT_GRACE + SHOW_OUT
        ) {
          v = { ...v, out: 'kicked' };
          fx.push({ t: 'say', who: host.id, text: pick(rnd, KICK), tone: 'angry' });
          fx.push({ t: 'out', why: 'kicked' });
        }
      }
      break;
    }
    case 'sit': {
      if (v.sitting !== null) break;
      v = { ...v, sitting: ev.seat };
      if (!v.sat) {
        v = { ...v, sat: true };
        fx.push(respect({ kind: 'sat', at: v.door }));
        const host = hostOf(v);
        if (host !== undefined && host.mood > 0 && rnd() < 0.5)
          fx.push({ t: 'say', who: host.id, text: pick(rnd, SIT), tone: 'happy' });
      }
      break;
    }
    case 'stand':
      v = { ...v, sitting: null };
      break;
    case 'accept': {
      if (v.offer === null) break;
      const { from, food } = v.offer;
      v = mood({ ...v, offer: null, eating: { from, food, until: v.t + EAT_S } }, from, 0.06);
      fx.push({ t: 'eat', food });
      break;
    }
    case 'refuse': {
      if (v.offer === null) break;
      const from = v.offer.from;
      // Legends get away with it more easily
      v = mood({ ...v, offer: null }, from, v.tier === 'legend' ? -0.05 : -0.15);
      fx.push({ t: 'say', who: from, text: pick(rnd, REFUSED), tone: 'sad' });
      fx.push(respect({ kind: 'refused_food', at: v.door }));
      break;
    }
    case 'thank': {
      if (v.thanks === null) break;
      const from = v.thanks.from;
      v = mood({ ...v, thanks: null }, from, 0.15);
      fx.push({ t: 'say', who: from, text: pick(rnd, THANKED), tone: 'happy' });
      fx.push(respect({ kind: 'ate', at: v.door, thanked: true }));
      break;
    }
    case 'chat': {
      const r = v.residents.find(q => q.id === ev.to);
      if (r === undefined) break;
      v = mood(v, r.id, 0.02);
      fx.push({
        t: 'say',
        who: r.id,
        text: chatter(rnd, v.kind),
        tone: r.mood < -0.3 ? 'plain' : 'happy',
      });
      break;
    }
    case 'bought': {
      const host = hostOf(v);
      v = { ...v, spent: v.spent + ev.coin };
      // A paying customer is welcome again (public places restart the clock)
      if (v.kind !== 'home') v = { ...v, since: v.t, hintedAt: null, overstayed: false };
      if (host !== undefined) {
        v = mood(v, host.id, 0.1);
        fx.push({ t: 'say', who: host.id, text: pick(rnd, SOLD), tone: 'happy' });
      }
      fx.push(respect({ kind: 'bought', at: v.door, coin: ev.coin }));
      break;
    }
    case 'gift': {
      const r = v.residents.find(q => q.id === ev.to);
      if (r === undefined) break;
      const d = ev.coin >= 25 ? 0.45 : ev.coin >= 5 ? 0.2 : 0.08;
      v = mood(v, r.id, d);
      // A big enough gift buys you more time too
      if (ev.coin >= 5) v = { ...v, welcome: v.welcome + 60, hintedAt: null, overstayed: false };
      fx.push({ t: 'say', who: r.id, text: giftLine(rnd, ev.coin), tone: 'happy' });
      fx.push(respect({ kind: 'gift', to: r.id, coin: ev.coin }));
      break;
    }
    case 'steal': {
      v = { ...v, stolen: v.stolen + 1 };
      fx.push(respect({ kind: 'stole', at: v.door, coin: ev.coin }));
      if (ev.caught) {
        const host = hostOf(v);
        v = moodAll({ ...v, out: 'caught', offer: null, eating: null }, -0.8);
        if (host !== undefined)
          fx.push({ t: 'say', who: host.id, text: pick(rnd, CAUGHT), tone: 'angry' });
        fx.push({ t: 'out', why: 'caught' });
      }
      break;
    }
    case 'leave': {
      // Walking out on food you were given
      if (v.eating !== null || v.offer !== null) {
        const from = (v.eating ?? v.offer)!.from;
        if (v.eating !== null) {
          fx.push({ t: 'say', who: from, text: pick(rnd, WALKED_OUT), tone: 'sad' });
          fx.push(respect({ kind: 'refused_food', at: v.door }));
        }
        v = mood({ ...v, eating: null, offer: null }, from, -0.2);
      }
      // Left before saying thanks: it still counts as eaten
      if (v.thanks !== null) {
        fx.push(respect({ kind: 'ate', at: v.door, thanked: false }));
        v = { ...v, thanks: null };
      }
      break;
    }
  }
  return { visit: v, effects: fx };
}

// ── The menu ─────────────────────────────────────────────────────────────

export type Action =
  | { a: 'accept'; label: string; icon: string }
  | { a: 'refuse'; label: string; icon: string }
  | { a: 'thank'; label: string; icon: string }
  | { a: 'sit'; label: string; icon: string; seat: number }
  | { a: 'stand'; label: string; icon: string }
  | { a: 'chat'; label: string; icon: string; to: string }
  | { a: 'gift'; label: string; icon: string; to: string; amounts: number[] }
  | { a: 'buy'; label: string; icon: string }
  | { a: 'steal'; label: string; icon: string; item: number }
  | { a: 'leave'; label: string; icon: string };

export interface MenuContext {
  /** Resident you're next to (id), a free seat within reach, a stealable within reach. */
  near: string | null;
  seat: number | null;
  stealable: number | null;
  /** Someone has eyes on you right now. */
  watched: boolean;
  /** This place sells something (goods or its menu) and the counter's within reach. */
  canBuy: boolean;
}

export const GIFT_AMOUNTS = [1, 5, 25];

/** What you can do right now, most pressing first. */
export function menu(v: Visit, c: MenuContext): Action[] {
  const out: Action[] = [];
  if (v.out !== null) return out;
  if (v.offer !== null) {
    out.push({
      a: 'accept',
      label: `Eat the ${v.offer.food.name.toLowerCase()}`,
      icon: v.offer.food.icon,
    });
    out.push({ a: 'refuse', label: 'No thanks', icon: '🙅' });
  }
  if (v.thanks !== null) out.push({ a: 'thank', label: 'Say thanks', icon: '🙏' });
  if (v.eating !== null) return out;
  if (v.sitting !== null) out.push({ a: 'stand', label: 'Stand up', icon: '🧍' });
  else if (c.seat !== null) out.push({ a: 'sit', label: 'Sit down', icon: '🪑', seat: c.seat });
  const near = v.residents.find(r => r.id === c.near);
  if (near !== undefined) {
    out.push({ a: 'chat', label: `Talk to ${near.name}`, icon: '💬', to: near.id });
    out.push({
      a: 'gift',
      label: `Gift ${near.name}`,
      icon: '🎁',
      to: near.id,
      amounts: GIFT_AMOUNTS,
    });
  }
  if (c.canBuy && v.sitting === null) out.push({ a: 'buy', label: 'Buy', icon: '🛒' });
  if (c.stealable !== null && !c.watched && v.sitting === null && v.offer === null)
    out.push({ a: 'steal', label: 'Pocket it', icon: '🤫', item: c.stealable });
  out.push({ a: 'leave', label: 'Leave', icon: '🚪' });
  return out;
}

/** Chance a theft is noticed: certain if watched, else a turn-around by the watchful. */
export function caughtChance(watched: boolean, watchful: number): number {
  return watched ? 1 : 0.08 + 0.2 * Math.max(0, Math.min(1, watchful));
}
