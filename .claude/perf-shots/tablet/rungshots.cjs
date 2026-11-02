// node rungshots.cjs <base> <outDir> <prefix>: iPad (WebKit) plaza shots at each
// lite state, to check the no-relink shadow / ink rungs look as they should.
const { webkit } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const [, , base, dir, prefix] = process.argv;
(async () => {
  const b = await webkit.launch({ executablePath: process.env.WEBKIT || '/tmp/claude-0/pw/webkit-2191/pw_run.sh' });
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }));
  const p = await ctx.newPage();
  await p.goto(`${base}/world?offline=1&skip=1&bday=0&perf=quiet&debug=1&spawn=plaza&camintro=0`, { timeout: 600000 });
  await p.waitForFunction(() => window.__w2 && window.__w2.me && window.__w2.running, null, { timeout: 900000, polling: 500 });
  await p.evaluate(() => {
    const g = window.__w2;
    if (g.adaptive) g.adaptive.frozen = true;
    const V = g.player.pos.constructor;
    const hit = g.world.raycast(new V(2, 40, 10), new V(0, -1, 0), 80);
    g.player.spawn(new V(2, (hit ? hit.point.y : 0) + 0.05, 10), 2.4);
    g.cam.snap(g.player);
    document.querySelectorAll('[data-perf-overlay]').forEach(e => e.remove());
  });
  await new Promise(r => setTimeout(r, 8000));
  for (const [name, lite] of [['on', { scale: 0.75, shadows: true, post: true }], ['noshadow', { scale: 0.75, shadows: false, post: true }], ['noink', { scale: 0.75, shadows: false, post: false }], ['back', { scale: 0.75, shadows: true, post: true }]]) {
    await p.evaluate(l => window.__w2.gfx.applyLite(l), lite);
    await new Promise(r => setTimeout(r, 5000));
    await p.screenshot({ path: `${dir}/${prefix}-${name}.jpg`, quality: 70, type: 'jpeg', timeout: 120000 });
    console.log('shot', name);
  }
  await b.close();
})();
