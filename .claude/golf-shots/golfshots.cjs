// node golfshots.cjs <q> <phone 0|1> <outdir> <shots,comma> [perf]
const { chromium } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const fs = require('fs');
const [q = 'high', phone = '0', out = '.', shotsArg = 'air', perfArg = ''] = process.argv.slice(2);
const shots = shotsArg.split(',').filter(Boolean);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  const ctx =
    phone === '1'
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }
      : { viewport: { width: 1280, height: 800 } };
  const p = await b.newPage(ctx);
  p.on('console', m => {
    const t = m.text();
    if (/golf|error|Error/i.test(t) && !/favicon|404|WebSocket|net::/i.test(t)) log('console:', t.slice(0, 300));
  });
  p.on('pageerror', e => log('pageerror', e.message.slice(0, 300)));
  const url = `http://127.0.0.1:5320/world?offline=1&skip=1&q=${q}&bday=0&perf=quiet&camintro=0`;
  await p.goto(url, { timeout: 600000 });
  await p.waitForFunction(() => !document.querySelector('[data-w2loader]') && window.__w2 && window.__w2.me, null, {
    timeout: 900000,
    polling: 2000,
  });
  log('loaded');
  await p.evaluate(() => {
    const g = window.__w2;
    g.running = false;
    g.setTimeOfDay('afternoon', 0);
    window.__step = (n, dt = 1 / 60) => {
      const pr = window.__w2perf && window.__w2perf.probe;
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const now = performance.now();
        pr?.frameStart(now);
        g.warmer?.tick(dt);
        g.step(dt, now);
        pr?.frameEnd();
        worst = Math.max(worst, performance.now() - now);
      }
      return worst;
    };
  });
  await p.addStyleTag({ content: 'body *{visibility:hidden!important} canvas{visibility:visible!important}' });

  const pose = async (shot, camOn) =>
    p.evaluate(
      ([shot, camOn]) => {
        const g = window.__w2;
        const V = g.player.pos.constructor;
        const ps = g.golfView.pose(shot);
        g.player.spawn(new V(ps.rider.x, ps.rider.y + 0.1, ps.rider.z), ps.rider.yaw);
        g.cam.snap?.(g.player);
        g.camHook = camOn
          ? cam => {
              cam.position.set(ps.cam.x, ps.cam.y, ps.cam.z);
              cam.lookAt(ps.look.x, ps.look.y, ps.look.z);
              cam.updateMatrixWorld();
            }
          : null;
        return ps;
      },
      [shot, camOn],
    );

  const settle = async max => {
    let worst = 0;
    let frames = 0;
    for (let k = 0; k < max; k += 20) {
      const r = await p.evaluate(() => {
        const w = window.__step(20);
        const g = window.__w2;
        return { w, q: g.golfView.stats.queue, m: g.mountain?.stats.pending ?? 0, built: g.golfView.built };
      });
      frames += 20;
      worst = Math.max(worst, r.w);
      if (r.built && r.q === 0 && r.m === 0 && k >= 40) break;
    }
    return { worst, frames };
  };

  const results = {};
  for (const shot of shots) {
    await pose(shot, true);
    // Aerial shots: thin the haze so the course reads (dev shots only)
    await p.evaluate(air => {
      const f = window.__w2.gfx.scene.fog;
      window.__fog0 ??= f.density;
      f.density = air ? window.__fog0 * 0.25 : window.__fog0;
    }, shot === 'air' || shot === 'top');
    const s = await settle(1400);
    const st = await p.evaluate(() => JSON.parse(JSON.stringify(window.__w2.golfView.stats)));
    log(shot, 'settled', JSON.stringify(s), JSON.stringify(st));
    await p.evaluate(() => window.__step(3));
    await p.screenshot({ path: `${out}/${shot}${phone === '1' ? '-phone' : ''}-${q}.png`, timeout: 300000 });
    log('shot', shot);
  }
  if (perfArg !== '') {
    for (const spot of perfArg.split(',')) {
      await pose(spot, false);
      const s = await settle(1400);
      await p.evaluate(() => window.__w2perf.reset());
      await p.evaluate(() => window.__step(90));
      const snap = await p.evaluate(() => {
        const s = window.__w2perf.snapshot();
        const g = window.__w2;
        return {
          frame: s.frame,
          cpu: s.cpu,
          render: s.render,
          systems: s.systems,
          golf: g.golfView.stats,
          hitches: s.hitchLog.length,
        };
      });
      snap.build = s;
      // The course's share: the same frame with its group hidden
      snap.without = await p.evaluate(() => {
        const g = window.__w2;
        const r = g.gfx.renderer;
        g.gfx.scene.remove(g.golfView.group);
        window.__step(2);
        const off = { calls: r.info.render.calls, triangles: r.info.render.triangles };
        g.gfx.scene.add(g.golfView.group);
        window.__step(2);
        const on = { calls: r.info.render.calls, triangles: r.info.render.triangles };
        return { off, on };
      });
      results[spot] = snap;
      log('perf', spot, JSON.stringify({ cpu: snap.cpu, render: snap.render, golf: snap.golf, build: s, without: snap.without }));
      await p.screenshot({ path: `${out}/perf-${spot}${phone === '1' ? '-phone' : ''}-${q}.png`, timeout: 300000 });
    }
    fs.writeFileSync(`${out}/perf-${q}${phone === '1' ? '-phone' : ''}.json`, JSON.stringify(results, null, 1));
  }
  await b.close();
  log('done');
})().catch(e => {
  console.error('FAIL', e);
  process.exit(1);
});
