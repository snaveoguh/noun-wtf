// Desktop heat / freeze probe for Noun World.
//
//   node desktop.cjs <baseUrl> <profile> <out.json> [scenarios]
//
// profiles: retina (1440x900 @2, "Apple M2", 8 cores), hd (1920x1080 @1, RTX 3060, 8 cores)
// scenarios (comma list, default all but soak):
//   boot     quality, pixel ratio, buffer sizes, passes
//   passes   per-pass raster ms (gl.finish around each composer pass + the shadow map) and
//            megapixels drawn per frame, at the plaza
//   pacing   frames simulated / rendered per second under a 60 Hz and a 144 Hz display
//            (rAF shim; rendering stubbed so SwiftShader isn't the bottleneck), CPU ms per step
//   threads  CPU % per browser thread (from /proc) while: playing, paused (desk), menu open,
//            window blurred, tab hidden
//   rooms    enter + leave the nearest plaza room 10x: longest task, heap, programs, geometries
//   soak     SOAK_MIN minutes (default 20) skating a loop with rendering: heap / GPU objects
//            every 30 s
//
// The rAF shim: requestAnimationFrame is replaced by a timer on a virtual vsync of
// window.__rafHz (0 = the browser's own rAF). While window.__rafHidden is true no frames
// fire at all, like a hidden tab in a real browser.
const { chromium } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const fs = require('fs');

const [, , base, profileName, out, scen] = process.argv;
const SCEN = (scen || 'boot,passes,pacing,threads,rooms').split(',');
const SOAK_MIN = +(process.env.SOAK_MIN || 20);
const EXTRA = process.env.QS || '';

const PROFILES = {
  retina: {
    ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
    gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
    cores: 8,
    memory: 8,
  },
  hd: {
    ctx: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
    gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
    cores: 8,
    memory: 16,
  },
};

const P = PROFILES[profileName];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ── per-thread CPU from /proc (Linux) ──
function descendants(pid) {
  const all = fs.readdirSync('/proc').filter(x => /^\d+$/.test(x));
  const kids = new Map();
  for (const p of all) {
    try {
      const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8');
      const ppid = +st.slice(st.lastIndexOf(')') + 2).split(' ')[1];
      if (!kids.has(ppid)) kids.set(ppid, []);
      kids.get(ppid).push(+p);
    } catch {}
  }
  const outp = [];
  const walk = q => {
    outp.push(q);
    for (const k of kids.get(q) || []) walk(k);
  };
  walk(pid);
  return outp;
}
function procKind(pid) {
  try {
    const c = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    const m = c.match(/--type=([a-z-]+)/);
    if (!m) return 'browser';
    if (m[1] === 'utility') {
      const s = c.match(/--utility-sub-type=([\w.]+)/);
      return 'utility:' + (s ? s[1].split('.').slice(-2).join('.') : '?');
    }
    return m[1];
  } catch {
    return '?';
  }
}
function threadTicks(pids) {
  const m = new Map();
  for (const pid of pids) {
    const kind = procKind(pid);
    let tids = [];
    try {
      tids = fs.readdirSync(`/proc/${pid}/task`);
    } catch {
      continue;
    }
    for (const t of tids) {
      try {
        const st = fs.readFileSync(`/proc/${pid}/task/${t}/stat`, 'utf8');
        const name = st.slice(st.indexOf('(') + 1, st.lastIndexOf(')'));
        const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
        const ticks = +f[11] + +f[12];
        const key = `${kind}/${name.replace(/\d+$/, '#')}`;
        m.set(key, (m.get(key) || 0) + ticks);
      } catch {}
    }
  }
  return m;
}

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
      '--enable-precise-memory-info',
      '--autoplay-policy=no-user-gesture-required',
      '--js-flags=--expose-gc',
    ],
  });
  const ctx = await b.newContext(P.ctx);
  await ctx.addInitScript(
    ({ gpu, cores, memory }) => {
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => memory });
      for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
        const gp = C.prototype.getParameter;
        C.prototype.getParameter = function (p) {
          if (p === 0x9246) return gpu;
          return gp.call(this, p);
        };
      }
      // rAF shim on a virtual vsync
      const nativeRaf = window.requestAnimationFrame.bind(window);
      const nativeCancel = window.cancelAnimationFrame.bind(window);
      window.__rafHz = 0;
      window.__rafHidden = false;
      let q = new Map();
      let id = 1;
      let armed = false;
      const fire = () => {
        armed = false;
        if (window.__rafHidden) {
          armed = true;
          setTimeout(fire, 250);
          return;
        }
        const run = q;
        q = new Map();
        const now = performance.now();
        for (const cb of run.values()) cb(now);
      };
      window.requestAnimationFrame = cb => {
        if (!window.__rafHz && !window.__rafHidden) return nativeRaf(cb);
        const i = -id++;
        q.set(i, cb);
        if (!armed) {
          armed = true;
          const per = 1000 / (window.__rafHz || 60);
          const now = performance.now();
          const next = Math.ceil((now + 0.5) / per) * per;
          setTimeout(fire, next - now);
        }
        return i;
      };
      window.cancelAnimationFrame = i => (i < 0 ? q.delete(i) : nativeCancel(i));
      // Visibility / focus overrides for the hidden + blurred states
      window.__vis = 'visible';
      window.__focus = true;
      Object.defineProperty(document, 'visibilityState', { get: () => window.__vis });
      Object.defineProperty(document, 'hidden', { get: () => window.__vis === 'hidden' });
      const hf = Document.prototype.hasFocus;
      Document.prototype.hasFocus = function () {
        return window.__focus && hf.call(this);
      };
    },
    { gpu: P.gpu, cores: P.cores, memory: P.memory },
  );
  const p = await ctx.newPage();
  p.on('pageerror', e => log('pageerror', String(e).slice(0, 200)));
  const cdp = await ctx.newCDPSession(p);
  const url = `${base}/world?offline=1&skip=1&bday=0&perf=quiet&debug=1${EXTRA}`;
  log('goto', url);
  await p.goto(url, { timeout: 600000 });
  await p
    .getByText('PRESS START')
    .first()
    .click({ force: true, timeout: 600000 })
    .catch(e => log('no start', e.message));
  await p.waitForFunction(() => window.__w2 && window.__w2.me && window.__w2.running, null, {
    timeout: 900000,
    polling: 2000,
  });
  log('running');
  const results = { profile: profileName, url, scenarios: {} };
  const save = () => fs.writeFileSync(out, JSON.stringify(results, null, 1));
  const boot = await p.evaluate(() => {
    const g = window.__w2;
    if (g.adaptive) g.adaptive.frozen = true;
    const r = g.gfx.renderer;
    const c = r.domElement;
    return {
      quality: g.gfx.quality,
      lite: g.gfx.lite,
      pixelRatio: r.getPixelRatio(),
      css: [c.clientWidth, c.clientHeight],
      buffer: [c.width, c.height],
      shadowMap: g.gfx.sun.shadow.mapSize.x,
      passes: g.gfx.composer.passes.map(x => x.name || x.constructor.name),
      frameCap: g.frameCap ?? null,
      adaptive: g.adaptive ? g.adaptive.rungs.map(x => JSON.stringify(x)) : null,
    };
  });
  results.boot = boot;
  log('boot', JSON.stringify(boot));
  const spot = () =>
    p.evaluate(() => {
      const g = window.__w2;
      const V = g.player.pos.constructor;
      const hit = g.world.raycast(new V(0, 40, 14), new V(0, -1, 0), 80);
      const y = hit ? hit.point.y : g.player.pos.y;
      g.player.spawn(new V(0, y + 0.05, 14), 0);
      g.player.vel.set(0, 0, 0);
      g.cam.snap(g.player);
    });
  await spot();
  await sleep(15000);
  save();
  const keys = (on, ...k) =>
    p.evaluate(
      ([on, k]) => {
        const s = window.__w2.input.keys;
        for (const x of k) on ? s.add(x) : s.delete(x);
      },
      [on, k],
    );

  if (SCEN.includes('passes')) {
    // SwiftShader raster ms per frame (a 1-px readPixels waits for the frame's raster;
    // gl.finish doesn't), and the same with one thing changed at a time. Plus megapixels
    // drawn per frame (viewport area of each framebuffer the frame draws into).
    const r = await p.evaluate(async () => {
      const g = window.__w2;
      const G = g.gfx;
      const R = G.renderer;
      const gl = R.getContext();
      g.running = false;
      await new Promise(r => setTimeout(r, 300));
      const px1 = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
      const frame = () => {
        sync();
        const t0 = performance.now();
        g.step(1 / 60);
        sync();
        return performance.now() - t0;
      };
      const ms = () => {
        frame();
        return Math.round(Math.min(frame(), frame()));
      };
      // megapixels per frame
      let px = 0;
      let seen = new Set();
      let fb = null;
      let vp = [0, 0, 0, 0];
      const bf = gl.bindFramebuffer;
      const vpf = gl.viewport;
      gl.bindFramebuffer = function (tg, f) {
        fb = f;
        return bf.call(this, tg, f);
      };
      gl.viewport = function (x, y, w, h) {
        vp = [x, y, w, h];
        return vpf.call(this, x, y, w, h);
      };
      const undo = [];
      for (const n of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const o = gl[n];
        gl[n] = function (...a) {
          const k = (fb ? fb.__id || (fb.__id = Math.random()) : 0) + ':' + vp.join(',');
          if (!seen.has(k)) {
            seen.add(k);
            px += vp[2] * vp[3];
          }
          return o.apply(this, a);
        };
        undo.push(() => (gl[n] = o));
      }
      px = 0;
      seen = new Set();
      R.info.reset();
      g.step(1 / 60);
      const mpx = px / 1e6;
      const draws = R.info.render.calls;
      for (const u of undo) u();
      gl.bindFramebuffer = bf;
      gl.viewport = vpf;
      const W = R.domElement.clientWidth;
      const H = R.domElement.clientHeight;
      const lite = { ...G.lite };
      const shadow0 = G.sun.shadow.mapSize.x;
      const setShadow = n => {
        G.sun.shadow.mapSize.set(n, n);
        G.sun.shadow.map?.dispose();
        G.sun.shadow.map = null;
      };
      const scale = s => {
        G.applyLite({ ...G.lite, scale: s });
        g.resize(W, H);
      };
      const out = { mpx, draws, scale: lite.scale, shadow: shadow0 };
      out.base = ms();
      if (shadow0 > 2048) {
        setShadow(2048);
        out.shadow2048 = ms();
        setShadow(shadow0);
      }
      const passes = G.composer.passes;
      const last = passes[passes.length - 1];
      if (last.effects && last.effects.some(e => /SMAA/.test(e.constructor.name + e.name))) {
        last.enabled = false;
        passes[passes.length - 2].renderToScreen = true;
        out.noSMAA = ms();
        last.enabled = true;
        passes[passes.length - 2].renderToScreen = false;
      }
      for (const s of [1.5, 1]) {
        if (s >= lite.scale) continue;
        scale(s);
        out['scale' + s] = ms();
      }
      scale(lite.scale);
      out.baseAgain = ms();
      g.running = true;
      g.last = performance.now();
      requestAnimationFrame(g.frame);
      return out;
    });
    results.scenarios.passes = r;
    log('passes', JSON.stringify(r));
    save();
  }

  if (SCEN.includes('pacing')) {
    // Virtual vsync: Game.frame is called with display timestamps (k / hz s) from a tight
    // loop, rendering stubbed, rAF a no-op. Counts what the game's own loop does per
    // display second: steps, renders, CPU ms. Blurred / covered states the same way.
    for (const [hz, state] of [[60, ''], [120, ''], [144, ''], [144, 'blurred'], [144, 'menu'], [240, '']]) {
      const s = await p.evaluate(async ([hz, state]) => {
        const g = window.__w2;
        const real = g.gfx.render.bind(g.gfx);
        let renders = 0;
        g.gfx.render = () => {
          renders++;
        };
        const raf = window.requestAnimationFrame;
        window.requestAnimationFrame = () => 0;
        let release = null;
        if (state === 'blurred') {
          window.__focus = false;
          window.dispatchEvent(new Event('blur'));
        }
        if (state === 'menu') release = g.coverGame ? g.coverGame('perf') : null;
        const SECS = 6;
        const per = 1000 / hz;
        // one virtual timeline across runs (it runs ahead of the real clock)
        let t = Math.max(performance.now(), window.__vt || 0);
        let cpu = 0;
        g.last = t;
        const dts = [];
        const st = g.step.bind(g);
        g.step = (dt, now) => {
          dts.push(dt);
          return st(dt, now);
        };
        const frames = hz * SECS;
        for (let i = 0; i < frames; i++) {
          t += per;
          // the browser's clock moves on with the display, whatever the frame cost
          const a = performance.now();
          g.frame(t);
          cpu += performance.now() - a;
          if (i % 30 === 0) await new Promise(r => setTimeout(r, 0));
        }
        window.__vt = t;
        delete g.step;
        if (release) release();
        if (state === 'blurred') {
          window.__focus = true;
          window.dispatchEvent(new Event('focus'));
        }
        window.requestAnimationFrame = raf;
        g.gfx.render = real;
        // back on the real clock: Game.frame resyncs (dt is capped, the pacer restarts)
        g.last = performance.now();
        requestAnimationFrame(g.frame);
        const simSec = dts.reduce((a, b) => a + b, 0);
        return {
          hz,
          state,
          stepsPerSec: dts.length / SECS,
          rendersPerSec: renders / SECS,
          simSecondsPerSecond: simSec / SECS,
          cpuMsPerFrameCall: cpu / frames,
          cpuMsPerStep: cpu / Math.max(1, dts.length),
          maxDt: Math.max(...dts),
        };
      }, [hz, state]);
      results.scenarios[`pacing-${hz}${s.state ? '-' + s.state : ''}`] = s;
      log(
        `pacing ${hz} Hz ${state}`,
        `steps/s ${s.stepsPerSec.toFixed(1)} renders/s ${s.rendersPerSec.toFixed(1)} sim s/s ${s.simSecondsPerSecond.toFixed(3)}`,
        `cpu/step ${s.cpuMsPerStep.toFixed(2)} ms maxDt ${(s.maxDt * 1000).toFixed(1)} ms`,
      );
      save();
      await spot();
    }
  }

  if (SCEN.includes('threads')) {
    // Chromium runs as a child of this node process
    const pids = () => descendants(process.pid).filter(x => x !== process.pid);
    const bp = true;
    await cdp.send('Performance.enable');
    const metrics = async () => {
      const { metrics: m } = await cdp.send('Performance.getMetrics');
      return Object.fromEntries(m.map(x => [x.name, x.value]));
    };
    const sample = async (name, ms, setup, teardown) => {
      await p.evaluate(setup);
      await sleep(3000);
      const ps = pids();
      const a = threadTicks(ps);
      const m0 = await metrics();
      const t0 = Date.now();
      await p.evaluate(() => window.__w2perf.reset());
      if (process.env.MOVE_MOUSE) {
        // a cursor drifting over the page the whole time (free-cursor play, menus)
        const end = Date.now() + ms;
        let i = 0;
        while (Date.now() < end) {
          await p.mouse.move(400 + 300 * Math.sin(i / 7), 300 + 200 * Math.cos(i / 9));
          i++;
          await sleep(16);
        }
      } else await sleep(ms);
      const bT = threadTicks(pids());
      const m1 = await metrics();
      const sec = (Date.now() - t0) / 1000;
      const main = {};
      for (const k of ['TaskDuration', 'ScriptDuration', 'RecalcStyleDuration', 'LayoutDuration'])
        main[k.replace('Duration', 'MsPerSec')] = +(((m1[k] - m0[k]) * 1000) / sec).toFixed(1);
      main.styleRecalcsPerSec = +((m1.RecalcStyleCount - m0.RecalcStyleCount) / sec).toFixed(1);
      const snap = await p.evaluate(() => {
        const s = window.__w2perf.snapshot();
        return { fps: s.frame.fps, frames: s.frame.count ?? null, cpuP50: s.cpu.p50 };
      });
      const rows = [];
      let total = 0;
      for (const [k, v] of bT) {
        const d = (v - (a.get(k) || 0)) / 100 / sec; // ticks are 10 ms: cores busy
        if (d > 0.005) rows.push([k, +(d * 100).toFixed(1)]);
        total += Math.max(0, d);
      }
      rows.sort((x, y) => y[1] - x[1]);
      results.scenarios[`threads-${name}`] = { totalPct: +(total * 100).toFixed(1), rows, snap, main };
      log(`threads ${name}`, `total ${(total * 100).toFixed(0)}% of a core`, JSON.stringify(snap), JSON.stringify(main));
      for (const r of rows.slice(0, 8)) log('   ', r[0].padEnd(40), r[1] + '%');
      save();
      await p.evaluate(teardown);
      await sleep(2000);
    };
    if (bp !== null) {
      await sample('playing', 12000, () => {}, () => {});
      await sample(
        'paused',
        12000,
        () => window.__w2.setPaused(true),
        () => window.__w2.setPaused(false),
      );
      await sample(
        'blurred',
        12000,
        () => {
          window.__focus = false;
          window.dispatchEvent(new Event('blur'));
        },
        () => {
          window.__focus = true;
          window.dispatchEvent(new Event('focus'));
        },
      );
      await sample(
        'hidden',
        12000,
        () => {
          window.__rafHidden = true;
          window.__vis = 'hidden';
          document.dispatchEvent(new Event('visibilitychange'));
        },
        () => {
          window.__rafHidden = false;
          window.__vis = 'visible';
          document.dispatchEvent(new Event('visibilitychange'));
        },
      );
      await sample(
        'settings',
        12000,
        () => document.querySelector('[data-w2cog]')?.click(),
        () => document.querySelector('[data-w2cog]')?.click(),
      );
      await sample(
        'map',
        12000,
        () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', bubbles: true })),
        () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', bubbles: true })),
      );
    }
  }

  if (SCEN.includes('rooms')) {
    const mem = () =>
      p.evaluate(() => {
        if (window.gc) window.gc();
        const g = window.__w2;
        const m = g.gfx.renderer.info;
        return {
          heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
          geometries: m.memory.geometries,
          textures: m.memory.textures,
          programs: m.programs ? m.programs.length : null,
          sceneObjects: (() => {
            let n = 0;
            g.gfx.scene.traverse(() => n++);
            return n;
          })(),
          dom: document.getElementsByTagName('*').length,
        };
      });
    const rooms = [];
    rooms.push({ i: 0, ...(await mem()) });
    log('rooms start', JSON.stringify(rooms[0]));
    for (let i = 1; i <= 10; i++) {
      await spot();
      await sleep(1500);
      const ok = await p.evaluate(() => {
        const g = window.__w2;
        const d = g.interiors.doors();
        const plaza = d
          .slice()
          .sort(
            (a, b) =>
              Math.hypot(a.x ?? a.pos?.x ?? 0, a.z ?? a.pos?.z ?? 0) -
              Math.hypot(b.x ?? b.pos?.x ?? 0, b.z ?? b.pos?.z ?? 0),
          )[0];
        window.__w2perf.reset();
        return plaza ? g.interiors.debugEnter(plaza.id) : false;
      });
      await p
        .waitForFunction(() => window.__w2.interiors.inside, null, { timeout: 120000 })
        .catch(() => log('never inside'));
      await sleep(4000);
      const enter = await p.evaluate(() => window.__w2perf.snapshot().longTasks.maxMs);
      await p.evaluate(() => {
        window.__w2perf.reset();
        window.__w2.interiors.requestLeave();
      });
      await p
        .waitForFunction(() => !window.__w2.interiors.inside, null, { timeout: 60000 })
        .catch(() => {});
      await sleep(4000);
      const leave = await p.evaluate(() => window.__w2perf.snapshot().longTasks.maxMs);
      const m = await mem();
      rooms.push({ i, ok, enterLongMs: enter, leaveLongMs: leave, ...m });
      log('room', i, JSON.stringify(rooms[rooms.length - 1]));
      results.scenarios.rooms = rooms;
      save();
    }
  }

  if (SCEN.includes('soak')) {
    const rows = [];
    // SOAK_STUB=n: draw only every nth frame, so the sim, streaming and network run at
    // the display's pace under SwiftShader (what leaks is the JS and GPU objects, not pixels)
    const stub = +(process.env.SOAK_STUB || 0);
    if (stub > 0)
      await p.evaluate(n => {
        const g = window.__w2;
        const real = g.gfx.render.bind(g.gfx);
        let i = 0;
        g.gfx.render = dt => {
          if (++i % n === 0) real(dt);
        };
      }, stub);
    await spot();
    await keys(true, 'KeyW', 'KeyD');
    const t0 = Date.now();
    while (Date.now() - t0 < SOAK_MIN * 60000) {
      await sleep(30000);
      const r = await p.evaluate(() => {
        const g = window.__w2;
        const m = g.gfx.renderer.info;
        const s = window.__w2perf.snapshot();
        window.__w2perf.reset();
        if (window.gc) window.gc();
        return {
          heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
          geometries: m.memory.geometries,
          textures: m.memory.textures,
          programs: m.programs ? m.programs.length : null,
          fps: s.frame.fps,
          longMax: s.longTasks.maxMs,
          longCount: s.longTasks.count,
          frameMax: s.frame.max,
          pos: [Math.round(g.player.pos.x), Math.round(g.player.pos.z)],
          dom: document.getElementsByTagName('*').length,
        };
      });
      r.min = +((Date.now() - t0) / 60000).toFixed(1);
      rows.push(r);
      log('soak', JSON.stringify(r));
      results.scenarios.soak = rows;
      save();
      // Wander: respawn somewhere new every 2 min so chunks stream in and out
      if (rows.length % 4 === 0)
        await p.evaluate(n => {
          const g = window.__w2;
          const V = g.player.pos.constructor;
          const a = n * 1.7;
          const x = Math.cos(a) * 120;
          const z = Math.sin(a) * 120;
          const hit = g.world.raycast(new V(x, 200, z), new V(0, -1, 0), 400);
          g.player.spawn(new V(x, (hit ? hit.point.y : 10) + 0.1, z), a);
          g.cam.snap(g.player);
        }, rows.length);
    }
    await keys(false, 'KeyW', 'KeyD');
  }

  if (SCEN.includes('repl')) {
    // Interactive: write <dir>/N.js (an async function body run in the page; `return` a
    // value), read <dir>/N.out. <dir> = REPL env var. `//node` first line runs it in node
    // with (p, cdp, b, sleep) instead.
    const dir = process.env.REPL;
    fs.mkdirSync(dir, { recursive: true });
    log('repl on', dir);
    for (;;) {
      const f = fs.readdirSync(dir).filter(x => x.endsWith('.js') && !fs.existsSync(`${dir}/${x}.out`));
      for (const x of f) {
        const src = fs.readFileSync(`${dir}/${x}`, 'utf8');
        let res;
        try {
          if (src.startsWith('//node')) {
            const fn = new Function('p', 'cdp', 'b', 'sleep', 'fs', 'H', `return (async () => {${src}})()`);
            res = await fn(p, cdp, b, sleep, fs, { descendants, threadTicks });
          } else res = await p.evaluate(`(async () => {${src}})()`);
        } catch (e) {
          res = { error: String(e) };
        }
        fs.writeFileSync(`${dir}/${x}.out`, JSON.stringify(res, null, 1) ?? 'undefined');
        if (src.includes('//quit')) {
          await b.close();
          return;
        }
      }
      await sleep(300);
    }
  }

  save();
  if (process.env.SHOT) {
    // The same rider in every build
    await p.evaluate(() =>
      window.__w2.setSeed({ background: 0, body: 12, accessory: 40, head: 60, glasses: 3 }),
    );
    await sleep(12000);
    if (process.env.SHARP) await p.evaluate(() => window.__w2.setSharp?.(true));
    await spot();
    // HUD-free: only the canvas (and its ancestors) stay visible; noon, same view
    await p.evaluate(() => {
      const st = document.createElement('style');
      st.textContent = 'body *{visibility:hidden!important}';
      document.head.appendChild(st);
      for (const c of document.querySelectorAll('canvas')) {
        if (c.clientWidth < 600) continue;
        for (let e = c; e; e = e.parentElement) e.style.setProperty('visibility', 'visible', 'important');
      }
    });
    await sleep(8000);
    await p.screenshot({ path: process.env.SHOT, timeout: 240000 }).catch(e => log('shot fail', e.message));
  }
  await b.close();
  log('done');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
