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
