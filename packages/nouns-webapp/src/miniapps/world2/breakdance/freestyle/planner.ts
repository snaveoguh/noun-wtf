// ── Freestyle: the set (what the Noun dances, beat by beat) ─────────────
//
// Pure. A FreestyleSet hands out FreeSteps on a beat grid: a move, the beat
// it starts on, its length on the pose's grid (`n`, what movePose gets) and
// how long it's held (`dur`, whole beats except the exit's quick get-up).
//
// Left alone it auto-dances a flowing set, the way a breaker builds a round:
// toprock for a bar or two → drop → footwork → a power move (or two) → a
// freeze → back into footwork, or up into toprock again. Moves come from the
// sim's table (sim/moves.ts) and always flow (`canFlow`).
//
// A keyed move (keys.ts) cuts in on the next whole beat. Going from your
// feet to a floor move puts a one-beat drop in first, and from the floor to
// toprock a one-beat get-up, so nothing pops; then the auto set carries on
// from wherever the keyed move left the dancer.

import type { MoveFamily, MoveId } from '../contract';

import { canFlow, MOVE_LIST, MOVES, type FlowFrom } from '../sim/moves';

export type Rng = () => number;

/** A small seeded PRNG (mulberry32), so a set is reproducible in tests. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FreeStep {
  move: MoveId;
  /** Beat it starts on. */
  start: number;
  /** Length on the pose's grid (movePose's `n`). */
  n: number;
  /** Beats it's held for (power moves keep spinning past `n`). */
  dur: number;
  /** Typed by the player (else the auto set picked it). */
  keyed: boolean;
  /** Counts up with every step (the net blob uses it to spot a restart). */
  seq: number;
}

const fam = (m: MoveId): MoveFamily => MOVES[m].family;

/** On their feet (toprock, or just got up)? */
export function isUp(m: MoveId | null): boolean {
  return m === null || fam(m) === 'toprock' || m === 'get_up';
}

const byFamily = (f: MoveFamily) => MOVE_LIST.filter(m => m.family === f).map(m => m.id);
const TOPROCK = byFamily('toprock');
const FOOTWORK = byFamily('footwork');
const POWER = byFamily('power');
const FREEZES = byFamily('freeze');

function pick<T>(rng: Rng, list: readonly T[], not?: T): T {
  const from = list.length > 1 && not !== undefined ? list.filter(x => x !== not) : list;
  return from[Math.min(from.length - 1, Math.floor(rng() * from.length))];
}

/** How long the auto set holds a move (whole beats). */
export function holdFor(m: MoveId, rng: Rng): number {
  const s = MOVES[m];
  const n = s.beats;
  switch (s.family) {
    case 'toprock':
      return rng() < 0.35 ? n * 2 : n;
    case 'footwork':
      // short patterns twice through, long ones once
      return n <= 3 ? n * 2 : n;
    case 'power':
      return n <= 3 ? n * 2 : rng() < 0.4 ? n * 2 : n;
    case 'freeze':
      return Math.max(2, n) + 2;
    default:
      return n;
  }
}

/**
 * The auto set's next move after `prev`. `run` counts moves in a row of
 * prev's family (so toprock doesn't go on forever, a run of footwork builds
 * to power, and so on).
 */
export function nextAuto(prev: MoveId | null, run: number, rng: Rng): MoveId {
  const r = rng();
  let next: MoveId;
  if (prev === null || prev === 'get_up') next = pick(rng, TOPROCK);
  else {
    switch (fam(prev)) {
      case 'toprock':
        next = run < 2 && r < 0.45 ? pick(rng, TOPROCK, prev) : r < 0.8 ? 'drop' : 'spin_down';
        break;
      case 'transition': // drop / spin down
        next = r < 0.8 ? pick(rng, FOOTWORK) : pick(rng, POWER);
        break;
      case 'footwork':
        next =
          run < 2 && r < 0.35
            ? pick(rng, FOOTWORK, prev)
            : r < 0.8
              ? pick(rng, POWER)
              : pick(rng, FREEZES);
        break;
      case 'power':
        next = run < 2 && r < 0.3 ? pick(rng, POWER, prev) : pick(rng, FREEZES);
        break;
      case 'freeze':
        next = r < 0.6 ? 'get_up' : pick(rng, FOOTWORK);
        break;
      default:
        next = pick(rng, TOPROCK);
    }
  }
  // Belt and braces: the table's flow rules always hold
  if (!canFlow(prev as FlowFrom, MOVES[next])) next = isUp(prev) ? 'drop' : 'get_up';
  return next;
}

/** The quick transition a keyed move needs first (null: it flows as is). */
export function bridgeFor(from: MoveId | null, to: MoveId): MoveId | null {
  const toFam = fam(to);
  if (toFam === 'transition') return null;
  if (isUp(from) && toFam !== 'toprock') return 'drop';
  if (!isUp(from) && toFam === 'toprock') return 'get_up';
  return null;
}

/** Can a keyed move play at all from here (a drop while down, a get-up while up: no)? */
export function keyedMakesSense(from: MoveId | null, to: MoveId): boolean {
  if (to === 'drop' || to === 'spin_down') return isUp(from);
  if (to === 'get_up') return !isUp(from);
  return true;
}

export class FreestyleSet {
  cur: FreeStep | null = null;
  private queue: FreeStep[] = [];
  private seq = 0;
  private run = 0;
  /** No more auto moves (the set is ending). */
  private ending = false;

  constructor(private rng: Rng = Math.random) {}

  private make(move: MoveId, start: number, keyed: boolean, dur?: number, n?: number): FreeStep {
    this.seq = (this.seq + 1) % 1000;
    return {
      move,
      start,
      n: n ?? MOVES[move].beats,
      dur: dur ?? holdFor(move, this.rng),
      keyed,
      seq: this.seq,
    };
  }

  private follow(prev: FreeStep): FreeStep {
    const q = this.queue.shift();
    const start = prev.start + prev.dur;
    if (q !== undefined) {
      q.start = start;
      return q;
    }
    if (this.ending) {
      // Hold the last pose (a freeze stays frozen, a spin keeps spinning)
      return { ...prev, dur: prev.dur + 4 };
    }
    const move = nextAuto(prev.move, this.run, this.rng);
    return this.make(move, start, false);
  }

  private setCur(s: FreeStep) {
    const prev = this.cur;
    this.run = prev !== null && fam(prev.move) === fam(s.move) ? this.run + 1 : 0;
    this.cur = s;
  }

  /** The step playing at `beat` (starts the set on the next whole beat if it hasn't begun). */
  at(beat: number): FreeStep {
    if (this.cur === null) {
      const first = this.queue.shift();
      if (first !== undefined) {
        first.start = Math.ceil(beat - 1e-6) + 0;
        this.setCur(first);
      } else this.setCur(this.make(nextAuto(null, 0, this.rng), Math.ceil(beat - 1e-6) + 0, false));
    }
    let guard = 0;
    while (beat >= this.cur!.start + this.cur!.dur && guard++ < 64) {
      const s = this.follow(this.cur!);
      if (s.seq === this.cur!.seq) this.cur = s;
      else this.setCur(s);
    }
    return this.cur!;
  }

  /**
   * A keyed move at `beat`: it plays from the next whole beat (after a
   * one-beat drop / get-up when it needs one). Returns the steps queued,
   * empty when it makes no sense from here (a drop while already down).
   */
  request(move: MoveId, beat: number): FreeStep[] {
    const start = Math.floor(beat + 1e-6) + 1;
    const playing = this.cur;
    // What the dancer will be doing when it starts
    const from =
      playing !== null && playing.start + playing.dur > start
        ? playing.move
        : (this.queue.at(-1)?.move ?? playing?.move ?? null);
    if (!keyedMakesSense(from, move)) return [];
    this.ending = false;
    this.queue = [];
    const out: FreeStep[] = [];
    const bridge = bridgeFor(from, move);
    if (bridge !== null) out.push(this.make(bridge, start, false, 1, 1));
    out.push(this.make(move, start + out.length, true));
    if (playing === null) {
      this.queue = out;
      return out;
    }
    if (playing.start + playing.dur > start) {
      // cut the current move off at the next beat
      playing.dur = Math.max(0, start - playing.start);
    }
    this.queue = [...out];
    return out;
  }

  /**
   * End the set from `beat`: a quick get-up if the dancer's on the floor
   * (`upBeats` long, starting now), then hold. Returns the beat it's done.
   */
  finish(beat: number, upBeats = 0.6): number {
    this.ending = true;
    this.queue = [];
    const cur = this.cur;
    if (cur === null || isUp(cur.move) || cur.move === 'drop' || cur.move === 'spin_down') {
      if (cur !== null && (cur.move === 'drop' || cur.move === 'spin_down')) {
        const up = this.make('get_up', beat, false, upBeats, upBeats);
        cur.dur = Math.max(0, beat - cur.start);
        this.queue = [up];
        return beat + upBeats;
      }
      return beat;
    }
    cur.dur = Math.max(0, beat - cur.start);
    this.queue = [this.make('get_up', beat, false, upBeats, upBeats)];
    return beat + upBeats;
  }
}
