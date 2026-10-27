// Sizzle reels: the shot list. A shot is a scene to start from, a frame
// count (30 fps) and a page-side `setup(arg)` that stages the moment and
// installs `window.__sizzleFrame(i)` (advance one frame, leave it drawn).
// Setups run in the browser, so each one is self-contained. See README.md.

import { openBigDrop, openBreaks, openExchange, openWorld } from './scenes.mjs';

export const SCENES = {
  world: openWorld,
  bigdrop: openBigDrop,
  breaks: openBreaks,
  exchange: openExchange,
};

// ── Noun Breaks (scene: breaks; window.__d is the breakDev() harness) ──

async function brkScripted({ phase, n = 0, dt = 0 }) {
  let d = window.__d;
  d.hold(null);
  const t = window.__brkAt(phase, n, dt);
  if (d.t > t) {
    // The harness only runs forward: a fresh battle (same script) to go back
    d.dispose();
    d = window.__d = await window.__w2.breakDev(window.__brkOpts);
    await new Promise(r => setTimeout(r, 3000));
  }
  d.seek(t);
  window.__sizzleFrame = () => {
    d.play(1 / 30, 30);
    d.render();
  };
  window.__sizzleSkip = () => d.play(1 / 30, 30);
}

function brkMove({ move, pre = 0.4 }) {
  const d = window.__d;
  d.hold(move);
  d.play(pre);
  window.__sizzleFrame = () => {
    d.play(1 / 30, 30);
    d.render();
  };
  window.__sizzleSkip = () => d.play(1 / 30, 30);
}

const brk = (frames, setup, arg) => ({ scene: 'breaks', frames, setup, arg });

// ── The Big Drop (scene: bigdrop; window.__bd, scenes.mjs) ──

/**
 * Put the rider somewhere on the mountain and roll a camera.
 *  at:    'summit' | {s, x?} on the race line (s = peak z) | 'kicker' {minH, from}
 *         | 'loop' {n, back} | 'basin' {ds, x} | 'basinKicker' {ds}
 *  speed: m/s; pre: seconds ridden before the first frame; carve: steer
 *  amplitude (spray); cam: [mode, opts] for __bd.cam, or null for the game's.
 */
function bdShot(o) {
  const { T, B, PT, place, cam, peakOf } = window.__bd;
  const sz = window.__sz;
  const g = sz.g;
  sz.input = null;
  cam(null);
  const at = o.at;
  let x;
  let z;
  let dx;
  let dz;
  let speed = o.speed ?? 60;
  if (at === 'summit') {
    z = o.z ?? 30;
    x = T.centerX(z);
  } else if (at === 'kicker') {
    const f = T.featuresIn(o.from ?? 20000, (o.from ?? 20000) + 200000).find(
      f => f.kind === 'kicker' && T.kickerShape(f).h >= (o.minH ?? 6),
    );
    const k = T.kickerShape(f);
    z = f.s - (o.back ?? 60);
    x = T.centerX(z);
    speed = k.speed * (o.k ?? 1);
    window.__bdKick = { s: f.s, h: k.h, speed: k.speed, hang: k.hang, lip: k.lip };
  } else if (at === 'loop') {
    const f = T.featuresIn(o.from ?? 0, 1e6).filter(f => f.kind === 'loop')[o.n ?? 0];
    z = f.s - (o.back ?? 120);
    x = T.centerX(z);
    window.__bdLoop = { s: f.s, size: f.size };
  } else if (at === 'basin') {
    z = 24 + B.BASIN.start + (o.ds ?? 25000);
    x = o.x ?? 150;
    dx = Math.sin(o.yaw ?? 0);
    dz = Math.cos(o.yaw ?? 0);
  } else if (at === 'basinKicker') {
    // Rough a spot out on the basin, then line up on its biggest kicker nearby
    place(o.x ?? 150, 24 + B.BASIN.start + (o.ds ?? 25000), 60);
    const q = peakOf();
    const ks = B.basinKickersNear(q.x, q.z + 1500, 1400).filter(k => k.shape.h > (o.minH ?? 8));
    const k = ks[o.n ?? 0];
    const back = k.shape.lip + (o.back ?? 100);
    x = k.x - k.dx * back;
    z = k.z - k.dz * back;
    dx = k.dx;
    dz = k.dz;
  } else if (at === 'herd') {
    // Out on the basin, let the herds spawn round the rider, then line up
    // through the nearest herd of `kind` so it bolts as the rider comes through
    place(o.x ?? 150, 24 + B.BASIN.start + (o.ds ?? 25000), 30);
    sz.run(240);
    const life = window.__bd.ud.systems.find(y => Array.isArray(y.herds));
    const q = peakOf();
    const hs = (life?.herds ?? []).filter(h => h.kind === (o.kind ?? 'yak') && h.members.length > 0);
    hs.sort((a, b) => Math.hypot(a.x - q.x, a.z - q.z) - Math.hypot(b.x - q.x, b.z - q.z));
    const h = hs[0];
    if (h === undefined) throw new Error(`no ${o.kind ?? 'yak'} herd`);
    const yaw = o.yaw ?? 0.5;
    dx = Math.sin(yaw);
    dz = Math.cos(yaw);
    x = h.x - dx * (o.back ?? 70);
    z = h.z - dz * (o.back ?? 70);
    window.__bdHerd = { kind: h.kind, n: h.members.length };
  } else {
    z = at.s;
    x = at.x ?? T.centerX(z);
  }
  place(x, z, speed, dx, dz);
  if (o.pre) sz.run(Math.round(o.pre * 60));
  if (o.carve) {
    let t = 0;
    sz.input = () => {
      t += 1 / 60;
      return { moveX: Math.sin(t * (o.carveW ?? 2.2)) * o.carve };
    };
  }
  if (o.cam) cam(o.cam[0], o.cam[1]);
  window.__sizzleFrame = () => sz.step();
  window.__sizzleSkip = () => sz.run(2);
  void PT;
  void g;
}

const bd = (frames, arg, extra = {}) => ({ scene: 'bigdrop', frames, setup: bdShot, arg, ...extra });

// ── Noun World (scene: world; window.__sz, scenes.mjs) ──

/**
 * kind 'skate': ride from `at` ([x, z], or the spawn) heading `yaw`, pushing,
 *   popping an ollie every `jump` s with a grab in the air;
 * kind 'fountain': the Grand Exchange's way in, down through the Noggles
 *   Fountain (exchange3d/world/UnderFountain, its dev handle);
 * kind 'interior': walk up to a door of kind `door` (cafe, bar, …) and in;
 *   `inside` > 0 skips to that many seconds after the door, in the room.
 * cam: [mode, opts] for __sz.rig, or null for the game's camera.
 */
async function worldShot(o) {
  const sz = window.__sz;
  const g = sz.g;
  sz.input = null;
  sz.rig(null);
  const pl = g.player;
  if (o.kind === 'skate') {
    if (pl.mode !== 'board') sz.input = { boardTogglePressed: true };
    sz.run(4);
    if (o.at) {
      const y = g.world.raycast(new sz.V(o.at[0], 40, o.at[1]), new sz.V(0, -1, 0), 80)?.point.y ?? pl.pos.y;
      pl.pos.set(o.at[0], y + 0.1, o.at[1]);
    }
    if (o.yaw !== undefined) {
      pl.fwd.set(Math.sin(o.yaw), 0, Math.cos(o.yaw));
      pl.vel.copy(pl.fwd).multiplyScalar(o.speed ?? 8);
    }
    let t = 0;
    sz.input = () => {
      t += 1 / 60;
      const air = pl.state === 'air';
      const ph = o.jump ? t % o.jump : 1;
      return {
        push: !air && ph > 0.3,
        jumpPressed: o.jump ? ph < 1 / 60 + 1e-6 && t > 0.2 : false,
        grabL: air && (o.grab ?? true),
        moveX: o.steer ? Math.sin(t * 1.3) * o.steer : 0,
      };
    };
    sz.run(Math.round((o.pre ?? 0.5) * 60));
    g.cam.snap?.(pl);
  } else if (o.kind === 'fountain') {
    const f = window.__gxFountain;
    if (f === undefined) throw new Error('no fountain handle (plaza level only)');
    if (o.from) {
      pl.pos.set(o.from[0], pl.pos.y, o.from[1]);
      sz.run(2);
      g.cam.snap?.(pl);
    }
    f.enter();
  } else if (o.kind === 'interior') {
    const doors = g.interiors.doors().filter(d => (o.door ?? ['cafe', 'bar']).includes(d.kind));
    const d = doors[o.n ?? 0];
    if (d === undefined) throw new Error(`no door of kind ${o.door}`);
    window.__szDoor = { name: d.name, kind: d.kind };
    if (o.inside) {
      g.interiors.requestEnter(d);
      for (let i = 0; i < 60 * 8 && !g.interiors.inside; i++) sz.run(1);
      await new Promise(r => setTimeout(r, 4000));
      sz.run(Math.round(o.inside * 60));
    }
  }
  if (o.cam) sz.rig(o.cam[0], o.cam[1]);
  window.__sizzleFrame = () => sz.step();
  window.__sizzleSkip = () => sz.run(2);
}

const world = (frames, arg, extra = {}) => ({ scene: 'world', frames, setup: worldShot, arg, ...extra });

// ── The Grand Exchange (scene: exchange; window.__gx, scenes.mjs) ──

/**
 * A camera move on the trading floor. kind:
 *  'pit'     orbit pit `pit` (index) at r, el, from az0 turning w rad/s;
 *  'trade'   wait for a trade to start near the middle and orbit its meeting point;
 *  'pullout' from the floor out to VAST: r from r0 to r1 (log-eased), el and az drifting;
 *  'descent' the scene's own drop-in through the roof (to WIDE).
 */
function gxShot(o) {
  const gx = window.__gx;
  const s = gx.s;
  gx.t = 0;
  gx.orbit = null;
  if (o.warm) gx.run(o.warm);
  const ease = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  if (o.kind === 'pit') {
    // (setMode('floor') from 'floor' would step on to the next pit)
    s.mode = 'wide';
    s.pitIx = o.pit ?? 0;
    s.setMode('floor');
    const c = s.want;
    gx.orbit = t => ({ tx: c.tx, ty: o.ty ?? 1.7, tz: c.tz, r: o.r ?? 11, az: (o.az0 ?? 0.6) + (o.w ?? 0.12) * t, el: o.el ?? 0.22 });
  } else if (o.kind === 'trade') {
    // Run the floor until a fresh trade starts, then frame its meeting point
    gx.trades.length = 0;
    let pick = null;
    for (let i = 0; i < 30 * 30 && pick === null; i++) {
      s.step(1 / 30);
      pick = gx.trades.find(x => !x.a.quick && Math.hypot(x.a.meet.x, x.a.meet.z) < (o.within ?? 60)) ?? null;
    }
    const m = pick ? pick.a.meet : { x: 0, z: 0 };
    window.__gxTrade = pick ? { meet: m, good: pick.a.job.good, real: pick.a.job.real } : null;
    gx.orbit = t => ({ tx: m.x, ty: 1.5, tz: m.z, r: (o.r ?? 8) - (o.push ?? 1.5) * ease(t / 4), az: (o.az0 ?? 0.9) + (o.w ?? 0.15) * t, el: o.el ?? 0.3 });
  } else if (o.kind === 'pullout') {
    // From a pit's crowd out to VAST. The target glides from the pit to the
    // hall's centre and the camera climbs early, so it clears the hall walls
    // (no camera collision here) before the rings of halls come in.
    s.mode = 'wide';
    s.pitIx = o.pit ?? 0;
    s.setMode('floor');
    const c = { tx: s.want.tx, tz: s.want.tz };
    const T = o.secs ?? 5;
    const r0 = o.r0 ?? 12;
    const r1 = o.r1 ?? 720;
    const el0 = o.el0 ?? 0.2;
    const el1 = o.el1 ?? 0.5;
    gx.orbit = t => {
      const k = ease(t / T);
      const up = Math.sqrt(ease(t / (T * 0.55)));
      return {
        tx: c.tx * (1 - k),
        ty: 1.5 * (1 - k),
        tz: c.tz * (1 - k),
        r: Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * k),
        az: (o.az0 ?? 2.4) + (o.w ?? 0.12) * t,
        el: el0 + ((o.elMid ?? 0.8) - el0) * up - ((o.elMid ?? 0.8) - el1) * ease((t / T - 0.55) / 0.45),
      };
    };
  } else if (o.kind === 'descent') {
    s.cur = { tx: 0, ty: 0, tz: 0, r: o.r ?? 70, az: o.az0 ?? 2.5, el: 1.5 };
    s.mode = 'wide';
    s.want = { tx: 0, ty: 0, tz: 0, r: 120, az: o.az0 ?? 2.5, el: 0.62 };
    s.idle = 0;
  }
  window.__sizzleFrame = () => gx.step();
  window.__sizzleSkip = null;
}

const gx = (frames, arg) => ({ scene: 'exchange', frames, setup: gxShot, arg });

export const SHOTS = {
  'brk-intro': brk(60, brkScripted, { phase: 'intro', dt: 0.6 }),
  'brk-toprock': brk(60, brkScripted, { phase: 'turn', dt: 0.8 }),
  'brk-headspin': brk(75, brkMove, { move: 'headspin' }),
  'brk-windmill': brk(60, brkMove, { move: 'windmill' }),
  'brk-airflare': brk(50, brkMove, { move: 'airflare' }),
  'brk-sixstep': brk(50, brkMove, { move: 'six_step' }),
  'brk-freeze': brk(45, brkMove, { move: 'airchair', pre: 0.9 }),
  'brk-crowd': brk(50, brkScripted, { phase: 'between', dt: 0.4 }),
  'brk-judges': brk(70, brkScripted, { phase: 'judging', n: 1, dt: 2.2 }),
  'brk-winner': brk(50, brkScripted, { phase: 'done', dt: 1 }),

  'bd-summit': bd(75, { at: 'summit', speed: 6, cam: ['side', { side: 1.5, up: 0.8, ahead: 3.8, lead: -2, lookUp: 1.3, smooth: 4, fov: 64 }] }),
  'bd-speed': bd(75, { at: { s: 30000 }, speed: 420, carve: 0.8, cam: ['side', { side: 4, up: 0.5, lead: 1.5, lookUp: 0.6, fov: 76 }] }),
  'bd-chase': bd(75, { at: { s: 45000 }, speed: 520, carve: 0.6 }),
  'bd-kicker': bd(90, { at: 'kicker', from: 20000, minH: 8, back: 50, cam: ['side', { side: 6, up: 1.2, lead: 1.5, flat: true, fov: 60 }] }),
  'bd-basin': bd(90, { at: 'basin', ds: 25000, x: 150, speed: 55, carve: 0.5, cam: ['orbit', { r: 7, h: 1.6, a0: -1.2, w: 0.35, smooth: 0 }] }),
  'bd-basin-air': bd(90, { at: 'basinKicker', ds: 25000, minH: 8, back: 60, cam: ['side', { side: 8, up: 1.5, lead: 2, flat: true, fov: 60 }] }),
  'bd-herd': bd(90, { at: 'herd', kind: 'yak', ds: 25000, back: 60, speed: 35, cam: ['side', { side: 5, up: 1.2, ahead: -2, lead: 10, smooth: 6, fov: 64 }] }),
  // Last in its scene: the loop's ride hook keeps hold of the rider afterwards
  'bd-loop': bd(150, { at: 'loop', n: 0, back: 110, speed: 70 }, { last: true }),
  'w-skate': world(60, { kind: 'skate', jump: 1.6, pre: 0.6, cam: ['side', { side: 3.2, up: 0.6, ahead: 1.5, lead: 2, smooth: 6, fov: 62 }] }),
  'w-skate2': world(60, { kind: 'skate', jump: 1.2, pre: 1.6, steer: 0.4, cam: ['orbit', { r: 5, h: 1.2, a0: 2.4, w: 0.6 }] }),
  'w-cafe': world(60, { kind: 'interior', door: ['cafe', 'bar'], inside: 0.6, cam: ['orbit', { r: 4.5, h: 1.7, a0: 0.4, w: 0.25, lookUp: 1.2 }] }),
  // Last in its scene: the world pauses under the fountain afterwards
  'w-fountain': world(84, { kind: 'fountain' }, { last: true }),
  'gx-shout': gx(75, { kind: 'pit', pit: 0, r: 10, el: 0.2, az0: 0.5, w: 0.14, warm: 2 }),
  'gx-shout2': gx(60, { kind: 'pit', pit: 3, r: 9, el: 0.16, az0: 2.2, w: -0.16 }),
  'gx-trade': gx(120, { kind: 'trade', r: 11, push: 2.5, el: 0.55, w: 0.16 }),
  'gx-pullout': gx(165, { kind: 'pullout', pit: 0, secs: 5.2, r0: 12, r1: 760, el0: 0.25, elMid: 0.85, el1: 0.5 }),
  'gx-descent': gx(60, { kind: 'descent' }),
};
