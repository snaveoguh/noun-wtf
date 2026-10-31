// node measure.cjs <baseUrl> <profile> <outJson> [scenarios]
const { chromium } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const fs = require('fs');

const [, , base, profileName, out, scen] = process.argv;
const SCEN = (scen || 'idle,skate,remotes,interior,drop').split(',');

const PROFILES = {
  desktop: {
    ctx: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    throttle: 1,
    gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
    cores: 8,
    memory: 16,
  },
  mid: {
    ctx: {
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    },
    throttle: 4,
    gpu: 'Mali-G710 MC10',
    cores: 8,
    memory: 8,
  },
  weak: {
    ctx: {
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.6,
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (Linux; Android 12; moto g06) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
    },
    throttle: 6,
    gpu: 'Mali-G52 MC2',
    cores: 8,
    memory: 4,
  },
};

const P = PROFILES[profileName];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

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
    },
    { gpu: P.gpu, cores: P.cores, memory: P.memory },
  );
  const p = await ctx.newPage();
  p.on('pageerror', e => log('pageerror', String(e).slice(0, 200)));
  const cdp = await ctx.newCDPSession(p);
  const url = `${base}/world?offline=1&skip=1&bday=0&perf=quiet&debug=1&spawn=plaza`;
  log('goto', url);
  await p.goto(url, { timeout: 600000 });
  await p.getByText('PRESS START').first().click({ force: true, timeout: 600000 }).catch(e => log('no start', e.message));
  await p.waitForFunction(() => window.__w2 && window.__w2.me && window.__w2.running, null, {
    timeout: 900000,
    polling: 2000,
  });
  log('running');
  // Freeze the quality controllers so builds compare like for like
  // (each build's controller is reported separately)
  const freeze = await p.evaluate(() => {
    const g = window.__w2;
    g.ladder = null;
    g.__noAdapt = setInterval(() => {
      g.lowFpsTime = 0;
      if (g.quality && g.quality.freeze) g.quality.freeze();
    }, 200);
    if (g.adaptive) g.adaptive.frozen = true;
    return {
      quality: g.gfx.quality,
      lite: g.gfx.lite,
      weak: g.weakDevice,
      pr: g.gfx.renderer.getPixelRatio(),
    };
  });
  log('boot', JSON.stringify(freeze));
  // Same spot and view for every build: plaza, facing +Z
  const spot = await p.evaluate(() => {
    const g = window.__w2;
    const V = g.player.pos.constructor;
    const hit = g.world.raycast(new V(0, 40, 14), new V(0, -1, 0), 80);
    const y = hit ? hit.point.y : g.player.pos.y;
    g.player.spawn(new V(0, y + 0.05, 14), 0);
    g.player.vel.set(0, 0, 0);
    g.cam.snap(g.player);
    return { y };
  });
  log('spawn', JSON.stringify(spot));
  // SEED=1: the same rider in every run (head models range from ~1k to ~30k triangles)
  if (process.env.SEED)
    await p.evaluate(() =>
      window.__w2.setSeed({ background: 0, body: 12, accessory: 40, head: 60, glasses: 3 }),
    );
  await sleep(15000); // settle: lazy systems, first compiles
  if (P.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: P.throttle });

  const results = { profile: profileName, boot: freeze, scenarios: {} };
  const measure = async (name, ms) => {
    await p.evaluate(() => window.__w2perf.reset());
    const prof = process.env.PROF === name;
    if (prof) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    }
    await sleep(ms);
    if (prof) {
      const { profile } = await cdp.send('Profiler.stop');
      fs.writeFileSync(out.replace('.json', `-${name}.cpuprofile`), JSON.stringify(profile));
    }
    const s = await p.evaluate(() => window.__w2perf.snapshot());
    results.scenarios[name] = s;
    log(
      name,
      `fps ${s.frame.fps.toFixed(1)} frame p50 ${s.frame.p50.toFixed(1)} p95 ${s.frame.p95.toFixed(1)} p99 ${s.frame.p99.toFixed(1)}`,
      `cpu p50 ${s.cpu.p50.toFixed(1)} p95 ${s.cpu.p95.toFixed(1)} p99 ${s.cpu.p99.toFixed(1)}`,
      `draws ${s.render?.calls} tris ${s.render?.triangles} progs ${s.render?.programs}`,
      `heap ${s.heapMB?.toFixed(0)} alloc ${s.allocMBps?.toFixed(1)} lt ${s.longTasks.count}/${s.longTasks.maxMs.toFixed(0)}`,
    );
    log('   ', s.systems.slice(0, 8).map(x => `${x.name}:${x.mean.toFixed(2)}/${x.p95.toFixed(1)}`).join(' '));
    fs.writeFileSync(out, JSON.stringify(results, null, 1));
  };
  const keys = (on, ...k) =>
    p.evaluate(
      ([on, k]) => {
        const s = window.__w2.input.keys;
        for (const x of k) on ? s.add(x) : s.delete(x);
      },
      [on, k],
    );

  if (SCEN.includes('idle')) await measure('plaza-idle', 12000);
  if (SCEN.includes('skate')) {
    await keys(true, 'KeyW', 'KeyD');
    await sleep(1500);
    await measure('skate-loop', 15000);
    await keys(false, 'KeyW', 'KeyD');
    await sleep(1000);
  }
  if (SCEN.includes('remotes')) {
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
            x: me.x + Math.cos(a) * r,
            y: me.z + Math.sin(a) * r,
            airborneY: me.y,
            seedKey: `${i % 2}-${i % 30}-${(i * 7) % 130}-${(i * 13) % 230}-${i % 20}`,
            state: JSON.stringify({
              v: 2,
              q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
              b: [0, 0, 0, 1],
              a: i % 3 ? 'skate_idle' : 'skate_push',
              m: 'board',
              sp: 6,
              n: `bot ${i}`,
              tr: i % 2 ? 'KICKFLIP + 50-50' : '',
            }),
          });
        }
      }, 100);
    });
    await sleep(20000); // build their Nouns (load heads)
    await measure('remotes-16', 12000);
    await p.evaluate(() => {
      const g = window.__w2;
      clearInterval(g.__bots);
      for (let i = 0; i < 16; i++) {
        g.net.players.delete(`bot${i}`);
      }
    });
    await sleep(2000);
  }
  // NOUNS CAMP: wake up in it as a first spawn does, look round, then out of the window
  if (SCEN.includes('camp')) {
    const ok = await p.evaluate(() => window.__w2.camp.spawnInside());
    log('camp', ok);
    await sleep(4000);
    await measure('camp-spawn', 12000);
    // Stood at the window looking out over the plaza (the most world it shows)
    await p.evaluate(() => {
      const g = window.__w2;
      const s = g.camp.site;
      const V = g.player.pos.constructor;
      g.player.spawn(new V(s.origin.x - 0.5, s.floorY + 0.05, s.origin.z + 0.6), Math.PI);
      g.cam.snap(g.player);
    });
    await sleep(3000);
    await measure('camp-window', 12000);
    await sleep(1000);
  }
  if (SCEN.includes('interior')) {
    const ok = await p.evaluate(() => {
      const g = window.__w2;
      const d = g.interiors.doors();
      const plaza = d.slice().sort(
        (a, b) =>
          Math.hypot(a.x ?? a.pos?.x ?? 0, a.z ?? a.pos?.z ?? 0) -
          Math.hypot(b.x ?? b.pos?.x ?? 0, b.z ?? b.pos?.z ?? 0),
      )[0];
      window.__t0 = performance.now();
      window.__w2perf.reset();
      return plaza ? g.interiors.debugEnter(plaza.id) : false;
    });
    log('enter', ok);
    if (process.env.PROF === 'int-enter') { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); await sleep(20000); const { profile } = await cdp.send('Profiler.stop'); fs.writeFileSync(out.replace('.json', '-int-enter.cpuprofile'), JSON.stringify(profile)); }
    await p.waitForFunction(() => window.__w2.interiors.inside, null, { timeout: 120000 }).catch(() => log('never inside'));
    const enter = await p.evaluate(() => {
      const s = window.__w2perf.snapshot();
      return { ms: performance.now() - window.__t0, maxFrame: s.frame.max, longMax: s.longTasks.maxMs, hitches: s.frame.hitches };
    });
    log('enter took', JSON.stringify(enter));
    results.enterInterior = enter;
    await sleep(3000);
    await measure('interior', 10000);
    await p.evaluate(() => {
      window.__w2perf.reset();
      window.__w2.interiors.requestLeave();
    });
    await p.waitForFunction(() => !window.__w2.interiors.inside, null, { timeout: 60000 }).catch(() => {});
    await sleep(2000);
    const leave = await p.evaluate(() => {
      const s = window.__w2perf.snapshot();
      return { maxFrame: s.frame.max, hitches: s.frame.hitches };
    });
    results.leaveInterior = leave;
    log('leave', JSON.stringify(leave));
    await sleep(2000);
  }
  if (SCEN.includes('drop')) {
    if (process.env.PROF === 'drop-enter') { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
    await p.evaluate(() => {
      window.__w2perf.reset();
      window.__w2.missions.enterUpsideDown();
    });
    if (process.env.PROF === 'drop-enter') { await sleep(12000); const { profile } = await cdp.send('Profiler.stop'); fs.writeFileSync(out.replace('.json', '-drop-enter.cpuprofile'), JSON.stringify(profile)); }
    await sleep(20000);
    const enter = await p.evaluate(() => window.__w2perf.snapshot());
    results.enterDrop = { maxFrame: enter.frame.max, hitches: enter.frame.hitches, longMax: enter.longTasks.maxMs };
    log('drop enter', JSON.stringify(results.enterDrop));
    await keys(true, 'KeyW');
    await sleep(2000);
    await measure('big-drop', 15000);
    await keys(false, 'KeyW');
  }
  fs.writeFileSync(out, JSON.stringify(results, null, 1));
  if (process.env.SHOT) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await p.screenshot({ path: process.env.SHOT, timeout: 180000 }).catch(e => log('shot fail', e.message));
  }
  await b.close();
  log('done');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
