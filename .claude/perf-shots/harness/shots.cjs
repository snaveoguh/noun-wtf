const { chromium } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const [, , base, outDir, tag, which] = process.argv;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DEV = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  landscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  tablet: { viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
  for (const name of (which || 'phone,landscape,tablet,desktop').split(',')) {
    const ctx = await b.newContext(DEV[name]);
    const p = await ctx.newPage();
    await p.goto(`${base}/world?offline=1&skip=1&bday=0&debug=1&spawn=plaza`, { timeout: 600000 });
    await p.getByText('PRESS START').first().click({ force: true, timeout: 600000 }).catch(() => {});
    await p.waitForFunction(() => window.__w2 && window.__w2.me && window.__w2.running, null, { timeout: 900000, polling: 2000 });
    await p.evaluate(() => { const g = window.__w2; if (g.adaptive) g.adaptive.frozen = true; const V = g.player.pos.constructor; const hit = g.world.raycast(new V(0, 40, 14), new V(0, -1, 0), 80); g.player.spawn(new V(0, (hit ? hit.point.y : 0) + 0.05, 14), 0); g.cam.snap(g.player); });
    await sleep(12000);
    const tray = await p.evaluate(() => { const t = document.querySelector('.nos-tray'); if (!t) return null; const r = t.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
    console.log(name, 'tray', JSON.stringify(tray));
    await p.screenshot({ path: `${outDir}/${tag}-${name}.png`, timeout: 300000 });
    await ctx.close();
  }
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
