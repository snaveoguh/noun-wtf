// ── 3D Grand Exchange: what traders shout, and whose bubble shows (pure) ─
//
// Text: an order becomes a floor shout ("BUY 12 FRIES @ 4", "SELL NOGGLES
// 30!"), a fill a result ("FILLED +48 COIN" for the seller, "GOT 12 FRIES"
// for the buyer). Selection: only the most important bubbles near the
// camera show (MAX_BUBBLES), so the floor stays readable and the DOM cheap.

import type { GoodId } from '../../world2/trade/contract';

export type BubbleKind = 'buy' | 'sell' | 'filled' | 'got' | 'say';

export interface Bubble {
  kind: BubbleKind;
  text: string;
  /** Real exchange data (gets the LIVE marker), not the simulated crowd. */
  real: boolean;
  /** Crowd clock (s) it was said, and how long it lasts. */
  at: number;
  ttl: number;
  /** Pops (a fill landing). */
  pop?: boolean;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * An order as a floor shout. `variant` picks the phrasing (stable per
 * trader, so one trader doesn't flip styles): the long form, or the pit
 * shorthand ("SELL NOGGLES 30!").
 */
export function orderText(
  o: { side: 'buy' | 'sell'; good: GoodId; qty: number; price: number },
  variant = 0,
): string {
  const side = o.side === 'buy' ? 'BUY' : 'SELL';
  const v = Math.abs(variant) % 4;
  if (v === 3) return `${side} ${o.good} ${fmt(o.price)}!`;
  if (v === 2 && o.side === 'buy') return `${fmt(o.price)} BID FOR ${o.qty} ${o.good}!`;
  if (v === 2) return `${o.qty} ${o.good} AT ${fmt(o.price)}!`;
  return `${side} ${o.qty} ${o.good} @ ${fmt(o.price)}`;
}

/** A fill, from one side's point of view. */
export function fillText(
  side: 'buy' | 'sell',
  f: { good: GoodId; qty: number; price: number },
): string {
  if (side === 'sell') return `FILLED +${Math.round(f.qty * f.price)} COIN`;
  return `GOT ${f.qty} ${f.good} −${Math.round(f.qty * f.price)}`;
}

export const BUBBLE_TTL = { order: 4.5, fill: 2.6, say: 5 } as const;

/** Still showing at `now`? */
export const alive = (b: Bubble | null | undefined, now: number): b is Bubble =>
  b !== null && b !== undefined && now - b.at < b.ttl;

export const MAX_BUBBLES = { desktop: 30, phone: 16 } as const;

export interface BubbleCand {
  i: number;
  /** Distance to the camera (m). */
  dist: number;
  /** Projected onto the screen (inside the view, in front of the camera). */
  onScreen: boolean;
  bubble: Bubble | null;
  /** A real trader with a name (bots, riders, you). */
  named: boolean;
  you?: boolean;
  /** The trader the camera follows. */
  followed?: boolean;
}

/** How much a candidate deserves a bubble (0 = none). */
export function bubbleWeight(c: BubbleCand, now: number): number {
  if (!c.onScreen) return 0;
  if (c.followed === true) return 1e9;
  const b = alive(c.bubble, now) ? c.bubble : null;
  if (b === null && !c.named) return 0;
  let w = 1;
  if (b !== null) {
    if (b.kind === 'filled' || b.kind === 'got') w = 6;
    else if (b.kind === 'say') w = 3;
    else w = 2;
    if (b.real) w *= 4;
  } else w = 1.5; // a real trader's name tag, saying nothing right now
  if (c.you === true) w *= 10;
  else if (c.named) w *= 2;
  return w / (1 + c.dist / 18);
}

/**
 * The bubbles to show: the top `max` by weight. Ones already showing get
 * `stick` × their weight, so near-equal candidates don't flicker in and out.
 */
export function pickBubbles(
  cands: readonly BubbleCand[],
  max: number,
  now: number,
  showing: ReadonlySet<number> = new Set(),
  stick = 1.3,
): number[] {
  const scored: { i: number; w: number }[] = [];
  for (const c of cands) {
    let w = bubbleWeight(c, now);
    if (w <= 0) continue;
    if (showing.has(c.i)) w *= stick;
    scored.push({ i: c.i, w });
  }
  scored.sort((a, b) => b.w - a.w || a.i - b.i);
  return scored.slice(0, Math.max(0, max)).map(s => s.i);
}
