// Pure-sim tests: ballistics + hits, damage/elimination, mode scoring,
// bots never staying stuck over long all-bot matches, and determinism.

import { describe, expect, it } from 'vitest';

import { MAPS } from './maps';
import { viewDir } from './physics';
import { levelFor, matchRep, unlockedWeapons } from './progression';
import { WarfareSim, segCapsuleY, segSphere } from './sim';
import { DT, emptyInput, type MatchConfig, type PlayerInput } from './types';
import { WEAPONS } from './weapons';
import { World, newHit } from './world';

function cfg(over: Partial<MatchConfig> = {}): MatchConfig {
  return {
    mode: 'tdm',
    map: 'warehouse',
    teamSize: 2,
    difficulty: 1,
    seed: 1234,
    humans: [{ name: 'TESTER', look: '0-1-2-3-4', weapons: ['splatter', 'hopper'] }],
    ...over,
  };
}

/** Run until the countdown is over. */
function goLive(sim: WarfareSim, inputs: Record<number, PlayerInput> = {}) {
  let guard = 0;
  while (sim.phase !== 'live' && guard++ < 1000) sim.step(inputs);
}

/** Park everyone except the listed ids far away and out of the fight. */
function isolate(sim: WarfareSim, keep: number[]) {
  for (const p of sim.state.players) {
    if (keep.includes(p.id)) continue;
    p.alive = false;
    p.respawnAt = Infinity;
    sim.bots.delete(p.id);
  }
}

describe('world collision', () => {
  const world = new World(MAPS.warehouse);

  it('segment hits the floor from above with an upward normal', () => {
    const h = newHit();
    expect(world.segment(5, 3, 3, 5, -0.5, 3, h)).toBe(true);
    expect(h.y).toBeCloseTo(0, 5);
    expect(h.ny).toBe(1);
  });

  it('segment against a ramp lands on its slope', () => {
    const r = world.ramps[0];
    const mx = (r.x0 + r.x1) / 2;
    const mz = (r.z0 + r.z1) / 2;
    const h = newHit();
    expect(world.segment(mx, 9, mz, mx, -0.5, mz, h)).toBe(true);
    const expected = r.y0 + ((mx - r.x0) / (r.x1 - r.x0)) * (r.y1 - r.y0);
    expect(h.y).toBeCloseTo(expected, 4);
    expect(h.ny).toBeGreaterThan(0.5);
  });

  it('groundAt finds the catwalk above the floor', () => {
    expect(world.groundAt(-10, -20, 10)).toBeCloseTo(4, 5);
    expect(world.groundAt(-10, -20, 2)).toBeCloseTo(0, 5);
  });
});

describe('projectile ballistics + hits', () => {
  it('a paint ball travels with time of flight and drops under gravity', () => {
    const sim = new WarfareSim(cfg({ seed: 7 }));
    goLive(sim);
    isolate(sim, [0]);
    const p = sim.state.players[0];
    p.x = 0;
    p.z = 18;
    p.y = 0;
    const inp = { ...emptyInput(Math.PI / 2, 0), fire: true };
    p.weapon = 'splatter';
    p.bloom = 0;
    sim.step({ 0: inp });
    const balls = sim.state.projectiles.filter(b => b.owner === 0);
    expect(balls.length).toBe(1);
    const b = balls[0];
    const x0 = b.x;
    const y0 = b.y;
    for (let i = 0; i < 10; i++) sim.step({ 0: { ...inp, fire: false } });
    // ~10 ticks at 88 m/s ≈ 14.7 m travelled, still airborne (no instant hitscan)
    expect(Math.abs(b.x - x0)).toBeGreaterThan(12);
    expect(Math.abs(b.x - x0)).toBeLessThan(16);
    expect(b.y).toBeLessThan(y0);
    // Drop ≈ ½ g t²
    const t = 10 * DT;
    expect(y0 - b.y).toBeCloseTo(0.5 * WEAPONS.splatter.gravity * t * t, 1);
  });

  it('segment/sphere and capsule helpers report entry fractions', () => {
    expect(segSphere(-2, 0, 0, 2, 0, 0, 0, 0, 0, 1)).toBeCloseTo(0.25, 5);
    expect(segSphere(-2, 5, 0, 2, 5, 0, 0, 0, 0, 1)).toBe(-1);
    expect(segCapsuleY(-2, 1, 0, 2, 1, 0, 0, 0, 2, 0, 0.5)).toBeCloseTo(0.375, 5);
    expect(segCapsuleY(-2, 3, 0, 2, 3, 0, 0, 0, 2, 0, 0.5)).toBe(-1);
  });

  it('a shot at a standing enemy hits it after travel time and splats it', () => {
    const sim = new WarfareSim(cfg({ seed: 99 }));
    goLive(sim);
    const shooter = sim.state.players[0];
    const enemy = sim.state.players.find(p => p.team !== shooter.team)!;
    isolate(sim, [0, enemy.id]);
    sim.bots.delete(enemy.id);
    shooter.x = -10;
    shooter.z = 3;
    shooter.y = 0;
    shooter.weapon = 'splatter';
    shooter.bloom = 0;
    enemy.x = 6;
    enemy.z = 3;
    enemy.y = 0;
    enemy.protectedUntil = 0;
    // Aim at chest
    const dx = enemy.x - shooter.x;
    const dy = 1.0 - 1.62;
    const yaw = Math.atan2(-dx, 0);
    const pitch = Math.atan2(dy, Math.abs(dx));
    let hitTick = -1;
    let splatOnPlayer = false;
    for (let i = 0; i < 40; i++) {
      enemy.x = 6;
      enemy.z = 3;
      const ev = sim.step({ 0: { ...emptyInput(yaw, pitch), fire: i === 0 } });
      for (const e of ev) {
        if (e.type === 'hit' && e.victim === enemy.id && hitTick < 0) hitTick = i;
        if (e.type === 'splat' && e.on === enemy.id) splatOnPlayer = true;
      }
    }
    expect(hitTick).toBeGreaterThan(0); // not instant
    expect(hitTick).toBeLessThan(20);
    expect(splatOnPlayer).toBe(true);
    expect(enemy.hp).toBeLessThan(100);
  });
});

describe('damage + elimination', () => {
  it('lethal damage splats the victim, credits the attacker and respawns later', () => {
    const sim = new WarfareSim(cfg());
    goLive(sim);
    const a = sim.state.players[0];
    const v = sim.state.players.find(p => p.team !== a.team)!;
    v.protectedUntil = 0;
    sim.damage(v, a, 60, 'hopper', false, v.x, v.y + 1, v.z);
    expect(v.alive).toBe(true);
    sim.damage(v, a, 60, 'hopper', true, v.x, v.y + 1, v.z);
    expect(v.alive).toBe(false);
    expect(a.stats.kills).toBe(1);
    expect(v.stats.deaths).toBe(1);
    expect(sim.state.match.scores[a.team as 0 | 1]).toBe(1);
    // Respawns after the TDM delay
    for (let i = 0; i < 60 * 3.5; i++) sim.step();
    expect(v.alive).toBe(true);
  });

  it('no friendly fire and spawn protection blocks damage', () => {
    const sim = new WarfareSim(cfg({ teamSize: 4 }));
    goLive(sim);
    const a = sim.state.players[0];
    const mate = sim.state.players.find(p => p.team === a.team && p.id !== a.id)!;
    mate.protectedUntil = 0;
    sim.damage(mate, a, 200, 'hopper', false, 0, 0, 0);
    expect(mate.alive).toBe(true);
    const enemy = sim.state.players.find(p => p.team !== a.team)!;
    enemy.protectedUntil = sim.time + 5;
    sim.damage(enemy, a, 200, 'hopper', false, 0, 0, 0);
    expect(enemy.alive).toBe(true);
  });

  it('grenade splash damages enemies in radius with falloff', () => {
    const sim = new WarfareSim(cfg({ seed: 5 }));
    goLive(sim);
    const a = sim.state.players[0];
    const v = sim.state.players.find(p => p.team !== a.team)!;
    isolate(sim, [a.id, v.id]);
    a.x = -12;
    a.z = 0;
    a.y = 0;
    v.x = -4;
    v.z = 3;
    v.y = 0;
    v.protectedUntil = 0;
    // Throw a grenade toward the victim
    const dx = v.x - a.x;
    const dz = v.z - a.z;
    const yaw = Math.atan2(-dx, -dz);
    let exploded = false;
    for (let i = 0; i < 160 && !exploded; i++) {
      v.x = -4;
      v.z = 3;
      const ev = sim.step({ 0: { ...emptyInput(yaw, -0.35), grenade: i === 0 } });
      if (ev.some(e => e.type === 'explode')) exploded = true;
    }
    expect(exploded).toBe(true);
    expect(v.hp).toBeLessThan(100);
  });

  it('elimination: wiping a team ends the round and awards it', () => {
    const sim = new WarfareSim(cfg({ mode: 'elim' }));
    goLive(sim);
    const reds = sim.state.players.filter(p => p.team === 0);
    const blue = sim.state.players.find(p => p.team === 1)!;
    for (const r of reds) {
      r.protectedUntil = 0;
      sim.damage(r, blue, 500, 'hopper', false, 0, 0, 0);
    }
    // One life: dead reds stay dead
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.state.match.scores[1]).toBe(1);
    expect(sim.phase).toBe('roundEnd');
    expect(reds.every(r => !r.alive)).toBe(true);
    // Next round respawns everyone
    for (let i = 0; i < 60 * 5; i++) sim.step();
    expect(sim.state.match.round).toBe(2);
    expect(sim.state.players.every(p => p.alive)).toBe(true);
  });
});

describe('mode scoring', () => {
  it('team splat ends at the target', () => {
    const sim = new WarfareSim(cfg({ target: 3, teamSize: 4 }));
    goLive(sim);
    const a = sim.state.players[0];
    for (let k = 0; k < 3; k++) {
      const v = sim.state.players.find(p => p.team !== a.team && p.alive)!;
      v.protectedUntil = 0;
      sim.damage(v, a, 500, 'hopper', false, 0, 0, 0);
      sim.step();
    }
    expect(sim.phase).toBe('matchEnd');
    expect(sim.state.match.winner).toBe(a.team);
  });

  it('turf war: standing in a zone captures it and it scores each second', () => {
    const sim = new WarfareSim(cfg({ mode: 'turf' }));
    goLive(sim);
    const a = sim.state.players[0];
    isolate(sim, [0]);
    const zone = sim.state.zones[1];
    let captured = false;
    for (let i = 0; i < 60 * 10; i++) {
      a.x = zone.x;
      a.z = zone.z;
      a.y = 0;
      const ev = sim.step();
      if (ev.some(e => e.type === 'zone' && e.owner === a.team)) captured = true;
    }
    expect(captured).toBe(true);
    expect(zone.owner).toBe(a.team);
    expect(sim.state.match.scores[a.team as 0 | 1]).toBeGreaterThan(2);
    expect(a.stats.captures).toBe(1);
  });

  it('free-for-all: everyone is an enemy and the first to the target wins', () => {
    const sim = new WarfareSim(cfg({ mode: 'ffa', target: 2 }));
    goLive(sim);
    const a = sim.state.players[0];
    expect(sim.state.players.every(p => p.team === -1)).toBe(true);
    for (let k = 0; k < 2; k++) {
      const v = sim.state.players.find(p => p.id !== a.id && p.alive)!;
      v.protectedUntil = 0;
      sim.damage(v, a, 500, 'hopper', false, 0, 0, 0);
      sim.step();
    }
    expect(sim.phase).toBe('matchEnd');
    expect(sim.state.match.winner).toBe(100 + a.id);
  });
});

describe('bots', () => {
  for (const map of ['nouncity', 'warehouse'] as const) {
    for (const mode of ['tdm', 'turf', 'elim'] as const) {
      it(`never stay stuck: all-bot ${mode} on ${map} for 2 minutes`, () => {
        const sim = new WarfareSim({
          mode,
          map,
          teamSize: 4,
          difficulty: 2,
          seed: 4242,
          humans: [],
          target: 9999,
          timeLimit: 9999,
        });
        // Per-bot: longest stretch of wanting to move without making progress
        const lastPos = sim.state.players.map(p => ({ x: p.x, z: p.z, t: 0 }));
        let worst = 0;
        let kills = 0;
        let fired = 0;
        for (let i = 0; i < 60 * 120; i++) {
          const ev = sim.step();
          for (const e of ev) {
            if (e.type === 'kill') kills++;
            if (e.type === 'fire') fired++;
          }
          if (i % 30 !== 0) continue;
          for (const p of sim.state.players) {
            const lp = lastPos[p.id];
            if (!p.alive || Math.hypot(p.x - lp.x, p.z - lp.z) > 2) {
              lp.x = p.x;
              lp.z = p.z;
              lp.t = sim.time;
            }
            worst = Math.max(worst, sim.time - lp.t);
          }
        }
        let unsticks = 0;
        let maxStuck = 0;
        for (const b of sim.bots.values()) {
          unsticks += b.debug.unsticks;
          maxStuck = Math.max(maxStuck, b.debug.maxStuck);
        }
        // The watchdog never lets a bot strain against a wall for > 4 s
        expect(maxStuck).toBeLessThanOrEqual(4);
        // Bots fight, and nobody stays parked for long
        expect(fired).toBeGreaterThan(50);
        expect(kills).toBeGreaterThan(3);
        expect(worst).toBeLessThan(mode === 'turf' ? 40 : 25);
        expect(unsticks).toBeLessThan(30);
        // Everyone stays inside the arena
        for (const p of sim.state.players) {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
          expect(p.y).toBeGreaterThan(-1);
        }
      }, 120_000);
    }
  }

  it('bots aim with lead + gravity (ballistic pitch hits a far target)', () => {
    const v = WEAPONS.hopper.speed;
    const g = WEAPONS.hopper.gravity;
    // 40 m away, level
    const pitch = Math.atan2(v * v - Math.sqrt(v ** 4 - g * g * 1600), g * 40);
    const [dx, dy] = viewDir(0, pitch);
    expect(dy).toBeGreaterThan(0);
    expect(dx).toBeCloseTo(0, 6);
    const t = 40 / (v * Math.cos(pitch));
    expect(v * Math.sin(pitch) * t - 0.5 * g * t * t).toBeCloseTo(0, 3);
  });
});

describe('determinism', () => {
  it('same seed + same inputs → identical state', () => {
    const run = () => {
      const sim = new WarfareSim(cfg({ teamSize: 4, mode: 'turf', seed: 777 }));
      for (let i = 0; i < 60 * 25; i++) {
        const t = i * DT;
        sim.step({
          0: {
            ...emptyInput(Math.sin(t) * 2, Math.cos(t * 0.7) * 0.2),
            moveY: 1,
            moveX: Math.sin(t * 1.3),
            fire: i % 20 < 10,
            jump: i % 90 === 0,
          },
        });
      }
      return sim.hash();
    };
    expect(run()).toBe(run());
  });

  it('different seeds diverge', () => {
    const a = new WarfareSim(cfg({ seed: 1 }));
    const b = new WarfareSim(cfg({ seed: 2 }));
    for (let i = 0; i < 600; i++) {
      a.step();
      b.step();
    }
    expect(a.hash()).not.toBe(b.hash());
  });
});

describe('progression', () => {
  it('levels unlock weapons in order', () => {
    expect(levelFor(0)).toBe(1);
    expect(unlockedWeapons(0)).toEqual(['splatter', 'hopper']);
    expect(unlockedWeapons(300)).toContain('shotgun');
    expect(unlockedWeapons(5000)).toEqual([
      'splatter',
      'hopper',
      'shotgun',
      'longsplat',
      'launcher',
    ]);
  });

  it('match rep rewards splats and wins', () => {
    const sim = new WarfareSim(cfg());
    const p = sim.state.players[0];
    p.stats.kills = 5;
    const win = matchRep(p, 'tdm', true, false, true);
    const loss = matchRep(p, 'tdm', false, false, true);
    expect(win.total).toBeGreaterThan(loss.total);
    expect(loss.total).toBeGreaterThanOrEqual(75);
  });
});
