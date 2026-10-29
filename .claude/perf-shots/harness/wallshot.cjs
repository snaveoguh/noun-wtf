// node wallshot.cjs <baseUrl> <q> <out.png> [dist] : the most-painted wall from `dist` m, for comparing
// the phone atlas (q=low) with the per-cell path (q=medium). GRAFFITI=<store.json> paints the live store.
// q=saved-low: no ?q=, a Low saved in Settings (the owner's phone), and PLAZA: the plaza spawn view instead.
const { chromium } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const fs = require('fs');
const [, , base, q, out, distArg] = process.argv;
const dist = +(distArg || 30);
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 12; moto g06) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36' });
  const store = fs.readFileSync(process.env.GRAFFITI, 'utf8');
  await ctx.addInitScript(({ store }) => {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 4 });
    localStorage.setItem('w2-graffiti-offline:plaza', store);
    if (location.search.includes('savedlow')) localStorage.setItem('noun-world-settings', JSON.stringify({ v: 2, quality: 'low' }));
    for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const gp = C.prototype.getParameter;
      C.prototype.getParameter = function (p) { return p === 0x9246 ? 'Mali-G52 MC2' : gp.call(this, p); };
    }
  }, { store });
  const p = await ctx.newPage();
  await p.goto(`${base}/world?offline=1&skip=1&bday=0&debug=1${q === 'saved-low' ? '&savedlow=1' : `&q=${q}`}`, { timeout: 600000 });
  await p.getByText('PRESS START').first().click({ force: true, timeout: 600000 }).catch(() => {});
  await p.waitForFunction(() => window.__w2 && window.__w2.me && window.__w2.running, null, { timeout: 900000, polling: 2000 });
  const info = process.env.PLAZA ? await p.evaluate(() => {
    const g = window.__w2;
    const V = g.player.pos.constructor;
    const hit = g.world.raycast(new V(0, 40, 14), new V(0, -1, 0), 80);
    g.player.spawn(new V(0, (hit ? hit.point.y : 0) + 0.05, 14), 0);
    g.cam.snap(g.player);
    return { plaza: true, quality: g.gfx.quality, weak: g.weakDevice, scale: g.gfx.lite.scale };
  }) : await p.evaluate(dist => {
    const g = window.__w2;
    // the wall with the most tags, among upright ones
    let best = null;
    for (const c of g.graffiti.cells.values()) {
      if (Math.abs(c.n.y) > 0.3) continue;
      const n = c.log.items().length ?? 0;
      if (best === null || n > best.n) best = { c, n };
    }
    const c = best.c;
    const at = c.mesh.position.clone();
    const eye = at.clone().addScaledVector(c.n, dist);
    eye.y = at.y + 1;
    g.camHook = cam => { cam.position.copy(eye); cam.lookAt(at); cam.fov = 12; cam.updateProjectionMatrix(); };
    // park the rider out of the way, far from the wall (so it stays a far tile on the phone)
    g.player.pos.set(eye.x, eye.y + 40, eye.z);
    return { id: c.id, tags: best.n, at: at.toArray().map(x => +x.toFixed(1)) };
  }, dist);
  console.log(JSON.stringify(info));
  await new Promise(r => setTimeout(r, 30000));
  await p.evaluate(() => document.querySelectorAll('[class*=hud], .w2-nametag').forEach(e => (e.style.visibility = 'hidden')));
  await p.screenshot({ path: out, timeout: 180000 });
  // SHADOWROOT_OFF=1: the same view again with the rider-only shadow pass off
  if (process.env.SHADOWROOT_OFF) {
    console.log(JSON.stringify(await p.evaluate(() => {
      const g = window.__w2;
      const sm = g.gfx.renderer.shadowMap;
      const r = { root: g.gfx.shadowRoot !== null, cast: g.gfx.sun.castShadow, map: g.gfx.sun.shadow.map !== null, auto: sm.autoUpdate, enabled: sm.enabled };
      g.gfx.shadowRoot = null;
      return r;
    })));
    await new Promise(r => setTimeout(r, 8000));
    await p.screenshot({ path: out.replace('.png', '-rootoff.png'), timeout: 180000 });
  }
  await b.close();
})();
