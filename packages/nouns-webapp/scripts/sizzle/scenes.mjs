// Sizzle reels: the scenes a shot starts from. Each opener takes a fresh
// page to a state shots can work in, and installs `window.__sz` helpers.
// Dev builds only: they use the dev handles (window.__w2, __gx3d,
// __gxFountain, __w2.breakDev()).

import { cleanFrame } from './lib.mjs';

const WORLD_Q = process.env.SIZZLE_Q ?? 'medium';

/**
 * Noun World, offline, intros skipped, the loop stopped. `__sz.step()`
 * advances one 1/30 s frame as two 1/60 physics steps, rendering the second.
 * `__sz.cam` (a function of (camera, dt)) overrides the camera after the
 * game has placed it; `__sz.input` overrides the controls.
 */
export async function openWorld(p, base, extra = '') {
  await p.goto(`${base}/world?offline=1&skip=1&q=${WORLD_Q}&bday=0${extra}`, {
    timeout: 1_200_000,
    waitUntil: 'commit',
  });
  await pressStart(p);
  await p.evaluate(installWorld);
  await p.keyboard.press('h').catch(() => {});
  await cleanFrame(p);
}

/** Click PRESS START (in the page: Playwright's own click can stall on a busy page) and wait for the rider. */
export async function pressStart(p) {
  const btn = () => {
    const has = b => /PRESS START/.test(b.textContent ?? '');
    const bs = [...document.querySelectorAll('button, [role=button]')].filter(has);
    if (bs.length > 0) return bs[bs.length - 1];
    // The innermost element carrying the text
    return [...document.querySelectorAll('div, span, a')].filter(has).pop();
  };
  await p.waitForFunction(btn, null, { timeout: 1_500_000, polling: 3000 });
  await p.waitForFunction(
    btn => {
      const b = new Function(`return (${btn})()`)();
      b?.click();
      return window.__w2 && window.__w2.me;
    },
    btn.toString(),
    { timeout: 900_000, polling: 5000 },
  );
}

/** Runs in the page. */
export function installWorld() {
  const g = window.__w2;
  g.running = false;
  for (let i = 0; i < 30; i++) g.step(1 / 30);
  const realRender = g.gfx.render.bind(g.gfx);
  const ip = g.input;
  if (!ip.__szPoll) {
    ip.__szPoll = ip.poll.bind(ip);
    ip.poll = n => {
      const s = ip.__szPoll(n);
      const o = window.__sz.input;
      if (o) Object.assign(s, typeof o === 'function' ? o(s) : o);
      return s;
    };
  }
  const sz = {
    g,
    V: g.player.pos.constructor,
    input: null,
    cam: null,
    t: 0,
    /** Silent physics steps (no render). */
    run(n, dt = 1 / 60) {
      g.gfx.render = () => {};
      for (let i = 0; i < n; i++) g.step(dt);
      g.gfx.render = realRender;
    },
    /** One 30 fps frame. */
    step() {
      sz.run(1);
      g.step(1 / 60);
      sz.t += 1 / 30;
    },
    realRender,
  };
  window.__sz = sz;
  const V = sz.V;
  const cam0 = () => g.gfx.camera;
  sz.fov0 = cam0().fov;
  sz.toFixed = (v, out) => out.copy(v);
  sz.fromFixed = (v, out) => out.copy(v);
  /**
   * Camera rigs round the rider (sz.cam); null hands back to the game's.
   *  side:  {side, up, ahead, lead}  m to the right / above / ahead of the
   *         rider along its velocity, looking `lead` m ahead of it.
   *  fixed: {at:[x,y,z] (sz.toFixed coords) | else here + side/ahead/up} looking at the rider.
   *  orbit: {r, h, a0, w}  round the rider, angle a0 + w·t (rad, rad/s).
   * `smooth` (1/s) eases the eye; `fov` sets the lens.
   */
  const eye = new V();
  const look = new V();
  const tmp = new V();
  const side = new V();
  const fwd = new V();
  sz.rig = (mode, o = {}) => {
    if (mode === null) {
      sz.cam = null;
      return;
    }
    let t = 0;
    let first = true;
    const fixedAt = o.at ? new V(...o.at) : null;
    if (o.fov === undefined && sz.fov0 !== undefined && cam0().fov !== sz.fov0) {
      cam0().fov = sz.fov0;
      cam0().updateProjectionMatrix();
    }
    sz.cam = (cam, dt) => {
      t += dt;
      const pl = o.target?.() ?? g.player;
      fwd.copy(pl.vel);
      if (o.flat) fwd.y = 0;
      if (fwd.lengthSq() < 1e-4) fwd.copy(pl.fwd);
      fwd.normalize();
      side.set(-fwd.z, 0, fwd.x).normalize();
      if (mode === 'side') {
        tmp.copy(pl.pos)
          .addScaledVector(side, o.side ?? 6)
          .addScaledVector(fwd, o.ahead ?? 0);
        tmp.y += o.up ?? 1.5;
        look.copy(pl.pos).addScaledVector(fwd, o.lead ?? 4);
        look.y += o.lookUp ?? 0.8;
      } else if (mode === 'fixed') {
        if (fixedAt === null && first) {
          // 'here': fixed in the world where the rider is now, plus an offset
          tmp.copy(pl.pos)
            .addScaledVector(side, o.side ?? 0)
            .addScaledVector(fwd, o.ahead ?? 0);
          tmp.y += o.up ?? 0;
          sz.toFixed(tmp, fixedAtHere);
        }
        sz.fromFixed(fixedAt ?? fixedAtHere, tmp);
        look.copy(pl.pos);
        look.y += o.lookUp ?? 0.8;
      } else if (mode === 'orbit') {
        const a = (o.a0 ?? 0) + (o.w ?? 0.4) * t;
        const r = o.r ?? 6;
        tmp.copy(pl.pos)
          .addScaledVector(side, Math.cos(a) * r)
          .addScaledVector(fwd, Math.sin(a) * r);
        tmp.y += o.h ?? 1.5;
        look.copy(pl.pos);
        look.y += o.lookUp ?? 0.8;
      }
      if (first || !o.smooth) eye.copy(tmp);
      else eye.lerp(tmp, 1 - Math.exp(-o.smooth * dt));
      first = false;
      cam.position.copy(eye);
      cam.lookAt(look);
      if (o.fov && cam.fov !== o.fov) {
        cam.fov = o.fov;
        cam.updateProjectionMatrix();
      }
    };
  };
  const fixedAtHere = new V();
  // The game calls camHook just before it renders; chain to whatever else is hooked
  g.camHook = (cam, dt) => sz.cam?.(cam, dt);
}

/** Noun World, then onto the Big Drop, with `__bd` helpers (peak coordinates). */
export async function openBigDrop(p, base) {
  await openWorld(p, base);
  await p.evaluate(installBigDrop);
}

/** Runs in the page. */
export async function installBigDrop() {
  const sz = window.__sz;
  const g = sz.g;
  if (!g.missions.ud.active) g.missions.enterUpsideDown(false);
  sz.run(300);
  const T = await import('/src/miniapps/world2/missions/bigdrop/track.ts');
  const PT = await import('/src/miniapps/world2/missions/peakTerrain.ts');
  const B = await import('/src/miniapps/world2/missions/bigdrop/terrainBasin.ts');
  const ud = g.missions.ud;
  const ALT = 20000;
  const peakOf = () => {
    const o = ud.origin;
    const q = g.player.pos;
    return { x: q.x + o.x, y: q.y + o.y - ALT, z: q.z + o.z };
  };
  const toLocal = (x, y, z, out = new sz.V()) => {
    const o = ud.origin;
    return out.set(x - o.x, y - o.y + ALT, z - o.z);
  };
  /** Put the rider on the snow at peak (x, z), riding (dx, dz) (default: down the line). */
  const place = (x, z, speed, dx, dz) => {
    const pl = g.player;
    if (dx === undefined) {
      const ddx = (T.centerX(z + 1) - T.centerX(z - 1)) / 2;
      const l = Math.hypot(ddx, 1);
      dx = ddx / l;
      dz = 1 / l;
    }
    const o = ud.origin;
    const h = PT.peakHeight(x, z);
    const dh = (PT.peakHeight(x + dx, z + dz) - PT.peakHeight(x - dx, z - dz)) / 2;
    const ll = Math.hypot(1, dh);
    pl.pos.set(x - o.x, h - o.y + ALT, z - o.z);
    pl.vel.set((dx / ll) * speed, (dh / ll) * speed, (dz / ll) * speed);
    pl.fwd.set(dx / ll, dh / ll, dz / ll);
    const n = PT.peakNormal(x, z, { x: 0, y: 0, z: 0 });
    pl.up.set(n.x, n.y, n.z);
    pl.state = 'ground';
    pl.run = 1e5;
    pl.runTime = 0;
    sz.run(3);
    g.cam.snap(pl);
  };
  // Fixed cameras live in peak coordinates: the floating origin moves under them
  sz.toFixed = (v, out) => out.set(v.x + ud.origin.x, v.y + ud.origin.y - ALT, v.z + ud.origin.z);
  sz.fromFixed = (v, out) => toLocal(v.x, v.y, v.z, out);
  window.__bd = { T, PT, B, ud, ALT, peakOf, toLocal, place, cam: sz.rig };
}

/**
 * Noun Pool's hall (`/world?play=pool`), the menu open, the loop stopped
 * (`__sz`), with `__pl` helpers: `stage(state, aim)` starts a frame (you vs
 * the CPU) from a given table, `shoot()` plays the lined-up shot, and
 * `__pl.cam` (a function of (t, local)) puts the camera anywhere in the
 * table's frame (x along the length, y up, z across; the cloth at feltY).
 */
export async function openPool(p, base) {
  await openWorld(p, base, '&play=pool');
  await p.waitForFunction(() => window.__w2.pool.ui.phase === 'menu' && window.__w2.pool.view !== null, null, {
    timeout: 300_000,
    polling: 1000,
  });
  await p.evaluate(installPool);
  // The players' Nouns load their heads
  await p.waitForTimeout(8000);
  await cleanFrame(p);
}

/** Runs in the page. */
export async function installPool() {
  const sz = window.__sz;
  const g = sz.g;
  const pool = g.pool;
  const view = pool.view;
  const { quantize } = await import('/src/miniapps/world2/pool/net/codec.ts');
  const V = sz.V;
  const eye = new V();
  const look = new V();
  const pl = {
    pool,
    view,
    quantize,
    t: 0,
    cam: null,
    /** The cloth's height in the table frame. */
    feltY: view.feltY,
    /** Seat 0's and seat 1's Nouns (fixed, so every render matches). */
    seeds: [
      { background: 0, body: 13, accessory: 31, head: 138, glasses: 7 },
      { background: 1, body: 22, accessory: 88, head: 52, glasses: 3 },
    ],
    /**
     * A frame from `state` (you to shoot, the CPU in seat 1), the cue lined
     * up: aim (dx, dy), power, spin, cue (ball in hand) and call (the 8).
     */
    stage(state, o = {}) {
      pool.session = null;
      const me = pool.transport.id;
      const key = s => `${s.background}-${s.body}-${s.accessory}-${s.head}-${s.glasses}`;
      pool.begin(
        {
          gid: 'sizzle',
          seed: 1,
          breaker: 0,
          players: [
            { id: me, name: 'you', human: true, seedKey: key(pl.seeds[0]) },
            { id: 'cpu', name: 'CPU', human: false, skill: 0.97, seedKey: key(pl.seeds[1]) },
          ],
          pro: true,
          table: pool.table.id,
          place: pool.table,
        },
        'host',
        me,
        quantize(state),
      );
      view.setPlayers(pl.seeds);
      // One step lines the turn up (setupTurn), then ours goes on top
      sz.run(1);
      const d = pool.debug;
      if (o.cue) d.setPlace(o.cue);
      if (o.aim) d.setAim(o.aim.dx, o.aim.dy);
      if (o.call !== undefined) d.setCall(o.call);
      pool.setPower(o.power ?? 0.5);
      pool.setSpin(o.side ?? 0, o.top ?? 0);
      view.aimMode = o.gameCam === 'top' ? 'top' : 'aim';
      view.setCam(o.gameCam ?? 'aim');
      view.cam.snap();
      pl.shot = o;
    },
    shoot() {
      const ok = pool.shoot();
      if (!ok) throw new Error('pool: the shot was refused');
    },
  };
  // No aiming guide in a sizzle (it's the shooter's HUD); the called pocket stays
  if (!pool.__szFrameFor) {
    pool.__szFrameFor = pool.frameFor.bind(pool);
    pool.frameFor = ev => {
      const f = pool.__szFrameFor(ev);
      if (f.aim !== null) f.aim = { ...f.aim, guide: false };
      return f;
    };
  }
  // Pool's block in Game.step doesn't call camHook: run ours after it
  if (!pool.__szStep) {
    pool.__szStep = pool.step.bind(pool);
    pool.step = dt => {
      pool.__szStep(dt);
      // (window.__pl: a re-install replaces it)
      const pl = window.__pl;
      pl.t += dt;
      if (pl.cam === null) return;
      const c = pl.cam(pl.t);
      const f = view.frame;
      f.updateMatrixWorld();
      eye.set(...c.eye);
      look.set(...c.look);
      // The players hide a body the camera is inside: tell them where it is
      view.cam.eye.copy(eye);
      eye.applyMatrix4(f.matrixWorld);
      look.applyMatrix4(f.matrixWorld);
      const cam = g.gfx.camera;
      cam.position.copy(eye);
      cam.up.set(0, 1, 0);
      cam.lookAt(look);
      const fov = c.fov ?? 50;
      if (cam.fov !== fov) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
    };
  }
  window.__pl = pl;
}

/**
 * Noun World on foot for NOUN PARKOUR, the loop stopped (`__sz`), with
 * `__pk` helpers: `route(id)` starts a route (its gates + course props)
 * and skips the countdown, `place(x, y, z, yaw)` stands the rider
 * somewhere, `pilot(phases)` scripts the controls (see installParkour).
 */
export async function openParkour(p, base) {
  await openWorld(p, base);
  // The same rider in every shot (a fresh page rolls a random Noun)
  await p.evaluate(() => window.__w2.setSeed({ background: 0, body: 13, accessory: 31, head: 138, glasses: 7 }));
  await p.waitForTimeout(10_000);
  await p.evaluate(installParkour);
  await cleanFrame(p);
}

/**
 * Runs in the page. A pilot phase drives the stick in world space
 * (gamepad-style, so the parkour engine gets a wish direction):
 *   dir [dx, dz] | to [x, z] (steer at a point) | yaw (rad) | none (stick idle);
 *   move (0..1, default 1), sprint, jump (pressed on the phase's first
 *   step), hold (jump held: climb), duck (held), duckPress, release;
 *   stick [x, y] (the raw stick instead, e.g. hanging: x shimmies, y up);
 *   gate (stage the route clock at that checkpoint when the phase starts);
 *   dur (s) and/or until (a JS expression over p = player, m = motor move,
 *   a = anim kind, t = phase time): the phase ends on whichever comes first.
 * `__pk.log` records each phase change (step, kind, position).
 */
export function installParkour() {
  const sz = window.__sz;
  const g = sz.g;
  const pk = g.parkour;
  const course = pk.course;
  const pkx = {
    g,
    pk,
    course,
    log: [],
    steps: 0,
    route(id) {
      course.start(id);
      // The countdown holds the rider on the line: run it out
      for (let i = 0; i < 60 * 5 && course.view.phase === 'countdown'; i++) sz.run(1);
    },
    place(x, y, z, yaw) {
      course.place(new sz.V(x, y, z), yaw);
      pk.motor.reset?.();
      sz.run(2);
      g.cam.snap(g.player);
    },
    pilot(phases) {
      // Controls relative to a fixed yaw, not the chase camera's: its yaw
      // carries over from whatever ran before, and a run must not depend
      // on that (the camera itself reads yaw + orbitYaw, not this getter)
      Object.defineProperty(g.cam, 'controlYaw', { get: () => 0, configurable: true });
      let i = 0;
      let t = 0;
      let fresh = true;
      pkx.log = [];
      pkx.steps = 0;
      const conds = phases.map(ph => (ph.until ? new Function('p', 'm', 'a', 't', `return (${ph.until})`) : null));
      sz.input = () => {
        pkx.steps++;
        const p = g.player;
        // Advance phases whose end has come
        while (i < phases.length) {
          const ph = phases[i];
          const c = conds[i];
          const done = (ph.dur !== undefined && t >= ph.dur) || (c !== null && c(p, pk.motor.move, pk.anim.kind, t));
          if (!done) break;
          i++;
          t = 0;
          fresh = true;
          pkx.log.push({ step: pkx.steps, phase: i, kind: pk.anim.kind, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2) });
        }
        const ph = phases[i] ?? {};
        t += 1 / 60;
        let wx = 0;
        let wz = 0;
        if (ph.dir) [wx, wz] = ph.dir;
        else if (ph.to) {
          wx = ph.to[0] - p.pos.x;
          wz = ph.to[1] - p.pos.z;
        } else if (ph.yaw !== undefined) {
          wx = Math.sin(ph.yaw);
          wz = Math.cos(ph.yaw);
        }
        const l = Math.hypot(wx, wz);
        const mag = l > 1e-6 ? (ph.move ?? 1) : 0;
        if (l > 1e-6) {
          wx /= l;
          wz /= l;
        }
        // World wish → stick at control yaw 0 (Player.updateFoot / ParkourSystem invert this)
        const fx = 0;
        const fz = 1;
        if (ph.gate !== undefined && fresh) pkx.gate(ph.gate);
        const out = {
          mode: 'gamepad',
          // `stick` [x, y]: the raw stick (hanging: x shimmies, y pulls up)
          moveY: ph.stick ? ph.stick[1] : (wx * fx + wz * fz) * mag,
          moveX: ph.stick ? ph.stick[0] : (-wx * fz + wz * fx) * mag,
          sprint: !!ph.sprint,
          jumpPressed: !!ph.jump && fresh,
          crouch: !!ph.hold,
          duck: !!ph.duck,
          duckPressed: !!ph.duckPress && fresh,
          boardTogglePressed: !!ph.release && fresh,
          push: false,
          pushPressed: false,
          respawnPressed: false,
          tricks: [],
        };
        fresh = false;
        return out;
      };
    },
    /**
     * Stage the route's clock at checkpoint `i` (its gate lit, the next one
     * faint): shots are cut from separate takes, not one run.
     */
    gate(i) {
      const c = course.clock;
      if (c === null) return;
      c.next = i;
      c.splits = c.splits.slice(0, i);
      course.gates?.setNext(i);
      course.view.next = i;
    },
    /** Silent steps, returning the anim kinds seen (for scripting). */
    trace(n) {
      const seen = [];
      for (let k = 0; k < n; k++) {
        sz.run(1);
        const a = pk.anim.kind;
        const p = g.player;
        if (seen.length === 0 || seen[seen.length - 1].a !== a)
          seen.push({ k, a, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2) });
      }
      return seen;
    },
  };
  window.__pk = pkx;
}

/**
 * Noun Warfare (`/warfare`), its rAF loop stopped, with `__wf` helpers:
 * `match(seed)` starts a bots-only Team Splat on Noun City in which a bot
 * brain plays the local player too (so the camera has someone to follow),
 * `frame(speed)` advances the sim by `speed` × 1/30 s (0.5 = half-speed
 * slow motion; the renderer interpolates between ticks) and draws it.
 */
export async function openWarfare(p, base) {
  await p.goto(`${base}/warfare?q=high`, { timeout: 1_200_000, waitUntil: 'commit' });
  await p.waitForFunction(() => window.__warfare?.game?.assets, null, { timeout: 900_000, polling: 2000 });
  await p.evaluate(installWarfare);
  await cleanFrame(p);
}

/** Runs in the page. */
export async function installWarfare() {
  const W = window.__warfare;
  const g = W.game;
  W.noLock(true);
  W.manual(true);
  cancelAnimationFrame(g.raf);
  g.frame = () => {};
  const { createBotMem, thinkBot } = await import('/src/miniapps/warfare/sim/bots.ts');
  const DT = 1 / 60;
  const wf = {
    g,
    mem: null,
    acc: 0,
    match(seed = 7) {
      g.startMatch({
        mode: 'tdm',
        map: 'nouncity',
        teamSize: 4,
        difficulty: 2,
        name: 'noun',
        look: '0-12-40-123-7',
        weapons: ['splatter', 'hopper', 'shotgun', 'longsplat', 'launcher'],
        seed,
      });
      wf.mem = createBotMem(g.sim, g.sim.state.players[g.me]);
      wf.acc = 0;
    },
    /** One sim tick, the local player driven by its bot brain. */
    tick() {
      const sim = g.sim;
      const me = sim.state.players[g.me];
      g.stepTicks(1, me.alive ? thinkBot(sim, me, wf.mem) : {});
    },
    /** Silent seconds. */
    run(secs) {
      for (let i = 0; i < Math.round(secs / DT); i++) wf.tick();
    },
    /** One output frame (1/30 s of screen time) at `speed` × real time. */
    frame(speed = 0.5, tp = g.tp) {
      g.tp = tp;
      wf.acc += speed * (1 / 30);
      while (wf.acc >= DT) {
        wf.tick();
        wf.acc -= DT;
      }
      // Interpolate between the last two ticks (render reads acc when not manual)
      g.manual = false;
      g.acc = wf.acc;
      g.render(speed / 30);
      g.manual = true;
    },
  };
  window.__wf = wf;
}

/** Noun World with a Noun Breaks battle mounted in the plaza (`window.__d`, view/dev.ts). */
export async function openBreaks(p, base) {
  await openWorld(p, base);
  await p.evaluate(installBreaks);
  // Heads and the crowd's models stream in
  await p.waitForTimeout(12_000);
  await cleanFrame(p);
}

/**
 * The 3D Grand Exchange (`/exchange?offline=1`, the in-tab sim), its
 * render loop stopped: `__gx.step()` advances the floor one 1/30 s frame
 * and draws it. `__gx.orbit` (null: the scene's own camera) is a function
 * of (t) returning an Orbit {tx,ty,tz,r,az,el} that drives the camera.
 * The shout bubbles are DOM (.gx3d-labels), so they stay in the frame.
 */
export async function openExchange(p, base) {
  await p.goto(`${base}/exchange?offline=1&skip=1`, { timeout: 1_200_000, waitUntil: 'commit' });
  await p.waitForFunction(() => window.__gx3d, null, { timeout: 900_000, polling: 2000 });
  // /exchange opens inside the NounOS page window, smaller than the
  // viewport and transformed (so even position:fixed is clipped to it).
  // Move the floor onto <body> and pin it to the whole frame; the scene
  // follows its host through a ResizeObserver. Then check it really fills
  // the frame, corner to corner.
  await p.addStyleTag({
    content:
      '.gx3d-root{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483000!important;border-radius:0!important;transform:none!important}',
  });
  await p.evaluate(() => document.body.appendChild(document.querySelector('.gx3d-root')));
  await p.waitForFunction(
    () => {
      const c = window.__gx3d.renderer.domElement;
      const r = c.getBoundingClientRect();
      const W = window.innerWidth;
      const H = window.innerHeight;
      const corner = document.elementFromPoint(W - 2, H - 2);
      return r.left === 0 && r.top === 0 && r.width === W && r.height === H && !!corner && c.closest('.gx3d-root').contains(corner);
    },
    null,
    { timeout: 30_000, polling: 250 },
  );
  await p.evaluate(installExchange);
  // Let the crowd spread out and the first trades start
  await p.evaluate(() => window.__gx.run(20));
  await cleanFrame(p, ['.gx3d-labels'], '.gx3d-canvas');
}

/** Runs in the page. */
export function installExchange() {
  const s = window.__gx3d;
  cancelAnimationFrame(s.raf);
  s.disposedLoop = true;
  // The loop is gone; keep `raf` from being restarted by anything
  s.loop = () => {};
  const gx = {
    s,
    orbit: null,
    t: 0,
    trades: [],
    run(secs, dt = 1 / 30) {
      for (let i = 0; i < Math.round(secs / dt); i++) s.step(dt);
    },
    step() {
      s.step(1 / 30);
      gx.t += 1 / 30;
      if (gx.orbit) {
        const o = gx.orbit(gx.t);
        s.cur = { ...o };
        s.want = { ...o };
        // Re-place the camera from the forced orbit (the step already moved it)
        s.stepCamera(0);
        s.stepCopies();
        s.stepLabels(0);
      }
      s.renderer.render(s.scene, s.camera);
    },
  };
  // Record trades as they start (for framing one)
  const on = s.onTrade.bind(s);
  s.onTrade = e => {
    if (e.t === 'start') gx.trades.push({ at: s.crowd.t, a: e.a });
    on(e);
  };
  window.__gx = gx;
}

/** Runs in the page. */
export async function installBreaks() {
  window.__brkOpts = { crewSize: 1 };
  window.__d = await window.__w2.breakDev(window.__brkOpts);
  window.__brkAt = (phase, n = 0, dt = 0) =>
    window.__d.mock.timeline.filter(s => s.phase === phase)[n].t + dt;
}
