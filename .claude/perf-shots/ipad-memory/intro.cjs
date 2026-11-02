// node intro.cjs <base> [engine] : the real CAMP intro + reading on a desktop
// profile, real frames, every page error and whether the canvas keeps drawing.
const { chromium, webkit } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const [, , base, engine = 'chromium'] = process.argv;
(async () => {
  const b = engine === 'webkit'
    ? await webkit.launch({ executablePath: '/tmp/claude-0/pw/webkit-2191/pw_run.sh' })
    : await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: +(process.env.W || 900), height: +(process.env.H || 560) }, deviceScaleFactor: +(process.env.DPR || 1) });
  if (process.env.CORES) await ctx.addInitScript(c => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => c }), +process.env.CORES);
  const p = await ctx.newPage();
  const t0 = Date.now();
  const errs = [];
  p.on('pageerror', e => { const s = String(e.stack || e).slice(0, 600); if (!errs.includes(s)) { errs.push(s); console.log(((Date.now() - t0) / 1000).toFixed(0) + 's PAGEERROR', s); } });
  p.on('console', m => { if (m.type() === 'error') console.log('console.error', m.text().slice(0, 300)); });
  await p.goto(`${base}/world?offline=1&skip=1&bday=0&perf=quiet&debug=1${process.env.URLX || ''}`, { timeout: 600000 });
  await p.waitForFunction(() => window.__w2 && window.__w2.running, null, { timeout: 900000, polling: 500 });
  console.log('running, quality', await p.evaluate(() => window.__w2.gfx.quality));
  if (process.env.INJECT) {
    // A throw in the reading shot (the book in the rider's hands), as the Brave freeze looked
    await new Promise(r => setTimeout(r, +process.env.INJECT * 1000));
    console.log('inject', await p.evaluate(() => { const c = window.__w2.camp; if (!c.book) return 'no book'; c.book.hold = () => { throw new Error('injected: book.hold'); }; return 'ok'; }));
  }
  let lastFrames = -1;
  for (let i = 0; i < (+process.env.SECS || 120) / 3; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await p.evaluate(() => { const g = window.__w2; return { campIntro: g.camp.view?.intro ?? g.camp.view_?.intro, guard: g.frameGuard?.errors, frames: g.gfx.renderer.info.render.frame, intro: document.body.dataset.campIntro ?? null, paused: g.paused, hold: g.gfx.hold, trip: !!document.querySelector('[data-trip]') }; });
    console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(s), s.frames === lastFrames ? 'NOT DRAWING' : '');
    lastFrames = s.frames;
  }
  await p.screenshot({ path: process.env.SHOT || '/tmp/claude-0/intro.jpg', type: 'jpeg', quality: 60 });
  console.log('errors', errs.length);
  await b.close();
})();
