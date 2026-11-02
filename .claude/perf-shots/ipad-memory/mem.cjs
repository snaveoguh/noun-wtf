// node mem.cjs <baseUrl> <out.json> [mode]
//   mode 'session' (default): WebKit iPad 1180×820 @2, the real first load
//     (CAMP intro + reading), then plaza, 16 riders, 3 rooms, mountain, mural,
//     plaza again. At every step: GL bytes (glmem.js), canvases, ImageBitmaps,
//     renderer.info, web-process RSS. At the end: the biggest GL allocations
//     named by where the game holds them.
//   mode 'loss': plaza, then WEBGL_lose_context lose → restore, screenshots
//     before / lost / restored (SHOTS=<dir>), errors, reloads.
// Env: ENGINE=chromium (default webkit), WEBKIT=<pw_run.sh>, URLX=<extra query>.
const fs = require('fs');
const path = require('path');
const { webkit, chromium } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');

const [, , base, out, mode = 'session'] = process.argv;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now();
const log = (...a) => console.log(((Date.now() - T0) / 1000).toFixed(0).padStart(4) + 's', ...a);
const MB = b => +(b / 1048576).toFixed(1);

function rss() {
  const o = {};
  for (const pid of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue;
    let cmd = '', st = '';
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); st = fs.readFileSync(`/proc/${pid}/status`, 'utf8'); } catch { continue; }
    const exe = cmd.split('\0')[0];
    if (/(^|\/)(bash|sh|node|grep|ps)$/.test(exe)) continue;
    let k = null;
    if (/W(ebKit|PE)WebProcess/.test(exe)) k = 'web';
    else if (/W(ebKit|PE)GPUProcess/.test(exe)) k = 'gpu';
    else if (exe.includes('chrom')) { const m = cmd.match(/--type=([a-z-]+)/); k = m ? m[1] : 'browser'; }
    if (!k) continue;
    o[k] = Math.round((o[k] || 0) + +(st.match(/VmRSS:\s+(\d+)/) || [0, 0])[1] / 1024);
  }
  return o;
}

(async () => {
  const chrome = process.env.ENGINE === 'chromium';
  const b = chrome
    ? await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] })
    : await webkit.launch({ executablePath: process.env.WEBKIT || '/tmp/claude-0/pw/webkit-2191/pw_run.sh' });
  const ctx = await b.newContext(chrome
    ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }
    : { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' });
  if (!chrome) await ctx.addInitScript(() => Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }));
  await ctx.addInitScript({ path: path.join(__dirname, 'glmem.js') });
  const p = await ctx.newPage();
  const errors = [];
  let loads = 0;
  p.on('pageerror', e => { errors.push(String(e).slice(0, 300)); log('pageerror', String(e).slice(0, 200)); });
  p.on('console', m => { const t = m.text(); if (/context|lost|restor|webgl/i.test(t)) log('console', m.type(), t.slice(0, 200)); });
  p.on('load', () => loads++);
  const url = `${base}/world?offline=1&skip=1&bday=0&perf=quiet&debug=1${process.env.URLX || ''}`;
  log('goto', url);
  await p.goto(url, { timeout: 600000 });
  await p.waitForFunction(() => window.__w2 && window.__w2.me && window.__w2.running, null, { timeout: 900000, polling: 500 });
  const boot = await p.evaluate(() => { const g = window.__w2; return { quality: g.gfx.quality, lite: g.gfx.lite, weak: g.weakDevice, buffer: [g.gfx.renderer.domElement.width, g.gfx.renderer.domElement.height], shadowMap: g.gfx.sun.shadow.mapSize.x, diet: g.textureDietOn ?? null }; });
  log('boot', JSON.stringify(boot));
  const res = { mode, engine: chrome ? 'chromium' : 'webkit', boot, samples: [], errors };
  const save = () => fs.writeFileSync(out, JSON.stringify(res, null, 1));
  const sample = async name => {
    const s = await p.evaluate(() => {
      const g = window.__w2;
      const i = g.gfx.renderer.info;
      const m = performance.memory;
      return { gl: window.__glmem.totals(), canv: window.__glmem.canvases(), bm: window.__glmem.bitmaps(), info: { tex: i.memory.textures, geo: i.memory.geometries, progs: i.programs?.length ?? 0 }, heap: m ? m.usedJSHeapSize : null };
    });
    const r = rss();
    const row = { at: Math.round((Date.now() - T0) / 1000), name, glMB: MB(s.gl.total), texMB: MB(s.gl.textures), rbMB: MB(s.gl.renderbuffers), bufMB: MB(s.gl.buffers), nTex: s.gl.nTex, canvases: s.canv.live, canvasMB: MB(s.canv.bytes), bitmaps: s.bm.live, bitmapMB: MB(s.bm.bytes), heapMB: s.heap ? MB(s.heap) : null, ...s.info, rss: r };
    res.samples.push(row);
    log(name.padEnd(14), `GL ${row.glMB} MB (tex ${row.texMB}, rb ${row.rbMB}, buf ${row.bufMB}, ${row.nTex} tex) | canvases ${row.canvases} = ${row.canvasMB} MB | bitmaps ${row.bitmaps} | heap ${row.heapMB} | progs ${row.progs} | rss ${JSON.stringify(r)}`);
    save();
  };
  const toPlaza = () => p.evaluate(() => {
    const g = window.__w2; const V = g.player.pos.constructor;
    const hit = g.world.raycast(new V(0, 40, 14), new V(0, -1, 0), 80);
    g.player.spawn(new V(0, (hit ? hit.point.y : 0) + 0.05, 14), 0); g.cam.snap(g.player);
  });
  const keys = (on, ...k) => p.evaluate(([on, k]) => { const s = window.__w2.input.keys; for (const x of k) on ? s.add(x) : s.delete(x); }, [on, k]);
  const shot = async name => { if (process.env.SHOTS) await p.screenshot({ path: `${process.env.SHOTS}/${name}.jpg`, type: 'jpeg', quality: 60, timeout: 120000 }).catch(e => log('shot', e.message)); };

  await sample('boot');
  if (mode === 'roomdiff') {
    // The same plaza door in and out 3×: which GL allocations outlive the room
    await toPlaza(); await sleep(8000);
    const before = new Set((await p.evaluate(() => window.__glmem.list())).map(r => r.id));
    await p.evaluate(() => (window.__glmem.trace = true));
    for (let k = 0; k < 3; k++) {
      await toPlaza(); await sleep(1000);
      await p.evaluate(k => { const g = window.__w2; const d = g.interiors.doors().slice().sort((a, b) => Math.hypot(a.x ?? 0, a.z ?? 0) - Math.hypot(b.x ?? 0, b.z ?? 0)); return g.interiors.debugEnter(d[k].id); }, k);
      await p.waitForFunction(() => window.__w2.interiors.inside, null, { timeout: 120000 }).catch(() => log('never inside'));
      await sleep(6000);
      await p.evaluate(() => window.__w2.interiors.requestLeave());
      await p.waitForFunction(() => !window.__w2.interiors.inside, null, { timeout: 60000 }).catch(() => {});
      await sleep(4000);
      await sample(`after room ${k + 1}`);
    }
    const left = await p.evaluate(ids => { const at = window.__glattrib(); const name = new Map(at.named); return window.__glmem.list().filter(r => !ids.includes(r.id)).map(r => ({ ...r, path: name.get(r.id) ?? null })); }, [...before]);
    res.left = left;
    let tot = 0; for (const r of left) tot += r.bytes;
    log('outlived the rooms:', left.length, 'allocations,', MB(tot), 'MB');
    const byPath = new Map();
    for (const r of left) { const k = `${r.kind} ${r.w}x${r.h} ${r.path ? r.path.replace(/\[\d+\]/g, '[]') : '(unnamed: not reachable from the game)'}`; const v = byPath.get(k) || [0, 0]; v[0]++; v[1] += r.bytes; byPath.set(k, v); }
    for (const [k, [n, b]] of [...byPath].sort((a, b) => b[1][1] - a[1][1]).slice(0, 25)) log('  ', String(MB(b)).padStart(6), 'MB', n + '×', k);
    const byStack = new Map();
    for (const r of left) if (!r.path) { const k = r.kind + ' ' + (r.stack || '?'); const v = byStack.get(k) || [0, 0]; v[0]++; v[1] += r.bytes; byStack.set(k, v); }
    for (const [k, [n, b]] of [...byStack].sort((a, b) => b[1][1] - a[1][1]).slice(0, 12)) log('  unnamed', String(MB(b)).padStart(6), 'MB', n + '×', k.slice(0, 400));
    const cg = await p.evaluate(() => window.__glmem.canvases().groups);
    for (const [k, [n, b]] of cg.slice(0, 18)) log('  canvas', String(MB(b)).padStart(6), 'MB', n + '×', k.slice(0, 200));
    save(); await b.close(); return;
  }
  if (mode === 'loss') {
    await toPlaza();
    await sleep(12000);
    await shot('loss-0-before');
    await sample('before-loss');
    const ok = await p.evaluate(() => { const gl = window.__w2.gfx.renderer.getContext(); const e = gl.getExtension('WEBGL_lose_context'); window.__lc = e; if (!e) return false; e.loseContext(); return true; });
    log('loseContext', ok);
    await sleep(3000);
    await shot('loss-1-lost');
    res.lost = await p.evaluate(() => ({ lost: window.__w2.gfx.renderer.getContext().isContextLost(), running: window.__w2.running }));
    res.notice = await p.evaluate(() => document.querySelector('[data-w2-context-lost]')?.textContent ?? null).catch(() => null);
    log('notice', res.notice);
    await p.evaluate(() => window.__lc && window.__lc.restoreContext()).catch(e => log('restore threw', e.message));
    // The fixed build reloads itself: wait for whichever page is up to be running again
    await p.waitForFunction(() => window.__w2 && window.__w2.me && window.__w2.running, null, { timeout: 900000, polling: 1000 }).catch(() => log('not running again'));
    await sleep(12000);
    res.after = await p.evaluate(() => ({ quality: window.__w2perf?.snapshot().extra.quality, lite: window.__w2.gfx.lite, shadowMap: window.__w2.gfx.sun.shadow.mapSize.x, buffer: [window.__w2.gfx.renderer.domElement.width, window.__w2.gfx.renderer.domElement.height] })).catch(() => null);
    log('after', JSON.stringify(res.after));
    await shot('loss-2-restored');
    res.restored = await p.evaluate(() => ({ lost: window.__w2?.gfx.renderer.getContext().isContextLost(), running: window.__w2?.running }));
    await sample('after-restore');
    res.loads = loads;
    log('lost', JSON.stringify(res.lost), 'restored', JSON.stringify(res.restored), 'loads', loads);
    save();
    await b.close();
    return;
  }
  // The intro + reading (~14 s), then out into the plaza
  await sleep(16000);
  await shot('mem-camp');
  await sample('camp+reading');
  await toPlaza(); await sleep(10000); await sample('plaza');
  // 16 riders arrive
  await p.evaluate(() => {
    const g = window.__w2; let t = 0;
    g.__bots = setInterval(() => {
      t += 0.1; const me = g.player.pos;
      for (let i = 0; i < 16; i++) {
        const a = t * 0.4 + (i / 16) * Math.PI * 2, r = 6 + (i % 4) * 3, yaw = a + Math.PI / 2;
        g.net.ingest(`bot${i}`, { x: me.x + Math.cos(a) * r, y: me.z + Math.sin(a) * r, airborneY: me.y, seedKey: `${i % 2}-${i % 30}-${(i * 7) % 130}-${(i * 13) % 230}-${i % 20}`, state: JSON.stringify({ v: 2, q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], b: [0, 0, 0, 1], a: 'skate_idle', m: 'board', sp: 6, n: `bot ${i}` }) });
      }
    }, 100);
  });
  await sleep(25000); await sample('16 riders');
  await p.evaluate(() => { const g = window.__w2; clearInterval(g.__bots); for (let i = 0; i < 16; i++) g.net.players.delete(`bot${i}`); });
  await sleep(3000); await sample('riders gone');
  // Rooms: the three nearest plaza doors, in and out
  for (let k = 0; k < 3; k++) {
    await toPlaza(); await sleep(1500);
    const ok = await p.evaluate(k => { const g = window.__w2; const d = g.interiors.doors().slice().sort((a, b) => Math.hypot(a.x ?? 0, a.z ?? 0) - Math.hypot(b.x ?? 0, b.z ?? 0)); return d[k] ? g.interiors.debugEnter(d[k].id) : false; }, k);
    await p.waitForFunction(() => window.__w2.interiors.inside, null, { timeout: 120000 }).catch(() => log('never inside'));
    await sleep(8000); await sample(`room ${k + 1} in`);
    await p.evaluate(() => window.__w2.interiors.requestLeave());
    await p.waitForFunction(() => !window.__w2.interiors.inside, null, { timeout: 60000 }).catch(() => {});
    await sleep(4000); await sample(`room ${k + 1} out`);
    if (!ok) log('room', k, 'not entered');
  }
  // Mountain
  await p.evaluate(() => { const g = window.__w2; if (g.mountainHero) { g.player.spawn(g.mountainHero.pos, g.mountainHero.yaw); g.cam.snap(g.player); } });
  await keys(true, 'KeyW'); await sleep(25000); await keys(false, 'KeyW'); await sample('mountain');
  // Mural
  await toPlaza();
  const mural = await p.evaluate(async () => {
    const g = window.__w2; const V = g.player.pos.constructor;
    for (const [x, z] of [[0, -6], [0, 14], [8, 20]]) {
      const hit = g.world.raycast(new V(x, 40, z), new V(0, -1, 0), 80);
      for (let k = 0; k < 8; k++) { g.player.spawn(new V(x, (hit ? hit.point.y : 0) + 0.05, z), (k / 8) * Math.PI * 2); g.cam.snap(g.player); await new Promise(r => setTimeout(r, 400)); if (g.mural.enter()) return true; }
    }
    return false;
  });
  await sleep(3000);
  for (let s = 0; s < 10; s++) { const y = 820 * (0.3 + 0.04 * s); await p.mouse.move(350, y); await p.mouse.down(); for (let i = 1; i <= 16; i++) await p.mouse.move(350 + 25 * i, y + Math.sin(i / 3) * 20); await p.mouse.up(); }
  await sleep(2000); await sample(`mural (${mural ? 'in' : 'no wall'})`);
  await p.evaluate(() => window.__w2.mural.exit());
  await toPlaza(); await sleep(12000); await sample('plaza again');
  // What's biggest, and where the game holds it
  const top = await p.evaluate(() => {
    const at = window.__glattrib();
    const name = new Map(at.named);
    return { walked: at.walked, list: window.__glmem.list().slice(0, 40).map(r => ({ ...r, path: name.get(r.id) ?? null })), canvases: window.__glmem.canvases() };
  });
  res.top = top;
  res.loads = loads;
  log('walked', top.walked);
  for (const r of top.list.slice(0, 30)) log('  ', String(MB(r.bytes)).padStart(6), 'MB', r.kind, `${r.w}×${r.h}${r.d > 1 ? '×' + r.d : ''}`, r.fmt.toString(16), r.mip ? 'mip' : '', r.samples > 1 ? 'x' + r.samples : '', r.path ?? '(unnamed)');
  log('big canvases', JSON.stringify(top.canvases.big.slice(0, 12)));
  save();
  await b.close();
  log('done, loads', loads);
})().catch(e => { console.error(e); process.exit(1); });
