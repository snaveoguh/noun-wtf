// Sizzle reels: the shot list. A shot is a scene to start from, a frame
// count (30 fps) and a page-side `setup(arg)` that stages the moment and
// installs `window.__sizzleFrame(i)` (advance one frame, leave it drawn).
// Setups run in the browser, so each one is self-contained. See README.md.

import {
  openBigDrop,
  openBreaks,
  openCamp,
  openExchange,
  openMissingnoun,
  openParkour,
  openPool,
  openWarfare,
  openWorld,
} from './scenes.mjs';

export const SCENES = {
  world: openWorld,
  bigdrop: openBigDrop,
  breaks: openBreaks,
  exchange: openExchange,
  pool: openPool,
  parkour: openParkour,
  warfare: openWarfare,
  camp: openCamp,
  missingnoun: openMissingnoun,
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

// ── Noun Pool (scene: pool; window.__pl, scenes.mjs) ──

/**
 * The tables the pool shots start from (sim frame: x along the length, y
 * across, metres from the middle), found offline with the pool sim so
 * every shot does what it says. They run as one frame: the break (rack
 * seed 56) drops six, then 10 straight into the corner, then a 35° cut on
 * the 15, and a staged finish: stripes gone, the 8 cut into the corner.
 */
const POOL = {
  // newFrame(56, 0): staged in the page (the rack comes from the seed)
  break: { rack: 56, cue: { x: -0.61525, y: 0.15 }, aim: { dx: 0.9905204433671789, dy: -0.13736539328261504 }, power: 1, top: -0.15 },
  pot: {
    state: {"balls":[{"x":-0.61201,"y":-0.25234},null,null,null,{"x":0.51639,"y":0.06061},{"x":0.93613,"y":0.32974},null,{"x":0.43596,"y":-0.17023},{"x":0.62115,"y":-0.03114},{"x":-0.67962,"y":-0.05834},{"x":0.47669,"y":-0.42782},{"x":0.86754,"y":-0.03118},null,null,{"x":-0.91614,"y":0.41374},{"x":0.67256,"y":-0.27515}],"phase":"play","turn":0,"groups":[null,null],"inHand":null,"shots":1,"fouls":[0,0],"last":null,"winner":null},
    aim: { dx: 0.9864370285002273, dy: -0.16414014988308553 }, power: 0.24081746433266488, top: 0.2,
  },
  cut: {
    state: {"balls":[{"x":-0.29,"y":-0.266},null,null,null,{"x":0.51639,"y":0.06061},{"x":0.93613,"y":0.32974},null,{"x":0.43596,"y":-0.17023},{"x":0.62115,"y":-0.03114},{"x":-0.67962,"y":-0.05834},null,{"x":0.86754,"y":-0.03118},null,null,{"x":-0.91614,"y":0.41374},{"x":0.67256,"y":-0.27515}],"phase":"play","turn":0,"groups":["stripes","solids"],"inHand":null,"shots":2,"fouls":[0,0],"last":null,"winner":null},
    aim: { dx: 0.9997072875837084, dy: 0.024193783334245392 }, power: 0.2665011470313027, top: 0,
  },
  eight: {
    state: {"balls":[{"x":-0.54,"y":0.084},null,null,null,{"x":0.3,"y":-0.25},{"x":0.78,"y":-0.32},null,{"x":-0.5,"y":0.3},{"x":0.62,"y":0.2},null,null,null,null,null,null,null],"phase":"play","turn":0,"groups":["stripes","solids"],"inHand":null,"shots":5,"fouls":[0,0],"last":null,"winner":null},
    aim: { dx: 0.9973733086364289, dy: 0.07243261157532943 }, power: 0.22364133917596424, top: 0, call: 3,
  },
};

/**
 * A pool shot. `table`: one of POOL (null: the menu's racked table);
 * `shootAt`: seconds into the shot the cue goes through (null: never);
 * cam: null = the game's own cameras (`gameCam` to start in: aim / top /
 * orbit), else {eye, look, fov} in the table frame (y = height over the
 * floor; the cloth is at __pl.feltY ≈ 0.87), eased to {eye1, look1} over
 * T s when given, or {orbit: {r, h, a0, w}} round the table.
 * Expects (checked on the first frame): `pots` (ball ids that must drop).
 */
async function plShot(o) {
  const pl = window.__pl;
  const sz = window.__sz;
  const pool = pl.pool;
  pl.cam = null;
  if (o.table === null) {
    pool.session = null;
    pl.view.setCam('orbit');
    pl.view.setPlayers(pl.seeds);
  } else {
    const d = o.table;
    let state = d.state;
    if (d.rack !== undefined) {
      const R = await import('/src/miniapps/world2/pool/sim/rules.ts');
      state = R.newFrame(d.rack, 0);
    }
    pl.stage(state, { ...d, gameCam: o.gameCam });
  }
  // Warm: let the Nouns walk to their spots / the cue settle
  sz.run(Math.round((o.warm ?? 1.2) * 60));
  pl.t = 0;
  const ease = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const lerp = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const c = o.cam;
  if (c?.orbit) {
    const q = c.orbit;
    pl.cam = t => {
      const a = (q.a0 ?? 0) + (q.w ?? 0.1) * t;
      return { eye: [Math.cos(a) * q.r, q.h, Math.sin(a) * q.r * (q.squash ?? 0.8)], look: c.look ?? [0, 0.75, 0], fov: c.fov };
    };
  } else if (c) {
    pl.cam = t => {
      const k = c.T ? ease(t / c.T) : 0;
      return { eye: c.eye1 ? lerp(c.eye, c.eye1, k) : c.eye, look: c.look1 ? lerp(c.look, c.look1, k) : c.look, fov: c.fov };
    };
  }
  const at = o.shootAt === undefined || o.shootAt === null ? -1 : Math.round(o.shootAt * 30);
  window.__plEvents = [];
  window.__sizzleFrame = i => {
    if (i === at) pl.shoot();
    sz.step();
    const s = pool.session;
    if (s?.state?.last && i >= at && at >= 0) window.__plLast = { last: s.state.last, winner: s.state.winner, reason: s.state.reason };
  };
  window.__sizzleSkip = i => {
    if (i === at) pl.shoot();
    sz.run(2);
  };
}

const pool = (frames, arg, extra = {}) => ({ scene: 'pool', frames, setup: plShot, arg, ...extra });

// ── NOUN PARKOUR (scene: parkour; window.__pk, scenes.mjs) ──

/**
 * Scripted runs of the three routes (pilot phases, see installParkour),
 * each worked out against the real collision and the real engine: every
 * move in them is the engine's own, started by the inputs a player would
 * give. THE GAUNTLET's second gate sits above a wall run on wall B, so its
 * clock is staged past it (`gate`); all three run clean to the finish
 * (≈18.4 s, ≈18.1 s and ≈17.0 s).
 */
const STEP = 1 / 60;
const PK_RUNS = {
  gauntlet: [
    { dir: [1, 0], sprint: true, until: 'p.pos.x > 18.4' },
    { dir: [1, 0], sprint: true, jump: true, dur: STEP },
    { dir: [1, 0], sprint: true, until: 'p.pos.x > 22.6' },
    // Wall jump across, run wall B
    { dir: [1, 0.5], sprint: true, jump: true, dur: STEP },
    { dir: [1, 0.6], sprint: true, until: "a === 'wallrun' && t > 0.1" },
    { dir: [1, 0], sprint: true, until: "a !== 'wallrun'" },
    { dir: [1, 0], sprint: true, until: 'p.footGrounded && t > 0.1', gate: 2 },
    // The tower: climb it hand over hand, mantle on top
    { to: [40, 21.5], sprint: true, until: 'p.pos.x > 36.2' },
    { to: [40, 21.5], sprint: true, jump: true, dur: STEP },
    { to: [40, 21.5], sprint: true, hold: true, until: "p.pos.y > 3.3 && p.footGrounded && a === 'none'" },
    // Post to post (standing precision jumps), then the pole
    { to: [40, 23.0], move: 0.5, until: 'p.pos.z > 22.9' },
    { dur: 0.4 },
    { dir: [0, 1], jump: true, dur: STEP },
    { until: 'p.footGrounded && t > 0.2' },
    { dur: 0.5 },
    { dir: [0, 1], jump: true, dur: STEP },
    { until: 'p.footGrounded && t > 0.2' },
    { dur: 0.5 },
    { dir: [0, 1], jump: true, dur: STEP },
    { until: "a === 'pole'" },
    { until: "a !== 'pole'" },
    // Slide under the bar, vault the wall, through the finish
    { to: [40, 44], sprint: true, until: 'p.pos.z > 42.3' },
    { to: [40, 50], sprint: true, duckPress: true, duck: true, dur: 0.3 },
    { to: [40, 52], sprint: true, dur: 3 },
  ],
  north: [
    // At the 6.8 m block: run up the wall, leap up the two sills, pull up
    { dir: [0, -1], sprint: true, until: 'p.pos.z < -73.8' },
    { dir: [0, -1], sprint: true, jump: true, dur: STEP },
    { dir: [0, -1], sprint: true, until: "a === 'hang' && t > 0.3" },
    { stick: [0, 0], dur: 0.3 },
    { stick: [0, 1], jump: true, dur: STEP },
    { stick: [0, 0], until: "a === 'hang' && t > 0.3" },
    { stick: [0, 0], dur: 0.3 },
    { stick: [0, 1], jump: true, dur: STEP },
    { stick: [0, 0], until: "a === 'hang' && t > 0.3" },
    { stick: [0, 0], dur: 0.3 },
    { stick: [0, 1], until: "a !== 'hang' && a !== 'pullup' && t > 0.3" },
    // Up the step
    { to: [-24, -77.4], move: 0.6, until: 'Math.abs(p.pos.z + 77.4) < 0.3 || t > 1.2' },
    { dir: [-1, 0], sprint: true, until: 'p.pos.x < -24.5' },
    { dir: [-1, 0], sprint: true, jump: true, dur: STEP },
    { dir: [-1, 0], sprint: true, until: "a === 'hang' || (p.pos.y > 10 && p.footGrounded && t > 0.3)" },
    { stick: [0, 1], until: "p.pos.y > 10 && p.footGrounded && a === 'none' && t > 0.3" },
    // Over the alley onto the sill, leap up to the roof
    { dir: [-1, 0], sprint: true, until: 'p.pos.x < -35.6' },
    { dir: [-1, 0], sprint: true, jump: true, dur: STEP },
    { dir: [-1, 0], sprint: true, until: "a === 'hang'" },
    { stick: [0, 0], dur: 0.3 },
    { stick: [0, 1], jump: true, dur: STEP },
    { stick: [0, 1], until: "p.footGrounded && a === 'none' && t > 0.3" },
    // Over the parapet onto the pole, down to the street
    { to: [-46, -77.4], until: 'Math.hypot(p.pos.x + 46, p.pos.z + 77.4) < 0.8' },
    { to: [-50, -78], until: 'Math.hypot(p.pos.x + 50, p.pos.z + 78) < 0.4' },
    { dir: [0, 1], move: 0.3, dur: 0.3 },
    { dir: [0, 1], sprint: true, until: "a === 'pole' || (t > 0.3 && !p.footGrounded && p.pos.y < 12)" },
    { until: "a === 'pole'", dur: 1 },
    { until: "a !== 'pole' && t > 0.2" },
    { dir: [0, 1], dur: 1.5 },
  ],
  lamps: [
    // Vault the wall, jump on the lamp, climb it
    { dir: [0, -1], sprint: true, until: 'p.pos.z < 17.3' },
    { dir: [0, -1], sprint: true, jump: true, dur: STEP },
    { dir: [0, -1], until: "a === 'pole'" },
    { stick: [0, 1], until: 'p.pos.y > 5.0' },
    // Swing round to the far side, launch at the next pole (×4)
    { stick: [0.9, 0.6], until: 'p.pos.z < 14.75 && Math.abs(p.pos.x - 15) < 0.3', dur: 2.5 },
    { dir: [0, -1], jump: true, dur: STEP },
    ...[7.5, 0, -7.5, -15].flatMap(z => [
      { dir: [0, -1], until: "a === 'pole' && t > 0.1" },
      { stick: [0, 1], dur: 0.7 },
      { stick: [0.9, 0.6], until: `p.pos.z < ${z} - 0.25 && Math.abs(p.pos.x - 15) < 0.3`, dur: 2.5 },
      { dir: [0, -1], jump: true, dur: STEP },
    ]),
    // Off the big mast: roll the landing
    { dir: [0, -1], duck: true, until: 'p.footGrounded && t > 0.2' },
    { dir: [0, -1], dur: 1.5 },
  ],
};

/**
 * A parkour shot: start `route` (gates + course props), run its scripted
 * run silently for `from` s, then roll. `ghost`: first run the route once
 * through to set a best (its ghost), then start `ghost` s behind it, so the
 * ghost leads; otherwise any saved best is cleared (no ghost).
 * cam: [mode, opts] for __sz.rig, or null for the game's own camera.
 */
function pkShot(o) {
  const k = window.__pk;
  const sz = window.__sz;
  sz.input = null;
  sz.rig(null);
  const key = `noun-parkour-v1:${o.route}`;
  localStorage.removeItem(key);
  if (o.ghost !== undefined) {
    k.route(o.route);
    k.pilot(o.run);
    for (let i = 0; i < 60 * 40 && k.course.view.phase === 'running'; i++) sz.run(1);
    if (localStorage.getItem(key) === null) throw new Error(`${o.route}: the ghost run didn't finish`);
  }
  k.route(o.route);
  k.pilot(o.ghost !== undefined ? [{ dur: o.ghost }, ...o.run] : o.run);
  sz.run(Math.round(o.from * 60));
  if (o.cam) sz.rig(o.cam[0], o.cam[1]);
  window.__sizzleFrame = () => sz.step();
  window.__sizzleSkip = () => sz.run(2);
}

const pk = (frames, route, arg, extra = {}) => ({
  scene: 'parkour',
  frames,
  setup: pkShot,
  arg: { route, run: PK_RUNS[route], ...arg },
  ...extra,
});

// ── NOUNS CAMP (scene: camp; window.__camp, scenes.mjs) ──

/**
 * A CAMP shot. `intro`: the game's own opening shot from a plain load (the
 * fly-in over the plaza, in through the window, into the rider's eyes on
 * MEME VALUE, the flick through five spreads, the pull-out and the toss),
 * seeded so it's the same every render. `jump`: run at the window, leap
 * out and fall the 146 m to the plaza, rolling the landing, with a camera
 * that looks in through the window and then drops with the rider.
 * `portraitK` widens the lens in a vertical frame (scenes.mjs `fovK`).
 */
function campShot(o) {
  const sz = window.__sz;
  const g = sz.g;
  const C = window.__camp;
  const s = C.site;
  sz.input = null;
  sz.rig(null);
  sz.fovK = innerHeight > innerWidth ? (o.portraitK ?? 1.4) : 1;
  if (o.kind === 'intro') {
    if (!C.intro(o.seed ?? 1)) throw new Error('no CAMP to wake up in');
  } else if (o.kind === 'jump') {
    C.place(o.x ?? 0, o.z ?? 4, Math.PI);
    const face = s.faceZ;
    window.__pk.pilot([
      { dir: [0, -1], move: 0.5, dur: o.walk ?? 0.4 },
      { dir: [0, -1], sprint: true, until: `p.pos.z < ${face - 1.0}` },
      { dir: [0, -1], sprint: true, jump: true, dur: 1 / 60 },
      { dir: [0, -1], until: 'p.pos.y < 8' },
      // A timed duck rolls the landing (parkour's hard landing)
      { dir: [0, -1], duck: true, until: 'p.footGrounded && t > 0.2' },
      { dur: 3 },
    ]);
    const V = sz.V;
    const pl = g.player;
    // In through the window at the rider, then dropping with them
    const inEye = new V(s.origin.x + (o.inSide ?? 1.4), s.floorY + 1.75, face - (o.inBack ?? 5.5));
    const eye = new V();
    const want = new V();
    const look = new V();
    let k = 0;
    let first = true;
    sz.cam = (cam, dt) => {
      const out = pl.pos.z < face - 0.3;
      k = out ? Math.min(1, k + dt / 0.9) : 0;
      const e = k * k * (3 - 2 * k);
      const [ox, oy, oz] = o.follow ?? [3.6, 2.6, -6.5];
      want.set(pl.pos.x + ox, pl.pos.y + oy, pl.pos.z + oz);
      // Down at the street it stops dropping (and keeps its distance)
      want.y = Math.max(want.y, o.floor ?? 2.4);
      want.lerp(inEye, 1 - e);
      if (first) eye.copy(want);
      else eye.lerp(want, 1 - Math.exp(-(o.smooth ?? 8) * dt));
      first = false;
      // Looking a little below them as they fall (the street coming up)
      const fall = Math.min(1, Math.max(0, (-pl.vel.y - 4) / 30));
      look.copy(pl.pos);
      look.y += 0.9 - (o.lookDown ?? 1.6) * fall * e;
      cam.position.copy(eye);
      cam.lookAt(look);
      if (cam.fov !== (o.fov ?? 60)) {
        cam.fov = o.fov ?? 60;
        cam.updateProjectionMatrix();
      }
    };
  }
  window.__sizzleFrame = () => sz.step();
  window.__sizzleSkip = () => sz.run(2);
}

const camp = (frames, arg, extra = {}) => ({ scene: 'camp', frames, setup: campShot, arg, ...extra });

// ── Missingnoun (scene: missingnoun; the plaza, `?seed=…-m`) ──

/**
 * Skating the plaza on a missingnoun (only its glitching head and noggles
 * ride): board on at (x, z) heading `yaw`, pushing, a flip trick every
 * `every` s from `tricks`, carving with `steer`, under a __sz.rig camera.
 */
function mnShot(o) {
  const sz = window.__sz;
  const g = sz.g;
  const pl = g.player;
  sz.input = null;
  sz.rig(null);
  sz.fovK = innerHeight > innerWidth ? (o.portraitK ?? 1.35) : 1;
  if (pl.mode !== 'board') sz.input = { boardTogglePressed: true };
  sz.run(4);
  sz.input = null;
  const V = sz.V;
  const y = g.world.raycast(new V(o.at[0], 40, o.at[1]), new V(0, -1, 0), 80)?.point.y ?? 0;
  pl.spawn(new V(o.at[0], y + 0.1, o.at[1]), o.yaw);
  if (pl.mode !== 'board') pl.toggleBoard();
  pl.fwd.set(Math.sin(o.yaw), 0, Math.cos(o.yaw));
  pl.vel.copy(pl.fwd).multiplyScalar(o.speed ?? 8);
  let t = 0;
  let k = 0;
  let next = o.first ?? 0.6;
  sz.input = () => {
    t += 1 / 60;
    const air = pl.state === 'air';
    let tricks = [];
    if (o.every && t >= next && !air) {
      tricks = [o.tricks[k++ % o.tricks.length]];
      next = t + o.every;
    }
    return {
      push: !air && (o.push ?? true),
      tricks,
      grabL: false,
      moveX: o.steer ? Math.sin(t * (o.steerW ?? 1.1)) * o.steer : 0,
      moveY: 0,
    };
  };
  sz.run(Math.round((o.pre ?? 0.5) * 60));
  g.cam.snap?.(pl);
  if (o.cam) sz.rig(o.cam[0], o.cam[1]);
  window.__sizzleFrame = () => sz.step();
  window.__sizzleSkip = () => sz.run(2);
}

const mn = (frames, arg, extra = {}) => ({ scene: 'missingnoun', frames, setup: mnShot, arg, ...extra });

// ── Noun Warfare (scene: warfare; window.__wf, scenes.mjs) ──

/**
 * A slice of a bots-only Team Splat (the local player played by a bot
 * brain too): `seed` picks the match, `at` s of it run silently first,
 * then `speed` × real time (0.5: half-speed slow motion), in third person
 * (`tp`, the game's over-the-shoulder camera) or first person.
 */
function wfShot(o) {
  const wf = window.__wf;
  wf.match(o.seed ?? 7);
  wf.run(o.at ?? 8);
  window.__sizzleFrame = () => wf.frame(o.speed ?? 0.5, o.tp ?? false);
  window.__sizzleSkip = window.__sizzleFrame;
}

const wf = (frames, arg) => ({ scene: 'warfare', frames, setup: wfShot, arg });

export const SHOTS = {
  // Moments the local player splats someone (found by scanning the matches' kill events)
  'wf-tp-kill': wf(90, { seed: 13, at: 3.6, speed: 0.5, tp: true }),
  'wf-fp-double': wf(90, { seed: 13, at: 6.3, speed: 0.5, tp: false }),
  'wf-tp-head': wf(80, { seed: 7, at: 34.1, speed: 0.5, tp: true }),
  'wf-fp-head': wf(90, { seed: 21, at: 45.7, speed: 0.5, tp: false }),
  'wf-tp-slow': wf(80, { seed: 13, at: 11.6, speed: 0.33, tp: true }),

  'pk-facade': pk(120, 'north', { from: 0.6, cam: ['fixed', { at: [-17.2, 1.6, -71.6] }] }),
  'pk-wallrun': pk(100, 'gauntlet', { from: 0.45, cam: null }),
  'pk-climb': pk(90, 'gauntlet', { from: 4.25, cam: ['fixed', { at: [34.5, 2.2, 17.5] }] }),
  'pk-posts': pk(150, 'gauntlet', { from: 10.5, cam: ['fixed', { at: [45, 4.5, 27] }] }),
  'pk-slide': pk(90, 'gauntlet', { from: 16.4, cam: ['fixed', { at: [44, 1.2, 46] }] }),
  'pk-gap': pk(140, 'north', { from: 8.4, cam: ['fixed', { at: [-38.8, 11.4, -71.5] }] }),
  'pk-pole': pk(150, 'north', { from: 13.0, cam: ['fixed', { at: [-55.5, 4.5, -65.5] }] }),
  'pk-lamps': pk(180, 'lamps', { from: 5.6, cam: ['fixed', { at: [24, 4.5, 4] }] }),
  'pk-roll': pk(105, 'lamps', { from: 15.0, cam: ['fixed', { at: [20.5, 1.4, -27] }] }),
  'pk-ghost': pk(120, 'lamps', { from: 7.1, ghost: 0.5, cam: ['side', { side: -6, up: 1.5, lead: 1, flat: true, smooth: 3, fov: 60 }] }),

  'pl-hall': pool(75, { table: null, cam: { orbit: { r: 3.2, h: 2.0, a0: 1.2, w: 0.16 }, look: [0, 0.8, 0], fov: 52 } }),
  'pl-break': pool(80, { table: POOL.break, shootAt: 0.5, cam: { eye: [1.28, 1.0, 0.42], look: [0.0, 0.87, -0.04], eye1: [1.2, 1.1, 0.36], T: 2.6, fov: 42 } }),
  'pl-break-high': pool(90, { table: POOL.break, shootAt: 0.15, cam: { eye: [-0.2, 2.35, 1.5], look: [0.35, 0.82, 0], eye1: [0.3, 2.45, 1.35], T: 3, fov: 50 } }),
  'pl-pot': pool(75, { table: POOL.pot, shootAt: 0.5, cam: { eye: [-0.35, 1.55, -1.3], look: [0.55, 0.87, -0.3], eye1: [-0.1, 1.45, -1.2], look1: [0.75, 0.87, -0.35], T: 2.5, fov: 46 } }),
  'pl-pot-aim': pool(75, { table: POOL.pot, shootAt: 0.7, cam: null, gameCam: 'aim' }),
  'pl-pot-top': pool(75, { table: POOL.pot, shootAt: 0.3, cam: null, gameCam: 'top' }),
  'pl-cut': pool(70, { table: POOL.cut, shootAt: 0.3, cam: { eye: [1.3, 0.98, -0.78], look: [0.25, 0.84, -0.22], fov: 44 } }),
  'pl-eight': pool(120, { table: POOL.eight, shootAt: 0.6, cam: { eye: [1.85, 1.4, 1.15], look: [-0.3, 0.95, 0.1], eye1: [1.6, 1.3, 1.0], look1: [-0.5, 1.0, 0.1], T: 4, fov: 46 } }),

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

  // NOUNS CAMP: the opening shot (7.5 s fly-in + 7.3 s of MEME VALUE), whole
  'camp-intro': camp(450, { kind: 'intro', seed: 3 }, { settle: 8000 }),
  // Out of the window and 146 m down to the plaza (~1 s run, ~5.3 s fall, the roll)
  'camp-jump': camp(270, { kind: 'jump', z: 4 }),

  // A missingnoun rider skating the plaza, flip tricks
  'mn-side': mn(150, { at: [20, -20], yaw: 0, tricks: ['kickflip', 'treflip', 'heelflip'], every: 1.5, first: 0.9, cam: ['side', { side: 3.4, up: 0.7, ahead: 1.2, lead: 2, smooth: 6, fov: 60 }] }),
  'mn-orbit': mn(120, { at: [-20, 20], yaw: Math.PI / 2, tricks: ['hardflip', 'shuvit', 'kickflip'], every: 1.4, first: 0.8, pre: 0.8, cam: ['orbit', { r: 4.5, h: 1.3, a0: 0.6, w: 0.55 }] }),
  'mn-chase': mn(120, { at: [20, -20], yaw: 0, tricks: ['treflip', 'kickflip'], every: 1.6, first: 0.5, pre: 1.2, steer: 0.35, cam: null }),
};
