// ── Respect: where the rest of the game reports in ──────────────────────
//
// Game.ts makes one RespectHooks and calls into it from the places things
// already happen, so each shared file only gains a line or two:
//
//   frame()        once a frame: a newly banked clean combo → 'trick';
//                  keeps the multiplayer legend badge in step with the tier
//   bail()         the rider's 'bail' event: anyone within reach (another
//                  player, a Noun Jersey crew member, a town customer) →
//                  'bail_into' them
//   stroke()       graffiti's finished stroke: on a home (a door's
//                  footprint, `game.interiors?.doors()`) → 'tagged_home';
//                  the twelfth stroke on one plain wall → 'tagged_wall' (a
//                  piece; a scribble is neutral)
//   wave()         a Noun Jersey hangout NPC waving at you: a legend gets
//                  greeted (a spoken line + a ticker note)
//
// The tiny pure parts (classifyTag, nearestWho) are exported and tested.

import type { RespectSystem } from './RespectSystem';
import type { BuildingDoor, InteriorKind, InteriorsApi } from '../interiors/contract';
import type { ComboState } from '../skate/Tricks';
import type { GrownTown } from '../towns/site';
import type * as THREE from 'three';

import { seedVoice } from '../audio/voice/cast';
import { GROWN_TOWNS } from '../towns/site';

/** A bail counts as "into" someone within this (m, horizontal; 2 m vertical). */
export const BAIL_R = 2.6;
/** Strokes on one wall before it counts as a piece. */
export const PIECE_STROKES = 12;
/** A tag this close to a door with no footprint is on that building (m). */
export const DOOR_R = 5;
/** Footprint margin (m): paint sits on the outer face of the wall. */
const FOOT_PAD = 1.2;
/** A legend is greeted at most this often (ms). */
const GREET_EVERY = 20_000;

export const GREETS = [
  'Yo! A legend in the park!',
  'Respect. Big respect.',
  "Look who it is. The legend's here.",
  'Legend! Show us something.',
] as const;

type Vec = { x: number; y: number; z: number };

export interface RespectHookGame {
  readonly respect: RespectSystem;
  player: { pos: THREE.Vector3; combo: ComboState };
  net: {
    players: ReadonlyMap<string, { name: string; current: { pos: THREE.Vector3 } }>;
    respectBadge: string;
  };
  crew: { npcs: readonly { name: string; pos: THREE.Vector3 }[] } | null;
  towns: { customersOf(id: GrownTown): { pos: THREE.Vector3; name?: string }[] } | null;
  voice: {
    speak(l: { text: string; voice: ReturnType<typeof seedVoice>; gain?: number }): unknown;
  };
}

/** Which building a tag at `at` is on, if any, and whether it's someone's home. */
export function classifyTag(
  at: Vec,
  doors: readonly BuildingDoor[],
  kindOf: (d: BuildingDoor) => InteriorKind | null,
): { home: boolean; building: string } | null {
  let best: { d: BuildingDoor; dist: number } | null = null;
  for (const d of doors) {
    const dist = Math.hypot(at.x - d.x, at.z - d.z);
    const f = d.footprint;
    const on =
      f !== undefined
        ? at.x >= f.minX - FOOT_PAD &&
          at.x <= f.maxX + FOOT_PAD &&
          at.z >= f.minZ - FOOT_PAD &&
          at.z <= f.maxZ + FOOT_PAD &&
          at.y <= d.y + f.height + 1.5
        : dist < DOOR_R && Math.abs(at.y - d.y) < 6;
    if (on && (best === null || dist < best.dist)) best = { d, dist };
  }
  if (best === null) return null;
  // Unknown kind: a building with a door and no business is someone's home
  return { home: (kindOf(best.d) ?? 'home') === 'home', building: best.d.id };
}

/** The closest of `people` within `r` (horizontal; 2 m vertical) of `at`. */
export function nearestWho(
  at: Vec,
  people: Iterable<{ name: string; pos: Vec }>,
  r = BAIL_R,
): string | null {
  let best: string | null = null;
  let bd = r;
  for (const p of people) {
    if (Math.abs(p.pos.y - at.y) > 2) continue;
    const d = Math.hypot(p.pos.x - at.x, p.pos.z - at.z);
    if (d < bd) {
      bd = d;
      best = p.name;
    }
  }
  return best;
}

export class RespectHooks {
  private lastBank: ComboState['lastBanked'] = null;
  private strokes = new Map<string, number>();
  private pieces = new Set<string>();
  private lastGreet = -Infinity;

  constructor(private g: RespectHookGame) {}

  private get interiors(): InteriorsApi | null {
    return (this.g as { interiors?: InteriorsApi | null }).interiors ?? null;
  }

  /** The Big Drop is its own dimension: nothing done there counts. */
  private get away(): boolean {
    return (this.g as { missions?: { ud?: { active?: boolean } } }).missions?.ud?.active === true;
  }

  /** Per frame: banked combos, and the legend badge others see. */
  frame() {
    const b = this.g.player.combo.lastBanked;
    if (b !== this.lastBank) {
      this.lastBank = b;
      if (b !== null && !b.bailed && !this.away)
        this.g.respect.add({ kind: 'trick', score: b.points });
    }
    const badge = this.g.respect.state().tier === 'legend' ? 'L' : '';
    if (this.g.net.respectBadge !== badge) this.g.net.respectBadge = badge;
  }

  /** The rider bailed: into whom? */
  bail() {
    if (this.away) return;
    const who = nearestWho(this.g.player.pos, this.people());
    if (who !== null) this.g.respect.add({ kind: 'bail_into', who });
  }

  private *people(): Generator<{ name: string; pos: Vec }> {
    for (const rp of this.g.net.players.values())
      yield { name: rp.name || 'a rider', pos: rp.current.pos };
    for (const n of this.g.crew?.npcs ?? []) yield { name: n.name, pos: n.pos };
    const towns = this.g.towns;
    if (towns !== null)
      for (const t of GROWN_TOWNS)
        for (const c of towns.customersOf(t)) yield { name: c.name ?? 'a customer', pos: c.pos };
  }

  /** Graffiti finished a stroke on `plane` (ending at `at`). */
  stroke(plane: string, at: Vec) {
    const api = this.interiors;
    const doors = api?.doors() ?? [];
    const where = classifyTag(at, doors, d => d.kind ?? api?.kindOf?.(d.id) ?? null);
    if (where?.home === true) {
      this.g.respect.add({ kind: 'tagged_home', building: where.building });
      return;
    }
    const n = (this.strokes.get(plane) ?? 0) + 1;
    this.strokes.set(plane, n);
    if (n >= PIECE_STROKES && !this.pieces.has(plane)) {
      this.pieces.add(plane);
      this.g.respect.add(
        where !== null
          ? { kind: 'tagged_wall', building: where.building }
          : { kind: 'tagged_wall' },
      );
    }
  }

  /** A crew member waved at the rider. */
  wave(
    name: string,
    seed: { background: number; body: number; accessory: number; head: number; glasses: number },
    pos: Vec,
  ) {
    if (this.g.respect.state().tier !== 'legend') return;
    const now = performance.now();
    if (now - this.lastGreet < GREET_EVERY) return;
    this.lastGreet = now;
    const line = GREETS[Math.floor(Math.random() * GREETS.length)]!;
    const d = Math.hypot(pos.x - this.g.player.pos.x, pos.z - this.g.player.pos.z);
    this.g.voice.speak({
      text: line,
      voice: seedVoice([seed.background, seed.body, seed.accessory, seed.head, seed.glasses]),
      gain: Math.max(0.3, 1 - d / 20),
    });
    this.g.respect.note(`${name}: "${line}"`);
  }
}
