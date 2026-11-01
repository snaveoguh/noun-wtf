const { chromium } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const [, , base, prof, secs] = process.argv;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage'] });
  const weak = prof === 'weak';
  const ctx = await b.newContext(weak ? { viewport:{width:412,height:915}, deviceScaleFactor:2.6, isMobile:true, hasTouch:true,
    userAgent:'Mozilla/5.0 (Linux; Android 12; moto g06) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'} : { viewport:{width:1280,height:800}});
  await ctx.addInitScript(({weak}) => {
    Error.stackTraceLimit = 60;
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => weak ? 4 : 16 });
    for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const gp = C.prototype.getParameter;
      C.prototype.getParameter = function (p) { if (p === 0x9246) return weak ? 'Mali-G52 MC2' : 'ANGLE (NVIDIA GeForce RTX 3060)'; return gp.call(this, p); };
      const gi = C.prototype.getProgramInfoLog; C.prototype.getProgramInfoLog = function (prog) { const t = performance.now(); const r = gi.call(this, prog); if (window.__gil) window.__gil.push(performance.now() - t); return r; };
      const lp = C.prototype.linkProgram;
      C.prototype.linkProgram = function (prog) {
        if (window.__linkLog) window.__linkLog.push({ t: performance.now(), stack: new Error().stack });
        return lp.call(this, prog);
      };
    }
  }, { weak });
  const p = await ctx.newPage();
  await p.goto(`${base}/world?offline=1&skip=1&bday=0&perf=quiet&debug=1&spawn=plaza`, { timeout: 600000 });
  await p.waitForFunction(() => window.__w2 && window.__w2.me && window.__w2.running, null, { timeout: 900000, polling: 2000 });
  await p.evaluate(() => { window.__w2.ladder = null; if (window.__w2.adaptive) window.__w2.adaptive.frozen = true; });
  await sleep(25000);
  await p.evaluate(() => { window.__p0 = new Set(window.__w2.gfx.renderer.info.programs.map(x => x.id)); window.__seen=[]; const r=window.__w2.gfx.renderer; let last=r.info.programs.length; window.__pi=setInterval(()=>{ for (const x of r.info.programs) if(!window.__p0.has(x.id)){ window.__p0.add(x.id); window.__seen.push(x.name+' | '+x.cacheKey.slice(0,160)); } },50); window.__linkLog = []; window.__gil = []; window.__fresh=[]; { const g=window.__w2; const r=g.gfx.renderer; const orig=r.renderBufferDirect.bind(r); r.renderBufferDirect=function(cam,sc,geo,mat,obj,grp){ const pr=r.properties.get(mat); if(pr.currentProgram===undefined){ let c=obj, path=[]; while(c&&c!==sc){ path.push(c.name||c.type); c=c.parent;} window.__fresh.push((cam.isOrthographicCamera?'SHADOW ':'')+mat.type+' '+(mat.name||'')+' @ '+path.slice(0,5).join('<')+' vis='+obj.visible+' age?'); } return orig(cam,sc,geo,mat,obj,grp); }; } const s = window.__w2.input.keys; s.add('KeyW'); s.add('KeyD'); });
  const cdp = await ctx.newCDPSession(p); if (process.env.THR) await cdp.send('Emulation.setCPUThrottlingRate', { rate: +process.env.THR });
  await sleep((+secs || 20) * 1000);
  const log = await p.evaluate(() => window.__linkLog.map(e => e.stack.split('\n').slice(2).filter(l => !/node_modules/.test(l)).slice(0, 5).map(l => l.trim().replace(/http:\/\/127\.0\.0\.1:\d+/, '').replace(/\?[^:]*/, '')).join(' < ')));
  const progs = await p.evaluate(() => window.__w2.gfx.renderer.info.programs.map(x => x.name + ' ' + x.usedTimes));
  const prog2 = await p.evaluate(() => window.__seen); console.log('NEW PROGRAMS', prog2.length); for (const x of prog2) console.log('  ', x);
  const c = {};
  for (const l of log) c[l] = (c[l] || 0) + 1;
  console.log('links in window:', log.length); const gil = await p.evaluate(() => window.__gil); console.log('getProgramInfoLog calls', gil.length, 'ms', gil.reduce((a,b)=>a+b,0).toFixed(0), 'max', Math.max(0,...gil).toFixed(0)); const fr = await p.evaluate(() => window.__fresh); console.log('FRESH', fr.length); for (const f of fr) console.log('  F', f); console.log('warmer issued', await p.evaluate(() => window.__w2.warmer ? window.__w2.warmer.issued : 'n/a'));
  for (const [k, v] of Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(v, k);
  console.log('programs now', progs.length);
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
