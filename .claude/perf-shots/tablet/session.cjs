// A kid's tablet session in Noun World, measured.
//
//   node session.cjs <baseUrl> <profile> <out.json> [scenarios]
//
// profiles: ipad-land / ipad-port (WebKit, iPad Safari: Mac UA + 5 touch
// points, DPR 2), droid-tab (Chromium, mid Android tablet 1280×800 @1.5,
// Adreno 618, 6 GB, 4× CPU), droid-weak (the same at 4 GB / Mali-G52, a Fire
// / Galaxy Tab A class tablet).
// scenarios (default all, in this order):
//   camp     the real first load: CAMP spawn + fly-in + reading, 20 s
//   escape   walk out of CAMP's window (W), the fall / skydive, 20 s
//   remotes  plaza, 16 simulated riders, 12 s
//   skate    plaza, W + D, 15 s
//   mountain the mountain hero spot, riding down (W), 20 s
//   room     enter the nearest plaza door (entry measured), 10 s inside, leave
//   car      cars.arrive() + drive (W), 15 s, then out
//   breaks   NOUN BREAKS vs CPU, 20 s
//   mural    mural mode at a plaza wall, 12 strokes with the mouse
//   soak     SOAK_MIN minutes (default 4) skating about, a sample every 20 s
//
// Every scenario records window.__w2perf.snapshot() (frame / CPU percentiles,
// systems, draws, programs, heap, the hitch log with the systems that ran in
// each stalled frame) plus the browser's process RSS from /proc.
// Env: WEBKIT=<pw_run.sh>, PROF=1 (Chromium: a .cpuprofile per scenario),
// SEED=1 (a fixed rider), FREEZE=0 (leave the adaptive controller running).
const fs = require('fs');
const path = require('path');
const PW = '/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright';
const { webkit, chromium } = require(PW);

const [, , base, profileName, out, scen] = process.argv;
const ALL = 'camp,escape,remotes,skate,mountain,room,car,breaks,mural,soak';
const SCEN = (scen || ALL).split(',');
const IPAD_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const DROID_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const PROFILES = {
  'ipad-land': { engine: 'webkit', ctx: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, userAgent: IPAD_UA }, touchPoints: 5 },
  'ipad-port': { engine: 'webkit', ctx: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true, userAgent: IPAD_UA }, touchPoints: 5 },
  'droid-tab': { engine: 'chromium', ctx: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, hasTouch: true, isMobile: true, userAgent: DROID_UA }, throttle: 4, gpu: 'Adreno (TM) 618', cores: 8, memory: 6 },
  'droid-weak': { engine: 'chromium', ctx: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, hasTouch: true, isMobile: true, userAgent: DROID_UA }, throttle: 4, gpu: 'Mali-G52 MC2', cores: 8, memory: 4 },
};
const P = PROFILES[profileName];
if (!P) throw new Error('profile? ' + Object.keys(PROFILES).join(' '));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t00 = Date.now();
const log = (...a) => console.log(((Date.now() - t00) / 1000).toFixed(0).padStart(5) + 's', ...a);

/** RSS (MB) of the browser's processes, by kind, from /proc. */
function rss() {
  const out = {};
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    let cmd = '';
    let status = '';
    try {
      cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    } catch {
      continue;
    }
    let kind = null;
    const exe = cmd.split('\0')[0];
    if (/(^|\/)(bash|sh|node|grep|ps)$/.test(exe)) continue;
    if (/W(ebKit|PE)WebProcess/.test(cmd)) kind = 'web';
    else if (/W(ebKit|PE)GPUProcess/.test(cmd)) kind = 'gpu';
    else if (/W(ebKit|PE)NetworkProcess/.test(cmd)) kind = 'net';
    else if (cmd.includes('pw-browsers/chromium') || cmd.includes('chrome-linux')) {
      const m = cmd.match(/--type=([a-z-]+)/);
      kind = m ? m[1] : 'browser';
    }
    if (!kind) continue;
    const kb = +(status.match(/VmRSS:\s+(\d+)/) || [0, 0])[1];
    out[kind] = Math.round(((out[kind] || 0) + kb / 1024) * 10) / 10;
  }
  return out;
}

(async () => {
  let b;
  if (P.engine === 'webkit') {
    b = await webkit.launch({ executablePath: process.env.WEBKIT || '/tmp/claude-0/pw/webkit-2191/pw_run.sh' });
  } else {
    b = await chromium.launch({
      executablePath: '/opt/pw-browsers/chromium',
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--enable-precise-memory-info', '--js-flags=--expose-gc', '--autoplay-policy=no-user-gesture-required'],
    });
  }
  const ctx = await b.newContext(P.ctx);
  await ctx.addInitScript(
    ({ tp, gpu, cores, memory }) => {
      if (tp) Object.defineProperty(navigator, 'maxTouchPoints', { get: () => tp });
      if (cores) Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores });
      if (memory) Object.defineProperty(navigator, 'deviceMemory', { get: () => memory });
      if (gpu)
        for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
          const gp = C.prototype.getParameter;
          C.prototype.getParameter = function (p) {
            if (p === 0x9246) return gpu;
            return gp.call(this, p);
          };
        }
      // A page reload (lost context / memory kill) shows up as a second boot
      window.__bootAt = performance.now();
    },
    { tp: P.touchPoints || 0, gpu: P.gpu, cores: P.cores, memory: P.memory },
  );
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => { errors.push(String(e).slice(0, 200)); log('pageerror', String(e).slice(0, 160)); });
  let loads = 0;
  p.on('load', () => loads++);
  const cdp = P.engine === 'chromium' ? await ctx.newCDPSession(p) : null;
  const url = `${base}/world?offline=1&skip=1&bday=0&perf=quiet&debug=1`;
  log(profileName, 'goto', url);
  const tGo = Date.now();
  await p.goto(url, { timeout: 600000 });
  await p.waitForFunction(() => window.__w2 && window.__w2.me && window.__w2.running, null, { timeout: 900000, polling: 500 });
  const bootS = (Date.now() - tGo) / 1000;
  const boot = await p.evaluate(() => {
    const g = window.__w2;
    return { quality: g.gfx.quality, lite: g.gfx.lite, weak: g.weakDevice, pr: g.gfx.renderer.getPixelRatio(), buffer: [g.gfx.renderer.domElement.width, g.gfx.renderer.domElement.height], shadowMap: g.gfx.sun.shadow.mapSize.x, diet: !!(g.textureDiet && g.textureDiet.on), adaptive: g.adaptive ? g.adaptive.rungs.length : null, tier: window.__w2perf.snapshot().extra };
  });
  log('running after', bootS, 's', JSON.stringify(boot));
  if (process.env.SEED)
    await p.evaluate(() => window.__w2.setSeed({ background: 0, body: 12, accessory: 40, head: 60, glasses: 3 }));
  if (process.env.FREEZE !== '0')
    await p.evaluate(() => { const g = window.__w2; if (g.adaptive) g.adaptive.frozen = true; });
  if (P.throttle && cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: P.throttle });
  await p.evaluate(() => window.__w2perf.reset());

  const results = { profile: profileName, engine: P.engine, bootS, boot, scenarios: {}, rss: [], errors };
  const save = () => fs.writeFileSync(out, JSON.stringify(results, null, 1));
  const gc = async () => { if (cdp) await cdp.send('HeapProfiler.collectGarbage').catch(() => {}); };
  const snap = () => p.evaluate(() => window.__w2perf.snapshot());
  const brief = s =>
    `frame p50 ${s.frame.p50.toFixed(0)} p95 ${s.frame.p95.toFixed(0)} max ${s.frame.max.toFixed(0)} | cpu p50 ${s.cpu.p50.toFixed(1)} p95 ${s.cpu.p95.toFixed(1)} max ${s.cpu.max.toFixed(0)} | draws ${s.render?.calls} progs ${s.render?.programs} tex ${s.render?.textures} geo ${s.render?.geometries} | heap ${s.heapMB?.toFixed(0)} | hitches ${s.hitchLog.length}`;
  const measure = async (name, fn) => {
    await p.evaluate(() => window.__w2perf.reset());
    const prof = process.env.PROF && cdp;
    if (prof) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
    const t0 = Date.now();
    const extra = (await fn()) || {};
    if (prof) { const { profile } = await cdp.send('Profiler.stop'); fs.writeFileSync(out.replace('.json', `-${name}.cpuprofile`), JSON.stringify(profile)); }
    const s = await snap();
    const r = rss();
    results.scenarios[name] = { ...s, wallS: (Date.now() - t0) / 1000, rss: r, ...extra };
    results.rss.push({ at: (Date.now() - t00) / 1000, name, ...r, heap: s.heapMB, tex: s.render?.textures, geo: s.render?.geometries, progs: s.render?.programs });
    log(name, brief(s), 'rss', JSON.stringify(r), JSON.stringify(extra));
    const worst = s.hitchLog.slice().sort((a, b) => b.cpuMs + b.frameMs / 10 - (a.cpuMs + a.frameMs / 10)).slice(0, 4);
    for (const h of worst) log('     hitch', h.frameMs, 'ms gap /', h.cpuMs, 'ms cpu', JSON.stringify(h.top));
    save();
  };
  const keys = (on, ...k) => p.evaluate(([on, k]) => { const s = window.__w2.input.keys; for (const x of k) on ? s.add(x) : s.delete(x); }, [on, k]);
  const toPlaza = () =>
    p.evaluate(() => {
      const g = window.__w2;
      const V = g.player.pos.constructor;
      const hit = g.world.raycast(new V(0, 40, 14), new V(0, -1, 0), 80);
      g.player.spawn(new V(0, (hit ? hit.point.y : g.player.pos.y) + 0.05, 14), 0);
      g.player.vel.set(0, 0, 0);
      g.cam.snap(g.player);
    });

  if (SCEN.includes('camp'))
    await measure('camp', async () => {
      await sleep(20000);
      return await p.evaluate(() => ({ inCamp: !!(window.__w2.camp && window.__w2.camp.inside) }));
    });
  if (SCEN.includes('escape'))
    await measure('escape', async () => {
      // Skip whatever's left of the intro, face the window, walk out
      await p.mouse.click(5, 5).catch(() => {});
      await keys(true, 'KeyW');
      await sleep(20000);
      await keys(false, 'KeyW');
      return await p.evaluate(() => { const g = window.__w2; return { y: +g.player.pos.y.toFixed(1), sky: !!(g.skydive && g.skydive.active) }; });
    });
  await toPlaza();
  await sleep(3000);
  if (SCEN.includes('remotes'))
    await measure('remotes', async () => {
      await p.evaluate(() => {
        const g = window.__w2;
        let t = 0;
        g.__bots = setInterval(() => {
          t += 0.1;
          const me = g.player.pos;
          for (let i = 0; i < 16; i++) {
            const a = t * 0.4 + (i / 16) * Math.PI * 2;
            const r = 6 + (i % 4) * 3;
            const yaw = a + Math.PI / 2;
            g.net.ingest(`bot${i}`, {
              x: me.x + Math.cos(a) * r, y: me.z + Math.sin(a) * r, airborneY: me.y,
              seedKey: `${i % 2}-${i % 30}-${(i * 7) % 130}-${(i * 13) % 230}-${i % 20}`,
              state: JSON.stringify({ v: 2, q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], b: [0, 0, 0, 1], a: i % 3 ? 'skate_idle' : 'skate_push', m: 'board', sp: 6, n: `bot ${i}`, tr: i % 2 ? 'KICKFLIP + 50-50' : '' }),
            });
          }
        }, 100);
      });
      // Riders arriving is part of the session: measure from the first packet
      await sleep(24000);
      await p.evaluate(() => { const g = window.__w2; clearInterval(g.__bots); for (let i = 0; i < 16; i++) g.net.players.delete(`bot${i}`); });
    });
  if (SCEN.includes('skate'))
    await measure('skate', async () => {
      await keys(true, 'KeyW', 'KeyD');
      await sleep(15000);
      await keys(false, 'KeyW', 'KeyD');
    });
  if (SCEN.includes('mountain'))
    await measure('mountain', async () => {
      const ok = await p.evaluate(() => {
        const g = window.__w2;
        if (!g.mountainHero) return false;
        g.player.spawn(g.mountainHero.pos, g.mountainHero.yaw);
        g.cam.snap(g.player);
        return true;
      });
      await keys(true, 'KeyW');
      await sleep(20000);
      await keys(false, 'KeyW');
      return { ok, down: await p.evaluate(() => window.__w2.hud.mountain?.down ?? null) };
    });
  if (SCEN.includes('room')) {
    await toPlaza();
    await sleep(2000);
    await measure('room-enter', async () => {
      const t0 = Date.now();
      const ok = await p.evaluate(() => {
        const g = window.__w2;
        const d = g.interiors.doors();
        const plaza = d.slice().sort((a, b) => Math.hypot(a.x ?? a.pos?.x ?? 0, a.z ?? a.pos?.z ?? 0) - Math.hypot(b.x ?? b.pos?.x ?? 0, b.z ?? b.pos?.z ?? 0))[0];
        return plaza ? g.interiors.debugEnter(plaza.id) : false;
      });
      await p.waitForFunction(() => window.__w2.interiors.inside, null, { timeout: 120000 }).catch(() => log('never inside'));
      const inMs = Date.now() - t0;
      await sleep(10000);
      return { ok, inMs, lastBuildMs: await p.evaluate(() => Math.round(window.__w2.interiors.stats.lastBuildMs)) };
    });
    await measure('room-leave', async () => {
      await p.evaluate(() => window.__w2.interiors.requestLeave());
      await p.waitForFunction(() => !window.__w2.interiors.inside, null, { timeout: 60000 }).catch(() => {});
      await sleep(4000);
    });
  }
  if (SCEN.includes('car'))
    await measure('car', async () => {
      await toPlaza();
      const ok = await p.evaluate(() => window.__w2.cars.arrive());
      await sleep(1500);
      await keys(true, 'KeyW');
      await sleep(15000);
      await keys(false, 'KeyW');
      const mtn = await p.evaluate(() => { const m = window.__w2.mountain; return m ? { lastMs: +m.stats.lastFrameMs.toFixed(1), maxMs: +m.stats.maxFrameMs.toFixed(1), propsMs: +(m.stats.propsMs ?? 0).toFixed(0), chunks: m.stats.chunks } : null; });
      await p.evaluate(() => { const c = window.__w2.cars; if (c.inCar) c.requestToggle(); });
      await sleep(2000);
      return { ok, mtn };
    });
  if (SCEN.includes('breaks'))
    await measure('breaks', async () => {
      await toPlaza();
      const ok = await p.evaluate(() => { const b = window.__w2.breaks; const a = b.arrive(); if (a) b.vsCpu(); return a; });
      await sleep(20000);
      await p.evaluate(() => { const b = window.__w2.breaks; try { b.exit ? b.exit() : b.backToSkating?.(); } catch {} });
      await sleep(2000);
      return { ok, active: await p.evaluate(() => window.__w2.breaks.active) };
    });
  if (SCEN.includes('mural'))
    await measure('mural', async () => {
      await toPlaza();
      // Find a wall: turn on the spot until mural mode takes
      const ok = await p.evaluate(async () => {
        const g = window.__w2;
        const V = g.player.pos.constructor;
        for (const [x, z] of [[0, 14], [8, 20], [-8, 20], [0, -6], [12, 0]]) {
          const hit = g.world.raycast(new V(x, 40, z), new V(0, -1, 0), 80);
          for (let k = 0; k < 8; k++) {
            g.player.spawn(new V(x, (hit ? hit.point.y : 0) + 0.05, z), (k / 8) * Math.PI * 2);
            g.cam.snap(g.player);
            await new Promise(r => setTimeout(r, 400));
            if (g.mural.enter()) return [x, z, k];
          }
        }
        return null;
      });
      await sleep(3000);
      const vp = P.ctx.viewport;
      for (let s = 0; s < 12; s++) {
        const y = vp.height * (0.3 + 0.04 * s);
        await p.mouse.move(vp.width * 0.3, y);
        await p.mouse.down();
        for (let i = 1; i <= 20; i++) await p.mouse.move(vp.width * (0.3 + 0.02 * i), y + Math.sin(i / 3) * 20);
        await p.mouse.up();
      }
      await sleep(2000);
      await p.evaluate(() => window.__w2.mural.exit());
      return { ok };
    });
  if (SCEN.includes('soak')) {
    const min = +(process.env.SOAK_MIN || 4);
    await toPlaza();
    const samples = [];
    const tEnd = Date.now() + min * 60000;
    let i = 0;
    await p.evaluate(() => window.__w2perf.reset());
    while (Date.now() < tEnd) {
      // Skate about: alternate turns, an ollie now and then, respawn if lost
      await keys(true, 'KeyW', i % 2 ? 'KeyA' : 'KeyD');
      for (let k = 0; k < 4; k++) { await sleep(4000); await keys(true, 'Space'); await sleep(200); await keys(false, 'Space'); }
      await keys(false, 'KeyW', 'KeyA', 'KeyD');
      if (i % 3 === 2) await toPlaza();
      await gc();
      const s = await snap();
      const r = rss();
      samples.push({ at: Math.round((Date.now() - t00) / 1000), heap: s.heapMB, tex: s.render?.textures, geo: s.render?.geometries, progs: s.render?.programs, cpuP95: s.cpu.p95, hitches: s.hitchLog.length, ...r });
      log('soak', JSON.stringify(samples[samples.length - 1]));
      i++;
    }
    const s = await snap();
    results.scenarios.soak = { ...s, samples };
    for (const h of s.hitchLog.slice().sort((a, b) => b.cpuMs - a.cpuMs).slice(0, 6)) log('     hitch', h.frameMs, 'ms gap /', h.cpuMs, 'ms cpu', JSON.stringify(h.top));
  }
  results.loads = loads;
  save();
  await b.close();
  log('done, page loads', loads);
})().catch(e => { console.error(e); process.exit(1); });
