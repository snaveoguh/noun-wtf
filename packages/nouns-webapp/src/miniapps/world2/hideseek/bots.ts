// ── CPU hiders and seekers (pure) ────────────────────────────────────────
//
// They move on the host's height grid (nav.ts): A* paths, walking on the
// flat, climbing walls onto the rooftops (slowly, like players do) and
// dropping off ledges. No physics: kinematic along the path.
//
//   Hiders  pick a hiding spot (sheltered cells against walls and props,
//           or rooftops), away from the start and from each other, and run
//           there; then crouch and keep still. A seeker coming close with a
//           clear line of sight sends them running to a spot away from it.
//           Now and then, with nobody near, one whistles.
//   Seekers wait out the hide phase (blindfolded), then patrol the places
//           people hide, sector by sector. They see a hider in front of
//           them (or very close behind) with a clear line, closer the
//           better and much less far when the hider is crouched still;
//           then chase and tag. Lost: they go to where they last saw them.
//           They ping when they've seen nobody for a while and head for the
//           chime (roughly), go to whistles, and check lit doors.
//
// The host asks `thinkBot` for each CPU every frame and applies what comes
// back (tags, door checks, whistles, pings) through the rules, the same way
// as a human's request, so a CPU can't tag what a player couldn't.

import type { BotAnim, HsStanding } from './contract';
import type { Door, Vec } from './rules';

import { TAG_R } from './contract';
import { nextRand } from './rules';
import { findPath, STEP, worldOf, type NavGrid } from './nav';

export interface Bot {
  id: string;
  pos: Vec;
  yaw: number;
  anim: BotAnim;
  path: Vec[];
  mode: 'wait' | 'go-hide' | 'hidden' | 'flee' | 'patrol' | 'chase' | 'investigate' | 'door';
  /** Seconds to the next decision. */
  think: number;
  target: string | null;
  lastSeen: Vec | null;
  lostT: number;
  /** Seconds since a seeker last saw anyone. */
  blindT: number;
  door: Door | null;
  doorT: number;
  repath: number;
  standing: HsStanding | null;
  rng: number;
  /** Sectors patrolled (key → game time). */
  visited: Map<string, number>;
  stuckT: number;
}

export interface BotSeen {
  id: string;
  pos: Vec;
  st: HsStanding;
  /** Crouched still (harder to see). */
  blending: boolean;
}

export interface BotCtx {
  grid: NavGrid;
  spots: { i: number; j: number; cover: number; roof: boolean }[];
  lobby: Vec;
  phase: 'hide' | 'seek' | 'reveal' | 'over';
  /** Game time (s) for patrol memory. */
  time: number;
  skill: number;
  players: readonly BotSeen[];
  los(a: Vec, b: Vec): boolean;
  lit: readonly Door[];
  /** Can this seeker ping now. */
  canPing(id: string): boolean;
  /** Something to go and listen to (a whistle / a ping), newest first. */
  sounds: readonly { id: string; pos: Vec; kind: 'whistle' | 'ping'; by?: string }[];
}

export type BotAct =
  | { a: 'tag'; by: string; id: string }
  | { a: 'door'; by: string; door: string }
  | { a: 'whistle'; id: string }
  | { a: 'ping'; by: string };

export function makeBot(id: string, pos: Vec, yaw: number, seed: number): Bot {
  return {
    id,
    pos: { ...pos },
    yaw,
    anim: 'idle',
    path: [],
    mode: 'wait',
    think: 0,
    target: null,
    lastSeen: null,
    lostT: 0,
    blindT: 0,
    door: null,
    doorT: 0,
    repath: 0,
    standing: null,
    rng: seed | 0,
    visited: new Map(),
    stuckT: 0,
  };
}

/** Back to the start ring for a new round. */
export function resetBot(b: Bot, pos: Vec, yaw: number) {
  b.pos = { ...pos };
  b.yaw = yaw;
  b.path = [];
  b.mode = 'wait';
  b.target = null;
  b.lastSeen = null;
  b.door = null;
  b.anim = 'idle';
  b.think = 0.3 + nextRand(b) * 1.2;
  b.visited.clear();
  b.blindT = 0;
}

type XZ = { x: number; z: number };
const hyp = (a: XZ, b: XZ) => Math.hypot(a.x - b.x, a.z - b.z);
const dist3 = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// ── Speeds (m/s) ──
export const SPEED = {
  walk: 3.2,
  run: 5.2,
  flee: 5.8,
  patrol: 4.2,
  chase: 5.6,
  climb: 2.2,
  fall: 10,
};

/** How far a seeker sees a hider (m). */
export function viewRange(skill: number, blending: boolean): number {
  return (14 + 14 * skill) * (blending ? 0.4 : 1);
}

/** Can seeker `b` see `t` now (range, field of view, line of sight). */
export function sees(b: Bot, t: BotSeen, ctx: BotCtx): boolean {
  if (t.pos.y > 1000) return false; // inside a building
  const d = dist3(b.pos, t.pos);
  if (d > viewRange(ctx.skill, t.blending)) return false;
  if (d > 4) {
    const fx = Math.sin(b.yaw);
    const fz = Math.cos(b.yaw);
    const dx = (t.pos.x - b.pos.x) / Math.max(0.01, hyp(b.pos, t.pos));
    const dz = (t.pos.z - b.pos.z) / Math.max(0.01, hyp(b.pos, t.pos));
    // ~140° in front
    if (fx * dx + fz * dz < Math.cos((70 * Math.PI) / 180)) return false;
  }
  return ctx.los(b.pos, t.pos);
}

function goTo(b: Bot, ctx: BotCtx, to: XZ): boolean {
  const p = findPath(ctx.grid, b.pos, to);
  if (p === null || p.length === 0) return false;
  b.path = p;
  return true;
}

function pickSpot(
  b: Bot,
  ctx: BotCtx,
  score: (p: Vec, s: { cover: number; roof: boolean }) => number,
  tries = 24,
): Vec | null {
  let best: Vec | null = null;
  let bs = -Infinity;
  const n = ctx.spots.length;
  if (n === 0) return null;
  for (let k = 0; k < tries; k++) {
    const s = ctx.spots[Math.floor(nextRand(b) * n)]!;
    const p = worldOf(ctx.grid, s.i, s.j);
    const v = score(p, s) + nextRand(b) * 3;
    if (v > bs) {
      bs = v;
      best = p;
    }
  }
  return best;
}

/** One CPU's frame. Returns what it wants the host to do. */
export function thinkBot(b: Bot, dt: number, ctx: BotCtx): BotAct[] {
  const acts: BotAct[] = [];
  const me = ctx.players.find(p => p.id === b.id);
  const st = me?.st ?? null;
  if (st !== b.standing) {
    // Found (now seeking), or a new round's role
    b.standing = st;
    b.path = [];
    b.mode = 'wait';
    b.think = 0;
  }
  if (ctx.phase === 'reveal' || ctx.phase === 'over' || st === null) {
    b.anim = 'wave';
    return acts;
  }
  b.think -= dt;
  if (st === 'h') hider(b, ctx, acts);
  else seeker(b, st, ctx, acts, dt);
  move(b, dt, ctx);
  return acts;
}

function hider(b: Bot, ctx: BotCtx, acts: BotAct[]) {
  const seekersNear = ctx.players.filter(p => p.st !== 'h');
  if (b.mode === 'wait' && b.think <= 0) {
    // Somewhere sheltered, away from the start, not on top of another CPU's spot
    const taken = ctx.players.filter(p => p.id !== b.id && p.st === 'h').map(p => p.pos);
    const far = 20 + 30 * ctx.skill;
    const spot = pickSpot(b, ctx, (p, s) => {
      const d = hyp(p, ctx.lobby);
      const crowd = taken.some(t => hyp(t, p) < 8) ? 6 : 0;
      return s.cover * 1.5 + (s.roof ? 2 + 4 * ctx.skill : 0) + Math.min(d, far) / 8 - crowd;
    });
    if (spot !== null && goTo(b, ctx, spot)) b.mode = 'go-hide';
    else b.think = 0.5;
    return;
  }
  if ((b.mode === 'go-hide' || b.mode === 'flee') && b.path.length === 0) {
    b.mode = 'hidden';
    b.think = 0.25;
  }
  if (ctx.phase !== 'seek' || b.think > 0) return;
  b.think = 0.25;
  // A seeker close and looking this way: run for it
  const fleeR = 6 + 5 * ctx.skill;
  let threat: BotSeen | null = null;
  let td = Infinity;
  for (const s of seekersNear) {
    const d = dist3(s.pos, b.pos);
    if (d < td) {
      td = d;
      threat = s;
    }
  }
  if (threat !== null && td < fleeR && b.mode !== 'flee' && ctx.los(threat.pos, b.pos)) {
    const from = threat.pos;
    const spot = pickSpot(
      b,
      ctx,
      (p, s) => Math.min(hyp(p, from), 40) / 4 + s.cover - (hyp(p, b.pos) > 45 ? 4 : 0),
      16,
    );
    if (spot !== null && goTo(b, ctx, spot)) b.mode = 'flee';
    return;
  }
  // Nobody about: a cheeky whistle now and then
  if (b.mode === 'hidden' && td > 28 && nextRand(b) < 0.012) acts.push({ a: 'whistle', id: b.id });
}

function sector(p: Vec) {
  return `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`;
}

function seeker(b: Bot, st: HsStanding, ctx: BotCtx, acts: BotAct[], dt: number) {
  // Blindfolded at the start
  if (ctx.phase === 'hide' && st === 's') {
    b.path = [];
    b.anim = 'idle';
    return;
  }
  b.visited.set(sector(b.pos), ctx.time);
  const hidersNow = ctx.players.filter(p => p.st === 'h');
  // Chasing: keep after them, tag when close
  if (b.mode === 'chase' && b.target !== null) {
    const t = hidersNow.find(p => p.id === b.target);
    if (t === undefined) {
      b.mode = 'patrol';
      b.target = null;
      b.path = [];
    } else {
      const visible = sees(b, t, ctx) || (dist3(b.pos, t.pos) < 3 && ctx.los(b.pos, t.pos));
      if (visible) {
        b.lastSeen = { ...t.pos };
        b.lostT = 0;
      } else b.lostT += dt;
      if (hyp(b.pos, t.pos) <= TAG_R * 0.85 && Math.abs(b.pos.y - t.pos.y) < 2) {
        acts.push({ a: 'tag', by: b.id, id: t.id });
      }
      b.repath -= dt;
      if (b.repath <= 0) {
        b.repath = 0.6;
        if (b.lostT > 3 && b.lastSeen !== null) {
          b.mode = 'investigate';
          goTo(b, ctx, b.lastSeen);
        } else if (!goTo(b, ctx, visible ? t.pos : (b.lastSeen ?? t.pos))) {
          // Can't get there (inside, or off the grid)
          b.mode = 'patrol';
          b.path = [];
        }
      }
      // Right next to them: straight at them
      if (visible && hyp(b.pos, t.pos) < 4) b.path = [{ ...t.pos }];
    }
    return;
  }
  if (b.think > 0) return;
  b.think = 0.2;
  // Look
  let seen: BotSeen | null = null;
  let sd = Infinity;
  for (const t of hidersNow)
    if (sees(b, t, ctx)) {
      const d = dist3(b.pos, t.pos);
      if (d < sd) {
        sd = d;
        seen = t;
      }
    }
  if (seen !== null) {
    b.mode = 'chase';
    b.target = seen.id;
    b.lastSeen = { ...seen.pos };
    b.lostT = 0;
    b.repath = 0;
    b.blindT = 0;
    return;
  }
  b.blindT += 0.2;
  // A lit door: go and open it
  if (b.mode === 'door' && b.door !== null) {
    if (hyp(b.pos, b.door) < 2.2) {
      b.doorT += 0.2;
      b.anim = 'idle';
      if (b.doorT >= 1.2) {
        acts.push({ a: 'door', by: b.id, door: b.door.id });
        b.door = null;
        b.mode = 'patrol';
        b.path = [];
      }
    } else if (b.path.length === 0 && !goTo(b, ctx, b.door)) {
      b.door = null;
      b.mode = 'patrol';
    }
    return;
  }
  if (ctx.lit.length > 0) {
    const others = ctx.players.filter(p => p.id !== b.id && p.st !== 'h');
    // The nearest lit door nobody else is already standing at
    const d = [...ctx.lit]
      .filter(l => !others.some(o => hyp(o.pos, l) < 3))
      .sort((x, y) => hyp(b.pos, x) - hyp(b.pos, y))[0];
    if (d !== undefined) {
      b.door = d;
      b.doorT = 0;
      b.mode = 'door';
      goTo(b, ctx, d);
      return;
    }
  }
  // A sound: go and look
  const heard = ctx.sounds.find(
    s => (s.kind === 'whistle' && hyp(s.pos, b.pos) < 70) || (s.kind === 'ping' && s.by === b.id),
  );
  if (heard !== undefined && b.mode !== 'investigate') {
    const err = (1 - ctx.skill) * 10;
    const at = {
      x: heard.pos.x + (nextRand(b) - 0.5) * err,
      y: heard.pos.y,
      z: heard.pos.z + (nextRand(b) - 0.5) * err,
    };
    if (goTo(b, ctx, at)) {
      b.mode = 'investigate';
      return;
    }
  }
  // Seen nobody for a while: ping
  if (b.blindT > 12 - 6 * ctx.skill && ctx.canPing(b.id)) {
    acts.push({ a: 'ping', by: b.id });
    b.blindT = 0;
  }
  // Patrol: hiding places in sectors nobody's checked lately
  if (b.path.length === 0) {
    if (b.mode === 'investigate') b.mode = 'patrol';
    const spot = pickSpot(
      b,
      ctx,
      (p, s) => {
        const last = b.visited.get(sector(p));
        const age = last === undefined ? 120 : ctx.time - last;
        const d = hyp(p, b.pos);
        return (
          Math.min(age, 120) / 15 + s.cover * 0.5 + (s.roof ? 0.5 : 0) - Math.max(0, d - 50) / 10
        );
      },
      16,
    );
    if (spot !== null && goTo(b, ctx, spot)) b.mode = 'patrol';
  }
}

/** Walk / climb / drop along the path. */
function move(b: Bot, dt: number, ctx: BotCtx) {
  const st = b.standing;
  const speed =
    st === 'h'
      ? b.mode === 'flee'
        ? SPEED.flee
        : SPEED.run
      : b.mode === 'chase'
        ? SPEED.chase * (0.85 + 0.3 * ctx.skill)
        : SPEED.patrol;
  const w = b.path[0];
  if (w === undefined) {
    if (b.mode === 'hidden') b.anim = 'crouch';
    else if (b.mode !== 'door') b.anim = 'idle';
    return;
  }
  const dx = w.x - b.pos.x;
  const dz = w.z - b.pos.z;
  const dh = Math.hypot(dx, dz);
  const dy = w.y - b.pos.y;
  if (dy > STEP) {
    const foot = ctx.grid.cell * 0.5;
    if (dh > foot + 0.05) {
      // Up to the foot of the wall…
      const k = Math.min(1, (speed * dt) / dh, (dh - foot) / dh);
      b.pos.x += dx * k;
      b.pos.z += dz * k;
      b.anim = 'run';
    } else {
      // …then climb
      b.pos.y = Math.min(w.y, b.pos.y + SPEED.climb * dt);
      b.anim = 'climb';
    }
    if (dh > 0.01) b.yaw = Math.atan2(dx, dz);
    return;
  }
  if (dh > 0.05) {
    const k = Math.min(1, (speed * dt) / dh);
    b.pos.x += dx * k;
    b.pos.z += dz * k;
    b.yaw = Math.atan2(dx, dz);
  }
  if (dy < -STEP && dh < 0.3) {
    // Over the edge: drop
    b.pos.y = Math.max(w.y, b.pos.y - SPEED.fall * dt);
    b.anim = 'fall';
  } else {
    // On the flat: follow the ground
    b.pos.y += Math.max(-4 * dt, Math.min(4 * dt, dy));
    b.anim = speed > 5 ? 'sprint' : speed > 3.5 ? 'run' : 'walk';
  }
  if (dh < 0.3 && Math.abs(w.y - b.pos.y) < 0.35) b.path.shift();
}
