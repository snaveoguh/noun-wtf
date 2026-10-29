// node probe.cjs <baseUrl> : what draws and what casts at the plaza (weak profile, saved Low)
const { chromium } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const [, , base] = process.argv;
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 12; moto g06) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36' });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 4 });
    localStorage.setItem('noun-world-settings', JSON.stringify({ v: 2, quality: 'low' }));
    for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const gp = C.prototype.getParameter;
      C.prototype.getParameter = function (p) { return p === 0x9246 ? 'Mali-G52 MC2' : gp.call(this, p); };
    }
  });
  const p = await ctx.newPage();
  await p.goto(`${base}/world?offline=1&skip=1&bday=0&perf=quiet&debug=1`, { timeout: 600000 });
  await p.getByText('PRESS START').first().click({ force: true, timeout: 600000 }).catch(() => {});
  await p.waitForFunction(() => window.__w2 && window.__w2.me && window.__w2.running, null, { timeout: 900000, polling: 2000 });
  await new Promise(r => setTimeout(r, 15000));
  const r = await p.evaluate(() => {
    const g = window.__w2;
    const shown = o => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
    const count = root => { let n = 0, c = 0, prims = 0; root.traverse(o => { if (o.isMesh && shown(o)) { n++; if (o.castShadow) c++; prims += Array.isArray(o.material) ? (o.geometry.groups.length || 1) : 1; } }); return { meshes: n, cast: c, prims }; };
    const rigs = [];
    g.gfx.scene.traverse(o => { if (o.name === 'NounRig') { let top = o; while (top.parent && top.parent !== g.gfx.scene) top = top.parent; rigs.push({ top: top.name || top.type, dist: +top.getWorldPosition(new o.position.constructor()).distanceTo(g.player.pos).toFixed(1), ...count(top) }); } });
    const casters = {};
    g.gfx.scene.traverse(o => { if (o.isMesh && o.castShadow && shown(o)) { let x = o, path = []; while (x.parent) { if (x.name) path.unshift(x.name); x = x.parent; } const k = path.slice(0, 2).join('/') || '(unnamed)'; casters[k] = (casters[k] || 0) + 1; } });
    const parts = {};
    g.me.root.traverse(o => { if (o.isMesh && shown(o)) { const k = `${o.parent?.name || o.parent?.type}>${o.name || '-'} [${(Array.isArray(o.material) ? o.material : [o.material]).map(m => m.type.replace('Material','') + ':' + (m.name||'')).join(',')}] tris ${o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3}${o.isSkinnedMesh ? ' skinned' : ''}`; parts[k] = (parts[k] || 0) + 1; } });
    const npc = {};
    let best = null;
    g.gfx.scene.traverse(o => { if (o.name === 'NounRig' && shown(o)) { let top = o; while (top.parent && top.parent !== g.gfx.scene) top = top.parent; const d = top.getWorldPosition(new o.position.constructor()).distanceTo(g.player.pos); if (d > 1 && (best === null || d < best.d)) best = { d, top }; } });
    if (best) { const chain = []; for (let x = best.top; x; x = x.parent) chain.push(x.name || x.type); npc.chain = chain; npc.ud = Object.keys(best.top.userData); best.top.traverse(o => { if (o.isMesh && shown(o)) { const k = `${o.parent?.name || o.parent?.type}>${o.name || '-'} ${o.isSkinnedMesh ? 'skinned' : ''} tris ${o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3}`; npc[k] = (npc[k] || 0) + 1; } }); }
    return { npc, parts, me: count(g.me.root), rigs: rigs.sort((a, b) => a.dist - b.dist).slice(0, 20), casters };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
