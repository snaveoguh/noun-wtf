// ── Noun Warfare simulation: inputs → step → state + events ────────────
//
// Pure and deterministic: fixed 60 Hz step, seeded RNG, no wall clock, no
// rendering. The local client runs it directly in phase 1; in phase 2 a
// host (PartyKit room) runs the same class, feeding it every client's
// PlayerInput per tick and broadcasting snapshots + events. Bots are part
// of the step (the host owns them), so a host-authoritative match needs
// nothing more than `step(inputs)`.

import type { DamageSource, WeaponId } from './weapons';

import { createBotMem, thinkBot, type BotMem } from './bots';
import { MAPS } from './maps';
import {
  COUNTDOWN,
  MODES,
  ROUND_BREAK,
  TURF_CAP_RATE,
  modeTarget,
  modeTimeLimit,
  respawnDelay,
} from './modes';
import { NavGraph } from './nav';
import { HEAD_R, bodyHeight, depenetrate, eyeHeight, headY, movePlayer, viewDir } from './physics';
import { Rng } from './rng';
import {
  BODY,
  DT,
  FFA_COLORS,
  TEAM_COLORS,
  emptyInput,
  type MatchConfig,
  type MatchPhase,
  type PlayerInput,
  type PlayerState,
  type Projectile,
  type SimEvent,
  type SimState,
  type Team,
} from './types';
import { GRENADE, WEAPONS, WEAPON_ORDER } from './weapons';
import { World, newHit, type MapDef, type SpawnDef } from './world';

const BOT_NAMES = [
  'PIP3',
  'NOGGLES',
  'BERRY',
  'TOAST',
  'GNARLY',
  'PRISM',
  'HOTDOG',
  'BEANS',
  'PIZZA',
  'GOOBER',
  'MOONPIE',
  'BLOCKY',
  'SPLOOT',
  'CHONK',
  'WAFFLE',
  'PICKLE',
  'FROGGY',
  'NOUNCE',
  'DRIP',
  'COBALT',
];

const navCache = new Map<string, NavGraph>();
const worldCache = new Map<string, World>();

export function worldFor(map: MapDef): World {
  let w = worldCache.get(map.id);
  if (w === undefined) {
    w = new World(map);
    worldCache.set(map.id, w);
  }
  return w;
}

export function navFor(map: MapDef): NavGraph {
  let n = navCache.get(map.id);
  if (n === undefined) {
    n = new NavGraph(worldFor(map));
    navCache.set(map.id, n);
  }
  return n;
}

/** Hand-rolled seed key for a bot's Noun look. */
function botLook(rng: Rng): string {
  return `${rng.int(2)}-${rng.int(30)}-${rng.int(137)}-${rng.int(234)}-${rng.int(21)}`;
}

export function isEnemy(a: PlayerState, b: PlayerState): boolean {
  if (a.id === b.id) return false;
  return a.team === -1 || b.team === -1 || a.team !== b.team;
}

const _hit = newHit();

export class WarfareSim {
  readonly cfg: MatchConfig;
  readonly map: MapDef;
  readonly world: World;
  readonly nav: NavGraph;
  state: SimState;
  readonly rng: Rng;
  /** Host-only bot brains (not part of the replicated snapshot). */
  readonly bots = new Map<number, BotMem>();
  /** Last applied input per player (bots + humans), for debugging / HUD. */
  readonly lastInputs = new Map<number, PlayerInput>();
  private events: SimEvent[] = [];
  /** Players that fired recently (bots "hear" gunfire). */
  readonly noise: { pid: number; x: number; y: number; z: number; t: number }[] = [];
  /**
   * Network replica (online clients): a cosmetic copy that only moves
   * players and flies paint. Match flow, damage, kills, respawns and zones
   * belong to the host, so they're skipped here.
   */
  replica = false;

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    this.map = MAPS[cfg.map];
    this.world = worldFor(this.map);
    this.nav = navFor(this.map);
    this.rng = new Rng(cfg.seed);
    const mode = cfg.mode;
    this.state = {
      tick: 0,
      time: 0,
      rngState: this.rng.s,
      nextId: 1,
      match: {
        mode,
        phase: 'countdown',
        phaseUntil: COUNTDOWN,
        scores: [0, 0],
        target: cfg.target ?? modeTarget(mode, cfg.teamSize),
        timeLimit: cfg.timeLimit ?? modeTimeLimit(mode),
        liveAt: COUNTDOWN,
        round: 1,
        winner: null,
        roundWinner: null,
        turfTick: 0,
      },
      players: [],
      projectiles: [],
      zones:
        mode === 'turf'
          ? this.map.zones.map(z => ({
              ...z,
              progress: 0,
              owner: -1 as Team,
              contested: false,
              present: 0,
            }))
          : [],
    };
    this.addPlayers();
    for (const p of this.state.players) this.spawn(p, true);
    this.state.rngState = this.rng.s;
  }

  get time() {
    return this.state.time;
  }

  get phase(): MatchPhase {
    return this.state.match.phase;
  }

  player(id: number): PlayerState | undefined {
    return this.state.players[id];
  }

  private addPlayers() {
    const cfg = this.cfg;
    const teams = MODES[cfg.mode].teams;
    const total = cfg.teamSize * 2;
    const names = [...BOT_NAMES];
    // Deterministic shuffle of bot names
    for (let i = names.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [names[i], names[j]] = [names[j], names[i]];
    }
    for (let i = 0; i < total; i++) {
      const human = cfg.humans[i];
      const team: Team = teams ? ((i % 2) as 0 | 1) : -1;
      const id = i;
      const bot = human === undefined;
      const fav: WeaponId =
        cfg.difficulty === 0
          ? 'hopper'
          : this.rng.pick<WeaponId>(['hopper', 'hopper', 'shotgun', 'longsplat', 'launcher']);
      const weapons: WeaponId[] = bot
        ? (['splatter', 'hopper', fav].filter((w, k, a) => a.indexOf(w) === k) as WeaponId[])
        : human.weapons.length > 0
          ? WEAPON_ORDER.filter(w => human.weapons.includes(w))
          : ['splatter', 'hopper'];
      const p: PlayerState = {
        id,
        name: bot ? names[i % names.length] : human.name,
        team,
        color: team === -1 ? FFA_COLORS[i % FFA_COLORS.length] : TEAM_COLORS[team],
        bot,
        look: bot ? botLook(this.rng) : human.look,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        yaw: 0,
        pitch: 0,
        grounded: true,
        crouched: false,
        sprinting: false,
        scoped: false,
        hp: BODY.maxHp,
        alive: false,
        respawnAt: 0,
        protectedUntil: 0,
        lastDamageAt: -100,
        diedAt: -100,
        killerId: -1,
        weapon: bot ? fav : weapons.includes('hopper') ? 'hopper' : weapons[0],
        weapons,
        mags: {
          splatter: WEAPONS.splatter.mag,
          hopper: WEAPONS.hopper.mag,
          shotgun: WEAPONS.shotgun.mag,
          longsplat: WEAPONS.longsplat.mag,
          launcher: WEAPONS.launcher.mag,
        },
        reloadUntil: 0,
        nextFireAt: 0,
        swapUntil: 0,
        bloom: 0,
        grenades: GRENADE.perLife,
        grenadeRegenAt: 0,
        nextGrenadeAt: 0,
        prevFire: false,
        prevJump: false,
        prevGrenade: false,
        damagers: [],
        multi: 0,
        lastKillAt: -100,
        stats: {
          kills: 0,
          deaths: 0,
          assists: 0,
          headshots: 0,
          score: 0,
          streak: 0,
          bestStreak: 0,
          shots: 0,
          hits: 0,
          damage: 0,
          captures: 0,
        },
        stride: 0,
      };
      this.state.players.push(p);
      if (bot) this.bots.set(id, createBotMem(this, p));
    }
  }

  // ── Spawning ──────────────────────────────────────────────────────────

  private spawnCandidates(p: PlayerState): SpawnDef[] {
    const all = this.map.spawns;
    if (p.team === -1) return all;
    const own = all.filter(s => s.team === p.team);
    return own.length > 0 ? own : all;
  }

  /** Pick the safest spawn: far from enemies, out of their sight, unoccupied. */
  chooseSpawn(p: PlayerState, initial: boolean): SpawnDef {
    const cands = this.spawnCandidates(p);
    let best = cands[0];
    let bestScore = -Infinity;
    for (const s of cands) {
      const sy = this.world.groundAt(s.x, s.z, s.y + 0.6);
      let score = this.rng.next() * 3;
      let minEnemy = 45;
      for (const o of this.state.players) {
        if (o === p || !o.alive) continue;
        const d = Math.hypot(o.x - s.x, o.y - sy, o.z - s.z);
        if (d < 2.2) score -= 60;
        if (!isEnemy(p, o)) continue;
        minEnemy = Math.min(minEnemy, d);
        if (
          !initial &&
          d < 50 &&
          this.world.clear(o.x, o.y + eyeHeight(o), o.z, s.x, sy + 1.2, s.z)
        )
          score -= 25;
      }
      score += minEnemy;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  spawn(p: PlayerState, initial = false) {
    const s = this.chooseSpawn(p, initial);
    p.x = s.x + this.rng.signed() * 0.4;
    p.z = s.z + this.rng.signed() * 0.4;
    p.y = this.world.groundAt(p.x, p.z, s.y + 0.6);
    if (!Number.isFinite(p.y)) p.y = s.y;
    p.vx = p.vy = p.vz = 0;
    p.yaw = s.yaw;
    p.pitch = 0;
    p.hp = BODY.maxHp;
    p.alive = true;
    p.grounded = true;
    p.crouched = false;
    p.scoped = false;
    p.respawnAt = 0;
    p.protectedUntil = this.state.time + BODY.spawnProtect;
    p.reloadUntil = 0;
    p.nextFireAt = this.state.time + 0.2;
    p.swapUntil = 0;
    p.bloom = 0;
    for (const w of WEAPON_ORDER) p.mags[w] = WEAPONS[w].mag;
    p.grenades = GRENADE.perLife;
    p.damagers = [];
    p.lastDamageAt = -100;
    depenetrate(this.world, p);
    const mem = this.bots.get(p.id);
    if (mem !== undefined) mem.onSpawn(this, p);
    this.events.push({ type: 'spawn', pid: p.id });
  }

  // ── Step ──────────────────────────────────────────────────────────────

  /**
   * Advance one fixed tick. `inputs` holds human inputs by player id
   * (missing = idle); bots think inside the step. Returns this tick's events.
   */
  step(inputs: ReadonlyMap<number, PlayerInput> | Record<number, PlayerInput> = {}): SimEvent[] {
    const st = this.state;
    this.events = [];
    st.tick++;
    st.time = st.tick * DT;
    const replica = this.replica;
    if (!replica) this.updatePhase();
    const m = st.match;
    const live = m.phase === 'live';
    const frozen = m.phase === 'countdown' || m.phase === 'matchEnd';

    const get = (id: number): PlayerInput | undefined =>
      inputs instanceof Map ? inputs.get(id) : (inputs as Record<number, PlayerInput>)[id];

    for (const p of st.players) {
      let inp: PlayerInput;
      const mem = this.bots.get(p.id);
      if (mem !== undefined) inp = thinkBot(this, p, mem);
      else inp = get(p.id) ?? this.lastInputs.get(p.id) ?? emptyInput(p.yaw, p.pitch);
      this.lastInputs.set(p.id, inp);
      if (!p.alive) {
        if (
          !replica &&
          live &&
          st.time >= p.respawnAt &&
          Number.isFinite(p.respawnAt) &&
          st.time - p.diedAt > 0.5
        )
          this.spawn(p);
        continue;
      }
      // Look is always free (even frozen), clamped
      p.yaw = Number.isFinite(inp.yaw) ? inp.yaw : p.yaw;
      p.pitch = Math.max(-1.45, Math.min(1.45, Number.isFinite(inp.pitch) ? inp.pitch : 0));
      this.updateWeapon(p, inp, live);
      movePlayer(this.world, p, inp, DT, frozen, inp.fire && live, this.events);
      p.prevJump = inp.jump;
      // Regen
      if (p.hp < BODY.maxHp && st.time - p.lastDamageAt > BODY.regenDelay)
        p.hp = Math.min(BODY.maxHp, p.hp + BODY.regenRate * DT);
      if (p.grenades < GRENADE.perLife && st.time >= p.grenadeRegenAt) {
        p.grenades++;
        p.grenadeRegenAt = st.time + GRENADE.regen;
      }
      if (p.y < this.map.killY && !replica) {
        const recent = p.damagers.length > 0 ? p.damagers[p.damagers.length - 1] : null;
        const by = recent !== null && st.time - recent.t < 6 ? recent.id : p.id;
        this.kill(p, st.players[by], 'fall', false);
      }
    }
    this.separatePlayers();
    this.stepProjectiles();
    if (!replica) {
      if (m.mode === 'turf' && live) this.stepZones();
      this.checkEnd();
    }
    while (this.noise.length > 0 && st.time - this.noise[0].t > 2.5) this.noise.shift();
    st.rngState = this.rng.s;
    return this.events;
  }

  private setPhase(phase: MatchPhase, until: number) {
    this.state.match.phase = phase;
    this.state.match.phaseUntil = until;
    this.events.push({ type: 'phase', phase });
  }

  private updatePhase() {
    const st = this.state;
    const m = st.match;
    if (m.phase === 'countdown' && st.time >= m.phaseUntil) {
      m.liveAt = st.time;
      this.setPhase('live', Infinity);
    } else if (m.phase === 'roundEnd' && st.time >= m.phaseUntil) {
      // Next Elimination round: everyone back at base
      m.round++;
      st.projectiles = [];
      for (const p of st.players) {
        p.alive = false;
        p.respawnAt = 0;
      }
      for (const p of st.players) this.spawn(p, true);
      m.liveAt = st.time + COUNTDOWN;
      this.setPhase('countdown', st.time + COUNTDOWN);
    }
  }

  // ── Weapons ───────────────────────────────────────────────────────────

  private updateWeapon(p: PlayerState, inp: PlayerInput, live: boolean) {
    const t = this.state.time;
    // Swap
    if (inp.weapon !== null && inp.weapon !== p.weapon && p.weapons.includes(inp.weapon)) {
      p.weapon = inp.weapon;
      p.reloadUntil = 0;
      p.swapUntil = t + 0.3;
      p.bloom = 0;
      this.events.push({ type: 'swap', pid: p.id, weapon: p.weapon });
    }
    const w = WEAPONS[p.weapon];
    // Reload
    if (p.reloadUntil > 0 && t >= p.reloadUntil) {
      p.mags[p.weapon] = w.mag;
      p.reloadUntil = 0;
    }
    if (
      p.reloadUntil === 0 &&
      p.mags[p.weapon] < w.mag &&
      (inp.reload || p.mags[p.weapon] === 0) &&
      t >= p.swapUntil
    ) {
      p.reloadUntil = t + w.reload;
      p.scoped = false;
      this.events.push({ type: 'reload', pid: p.id, weapon: p.weapon });
    }
    p.scoped = inp.scope && p.reloadUntil === 0 && !p.sprinting;
    p.bloom = Math.max(0, p.bloom - w.bloomDecay * DT);
    const pressed = inp.fire && !p.prevFire;
    const wants = inp.fire && (w.auto || pressed);
    if (
      live &&
      wants &&
      t >= p.nextFireAt &&
      t >= p.swapUntil &&
      p.reloadUntil === 0 &&
      p.mags[p.weapon] > 0
    ) {
      this.shoot(p);
    }
    p.prevFire = inp.fire;
    // Grenade (edge)
    const g = inp.grenade && !p.prevGrenade;
    p.prevGrenade = inp.grenade;
    if (live && g && p.grenades > 0 && t >= p.nextGrenadeAt) this.throwGrenade(p);
  }

  private shoot(p: PlayerState) {
    const w = WEAPONS[p.weapon];
    const t = this.state.time;
    const [dx, dy, dz] = viewDir(p.yaw, p.pitch);
    const ex = p.x;
    const ey = p.y + eyeHeight(p);
    const ez = p.z;
    const speedFrac = Math.min(1, Math.hypot(p.vx, p.vz) / BODY.walk);
    let cone = w.spread + w.moveSpread * speedFrac + (p.grounded ? 0 : w.airSpread) + p.bloom;
    if (p.crouched) cone *= 0.7;
    if (p.scoped) cone *= w.scopedSpread ?? 0.65;
    // Orthonormal basis around the view direction
    let ux = 0;
    let uy = 1;
    let uz = 0;
    if (Math.abs(dy) > 0.95) {
      ux = 1;
      uy = 0;
    }
    // r = normalize(cross(d, u)), u' = cross(r, d)
    let rx = dy * uz - dz * uy;
    let ry = dz * ux - dx * uz;
    let rz = dx * uy - dy * ux;
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl;
    ry /= rl;
    rz /= rl;
    ux = ry * dz - rz * dy;
    uy = rz * dx - rx * dz;
    uz = rx * dy - ry * dx;
    for (let i = 0; i < w.pellets; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const rad = cone * Math.sqrt(this.rng.next());
      const ca = Math.cos(a) * rad;
      const sa = Math.sin(a) * rad;
      let fx = dx + rx * ca + ux * sa;
      let fy = dy + ry * ca + uy * sa;
      let fz = dz + rz * ca + uz * sa;
      const fl = Math.hypot(fx, fy, fz);
      fx /= fl;
      fy /= fl;
      fz /= fl;
      this.state.projectiles.push({
        id: this.state.nextId++,
        owner: p.id,
        source: w.id,
        kind: w.kind,
        color: p.color,
        x: ex,
        y: ey,
        z: ez,
        vx: fx * w.speed,
        vy: fy * w.speed,
        vz: fz * w.speed,
        gravity: w.gravity,
        radius: w.radius,
        born: t,
        fuseAt: 0,
        dmg: w.dmg,
        headMult: w.headMult,
        bounces: 0,
      });
    }
    p.mags[w.id]--;
    p.nextFireAt = t + w.rate;
    p.bloom = Math.min(w.bloomMax, p.bloom + w.bloomPerShot);
    p.stats.shots++;
    p.protectedUntil = Math.min(p.protectedUntil, t);
    this.noise.push({ pid: p.id, x: p.x, y: p.y, z: p.z, t });
    this.events.push({ type: 'fire', pid: p.id, weapon: w.id, x: ex, y: ey, z: ez, dx, dy, dz });
  }

  private throwGrenade(p: PlayerState) {
    const t = this.state.time;
    const [dx, dy, dz] = viewDir(p.yaw, p.pitch);
    p.grenades--;
    p.nextGrenadeAt = t + 0.8;
    if (p.grenadeRegenAt <= t) p.grenadeRegenAt = t + GRENADE.regen;
    p.protectedUntil = Math.min(p.protectedUntil, t);
    this.state.projectiles.push({
      id: this.state.nextId++,
      owner: p.id,
      source: 'grenade',
      kind: 'grenade',
      color: p.color,
      x: p.x + dx * 0.4,
      y: p.y + eyeHeight(p) - 0.15,
      z: p.z + dz * 0.4,
      vx: dx * GRENADE.speed + p.vx * 0.5,
      vy: dy * GRENADE.speed + 3.2,
      vz: dz * GRENADE.speed + p.vz * 0.5,
      gravity: GRENADE.gravity,
      radius: GRENADE.radius,
      born: t,
      fuseAt: t + GRENADE.fuse,
      dmg: 0,
      headMult: 1,
      bounces: 0,
    });
    this.events.push({ type: 'throw', pid: p.id });
  }

  // ── Projectiles ───────────────────────────────────────────────────────

  /**
   * Earliest hit of a moving ball against a player's hitboxes (head
   * sphere + body capsule). Returns t (0..1) or -1; `head` reports which.
   */
  static hitPlayer(
    p: PlayerState,
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    rad: number,
    out: { head: boolean },
  ): number {
    const h = bodyHeight(p);
    // Head (the big Noun box) — generous sphere
    const tHead = segSphere(ax, ay, az, bx, by, bz, p.x, headY(p), p.z, HEAD_R + rad);
    // Body: vertical capsule under it
    const y0 = p.y + 0.22;
    const y1 = p.y + h * 0.47;
    const tBody = segCapsuleY(ax, ay, az, bx, by, bz, p.x, y0, y1, p.z, 0.36 + rad);
    if (tHead >= 0 && (tBody < 0 || tHead <= tBody)) {
      out.head = true;
      return tHead;
    }
    out.head = false;
    return tBody;
  }

  private stepProjectiles() {
    const st = this.state;
    const keep: Projectile[] = [];
    const headOut = { head: false };
    for (const pr of st.projectiles) {
      let dead = false;
      if (pr.kind === 'grenade' && st.time >= pr.fuseAt) {
        this.explode(pr, pr.x, pr.y, pr.z, 0, 1, 0);
        continue;
      }
      pr.vy -= pr.gravity * DT;
      const nx = pr.x + pr.vx * DT;
      const ny = pr.y + pr.vy * DT;
      const nz = pr.z + pr.vz * DT;
      // Players
      let bestT = 2;
      let victim: PlayerState | null = null;
      let head = false;
      if (pr.kind !== 'grenade') {
        for (const p of st.players) {
          if (!p.alive) continue;
          if (p.id === pr.owner && (pr.kind === 'ball' || st.time - pr.born < 0.25)) continue;
          const t = WarfareSim.hitPlayer(p, pr.x, pr.y, pr.z, nx, ny, nz, pr.radius, headOut);
          if (t >= 0 && t < bestT) {
            bestT = t;
            victim = p;
            head = headOut.head;
          }
        }
      }
      const wallHit = this.world.segment(pr.x, pr.y, pr.z, nx, ny, nz, _hit);
      if (victim !== null && (!wallHit || bestT <= _hit.t)) {
        const hx = pr.x + (nx - pr.x) * bestT;
        const hy = pr.y + (ny - pr.y) * bestT;
        const hz = pr.z + (nz - pr.z) * bestT;
        const owner = st.players[pr.owner];
        if (pr.kind === 'bomb') {
          this.damage(victim, owner, pr.dmg, pr.source, false, hx, hy, hz);
          this.explode(pr, hx, hy, hz, 0, 1, 0, victim.id);
        } else {
          const dmg = pr.dmg * (head ? pr.headMult : 1);
          this.events.push({
            type: 'splat',
            x: hx,
            y: hy,
            z: hz,
            nx: -pr.vx,
            ny: -pr.vy,
            nz: -pr.vz,
            color: pr.color,
            size: 0.5,
            on: victim.id,
          });
          this.damage(victim, owner, dmg, pr.source, head, hx, hy, hz);
        }
        dead = true;
      } else if (wallHit) {
        if (pr.kind === 'ball') {
          this.events.push({
            type: 'splat',
            x: _hit.x,
            y: _hit.y,
            z: _hit.z,
            nx: _hit.nx,
            ny: _hit.ny,
            nz: _hit.nz,
            color: pr.color,
            size: pr.source === 'longsplat' ? 0.75 : pr.source === 'shotgun' ? 0.38 : 0.55,
            on: -1,
          });
          dead = true;
        } else if (pr.kind === 'bomb') {
          this.explode(pr, _hit.x, _hit.y, _hit.z, _hit.nx, _hit.ny, _hit.nz);
          dead = true;
        } else {
          // Grenade bounce
          const vn = pr.vx * _hit.nx + pr.vy * _hit.ny + pr.vz * _hit.nz;
          const e = GRENADE.restitution;
          pr.vx = (pr.vx - (1 + e) * vn * _hit.nx) * 0.8;
          pr.vy = pr.vy - (1 + e) * vn * _hit.ny;
          pr.vz = (pr.vz - (1 + e) * vn * _hit.nz) * 0.8;
          pr.x = _hit.x + _hit.nx * 0.03;
          pr.y = _hit.y + _hit.ny * 0.03;
          pr.z = _hit.z + _hit.nz * 0.03;
          pr.bounces++;
          if (Math.abs(vn) > 2.5) this.events.push({ type: 'bounce', x: pr.x, y: pr.y, z: pr.z });
          // Resting on the floor: stop jittering
          if (_hit.ny > 0.7 && Math.abs(pr.vy) < 1.2) {
            pr.vy = 0;
            pr.vx *= 0.85;
            pr.vz *= 0.85;
          }
        }
      } else {
        pr.x = nx;
        pr.y = ny;
        pr.z = nz;
      }
      if (!dead && (st.time - pr.born > 4 || pr.y < this.map.killY)) dead = true;
      if (!dead) keep.push(pr);
    }
    st.projectiles = keep;
  }

  private explode(
    pr: Projectile,
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    directVictim = -1,
  ) {
    const splash = pr.kind === 'grenade' ? GRENADE.splash : WEAPONS.launcher.splash!;
    const owner = this.state.players[pr.owner];
    this.events.push({
      type: 'explode',
      x,
      y,
      z,
      nx,
      ny,
      nz,
      color: pr.color,
      radius: splash.radius,
      owner: pr.owner,
    });
    const ox = x + nx * 0.15;
    const oy = y + ny * 0.15 + 0.05;
    const oz = z + nz * 0.15;
    for (const p of this.state.players) {
      if (!p.alive || p.id === directVictim) continue;
      const cy = p.y + bodyHeight(p) * 0.55;
      const d = Math.hypot(p.x - ox, cy - oy, p.z - oz);
      if (d > splash.radius + 0.4) continue;
      const seen =
        this.world.clear(ox, oy, oz, p.x, cy, p.z) ||
        this.world.clear(ox, oy, oz, p.x, p.y + bodyHeight(p) - 0.2, p.z);
      if (!seen) continue;
      const f = Math.max(0, 1 - Math.max(0, d - 0.4) / splash.radius);
      let dmg = splash.dmg * Math.pow(f, 0.8);
      if (p.id === pr.owner) dmg *= 0.45;
      if (dmg < 3) continue;
      this.events.push({
        type: 'splat',
        x: p.x,
        y: cy,
        z: p.z,
        nx: p.x - ox,
        ny: 0.2,
        nz: p.z - oz,
        color: pr.color,
        size: 0.7,
        on: p.id,
      });
      this.damage(p, owner, dmg, pr.source, false, p.x, cy, p.z);
    }
  }

  // ── Damage + splats ───────────────────────────────────────────────────

  damage(
    victim: PlayerState,
    attacker: PlayerState | undefined,
    dmg: number,
    source: DamageSource,
    head: boolean,
    x: number,
    y: number,
    z: number,
  ) {
    const st = this.state;
    if (this.replica || !victim.alive || st.match.phase !== 'live') return;
    if (st.time < victim.protectedUntil) return;
    if (attacker !== undefined && attacker !== victim && !isEnemy(attacker, victim)) return;
    victim.hp -= dmg;
    victim.lastDamageAt = st.time;
    let fx = 0;
    let fz = 0;
    if (attacker !== undefined && attacker !== victim) {
      victim.damagers.push({ id: attacker.id, dmg, t: st.time });
      if (victim.damagers.length > 8) victim.damagers.shift();
      attacker.stats.damage += dmg;
      attacker.stats.hits++;
      const l = Math.hypot(victim.x - attacker.x, victim.z - attacker.z) || 1;
      fx = (victim.x - attacker.x) / l;
      fz = (victim.z - attacker.z) / l;
    }
    this.events.push({
      type: 'hit',
      attacker: attacker?.id ?? -1,
      victim: victim.id,
      dmg,
      head,
      source,
      x,
      y,
      z,
      fromX: fx,
      fromZ: fz,
    });
    const mem = this.bots.get(victim.id);
    if (mem !== undefined && attacker !== undefined && attacker !== victim)
      mem.onHurt(this, victim, attacker);
    if (victim.hp <= 0) this.kill(victim, attacker, source, head);
  }

  kill(
    victim: PlayerState,
    attacker: PlayerState | undefined,
    source: DamageSource,
    head: boolean,
  ) {
    const st = this.state;
    const m = st.match;
    if (this.replica || !victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.diedAt = st.time;
    victim.stats.deaths++;
    victim.stats.streak = 0;
    victim.reloadUntil = 0;
    victim.killerId = attacker?.id ?? -1;
    const delay = respawnDelay(m.mode);
    victim.respawnAt = st.time + delay;
    // Assist: biggest other contributor in the last 6 s
    let assist = -1;
    let assistDmg = 24;
    const tally = new Map<number, number>();
    for (const d of victim.damagers) {
      if (st.time - d.t > 6 || d.id === attacker?.id) continue;
      tally.set(d.id, (tally.get(d.id) ?? 0) + d.dmg);
    }
    for (const [id, dmg] of tally) {
      if (dmg > assistDmg) {
        assistDmg = dmg;
        assist = id;
      }
    }
    if (assist >= 0) st.players[assist].stats.assists++;
    const realKill = attacker !== undefined && attacker !== victim;
    if (realKill) {
      const a = attacker;
      const firstBlood = st.players.every(p => p.stats.kills === 0);
      a.stats.kills++;
      if (head) a.stats.headshots++;
      a.stats.streak++;
      a.stats.bestStreak = Math.max(a.stats.bestStreak, a.stats.streak);
      a.multi = st.time - a.lastKillAt <= 4 ? a.multi + 1 : 1;
      a.lastKillAt = st.time;
      if (m.mode === 'tdm' && a.team !== -1) m.scores[a.team]++;
      if (m.mode === 'ffa') a.stats.score++;
      if (m.mode === 'turf') a.stats.score += 1;
      const call = (text: string, tier: number) =>
        this.events.push({ type: 'callout', pid: a.id, text, tier });
      if (firstBlood) call('FIRST SPLAT', 1);
      if (a.multi === 2) call('DOUBLE SPLAT', 2);
      else if (a.multi === 3) call('TRIPLE SPLAT', 3);
      else if (a.multi === 4) call('QUAD SPLAT', 3);
      else if (a.multi >= 5) call('PAINTAGEDDON', 4);
      if (a.stats.streak === 5) call('SPLATTER SPREE', 3);
      else if (a.stats.streak === 8) call('PAINT RAMPAGE', 4);
      else if (a.stats.streak === 12) call('UNSPLATTABLE', 4);
      if (head && source !== 'grenade') call('NOGGLE SHOT', 0);
      if (a.killerId === victim.id && a.multi === 1) call('PAYBACK', 0);
    }
    this.events.push({
      type: 'kill',
      attacker: attacker?.id ?? victim.id,
      victim: victim.id,
      source,
      head,
      assist,
    });
    const mem = this.bots.get(victim.id);
    if (mem !== undefined) mem.onDeath();
  }

  // ── Separation (no stacking inside each other) ───────────────────────

  private separatePlayers() {
    const ps = this.state.players;
    const minD = BODY.radius * 1.7;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (!b.alive) continue;
        if (Math.abs(a.y - b.y) > 1.6) continue;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        if (d >= minD) continue;
        if (d < 1e-4) {
          dx = (i % 2 === 0 ? 1 : -1) * 0.01;
          dz = 0.01;
          d = Math.hypot(dx, dz);
        }
        const push = (minD - d) * 0.5;
        a.x -= (dx / d) * push;
        a.z -= (dz / d) * push;
        b.x += (dx / d) * push;
        b.z += (dz / d) * push;
        depenetrate(this.world, a);
        depenetrate(this.world, b);
      }
    }
  }

  // ── Turf zones ────────────────────────────────────────────────────────

  private stepZones() {
    const st = this.state;
    const m = st.match;
    for (const z of st.zones) {
      let red = 0;
      let blue = 0;
      for (const p of st.players) {
        if (!p.alive || p.team === -1) continue;
        if ((p.x - z.x) ** 2 + (p.z - z.z) ** 2 > z.r * z.r || Math.abs(p.y - z.y) > 3) continue;
        if (p.team === 0) red++;
        else blue++;
      }
      z.present = (red > 0 ? 1 : 0) | (blue > 0 ? 2 : 0);
      z.contested = red > 0 && blue > 0;
      const prevOwner = z.owner;
      if (!z.contested && (red > 0 || blue > 0)) {
        const n = Math.max(red, blue);
        const rate = TURF_CAP_RATE * Math.sqrt(n) * DT;
        z.progress = Math.max(-1, Math.min(1, z.progress + (blue > 0 ? rate : -rate)));
      } else if (red === 0 && blue === 0) {
        // Unattended: drift back to the owner's colour (or neutral)
        const home = z.owner === 0 ? -1 : z.owner === 1 ? 1 : 0;
        const d = home - z.progress;
        z.progress += Math.sign(d) * Math.min(Math.abs(d), 0.1 * DT);
      }
      if (z.progress <= -1 && z.owner !== 0) z.owner = 0;
      else if (z.progress >= 1 && z.owner !== 1) z.owner = 1;
      else if (z.owner === 0 && z.progress > 0) z.owner = -1;
      else if (z.owner === 1 && z.progress < 0) z.owner = -1;
      if (z.owner !== prevOwner) {
        this.events.push({ type: 'zone', zone: z.id, owner: z.owner, prev: prevOwner });
        if (z.owner !== -1) {
          for (const p of st.players) {
            if (!p.alive || p.team !== z.owner) continue;
            if ((p.x - z.x) ** 2 + (p.z - z.z) ** 2 > z.r * z.r) continue;
            p.stats.captures++;
            p.stats.score += 5;
          }
        }
      }
    }
    m.turfTick += DT;
    while (m.turfTick >= 1) {
      m.turfTick -= 1;
      for (const z of st.zones) if (z.owner !== -1) m.scores[z.owner] += 1;
    }
  }

  // ── Win conditions ────────────────────────────────────────────────────

  private endMatch(winner: number) {
    const m = this.state.match;
    m.winner = winner;
    this.setPhase('matchEnd', Infinity);
    this.events.push({ type: 'match', winner });
  }

  private checkEnd() {
    const st = this.state;
    const m = st.match;
    if (m.phase !== 'live') return;
    const elapsed = st.time - m.liveAt;
    const timeUp = elapsed >= m.timeLimit;
    if (m.mode === 'ffa') {
      let leader: PlayerState | null = null;
      let tie = false;
      for (const p of st.players) {
        if (leader === null || p.stats.kills > leader.stats.kills) {
          leader = p;
          tie = false;
        } else if (p.stats.kills === leader.stats.kills) tie = true;
      }
      if (leader !== null && leader.stats.kills >= m.target) this.endMatch(100 + leader.id);
      else if (timeUp) this.endMatch(tie || leader === null ? -1 : 100 + leader.id);
      return;
    }
    if (m.mode === 'tdm' || m.mode === 'turf') {
      const [r, b] = m.scores;
      if (r >= m.target || b >= m.target) this.endMatch(r >= b ? 0 : 1);
      else if (timeUp) this.endMatch(r === b ? -1 : r > b ? 0 : 1);
      return;
    }
    // Elimination
    const alive: [number, number] = [0, 0];
    const hp: [number, number] = [0, 0];
    for (const p of st.players) {
      if (!p.alive || p.team === -1) continue;
      alive[p.team]++;
      hp[p.team] += p.hp;
    }
    let roundWinner: Team | -2 = -2;
    if (alive[0] === 0 && alive[1] === 0) roundWinner = -1;
    else if (alive[0] === 0) roundWinner = 1;
    else if (alive[1] === 0) roundWinner = 0;
    else if (timeUp) {
      if (alive[0] !== alive[1]) roundWinner = alive[0] > alive[1] ? 0 : 1;
      else if (Math.abs(hp[0] - hp[1]) > 1) roundWinner = hp[0] > hp[1] ? 0 : 1;
      else roundWinner = -1;
    }
    if (roundWinner === -2) return;
    if (roundWinner !== -1) {
      m.scores[roundWinner]++;
      for (const p of st.players) if (p.team === roundWinner) p.stats.score += 10;
    }
    m.roundWinner = roundWinner;
    this.events.push({ type: 'round', winner: roundWinner, round: m.round });
    if (m.scores[0] >= m.target || m.scores[1] >= m.target)
      this.endMatch(m.scores[0] > m.scores[1] ? 0 : 1);
    else this.setPhase('roundEnd', st.time + ROUND_BREAK);
  }

  // ── Snapshot (phase 2: host → clients) ───────────────────────────────

  snapshot(): string {
    return JSON.stringify(this.state);
  }

  /** Cheap state hash for determinism checks. */
  hash(): number {
    const s = this.snapshot();
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
}

// ── Geometry helpers ─────────────────────────────────────────────────────

/** Entry t of segment a→b into a sphere, or −1. Starting inside counts as 0. */
export function segSphere(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const fx = ax - cx;
  const fy = ay - cy;
  const fz = az - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const c = fx * fx + fy * fy + fz * fz - r * r;
  if (c <= 0) return 0;
  if (a < 1e-12) return -1;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

/** Entry t of a segment into a vertical capsule (axis x,z from y0 to y1). */
export function segCapsuleY(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  y0: number,
  y1: number,
  cz: number,
  r: number,
): number {
  // Infinite cylinder in xz
  const dx = bx - ax;
  const dz = bz - az;
  const fx = ax - cx;
  const fz = az - cz;
  const a = dx * dx + dz * dz;
  const c = fx * fx + fz * fz - r * r;
  let best = -1;
  if (c <= 0) {
    if (ay >= y0 && ay <= y1) return 0;
  } else if (a > 1e-12) {
    const b = 2 * (fx * dx + fz * dz);
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t >= 0 && t <= 1) {
        const y = ay + (by - ay) * t;
        if (y >= y0 && y <= y1) best = t;
      }
    }
  }
  const tc0 = segSphere(ax, ay, az, bx, by, bz, cx, y0, cz, r);
  const tc1 = segSphere(ax, ay, az, bx, by, bz, cx, y1, cz, r);
  for (const t of [tc0, tc1]) if (t >= 0 && (best < 0 || t < best)) best = t;
  return best;
}
