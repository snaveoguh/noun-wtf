const { chromium } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const SP = process.env.SP; const OUT = SP + '/shots/';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto('http://127.0.0.1:5196/world?offline=1&skip=1&q=high&bday=0&play=surf', { timeout: 300000 });
  await p.waitForFunction(() => !document.querySelector('[data-w2loader]') && window.__w2?.me && window.__w2.ocean.water.phase !== 'off', null, { timeout: 600000 });
  await p.evaluate(() => { const g = window.__w2; g.running = false; g.ocean.manualClock = 40; for (let i = 0; i < 30; i++) g.step(1/30); g.ocean.surfAuto(true); });
  await p.addStyleTag({ content: 'body *{visibility:hidden!important} canvas{visibility:visible!important}' });
  await p.evaluate(() => { for (const c of document.querySelectorAll('canvas')) { let e = c; while (e) { e.style && e.style.setProperty('visibility', 'visible', 'important'); e = e.parentElement; } } });
  for (let i = 0; i < 80; i++) { const ok = await p.evaluate(() => { const g = window.__w2; for (let k = 0; k < 30; k++) g.step(1/30); const s = g.ocean.water; return s.phase === 'ride' && s.rideT > 2.5; }); if (ok) break; }
  const views = [
    // [toward shore m, along -a m, height m, look height, fov]
    [7, 2, 1.0, 0.7, 45], [5, -5, 0.8, 0.8, 50], [9, 6, 2.2, 0.5, 42], [4, 1, 0.6, 0.9, 60], [12, -8, 3, 0.4, 35], [-6, 3, 2.5, 0.5, 45],
  ];
  let i = 0;
  for (const v of views) {
    await p.evaluate(async v => {
      const g = window.__w2; const s = g.ocean.water; const V = g.player.pos.constructor;
      const sea = await import('/src/miniapps/world2/ocean/sea.ts');
      for (let k = 0; k < 8; k++) g.step(1/30);
      const sp = sea.seaAt(s.x, s.z, g.ocean.t, sea.blankSea());
      g.cam.rig = { pos: new V(s.x + sp.sx * v[0] - sp.ax * v[1], sp.y + v[2], s.z + sp.sz * v[0] - sp.az * v[1]), look: new V(s.x, s.y + v[3], s.z), fov: v[4] };
      g.step(1/30);
    }, v);
    await p.screenshot({ path: OUT + 'cov-' + (i++) + '.png', timeout: 240000 });
    console.log('cov', i, JSON.stringify(await p.evaluate(() => { const s = window.__w2.ocean.water; return [s.phase, +s.rideT.toFixed(1)]; })));
  }
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
