// node ladder.cjs <base> <out.json> [secs]: iPad (WebKit), the adaptive
// controller left running while skating the plaza: every rung change, and the
// frames around it (a step to shadows-off / post-off relinks every lit material).
const { webkit } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const fs = require('fs');
const [, , base, out, secs] = process.argv;
(async () => {
  const b = await webkit.launch({ executablePath: process.env.WEBKIT || '/tmp/claude-0/pw/webkit-2191/pw_run.sh' });
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' });
  await ctx.addInitScript(() => Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }));
  const p = await ctx.newPage();
  await p.goto(`${base}/world?offline=1&skip=1&bday=0&perf=quiet&debug=1&spawn=plaza&camintro=0`, { timeout: 600000 });
  await p.waitForFunction(() => window.__w2 && window.__w2.me && window.__w2.running, null, { timeout: 900000, polling: 500 });
  const boot = await p.evaluate(() => ({ rungs: window.__w2.adaptive?.rungs, lite: window.__w2.gfx.lite }));
  console.log('boot', JSON.stringify(boot));
  await p.evaluate(() => { const g = window.__w2; g.input.keys.add('KeyW'); g.input.keys.add('KeyD'); window.__w2perf.reset(); });
  const events = [];
  let last = -1;
  const tEnd = Date.now() + (+secs || 120) * 1000;
  while (Date.now() < tEnd) {
    const s = await p.evaluate(() => { const g = window.__w2; return { at: g.adaptive?.at, lite: g.gfx.lite, progs: g.gfx.renderer.info.programs?.length, t: performance.now() }; });
    if (s.at !== last) {
      // The frames around the step: read 2 s later (before the log rotates)
      await new Promise(r => setTimeout(r, 2000));
      const around = await p.evaluate(t => window.__w2perf.snapshot().hitchLog.filter(h => h.at > t - 1500), s.t);
      s.worstCpu = Math.max(0, ...around.map(h => h.cpuMs));
      s.worstGap = Math.max(0, ...around.map(h => h.frameMs));
      s.top = around.sort((a, b) => b.cpuMs - a.cpuMs)[0]?.top ?? null;
      s.progsAfter = await p.evaluate(() => window.__w2.gfx.renderer.info.programs?.length);
      events.push(s);
      console.log((s.t / 1000).toFixed(1), 'rung', s.at, JSON.stringify(s.lite), 'programs', s.progs, '->', s.progsAfter, 'worst frame around it: cpu', s.worstCpu, 'gap', s.worstGap, JSON.stringify(s.top));
      last = s.at;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  const snap = await p.evaluate(() => window.__w2perf.snapshot());
  const worst = snap.hitchLog.slice().sort((a, b) => b.cpuMs - a.cpuMs).slice(0, 8);
  for (const h of worst) console.log('hitch at', (h.at / 1000).toFixed(1), h.frameMs, 'ms gap /', h.cpuMs, 'ms cpu', JSON.stringify(h.top));
  fs.writeFileSync(out, JSON.stringify({ boot, events, worst, frame: snap.frame, cpu: snap.cpu }, null, 1));
  await b.close();
})();
