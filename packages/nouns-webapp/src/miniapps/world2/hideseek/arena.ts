// ── The arena: the plaza city's box, the lobby spot, the start ring (pure) ─
//
// The plaza city (world/Level.ts): open floor out to about ±75 m, then the
// ring of buildings (rooftops 10–30 m up, towers above), the soft bounds at
// ±93.6 and three alleys out to the mountain. The arena is the whole city
// inside the ring's outer face, rooftops included: |x|, |z| ≤ HALF. A
// glowing wall marks it while you're playing, and players in a game are
// held inside it (the alleys too).
//
// The lobby (where you start a game, and where every round starts) is the
// first candidate whose circle is flat, open floor and that keeps clear of
// the fountain, the breakdance cypher (0, −15), the Oracle's and the ice
// cream van's spots and the spawns (breakdance/net/cypher.ts CYPHER_AVOID).

import { CYPHER_AVOID } from '../breakdance/net/cypher';

export const ARENA = { cx: 0, cz: 0, half: 92 } as const;
/** How close to the lobby spot counts as "at the lobby" (the prompt). */
export const LOBBY_PROMPT_R = 5;
export const LOBBY_R = 3.2;

export interface LobbySpot {
  x: number;
  y: number;
  z: number;
  /** Facing (the way the start ring looks out). */
  yaw: number;
}

/** Candidates (x, z, yaw), tried in order. */
export const LOBBY_CANDIDATES: readonly [number, number, number][] = [
  // West plaza, between Ledge Garden and the south street
  [-34, 40, Math.PI],
  [30, -18, 0],
  [36, 34, Math.PI],
  [-56, 2, Math.PI / 2],
  [52, 52, Math.PI],
];

/** Keep clear: everything the cypher keeps clear of, plus the cypher itself. */
export const LOBBY_AVOID: readonly [number, number, number][] = [
  ...CYPHER_AVOID,
  [0, -15, 9], // the breakdance cypher
];

/**
 * The first clear candidate. `probe(x, z)` is the ground under a point
 * (null: nothing there) and whether it's flat.
 */
export function pickLobby(
  probe: (x: number, z: number) => { y: number; flat: boolean } | null,
): LobbySpot | null {
  for (const [x, z, yaw] of LOBBY_CANDIDATES) {
    if (LOBBY_AVOID.some(([ax, az, r]) => Math.hypot(x - ax, z - az) < r + LOBBY_R + 1)) continue;
    const c = probe(x, z);
    if (c === null || !c.flat || c.y > 1.5) continue;
    let ok = true;
    for (let i = 0; i < 8 && ok; i++) {
      const a = (i / 8) * Math.PI * 2;
      const e = probe(x + Math.cos(a) * LOBBY_R, z + Math.sin(a) * LOBBY_R);
      ok = e !== null && e.flat && Math.abs(e.y - c.y) < 0.15;
    }
    if (ok) return { x, y: c.y, z, yaw };
  }
  return null;
}

/** Where player `i` of `n` starts a round: a ring round the lobby, facing out. */
export function startSlot(
  lobby: LobbySpot,
  i: number,
  n: number,
): { x: number; z: number; yaw: number } {
  const a = lobby.yaw + (i / Math.max(1, n)) * Math.PI * 2;
  const r = n <= 1 ? 0 : 2.2 + n * 0.12;
  return { x: lobby.x + Math.sin(a) * r, z: lobby.z + Math.cos(a) * r, yaw: a };
}

/** Inside the arena box (x, z). */
export function inArena(x: number, z: number, margin = 0): boolean {
  return (
    Math.abs(x - ARENA.cx) <= ARENA.half - margin && Math.abs(z - ARENA.cz) <= ARENA.half - margin
  );
}

/** Clamp a point into the arena; true when it moved. */
export function clampArena(p: { x: number; z: number }): { x: boolean; z: boolean } {
  const h = ARENA.half;
  const out = { x: false, z: false };
  if (Math.abs(p.x - ARENA.cx) > h) {
    p.x = ARENA.cx + Math.sign(p.x - ARENA.cx) * h;
    out.x = true;
  }
  if (Math.abs(p.z - ARENA.cz) > h) {
    p.z = ARENA.cz + Math.sign(p.z - ARENA.cz) * h;
    out.z = true;
  }
  return out;
}

/** Distance from a point to the arena wall (negative outside). */
export function wallDistance(x: number, z: number): number {
  return ARENA.half - Math.max(Math.abs(x - ARENA.cx), Math.abs(z - ARENA.cz));
}

/** Interiors (interiors/InteriorSystem.ts POCKET_Y): rooms are built this high above their door. */
export const POCKET_MIN_Y = 3000;

/** The building a position is inside: the nearest door, when it's up in the pockets. */
export function doorOf<D extends { id: string; x: number; z: number }>(
  p: { x: number; y: number; z: number },
  doors: readonly D[],
): D | null {
  if (p.y < POCKET_MIN_Y) return null;
  let best: D | null = null;
  let bd = 40;
  for (const d of doors) {
    const dd = Math.hypot(d.x - p.x, d.z - p.z);
    if (dd < bd) {
      bd = dd;
      best = d;
    }
  }
  return best;
}
