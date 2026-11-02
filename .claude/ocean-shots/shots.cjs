const { chromium } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const SP = process.env.SP;
const OUT = SP + '/shots/';
const which = (process.env.WHICH || 'ride,beach,sunset,shop').split(',');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const phone = process.env.PHONE === '1';
  const p = await b.newPage(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await p.goto('http://127.0.0.1:5196/world?offline=1&skip=1&q=low&bday=0&play=surf', { timeout: 300000 });
  await p.waitForFunction(() => !document.querySelector('[data-w2loader]') && window.__w2?.me && window.__w2.ocean.water.phase !== 'off', null, { timeout: 600000 });
  await p.evaluate(() => { const g = window.__w2; g.running = false; g.ocean.manualClock = 40; });
  const step = (n, dt = 1 / 30) => p.evaluate(([n, dt]) => { const g = window.__w2; for (let i = 0; i < n; i++) g.step(dt); }, [n, dt]);
  const hud = on => p.evaluate(on => {
    let st = document.getElementById('__nohud');
    if (!on) { if (!st) { st = document.createElement('style'); st.id = '__nohud'; document.head.appendChild(st); }
      st.textContent = 'body *{visibility:hidden!important} canvas{visibility:visible!important}';
      for (const c of document.querySelectorAll('canvas')) { let e = c; while (e) { e.style && e.style.setProperty('visibility', 'visible', 'important'); e = e.parentElement; } }
    } else if (st) st.remove();
  }, on);
  const shot = async (name, withHud = false) => { await hud(withHud); await step(1); await p.screenshot({ path: OUT + name + '.png', timeout: 240000 }); console.log('shot', name); };
  const state = () => p.evaluate(() => { const g = window.__w2, o = g.ocean, s = o.water; return { phase: s.phase, rideT: +s.rideT.toFixed(1), v: +Math.hypot(s.vx, s.vz).toFixed(1), pos: [s.x, s.y, s.z].map(v => +v.toFixed(1)), combo: g.player.combo.entries.map(e => e.name).join(' + ') }; });
  await step(30);
  if (which.includes('ride')) {
    await p.evaluate(() => window.__w2.ocean.surfAuto(true));
    let st;
    for (let i = 0; i < 80; i++) { await step(30); st = await state(); if (st.phase === 'ride' && st.rideT > 3) break; }
    console.log('ride state', JSON.stringify(st));
    await shot((phone ? 'phone-' : '') + 'b-ride');
    if (phone) await shot('phone-b-ride-hud', true);
    await step(45);
    console.log('ride state 2', JSON.stringify(await state()));
    await shot((phone ? 'phone-' : '') + 'b-ride2', true);
    if (!phone) {
      // a side-on look at the rider on the face (from the beach side)
      await p.evaluate(async () => {
        const g = window.__w2; const s = g.ocean.water; const V = g.player.pos.constructor;
        const sea = await import('/src/miniapps/world2/ocean/sea.ts');
        const sp = sea.seaAt(s.x, s.z, g.ocean.t, sea.blankSea());
        g.cam.rig = { pos: new V(s.x + sp.sx * 9 - sp.ax * 4, s.y + 1.6, s.z + sp.sz * 9 - sp.az * 4), look: new V(s.x, s.y + 0.6, s.z), fov: 50 };
      });
      await shot('b-ride-side');
      await p.evaluate(() => { window.__w2.cam.rig = null; });
    }
    await p.evaluate(() => window.__w2.ocean.surfAuto(false));
  }
  if (which.includes('beach')) {
    // on the ocean beach (below the boardwalk), looking out to sea
    await p.evaluate(() => {
      const g = window.__w2; const o = g.ocean;
      const site = window.__oceanSite || null;
      const sp = o.shopSpot();
      const V = g.player.pos.constructor;
      // the shop's spot is on the boardwalk; walk 9 m out toward the sea along the shore direction
      const c = o.water; c.phase = 'off';
      const f = g.player; 
      const fr = window.__w2.ocean;
      return sp;
    });
    await p.evaluate(async () => {
      const g = window.__w2; const o = g.ocean;
      const m = await import('/src/miniapps/world2/towns/site.ts');
      const coast = await import('/src/miniapps/world2/ocean/coast.ts');
      const c = coast.coastFrameNow(); const f = c.town;
      const w = m.townToWorld(f, coast.COAST.shore - 5, c.uB + 30, { x: 0, z: 0 });
      const V = g.player.pos.constructor;
      const yaw = m.townYaw(f, 1, 0.35);
      g.player.spawn(new V(w.x, f.P, w.z), yaw);
      g.cam.snap(g.player);
    });
    await step(60);
    console.log('beach state', JSON.stringify(await state()));
    await shot('c-beach');
  }
  if (which.includes('sunset')) {
    await p.evaluate(() => window.__w2.setTimeOfDay('golden', 0));
    await step(40);
    await shot('d-sunset');
    await p.evaluate(() => window.__w2.setTimeOfDay('blue', 0));
    await step(40);
    await shot('d-dusk');
    await p.evaluate(() => window.__w2.setTimeOfDay('afternoon', 0));
    await step(10);
  }
  if (which.includes('shop')) {
    await p.evaluate(async () => {
      const g = window.__w2; const o = g.ocean; const sp = o.shopSpot();
      const m = await import('/src/miniapps/world2/towns/site.ts');
      const coast = await import('/src/miniapps/world2/ocean/coast.ts');
      const f = coast.coastFrameNow().town;
      const V = g.player.pos.constructor;
      const w = m.townToWorld(f, 116.5, 70 + 12, { x: 0, z: 0 });
      g.player.spawn(new V(w.x, f.P + 1.2, w.z), m.townYaw(f, 0.6, -1));
      g.cam.snap(g.player);
    });
    await step(60);
    await shot('e-shopfront');
    await p.evaluate(() => window.__w2.ocean.openShop());
    await step(2);
    await shot('e-shop', true);
  }
  console.log('errors', errs.join('\n'));
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
