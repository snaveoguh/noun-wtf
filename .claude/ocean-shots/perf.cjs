const { chromium } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const q = process.env.Q || 'low';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const phone = q === 'low';
  const p = await b.newPage(phone ? { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : { viewport: { width: 1280, height: 800 } });
  await p.goto(`http://127.0.0.1:5196/world?offline=1&skip=1&q=${q}&bday=0&play=surf&perf=quiet`, { timeout: 300000 });
  await p.waitForFunction(() => !document.querySelector('[data-w2loader]') && window.__w2?.me && window.__w2.ocean.water.phase !== 'off', null, { timeout: 600000 });
  await p.evaluate(() => window.__w2.ocean.surfAuto(true));
  const settle = ms => new Promise(r => setTimeout(r, ms));
  await settle(20000);
  const snap = async label => {
    await p.evaluate(() => window.__w2perf.reset?.());
    await settle(25000);
    const s = await p.evaluate(() => window.__w2perf.snapshot());
    const sys = (s.systems || []).slice(0, 8).map(x => `${x.name}:${x.mean.toFixed(2)}/${x.p95.toFixed(2)}`).join(' ');
    console.log(label, JSON.stringify({ frames: s.frame?.count ?? s.frames, cpu: s.cpu && { p50: +s.cpu.p50.toFixed(1), p95: +s.cpu.p95.toFixed(1), max: +(s.cpu.max ?? 0).toFixed(0) }, frame: s.frame && { p50: +s.frame.p50.toFixed(0), p99: +s.frame.p99.toFixed(0), max: +s.frame.max.toFixed(0), hitches: s.frame.hitches }, render: s.render && { calls: s.render.calls, tris: s.render.triangles, progs: s.render.programs, tex: s.render.textures }, heap: s.heapMB && +s.heapMB.toFixed(0), long: s.longTasks }));
    console.log('  systems', sys);
    console.log('  water', JSON.stringify(await p.evaluate(() => { const o = window.__w2.ocean; return { phase: o.water.phase, rideT: +o.water.rideT.toFixed(1), surface: !!o.surface, life: !!o.life }; })));
  };
  await snap('WITH OCEAN');
  await p.evaluate(() => { const o = window.__w2.ocean; o.surface.mesh.visible = false; o.life.group.visible = false; });
  await snap('OCEAN HIDDEN');
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
