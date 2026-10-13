// ── Noun Warfare online: compact wire formats ──────────────────────────
//
// Snapshots are one flat number array (`wf:s` d):
//
//   header   H numbers   tick, phase, phaseUntil, scores, liveAt, round,
//                        winner, roundWinner, turfTick, rng, nextId, counts
//   players  PF each     position (cm), velocity (dm/s), yaw/pitch (mrad),
//                        flags, hp, weapon, K/D/A/score, timers (ticks)
//   zones    ZF each     progress, owner, contested, present
//   humans   EF each     the rest of a human's state (ammo, timers, stats,
//                        input ack) — what prediction and host hand-over need
//
// Times travel as whole ticks (−1 = never). Events are short arrays keyed
// by a type index; projectile births are flat 10-number records. Typical
// 4v4 snapshot: ~0.9 KB of JSON.

import type { WarfareSim } from '../sim/sim';

import {
  DT,
  type MatchPhase,
  type PlayerInput,
  type PlayerState,
  type Projectile,
  type SimEvent,
  type SimState,
  type Team,
} from '../sim/types';
import { GRENADE, WEAPONS, WEAPON_ORDER, type DamageSource, type WeaponId } from '../sim/weapons';

export const SNAP_VERSION = 1;
export const H = 16;
export const PF = 20;
export const ZF = 4;
export const EF = 25;
export const BF = 10;
export const INPUT_FIELDS = 6;

const PHASES: MatchPhase[] = ['countdown', 'live', 'roundEnd', 'matchEnd'];
const SOURCES: DamageSource[] = [...WEAPON_ORDER, 'grenade', 'fall'];
const NONE = -99;

const r = Math.round;
const tk = (t: number) => (Number.isFinite(t) ? r(t / DT) : -1);
const ut = (n: number) => (n === -1 ? Infinity : n * DT);
const wrap = (a: number) => {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
};
const srcIdx = (s: DamageSource) => Math.max(0, SOURCES.indexOf(s));
const srcAt = (i: number): DamageSource => SOURCES[i] ?? 'splatter';
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ── Snapshot ──────────────────────────────────────────────────────────

export interface PlayerSnap {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  alive: boolean;
  grounded: boolean;
  crouched: boolean;
  sprinting: boolean;
  scoped: boolean;
  bot: boolean;
  reloading: boolean;
  hp: number;
  weapon: WeaponId;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  respawnAt: number;
  protectedUntil: number;
  stride: number;
  killerId: number;
  diedAt: number;
}

export interface HumanSnap {
  slot: number;
  ack: number;
  mags: Record<WeaponId, number>;
  reloadUntil: number;
  nextFireAt: number;
  swapUntil: number;
  bloom: number;
  grenades: number;
  grenadeRegenAt: number;
  nextGrenadeAt: number;
  prevFire: boolean;
  prevJump: boolean;
  prevGrenade: boolean;
  lastDamageAt: number;
  headshots: number;
  streak: number;
  bestStreak: number;
  shots: number;
  hits: number;
  damage: number;
  captures: number;
  multi: number;
  lastKillAt: number;
}

export interface DecodedSnap {
  tick: number;
  time: number;
  match: Omit<SimState['match'], 'mode' | 'target' | 'timeLimit'>;
  rngState: number;
  nextId: number;
  players: PlayerSnap[];
  zones: { progress: number; owner: Team; contested: boolean; present: number }[];
  humans: Map<number, HumanSnap>;
}

/** Flatten the sim. `humans` = slots to include full state for; `acks` per slot. */
export function encodeSnapshot(
  sim: WarfareSim,
  humans: Iterable<number>,
  acks: ReadonlyMap<number, number>,
): number[] {
  const st = sim.state;
  const m = st.match;
  const hs = [...humans].filter(i => st.players[i] !== undefined);
  const d: number[] = [
    st.tick,
    PHASES.indexOf(m.phase),
    tk(m.phaseUntil),
    m.scores[0],
    m.scores[1],
    tk(m.liveAt),
    m.round,
    m.winner ?? NONE,
    m.roundWinner ?? NONE,
    r(m.turfTick * 1000),
    st.rngState >>> 0,
    st.nextId,
    st.players.length,
    st.zones.length,
    hs.length,
    SNAP_VERSION,
  ];
  for (const p of st.players) {
    const flags =
      (p.alive ? 1 : 0) |
      (p.grounded ? 2 : 0) |
      (p.crouched ? 4 : 0) |
      (p.sprinting ? 8 : 0) |
      (p.scoped ? 16 : 0) |
      (p.bot ? 32 : 0) |
      (p.reloadUntil > 0 ? 64 : 0);
    d.push(
      r(p.x * 100),
      r(p.y * 100),
      r(p.z * 100),
      r(p.vx * 10),
      r(p.vy * 10),
      r(p.vz * 10),
      r(wrap(p.yaw) * 1000),
      r(p.pitch * 1000),
      flags,
      r(p.hp * 10),
      WEAPON_ORDER.indexOf(p.weapon),
      p.stats.kills,
      p.stats.deaths,
      p.stats.assists,
      p.stats.score,
      p.alive ? 0 : tk(p.respawnAt),
      tk(p.protectedUntil),
      r(p.stride * 10),
      p.killerId,
      tk(p.diedAt),
    );
  }
  for (const z of st.zones) d.push(r(z.progress * 1000), z.owner, z.contested ? 1 : 0, z.present);
  for (const i of hs) {
    const p = st.players[i];
    d.push(
      i,
      acks.get(i) ?? 0,
      ...WEAPON_ORDER.map(w => p.mags[w]),
      tk(p.reloadUntil),
      tk(p.nextFireAt),
      tk(p.swapUntil),
      r(p.bloom * 1000),
      p.grenades,
      tk(p.grenadeRegenAt),
      tk(p.nextGrenadeAt),
      (p.prevFire ? 1 : 0) | (p.prevJump ? 2 : 0) | (p.prevGrenade ? 4 : 0),
      tk(p.lastDamageAt),
      p.stats.headshots,
      p.stats.streak,
      p.stats.bestStreak,
      p.stats.shots,
      p.stats.hits,
      r(p.stats.damage),
      p.stats.captures,
      p.multi,
      tk(p.lastKillAt),
    );
  }
  return d;
}

export function decodeSnapshot(d: unknown): DecodedSnap | null {
  if (!Array.isArray(d) || d.length < H) return null;
  if (!d.every(v => typeof v === 'number' && Number.isFinite(v))) return null;
  const n = d as number[];
  const np = n[12];
  const nz = n[13];
  const nh = n[14];
  if (np < 0 || np > 32 || nz < 0 || nz > 16 || nh < 0 || nh > np) return null;
  if (n.length !== H + np * PF + nz * ZF + nh * EF) return null;
  const tick = n[0];
  const snap: DecodedSnap = {
    tick,
    time: tick * DT,
    match: {
      phase: PHASES[n[1]] ?? 'live',
      phaseUntil: ut(n[2]),
      scores: [n[3], n[4]],
      liveAt: ut(n[5]),
      round: n[6],
      winner: n[7] === NONE ? null : n[7],
      roundWinner: n[8] === NONE ? null : (n[8] as Team),
      turfTick: n[9] / 1000,
    },
    rngState: n[10] >>> 0,
    nextId: n[11],
    players: [],
    zones: [],
    humans: new Map(),
  };
  let o = H;
  for (let i = 0; i < np; i++, o += PF) {
    const f = n[o + 8];
    snap.players.push({
      x: n[o] / 100,
      y: n[o + 1] / 100,
      z: n[o + 2] / 100,
      vx: n[o + 3] / 10,
      vy: n[o + 4] / 10,
      vz: n[o + 5] / 10,
      yaw: n[o + 6] / 1000,
      pitch: n[o + 7] / 1000,
      alive: (f & 1) !== 0,
      grounded: (f & 2) !== 0,
      crouched: (f & 4) !== 0,
      sprinting: (f & 8) !== 0,
      scoped: (f & 16) !== 0,
      bot: (f & 32) !== 0,
      reloading: (f & 64) !== 0,
      hp: n[o + 9] / 10,
      weapon: WEAPON_ORDER[n[o + 10]] ?? 'hopper',
      kills: n[o + 11],
      deaths: n[o + 12],
      assists: n[o + 13],
      score: n[o + 14],
      respawnAt: (f & 1) !== 0 ? 0 : ut(n[o + 15]),
      protectedUntil: ut(n[o + 16]),
      stride: n[o + 17] / 10,
      killerId: n[o + 18],
      diedAt: ut(n[o + 19]),
    });
  }
  for (let i = 0; i < nz; i++, o += ZF)
    snap.zones.push({
      progress: n[o] / 1000,
      owner: n[o + 1] as Team,
      contested: n[o + 2] === 1,
      present: n[o + 3],
    });
  for (let i = 0; i < nh; i++, o += EF) {
    const mags = {} as Record<WeaponId, number>;
    WEAPON_ORDER.forEach((w, k) => (mags[w] = n[o + 2 + k]));
    const pf = n[o + 14];
    const slot = n[o];
    if (slot < 0 || slot >= np) continue;
    snap.humans.set(slot, {
      slot,
      ack: n[o + 1],
      mags,
      reloadUntil: Math.max(0, ut(n[o + 7])),
      nextFireAt: ut(n[o + 8]),
      swapUntil: ut(n[o + 9]),
      bloom: n[o + 10] / 1000,
      grenades: n[o + 11],
      grenadeRegenAt: ut(n[o + 12]),
      nextGrenadeAt: ut(n[o + 13]),
      prevFire: (pf & 1) !== 0,
      prevJump: (pf & 2) !== 0,
      prevGrenade: (pf & 4) !== 0,
      lastDamageAt: ut(n[o + 15]),
      headshots: n[o + 16],
      streak: n[o + 17],
      bestStreak: n[o + 18],
      shots: n[o + 19],
      hits: n[o + 20],
      damage: n[o + 21],
      captures: n[o + 22],
      multi: n[o + 23],
      lastKillAt: ut(n[o + 24]),
    });
  }
  return snap;
}

/** Dynamic per-player fields from a snapshot onto a full PlayerState. */
export function applyPlayerSnap(p: PlayerState, s: PlayerSnap) {
  p.x = s.x;
  p.y = s.y;
  p.z = s.z;
  p.vx = s.vx;
  p.vy = s.vy;
  p.vz = s.vz;
  p.yaw = s.yaw;
  p.pitch = s.pitch;
  p.alive = s.alive;
  p.grounded = s.grounded;
  p.crouched = s.crouched;
  p.sprinting = s.sprinting;
  p.scoped = s.scoped;
  p.bot = s.bot;
  p.hp = s.hp;
  p.weapon = s.weapon;
  p.stats.kills = s.kills;
  p.stats.deaths = s.deaths;
  p.stats.assists = s.assists;
  p.stats.score = s.score;
  p.respawnAt = s.respawnAt;
  p.protectedUntil = s.protectedUntil;
  p.stride = s.stride;
  p.killerId = s.killerId;
  p.diedAt = s.diedAt;
  if (!s.reloading) p.reloadUntil = 0;
}

export function applyHumanSnap(p: PlayerState, h: HumanSnap) {
  for (const w of WEAPON_ORDER) p.mags[w] = h.mags[w];
  p.reloadUntil = h.reloadUntil;
  p.nextFireAt = h.nextFireAt;
  p.swapUntil = h.swapUntil;
  p.bloom = h.bloom;
  p.grenades = h.grenades;
  p.grenadeRegenAt = h.grenadeRegenAt;
  p.nextGrenadeAt = h.nextGrenadeAt;
  p.prevFire = h.prevFire;
  p.prevJump = h.prevJump;
  p.prevGrenade = h.prevGrenade;
  p.lastDamageAt = h.lastDamageAt;
  p.stats.headshots = h.headshots;
  p.stats.streak = h.streak;
  p.stats.bestStreak = h.bestStreak;
  p.stats.shots = h.shots;
  p.stats.hits = h.hits;
  p.stats.damage = h.damage;
  p.stats.captures = h.captures;
  p.multi = h.multi;
  p.lastKillAt = h.lastKillAt;
}

/** Write a whole snapshot into a full SimState (the client's authoritative copy). */
export function applySnapshot(st: SimState, s: DecodedSnap) {
  st.tick = s.tick;
  st.time = s.time;
  st.rngState = s.rngState;
  st.nextId = s.nextId;
  Object.assign(st.match, s.match, { scores: [s.match.scores[0], s.match.scores[1]] });
  for (let i = 0; i < s.players.length && i < st.players.length; i++) {
    applyPlayerSnap(st.players[i], s.players[i]);
    const h = s.humans.get(i);
    if (h !== undefined) applyHumanSnap(st.players[i], h);
  }
  for (let i = 0; i < s.zones.length && i < st.zones.length; i++)
    Object.assign(st.zones[i], s.zones[i]);
}

// ── Events ────────────────────────────────────────────────────────────

const EV = [
  'fire',
  'splat',
  'hit',
  'kill',
  'callout',
  'spawn',
  'bounce',
  'explode',
  'zone',
  'round',
  'phase',
  'match',
] as const;
type NetEvType = (typeof EV)[number];
/** Only the owner's client cares about these; it predicts them itself. */
const LOCAL_ONLY = new Set(['reload', 'swap', 'jump', 'land', 'throw']);

export function packEvents(evs: readonly SimEvent[]): unknown[][] {
  const out: unknown[][] = [];
  const c = (v: number) => r(v * 100);
  for (const e of evs) {
    if (LOCAL_ONLY.has(e.type)) continue;
    const t = EV.indexOf(e.type as NetEvType);
    if (t < 0) continue;
    switch (e.type) {
      case 'fire':
        out.push([
          t,
          e.pid,
          WEAPON_ORDER.indexOf(e.weapon),
          c(e.x),
          c(e.y),
          c(e.z),
          r(e.dx * 1000),
          r(e.dy * 1000),
          r(e.dz * 1000),
        ]);
        break;
      case 'splat': {
        const l = Math.hypot(e.nx, e.ny, e.nz) || 1;
        out.push([
          t,
          c(e.x),
          c(e.y),
          c(e.z),
          r((e.nx / l) * 100),
          r((e.ny / l) * 100),
          r((e.nz / l) * 100),
          e.color,
          c(e.size),
          e.on,
        ]);
        break;
      }
      case 'hit':
        out.push([
          t,
          e.attacker,
          e.victim,
          r(e.dmg * 10),
          e.head ? 1 : 0,
          srcIdx(e.source),
          c(e.x),
          c(e.y),
          c(e.z),
          c(e.fromX),
          c(e.fromZ),
        ]);
        break;
      case 'kill':
        out.push([t, e.attacker, e.victim, srcIdx(e.source), e.head ? 1 : 0, e.assist]);
        break;
      case 'callout':
        out.push([t, e.pid, e.tier, e.text.slice(0, 32)]);
        break;
      case 'spawn':
        out.push([t, e.pid]);
        break;
      case 'bounce':
        out.push([t, c(e.x), c(e.y), c(e.z)]);
        break;
      case 'explode':
        out.push([
          t,
          c(e.x),
          c(e.y),
          c(e.z),
          r(e.nx * 100),
          r(e.ny * 100),
          r(e.nz * 100),
          e.color,
          c(e.radius),
          e.owner,
        ]);
        break;
      case 'zone':
        out.push([t, e.zone, e.owner, e.prev]);
        break;
      case 'round':
        out.push([t, e.winner, e.round]);
        break;
      case 'phase':
        out.push([t, PHASES.indexOf(e.phase)]);
        break;
      case 'match':
        out.push([t, e.winner]);
        break;
      default:
        break;
    }
  }
  return out;
}

/** Inverse of packEvents; anything malformed is dropped. */
export function unpackEvents(packed: unknown, nPlayers: number): SimEvent[] {
  if (!Array.isArray(packed)) return [];
  const out: SimEvent[] = [];
  const pid = (v: unknown) => {
    const i = num(v, -2);
    return Number.isInteger(i) && i >= -1 && i < nPlayers ? i : null;
  };
  const u = (v: unknown) => num(v) / 100;
  for (const a of packed.slice(0, 600)) {
    if (!Array.isArray(a)) continue;
    const type = EV[num(a[0], -1)];
    switch (type) {
      case 'fire': {
        const p = pid(a[1]);
        if (p === null || p < 0) break;
        out.push({
          type,
          pid: p,
          weapon: WEAPON_ORDER[num(a[2])] ?? 'hopper',
          x: u(a[3]),
          y: u(a[4]),
          z: u(a[5]),
          dx: num(a[6]) / 1000,
          dy: num(a[7]) / 1000,
          dz: num(a[8]) / 1000,
        });
        break;
      }
      case 'splat': {
        const on = pid(a[9]);
        out.push({
          type,
          x: u(a[1]),
          y: u(a[2]),
          z: u(a[3]),
          nx: u(a[4]),
          ny: u(a[5]),
          nz: u(a[6]),
          color: num(a[7]) & 0xffffff,
          size: Math.min(5, u(a[8])),
          on: on ?? -1,
        });
        break;
      }
      case 'hit': {
        const at = pid(a[1]);
        const v = pid(a[2]);
        if (at === null || v === null || v < 0) break;
        out.push({
          type,
          attacker: at,
          victim: v,
          dmg: num(a[3]) / 10,
          head: a[4] === 1,
          source: srcAt(num(a[5])),
          x: u(a[6]),
          y: u(a[7]),
          z: u(a[8]),
          fromX: u(a[9]),
          fromZ: u(a[10]),
        });
        break;
      }
      case 'kill': {
        const at = pid(a[1]);
        const v = pid(a[2]);
        if (at === null || v === null || at < 0 || v < 0) break;
        out.push({
          type,
          attacker: at,
          victim: v,
          source: srcAt(num(a[3])),
          head: a[4] === 1,
          assist: pid(a[5]) ?? -1,
        });
        break;
      }
      case 'callout': {
        const p = pid(a[1]);
        if (p === null || p < 0 || typeof a[3] !== 'string') break;
        out.push({ type, pid: p, tier: num(a[2]), text: a[3].slice(0, 32) });
        break;
      }
      case 'spawn': {
        const p = pid(a[1]);
        if (p === null || p < 0) break;
        out.push({ type, pid: p });
        break;
      }
      case 'bounce':
        out.push({ type, x: u(a[1]), y: u(a[2]), z: u(a[3]) });
        break;
      case 'explode':
        out.push({
          type,
          x: u(a[1]),
          y: u(a[2]),
          z: u(a[3]),
          nx: u(a[4]),
          ny: u(a[5]),
          nz: u(a[6]),
          color: num(a[7]) & 0xffffff,
          radius: Math.min(12, u(a[8])),
          owner: pid(a[9]) ?? -1,
        });
        break;
      case 'zone':
        if (typeof a[1] !== 'string') break;
        out.push({
          type,
          zone: a[1].slice(0, 4),
          owner: num(a[2], -1) as Team,
          prev: num(a[3], -1) as Team,
        });
        break;
      case 'round':
        out.push({ type, winner: num(a[1], -1) as Team | -1, round: num(a[2], 1) });
        break;
      case 'phase':
        out.push({ type, phase: PHASES[num(a[1])] ?? 'live' });
        break;
      case 'match':
        out.push({ type, winner: num(a[1], -1) });
        break;
      default:
        break;
    }
  }
  return out;
}

// ── Projectile births ─────────────────────────────────────────────────

export function packBirths(prs: readonly Projectile[]): number[] {
  const out: number[] = [];
  for (const p of prs)
    out.push(
      p.id,
      p.owner,
      srcIdx(p.source),
      r(p.x * 100),
      r(p.y * 100),
      r(p.z * 100),
      r(p.vx * 100),
      r(p.vy * 100),
      r(p.vz * 100),
      p.kind === 'grenade' ? r((p.fuseAt - p.born) * 1000) : 0,
    );
  return out;
}

/** Rebuild projectiles (colour from the owner); `born` = the receiver's sim time. */
export function unpackBirths(
  b: unknown,
  players: readonly PlayerState[],
  born: number,
): Projectile[] {
  if (!Array.isArray(b) || b.length % BF !== 0 || b.length > BF * 400) return [];
  const out: Projectile[] = [];
  for (let o = 0; o < b.length; o += BF) {
    const v = b.slice(o, o + BF).map(x => num(x));
    const owner = players[v[1]];
    if (owner === undefined) continue;
    const source = srcAt(v[2]);
    const grenade = source === 'grenade';
    const w = grenade || source === 'fall' ? null : WEAPONS[source as WeaponId];
    out.push({
      id: v[0],
      owner: owner.id,
      source,
      kind: grenade ? 'grenade' : (w?.kind ?? 'ball'),
      color: owner.color,
      x: v[3] / 100,
      y: v[4] / 100,
      z: v[5] / 100,
      vx: v[6] / 100,
      vy: v[7] / 100,
      vz: v[8] / 100,
      gravity: grenade ? GRENADE.gravity : (w?.gravity ?? 0),
      radius: grenade ? GRENADE.radius : (w?.radius ?? 0.05),
      born,
      fuseAt: grenade ? born + v[9] / 1000 : 0,
      dmg: w?.dmg ?? 0,
      headMult: w?.headMult ?? 1,
      bounces: 0,
    });
  }
  return out;
}

// ── Inputs ────────────────────────────────────────────────────────────

export function packInput(i: PlayerInput, out: number[]) {
  out.push(
    r(i.moveX * 100),
    r(i.moveY * 100),
    r(i.yaw * 1000),
    r(i.pitch * 1000),
    (i.fire ? 1 : 0) |
      (i.jump ? 2 : 0) |
      (i.crouch ? 4 : 0) |
      (i.sprint ? 8 : 0) |
      (i.reload ? 16 : 0) |
      (i.scope ? 32 : 0) |
      (i.grenade ? 64 : 0),
    i.weapon === null ? -1 : WEAPON_ORDER.indexOf(i.weapon),
  );
}

/** Untrusted → a sane PlayerInput. */
export function unpackInputs(a: unknown): PlayerInput[] {
  if (!Array.isArray(a) || a.length % INPUT_FIELDS !== 0 || a.length > INPUT_FIELDS * 8) return [];
  const out: PlayerInput[] = [];
  const cl = (v: number) => Math.max(-1, Math.min(1, v));
  for (let o = 0; o < a.length; o += INPUT_FIELDS) {
    const v = a.slice(o, o + INPUT_FIELDS).map(x => num(x));
    const b = v[4] | 0;
    const yaw = v[2] / 1000;
    out.push({
      moveX: cl(v[0] / 100),
      moveY: cl(v[1] / 100),
      yaw: Math.abs(yaw) < 1e5 ? yaw : 0,
      pitch: Math.max(-1.45, Math.min(1.45, v[3] / 1000)),
      fire: (b & 1) !== 0,
      jump: (b & 2) !== 0,
      crouch: (b & 4) !== 0,
      sprint: (b & 8) !== 0,
      reload: (b & 16) !== 0,
      scope: (b & 32) !== 0,
      grenade: (b & 64) !== 0,
      weapon: WEAPON_ORDER[v[5]] ?? null,
    });
  }
  return out;
}
