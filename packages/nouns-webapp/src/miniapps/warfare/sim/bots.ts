// ── Bot brains ──────────────────────────────────────────────────────────
//
// Each bot produces a PlayerInput per tick, exactly like a human, so the
// sim treats both the same. They:
//   • perceive with a view cone + line of sight (and hear recent gunfire),
//   • react after a human-ish delay, then track with a turn-rate limit, an
//     aim error that settles while they hold on target, jitter, and lead
//     on moving targets (plus drop compensation),
//   • roam the nav grid toward mode goals (Turf zones, last known enemy
//     positions, the mid), strafe in fights, back off / close to their
//     weapon's range, break to cover when hurt or reloading, then peek,
//   • lob grenades at enemies who just ducked behind cover,
//   • run a stuck watchdog: hop → re-route → (last resort) snap back onto
//     the nav grid, so no bot ever stays wedged.
// All randomness comes from the sim RNG, so bot behaviour is deterministic.

import type { WarfareSim } from './sim';

import { chestY, eyeHeight, headY, viewDir } from './physics';
import { DT, emptyInput, type Difficulty, type PlayerInput, type PlayerState } from './types';
import { GRENADE, WEAPONS, type WeaponId } from './weapons';

interface Skill {
  reaction: number;
  turn: number;
  errInit: number;
  errDecay: number;
  jitter: number;
  lead: number;
  fireTol: number;
  grenade: number;
  strafe: number;
  headChance: number;
  fov: number;
}

const SKILL: Record<Difficulty, Skill> = {
  0: {
    reaction: 0.7,
    turn: 3.2,
    errInit: 0.24,
    errDecay: 1.1,
    jitter: 0.035,
    lead: 0.25,
    fireTol: 0.13,
    grenade: 0.12,
    strafe: 0.45,
    headChance: 0,
    fov: 0.4,
  },
  1: {
    reaction: 0.4,
    turn: 5.5,
    errInit: 0.15,
    errDecay: 2.1,
    jitter: 0.02,
    lead: 0.7,
    fireTol: 0.085,
    grenade: 0.28,
    strafe: 0.8,
    headChance: 0.15,
    fov: 0.25,
  },
  2: {
    reaction: 0.23,
    turn: 9,
    errInit: 0.1,
    errDecay: 3.4,
    jitter: 0.011,
    lead: 0.95,
    fireTol: 0.055,
    grenade: 0.42,
    strafe: 1,
    headChance: 0.35,
    fov: 0.1,
  },
};

type BotState = 'roam' | 'fight' | 'cover' | 'peek';

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function yawTo(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/**
 * Launch pitch that lands a projectile (speed v, gravity g) on a target
 * dx metres away horizontally and dy up. Low arc; null when out of reach.
 */
export function ballisticPitch(v: number, g: number, dx: number, dy: number): number | null {
  if (g <= 0) return Math.atan2(dy, dx);
  const v2 = v * v;
  const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
  if (disc < 0) return null;
  return Math.atan2(v2 - Math.sqrt(disc), g * dx);
}

/** Grenade pitch by search (the throw adds an upward kick). */
function grenadePitch(dx: number, dy: number): number | null {
  let best: number | null = null;
  let bestErr = 1.5;
  for (let p = -0.3; p <= 1.1; p += 0.03) {
    const vh = GRENADE.speed * Math.cos(p);
    const vy = GRENADE.speed * Math.sin(p) + 3.2;
    const t = dx / Math.max(0.1, vh);
    if (t > GRENADE.fuse + 0.4) continue;
    const y = vy * t - 0.5 * GRENADE.gravity * t * t;
    const err = Math.abs(y - dy);
    if (err < bestErr) {
      bestErr = err;
      best = p;
    }
  }
  return best;
}

export interface BotMem {
  onSpawn(sim: WarfareSim, p: PlayerState): void;
  onHurt(sim: WarfareSim, p: PlayerState, attacker: PlayerState): void;
  onDeath(): void;
  /** Debug / test counters. */
  readonly debug: { unsticks: number; repaths: number; maxStuck: number };
  state: BotState;
  target: number;
}

export function createBotMem(sim: WarfareSim, p: PlayerState): BotBrain {
  return new BotBrain(sim, p);
}

export function thinkBot(sim: WarfareSim, p: PlayerState, mem: BotMem): PlayerInput {
  return (mem as BotBrain).think(sim, p);
}

export class BotBrain implements BotMem {
  readonly skill: Skill;
  readonly fav: WeaponId;
  readonly role: 'attack' | 'defend';
  state: BotState = 'roam';
  target = -1;
  readonly debug = { unsticks: 0, repaths: 0, maxStuck: 0 };

  private path: number[] = [];
  private pathIdx = 0;
  /** Current destination node (debug). */
  goalNode = -1;
  private repathAt = 0;
  private thinkAt = 0;
  private reactAt = 0;
  private lastSeenAt = -100;
  private lastKnown = { x: 0, y: 0, z: 0 };
  private hasKnown = false;
  private aimYaw = 0;
  private aimPitch = 0;
  private errYaw = 0;
  private errPitch = 0;
  private aimHead = false;
  private strafe = 1;
  private strafeUntil = 0;
  private stateUntil = 0;
  private hurtBy = -1;
  private hurtAt = -100;
  private nadeAt = 0;
  private jumpUntil = 0;
  private crouch = false;
  private wantScope = false;
  private semi = false;
  private throwNow = false;
  private stuckCheckAt = 0;
  private stuckX = 0;
  private stuckZ = 0;
  private stuckTime = 0;
  private wantsMove = false;
  private visible: number[] = [];

  constructor(sim: WarfareSim, p: PlayerState) {
    this.skill = SKILL[sim.cfg.difficulty];
    this.fav = p.weapons[p.weapons.length - 1];
    const mates = sim.state.players.filter(o => o.bot && o.team === p.team && o.team !== -1);
    this.role = mates.length % 3 === 0 ? 'defend' : 'attack';
    this.thinkAt = (p.id % 7) * 0.017;
  }

  onSpawn(sim: WarfareSim, p: PlayerState) {
    this.state = 'roam';
    this.target = -1;
    this.path = [];
    this.pathIdx = 0;
    this.goalNode = -1;
    this.repathAt = 0;
    this.aimYaw = p.yaw;
    this.aimPitch = 0;
    this.hasKnown = false;
    this.stuckTime = 0;
    this.stuckX = p.x;
    this.stuckZ = p.z;
    this.stuckCheckAt = sim.time + 0.5;
    this.crouch = false;
    this.wantScope = false;
  }

  onHurt(sim: WarfareSim, _p: PlayerState, attacker: PlayerState) {
    this.hurtBy = attacker.id;
    this.hurtAt = sim.time;
    if (!this.hasKnown || this.target < 0) {
      this.lastKnown = { x: attacker.x, y: attacker.y, z: attacker.z };
      this.hasKnown = true;
      this.lastSeenAt = sim.time - 0.5;
    }
  }

  onDeath() {
    this.target = -1;
    this.state = 'roam';
    this.path = [];
  }

  // ── Main ──────────────────────────────────────────────────────────────

  think(sim: WarfareSim, p: PlayerState): PlayerInput {
    const inp = emptyInput(this.aimYaw, this.aimPitch);
    if (!p.alive) return inp;
    const t = sim.time;
    const phase = sim.state.match.phase;
    if (phase === 'matchEnd') return inp;

    if (t >= this.thinkAt) {
      this.thinkAt = t + 0.12;
      this.perceive(sim, p);
      this.decide(sim, p);
    }

    const tgt = this.target >= 0 ? sim.state.players[this.target] : undefined;
    const seen = tgt !== undefined && tgt.alive && this.visible.includes(tgt.id);

    // ── Aim
    let wantYaw = this.aimYaw;
    let wantPitch = 0;
    let aimErrToTarget = Infinity;
    let dist = 0;
    const ey = p.y + eyeHeight(p);
    if (seen) {
      const w = WEAPONS[p.weapon];
      const ty = this.aimHead ? headY(tgt) : chestY(tgt);
      let ax = tgt.x;
      let ay = ty;
      let az = tgt.z;
      dist = Math.hypot(ax - p.x, ay - ey, az - p.z);
      const flight = dist / w.speed;
      ax += tgt.vx * flight * this.skill.lead;
      az += tgt.vz * flight * this.skill.lead;
      ay += (tgt.grounded ? 0 : tgt.vy * flight * 0.5) * this.skill.lead;
      const hx = Math.hypot(ax - p.x, az - p.z);
      wantYaw = yawTo(ax - p.x, az - p.z);
      const bp = ballisticPitch(w.speed, w.gravity, hx, ay - ey);
      wantPitch = bp ?? Math.atan2(ay - ey, hx);
      // Error settles while tracking
      const k = Math.exp(-this.skill.errDecay * DT);
      this.errYaw *= k;
      this.errPitch *= k;
      const j = this.skill.jitter;
      aimErrToTarget = Math.hypot(wrapAngle(this.aimYaw - wantYaw), this.aimPitch - wantPitch);
      wantYaw += this.errYaw + sim.rng.signed() * j;
      wantPitch += this.errPitch + sim.rng.signed() * j * 0.6;
    } else if (this.throwNow) {
      wantYaw = this.aimYaw;
      wantPitch = this.aimPitch;
    } else if (this.hasKnown && t - this.lastSeenAt < 3) {
      wantYaw = yawTo(this.lastKnown.x - p.x, this.lastKnown.z - p.z);
      wantPitch = Math.atan2(
        this.lastKnown.y + 1.2 - ey,
        Math.hypot(this.lastKnown.x - p.x, this.lastKnown.z - p.z) + 0.01,
      );
    } else {
      const n = this.nextNode(sim);
      if (n !== null) {
        const dx = n.x - p.x;
        const dz = n.z - p.z;
        if (dx * dx + dz * dz > 0.04) wantYaw = yawTo(dx, dz);
        wantPitch = Math.max(-0.3, Math.min(0.3, Math.atan2(n.y - p.y, Math.hypot(dx, dz) + 2)));
      }
    }
    const turn = this.skill.turn * (seen ? 1 : 0.6) * DT;
    const dy = wrapAngle(wantYaw - this.aimYaw);
    this.aimYaw = wrapAngle(
      this.aimYaw + Math.max(-turn, Math.min(turn, dy * 0.35 + Math.sign(dy) * turn * 0.25)),
    );
    if (Math.abs(dy) < turn * 0.3) this.aimYaw = wrapAngle(wantYaw);
    const dp = wantPitch - this.aimPitch;
    this.aimPitch += Math.max(-turn, Math.min(turn, dp * 0.4));
    inp.yaw = this.aimYaw;
    inp.pitch = Math.max(-1.3, Math.min(1.3, this.aimPitch));

    // ── Fire
    if (seen && phase === 'live' && t >= this.reactAt) {
      const w = WEAPONS[p.weapon];
      const tol = this.skill.fireTol + Math.atan2(0.45, Math.max(1, dist));
      const inRange = (w.id !== 'shotgun' || dist < 20) && (w.id !== 'launcher' || dist > 3.5);
      if (aimErrToTarget < tol && inRange) {
        if (w.auto) inp.fire = true;
        else {
          this.semi = !this.semi;
          inp.fire = this.semi;
        }
      }
    }
    if (this.throwNow) {
      inp.grenade = true;
      this.throwNow = false;
    }

    // ── Weapon choice
    inp.weapon = this.pickWeapon(p, seen ? dist : -1);
    inp.scope = this.wantScope && seen && p.weapon === 'longsplat' && dist > 9;
    if (p.mags[p.weapon] < WEAPONS[p.weapon].mag * 0.35 && !seen) inp.reload = true;

    // ── Move
    let wx = 0;
    let wz = 0;
    this.wantsMove = false;
    if (phase !== 'countdown') {
      if (this.state === 'fight' && seen) {
        const w = WEAPONS[p.weapon];
        const fx = (tgt.x - p.x) / Math.max(0.1, Math.hypot(tgt.x - p.x, tgt.z - p.z));
        const fz = (tgt.z - p.z) / Math.max(0.1, Math.hypot(tgt.x - p.x, tgt.z - p.z));
        // perpendicular (right of the line to target)
        const sx = -fz;
        const sz = fx;
        if (t >= this.strafeUntil) {
          this.strafe = sim.rng.chance(0.5) ? 1 : -1;
          this.strafeUntil = t + sim.rng.range(0.35, 1.2);
        }
        const st = this.strafe * this.skill.strafe;
        wx = sx * st;
        wz = sz * st;
        const hdist = Math.hypot(tgt.x - p.x, tgt.z - p.z);
        if (hdist > w.botRange + 5) {
          // Close in along the nav path when far
          const n = this.nextNode(sim);
          if (n !== null) {
            const l = Math.hypot(n.x - p.x, n.z - p.z) || 1;
            wx = wx * 0.4 + (n.x - p.x) / l;
            wz = wz * 0.4 + (n.z - p.z) / l;
          } else {
            wx += fx;
            wz += fz;
          }
        } else if (hdist < w.botRange - 4 && w.id !== 'shotgun') {
          wx -= fx * 0.8;
          wz -= fz * 0.8;
        } else if (w.id === 'shotgun' && hdist > 5) {
          wx += fx * 0.8;
          wz += fz * 0.8;
        }
        // Don't strafe into walls or off ledges
        if (!this.safeDir(sim, p, wx, wz)) {
          this.strafe = -this.strafe;
          wx = -wx;
          wz = -wz;
          if (!this.safeDir(sim, p, wx, wz)) {
            wx = 0;
            wz = 0;
          }
        }
        if (this.skill.strafe >= 1 && sim.rng.chance(0.004) && p.grounded) this.jumpUntil = t + 0.1;
      } else {
        const n = this.nextNode(sim);
        if (n !== null) {
          const dx = n.x - p.x;
          const dz = n.z - p.z;
          const l = Math.hypot(dx, dz);
          if (l > 0.05) {
            wx = dx / l;
            wz = dz / l;
            this.wantsMove = true;
          }
        }
      }
    }
    // World → view-relative
    const s = Math.sin(inp.yaw);
    const c = Math.cos(inp.yaw);
    // forward (−s, −c), right (c, −s)
    inp.moveY = Math.max(-1, Math.min(1, -wx * s - wz * c));
    inp.moveX = Math.max(-1, Math.min(1, wx * c - wz * s));
    inp.sprint = !seen && this.wantsMove && this.state !== 'cover' && p.hp > 50 && inp.moveY > 0.7;
    inp.crouch = this.crouch && (this.state === 'cover' || (seen && p.weapon === 'longsplat'));
    inp.jump = t < this.jumpUntil;
    this.watchdog(sim, p);
    if (t < this.jumpUntil) inp.jump = true;
    return inp;
  }

  // ── Perception ────────────────────────────────────────────────────────

  private perceive(sim: WarfareSim, p: PlayerState) {
    const t = sim.time;
    const ex = p.x;
    const ey = p.y + eyeHeight(p);
    const ez = p.z;
    const [fx, , fz] = viewDir(this.aimYaw, 0);
    this.visible = [];
    let best = -1;
    let bestScore = Infinity;
    for (const o of sim.state.players) {
      if (!o.alive || o.id === p.id) continue;
      if (!(o.team === -1 || p.team === -1 || o.team !== p.team)) continue;
      const dx = o.x - ex;
      const dz = o.z - ez;
      const d = Math.hypot(dx, dz);
      if (d > 75) continue;
      const cosA = (dx * fx + dz * fz) / (d || 1);
      const noticed =
        d < 6 ||
        cosA > this.skill.fov ||
        (o.id === this.hurtBy && t - this.hurtAt < 1.5) ||
        o.id === this.target;
      if (!noticed) continue;
      if (
        !sim.world.clear(ex, ey, ez, o.x, headY(o), o.z) &&
        !sim.world.clear(ex, ey, ez, o.x, chestY(o), o.z)
      )
        continue;
      this.visible.push(o.id);
      const score = d * (o.id === this.target ? 0.6 : 1) * (1.6 - cosA);
      if (score < bestScore) {
        bestScore = score;
        best = o.id;
      }
    }
    if (best >= 0) {
      const o = sim.state.players[best];
      if (best !== this.target || t - this.lastSeenAt > 1.2) {
        // New target (or re-acquired): reaction delay + fresh aim error
        const r = this.skill.reaction * sim.rng.range(0.75, 1.3);
        this.reactAt = t + (o.id === this.hurtBy && t - this.hurtAt < 1 ? r * 0.7 : r);
        const e = this.skill.errInit;
        this.errYaw = sim.rng.signed() * e;
        this.errPitch = sim.rng.signed() * e * 0.5;
        this.aimHead = sim.rng.chance(this.skill.headChance);
      }
      this.target = best;
      this.lastSeenAt = t;
      this.lastKnown = { x: o.x, y: o.y, z: o.z };
      this.hasKnown = true;
    } else if (this.target >= 0) {
      const o = sim.state.players[this.target];
      if (!o.alive) {
        this.target = -1;
        this.hasKnown = false;
      } else if (t - this.lastSeenAt > 4) this.target = -1;
    }
    // Hear gunfire
    if (this.target < 0 && (!this.hasKnown || t - this.lastSeenAt > 4)) {
      for (const n of sim.noise) {
        if (n.pid === p.id) continue;
        const o = sim.state.players[n.pid];
        if (o.team !== -1 && o.team === p.team) continue;
        if (Math.hypot(n.x - p.x, n.z - p.z) < 38) {
          this.lastKnown = { x: n.x, y: n.y, z: n.z };
          this.hasKnown = true;
          this.lastSeenAt = n.t - 2;
          break;
        }
      }
    }
  }

  // ── Decisions (state machine + goals) ────────────────────────────────

  private decide(sim: WarfareSim, p: PlayerState) {
    const t = sim.time;
    const seen = this.target >= 0 && this.visible.includes(this.target);
    const tgt = this.target >= 0 ? sim.state.players[this.target] : undefined;
    const reloading = p.reloadUntil > 0;

    switch (this.state) {
      case 'roam':
      case 'peek':
        if (seen) this.state = 'fight';
        else if (this.state === 'peek' && t > this.stateUntil) this.state = 'roam';
        break;
      case 'fight':
        if (!seen && t - this.lastSeenAt > 0.8) {
          this.state = 'roam';
          this.repathAt = 0;
        } else if (
          tgt !== undefined &&
          (p.hp < 40 || (reloading && Math.hypot(tgt.x - p.x, tgt.z - p.z) > 7)) &&
          sim.rng.chance(0.35)
        ) {
          if (this.seekCover(sim, p, tgt)) {
            this.state = 'cover';
            this.stateUntil = t + sim.rng.range(1.6, 3.2);
          }
        }
        break;
      case 'cover':
        if (this.pathIdx >= this.path.length) this.crouch = sim.rng.chance(0.7) || this.crouch;
        if (t > this.stateUntil && !reloading && p.hp > 60) {
          this.state = 'peek';
          this.crouch = false;
          this.stateUntil = t + sim.rng.range(1.2, 2.4);
          if (this.hasKnown)
            this.goTo(sim, p, this.lastKnown.x, this.lastKnown.y, this.lastKnown.z);
        } else if (seen && tgt !== undefined && Math.hypot(tgt.x - p.x, tgt.z - p.z) < 6) {
          this.state = 'fight';
          this.crouch = false;
        }
        break;
    }
    if (this.state !== 'cover') this.crouch = false;

    // Sniper bots crouch + scope at range
    this.wantScope = p.weapons.includes('longsplat');
    if (seen && p.weapon === 'longsplat' && sim.cfg.difficulty > 0)
      this.crouch = sim.rng.chance(0.5);

    // Grenades: flush out someone who just ducked out of sight
    if (
      p.grenades > 0 &&
      t >= this.nadeAt &&
      sim.state.match.phase === 'live' &&
      this.hasKnown &&
      !seen &&
      t - this.lastSeenAt < 2.5
    ) {
      const dx = this.lastKnown.x - p.x;
      const dz = this.lastKnown.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 7 && d < 24 && sim.rng.chance(this.skill.grenade)) {
        const pitch = grenadePitch(d, this.lastKnown.y - (p.y + eyeHeight(p) - 0.15));
        if (pitch !== null) {
          this.aimYaw = yawTo(dx, dz);
          this.aimPitch = pitch;
          this.throwNow = true;
        }
      }
      this.nadeAt = t + sim.rng.range(6, 14);
    }

    // Goals (roam / peek)
    if (this.state === 'roam' && (t >= this.repathAt || this.pathIdx >= this.path.length)) {
      this.pickGoal(sim, p);
    } else if (this.state === 'fight' && t >= this.repathAt && tgt !== undefined) {
      // Keep a route toward the target for closing in
      this.goTo(sim, p, tgt.x, tgt.y, tgt.z);
      this.repathAt = t + 1.2;
    }
  }

  private pickWeapon(p: PlayerState, dist: number): WeaponId | null {
    const fav = this.fav;
    const has = (w: WeaponId) => p.weapons.includes(w);
    const empty = p.mags[p.weapon] === 0 && p.reloadUntil > 0;
    if (
      dist >= 0 &&
      empty &&
      dist < 15 &&
      has('splatter') &&
      p.weapon !== 'splatter' &&
      this.skill.turn > 4
    )
      return 'splatter';
    let want: WeaponId = fav;
    if (dist >= 0) {
      if (fav === 'shotgun' && dist > 14) want = 'hopper';
      if (fav === 'longsplat' && dist < 10) want = 'hopper';
      if (fav === 'launcher' && (dist < 4.5 || dist > 30)) want = 'hopper';
    }
    if (!has(want)) want = has('hopper') ? 'hopper' : p.weapons[0];
    // Don't flip-flop mid-reload of the current gun unless it's empty
    if (p.reloadUntil > 0 && !empty) return null;
    return want === p.weapon ? null : want;
  }

  private safeDir(sim: WarfareSim, p: PlayerState, wx: number, wz: number): boolean {
    const l = Math.hypot(wx, wz);
    if (l < 0.01) return true;
    const ax = p.x + (wx / l) * 1.0;
    const az = p.z + (wz / l) * 1.0;
    if (!sim.world.inBounds(ax, az, 0.6)) return false;
    if (!sim.world.clear(p.x, p.y + 0.6, p.z, ax, p.y + 0.6, az)) return false;
    // No walking off a ledge mid-fight
    return sim.world.groundAt(ax, az, p.y + 0.6) > p.y - 1.2;
  }

  private seekCover(sim: WarfareSim, p: PlayerState, threat: PlayerState): boolean {
    const cands = sim.nav.within(p.x, p.y, p.z, 9, 1.5);
    const tx = threat.x;
    const ty = threat.y + eyeHeight(threat);
    const tz = threat.z;
    let best = -1;
    let bestScore = Infinity;
    let checks = 0;
    // Random start so ties don't always pick the same node
    const off = sim.rng.int(Math.max(1, cands.length));
    for (let k = 0; k < cands.length && checks < 28; k++) {
      const i = cands[(k + off) % cands.length];
      const n = sim.nav.nodes[i];
      if (n.cover < 0.25) continue;
      checks++;
      if (sim.world.clear(tx, ty, tz, n.x, n.y + 1.1, n.z)) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      const away = Math.hypot(n.x - tx, n.z - tz) < Math.hypot(p.x - tx, p.z - tz) - 2 ? 4 : 0;
      const score = d + away - n.cover * 3;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) return false;
    return this.goToNode(sim, p, best);
  }

  private pickGoal(sim: WarfareSim, p: PlayerState) {
    const t = sim.time;
    const m = sim.state.match;
    this.repathAt = t + sim.rng.range(5, 9);
    const turf = m.mode === 'turf' && sim.state.zones.length > 0;
    // Turf: standing in a zone that isn't fully ours yet (or is under
    // attack) → hold it, shuffling between spots inside the circle.
    if (turf) {
      const here = sim.state.zones.find(
        z => (p.x - z.x) ** 2 + (p.z - z.z) ** 2 < z.r * z.r && Math.abs(p.y - z.y) < 3,
      );
      const full = here !== undefined && (p.team === 0 ? here.progress <= -1 : here.progress >= 1);
      const hold =
        here !== undefined &&
        (!full || here.contested || (this.role === 'defend' && sim.rng.chance(0.6)));
      if (hold) {
        const nodes = sim.nav.within(here.x, here.y, here.z, Math.max(1.2, here.r - 0.9), 2);
        if (nodes.length > 0 && this.goToNode(sim, p, nodes[sim.rng.int(nodes.length)])) {
          this.repathAt = t + sim.rng.range(1.2, 2.6);
          return;
        }
      }
    }
    // Fresh intel first (zone players mostly stick to the objective)
    if (this.hasKnown && t - this.lastSeenAt < 6 && sim.rng.chance(turf ? 0.3 : 0.8)) {
      if (this.goTo(sim, p, this.lastKnown.x, this.lastKnown.y, this.lastKnown.z)) return;
    }
    if (turf) {
      const zones = sim.state.zones;
      const mine = zones.filter(z => z.owner === p.team);
      const theirs = zones.filter(z => z.owner !== p.team);
      let pick = zones[0];
      if (this.role === 'defend' && mine.length > 0) {
        pick = mine.find(z => z.contested) ?? mine[sim.rng.int(mine.length)];
      } else if (theirs.length > 0) {
        // Nearest un-owned zone, with some spread across the crew
        const sorted = [...theirs].sort(
          (a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z),
        );
        pick = sim.rng.chance(0.7) ? sorted[0] : sorted[sim.rng.int(sorted.length)];
      } else pick = zones[sim.rng.int(zones.length)];
      const nodes = sim.nav.within(pick.x, pick.y, pick.z, Math.max(1.2, pick.r - 0.8), 2);
      if (nodes.length > 0 && this.goToNode(sim, p, nodes[sim.rng.int(nodes.length)])) {
        this.repathAt = t + sim.rng.range(2.5, 5);
        return;
      }
    }
    // Hunt: harder bots get a (fuzzed) sense of where enemies are
    const enemies = sim.state.players.filter(
      o => o.alive && o.id !== p.id && (o.team === -1 || o.team !== p.team),
    );
    const late = m.mode === 'elim' && t - m.liveAt > 35;
    if (enemies.length > 0 && (late || sim.rng.chance(0.25 + sim.cfg.difficulty * 0.2))) {
      const e = enemies[sim.rng.int(enemies.length)];
      const fuzz = late ? 3 : 9;
      if (this.goTo(sim, p, e.x + sim.rng.signed() * fuzz, e.y, e.z + sim.rng.signed() * fuzz))
        return;
    }
    // Otherwise roam toward the middle of the map
    const W = sim.world;
    for (let k = 0; k < 6; k++) {
      const x = sim.rng.range(W.minX * 0.6, W.maxX * 0.6);
      const z = sim.rng.range(W.minZ * 0.85, W.maxZ * 0.85);
      if (this.goTo(sim, p, x, 0, z)) return;
    }
  }

  private goTo(sim: WarfareSim, p: PlayerState, x: number, y: number, z: number): boolean {
    const n = sim.nav.nearest(x, y, z, 8);
    if (n < 0) return false;
    return this.goToNode(sim, p, n);
  }

  private goToNode(sim: WarfareSim, p: PlayerState, node: number): boolean {
    const start = sim.nav.nearest(p.x, p.y, p.z, 6);
    if (start < 0) return false;
    const path = sim.nav.path(start, node);
    this.debug.repaths++;
    if (path === null) return false;
    this.path = path;
    this.pathIdx = 0;
    this.goalNode = node;
    return true;
  }

  private nextNode(sim: WarfareSim) {
    if (this.pathIdx >= this.path.length) return null;
    return sim.nav.nodes[this.path[this.pathIdx]];
  }

  /** Advance along the path + the stuck watchdog. */
  private watchdog(sim: WarfareSim, p: PlayerState) {
    const t = sim.time;
    // Waypoint advance
    while (this.pathIdx < this.path.length) {
      const n = sim.nav.nodes[this.path[this.pathIdx]];
      const dh = Math.hypot(n.x - p.x, n.z - p.z);
      if (dh < 0.55 && Math.abs(n.y - p.y) < 1.2) this.pathIdx++;
      else if (dh < 1.1 && this.pathIdx + 1 < this.path.length) {
        // Skip ahead when the next one is straight on
        const n2 = sim.nav.nodes[this.path[this.pathIdx + 1]];
        if (
          Math.abs(n2.y - p.y) < 0.6 &&
          sim.world.clear(p.x, p.y + 0.5, p.z, n2.x, n2.y + 0.5, n2.z)
        )
          this.pathIdx++;
        else break;
      } else break;
    }
    // Fell off the route (dropped from a ledge, knocked) → re-route soon
    const cur = this.nextNode(sim);
    if (cur !== null && Math.abs(cur.y - p.y) > 2.5 && p.grounded)
      this.repathAt = Math.min(this.repathAt, t);

    if (t < this.stuckCheckAt) return;
    this.stuckCheckAt = t + 0.5;
    const moved = Math.hypot(p.x - this.stuckX, p.z - this.stuckZ);
    this.stuckX = p.x;
    this.stuckZ = p.z;
    if (!this.wantsMove || moved > 0.3) {
      this.stuckTime = 0;
      return;
    }
    this.stuckTime += 0.5;
    this.debug.maxStuck = Math.max(this.debug.maxStuck, this.stuckTime);
    if (this.stuckTime >= 1 && this.stuckTime < 2) {
      // Hop + jiggle
      this.jumpUntil = t + 0.12;
      this.strafe = -this.strafe;
    } else if (this.stuckTime >= 2 && this.stuckTime < 3.5) {
      // New route from where we actually are
      this.path = [];
      this.repathAt = 0;
      this.state = 'roam';
      this.pickGoal(sim, p);
    } else if (this.stuckTime >= 3.5) {
      // Last resort: snap onto the nearest nav node
      const n = sim.nav.nearest(p.x, p.y, p.z, 12);
      if (n >= 0) {
        const nd = sim.nav.nodes[n];
        p.x = nd.x;
        p.y = nd.y;
        p.z = nd.z;
        p.vx = p.vy = p.vz = 0;
      }
      this.debug.unsticks++;
      this.stuckTime = 0;
      this.path = [];
      this.repathAt = 0;
      this.pickGoal(sim, p);
    }
  }
}
