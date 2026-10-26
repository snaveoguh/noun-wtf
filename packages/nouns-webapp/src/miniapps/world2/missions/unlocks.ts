// ── What a rider has unlocked, readable outside the game ─────────────────
//
// The homepage shows THE BIG DROP locked or unlocked without loading Noun
// World: this reads the same saved mission state MissionSystem keeps
// (localStorage, `STORE_PREFIX + riderId`), through the same sanitizer.
// Pure data only (progress.ts + defs.ts): no three.js, no game.

import { MISSION_BY_ID } from './defs';
import { sanitizeState, type MissionState } from './progress';

/** Where MissionSystem saves a rider's missions (+ the rider id). */
export const STORE_PREFIX = 'noun-world-missions:';
/** The rider id's key (net/Stats.ts `riderId`; a test keeps the two in step). */
export const RIDER_KEY = 'noun-world-rider-id';

/** The door's mission: done once you've been through it. */
const DOOR = 'deepest-door';

/**
 * The deepest door opens for you: you've been through it, or the Keymaker
 * sent you (met, and the missions before the door done). MissionSystem's
 * `doorOpen` is this plus its own in-session rule (no teleports).
 */
export function doorUnlocked(s: MissionState): boolean {
  if (s.done[DOOR] !== undefined) return true;
  const m = MISSION_BY_ID[DOOR];
  return (
    m !== undefined && s.met[m.npc] !== undefined && m.after.every(a => s.done[a] !== undefined)
  );
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** This browser's rider's saved missions (empty when there's no rider yet or it's unreadable). */
export function savedMissions(): MissionState {
  const id = read(RIDER_KEY);
  let raw: unknown = null;
  if (id !== null && id !== '')
    try {
      raw = JSON.parse(read(STORE_PREFIX + id) ?? 'null');
    } catch {
      raw = null;
    }
  return sanitizeState(raw);
}

/** Is the Big Drop (behind the deepest door) open to this browser's rider? */
export function bigDropUnlocked(): boolean {
  return doorUnlocked(savedMissions());
}

/** The query that launches Noun World straight onto the Big Drop. */
export const DROP_PARAM = 'drop';
export const BIG_DROP_URL = `/world?${DROP_PARAM}=1`;

/** Said when a direct launch finds the door still shut. */
export const DROP_LOCKED_MSG = 'The Big Drop is behind the deepest door: find the Keymaker';
