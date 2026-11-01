// Mural mode in headless Chromium as an iPad: pen strokes with pressure (CDP
// pointerType 'pen'), finger pinch / pan / two-finger tap, picker, panels.
const { chromium } = require('/home/user/noun-wtf/packages/nouns-webapp/node_modules/playwright');
const OUT = '/home/user/noun-wtf/.claude/tablet-graffiti-shots';
const URL = 'http://127.0.0.1:5196/world?offline=1&skip=1&q=low&bday=0&spawn=plaza&camintro=0';
const W = +(process.env.W || 1180);
const H = +(process.env.H || 820);
const TAG = process.env.TAG || 'land';

(async () => {
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
  const cdp = await ctx.newCDPSession(p);
  const t0 = Date.now();
  await p.goto(URL, { timeout: 300000 });
  await p.waitForFunction(() => !document.querySelector('[data-w2loader]') && window.__w2?.me, null, { timeout: 600000 });
  console.log('loaded', (Date.now() - t0) / 1000, 's');
  const step = (n = 1) => p.evaluate(n => { const g = window.__w2; for (let i = 0; i < n; i++) g.step(1 / 30); }, n);
  await p.evaluate(() => { window.__w2.running = false; });
  await step(20);

  // Find a big flat wall near the plaza spawn and stand 2 m in front of it
  await p.evaluate(async () => { window.__RC = (await import('/node_modules/.vite/deps/three.js')).Raycaster; });
  let wall = await p.evaluate(() => {
    const g = window.__w2;
    const V = g.player.pos.constructor;
    let best = null;
    for (const [cx, cz] of [[g.player.pos.x, g.player.pos.z], [60, -42], [40, -60], [20, -40], [0, -20], [-20, 0], [0, 20], [20, 40], [45, 10], [-40, -40], [-40, 40], [40, 40], [0, 50], [-50, 0], [0, -50]]) {
      for (let a = 0; a < 96; a++) {
        const d = new V(Math.cos((a / 96) * Math.PI * 2), 0, Math.sin((a / 96) * Math.PI * 2));
        const from = new V(cx, g.player.pos.y + 1.4, cz);
        const h = g.world.raycast(from, d, 45);
        if (!h || Math.abs(h.normal.y) > 0.1) continue;
        // Flat for 3 m either side and 2.5 m up?
        const n = h.normal.clone().setY(0).normalize();
        const u = new V(-n.z, 0, n.x);
        let ok = 0;
        for (const [du, dv] of [[-2.5, 0], [2.5, 0], [0, 1.6], [-2.5, 1.5], [2.5, 1.5], [0, -0.8]]) {
          const o = h.point.clone().addScaledVector(n, 1).addScaledVector(u, du).add(new V(0, dv, 0));
          const h2 = g.world.raycast(o, n.clone().negate(), 2);
          if (h2 && Math.abs(h2.point.distanceTo(o) - 1) < 0.05 && h2.normal.dot(n) > 0.98) ok++;
        }
        // What you SEE there must be the collider (no facade in front of it)
        let seen = 0;
        if (ok === 6) {
          const R = new window.__RC();
          for (const [du, dv] of [[-2.2, -0.9], [0, -0.9], [2.2, -0.9], [-2.2, 0.3], [0, 0.3], [2.2, 0.3], [-2.2, 1.5], [0, 1.5], [2.2, 1.5]]) {
            const o = h.point.clone().addScaledVector(n, 3).addScaledVector(u, du).add(new V(0, dv, 0));
            R.set(o, n.clone().negate());
            R.far = 4; R.camera = g.gfx.camera;
            const hits = R.intersectObjects(g.gfx.scene.children, true).filter(x => x.object.visible && !x.object.name.includes('graffiti') && x.object.isMesh);
            if (hits.length && Math.abs(hits[0].distance - 3) < 0.1) seen++;
          }
        }
        if (ok === 6 && seen === 9 && (!best || h.point.distanceTo(from) < best.dist))
          best = { dist: h.point.distanceTo(from), point: h.point.toArray(), normal: n.toArray() };
      }
      if (best) break;
    }
    return best;
  });
  if (process.env.WALL) wall = JSON.parse(process.env.WALL);
  console.log('wall', JSON.stringify(wall));
  if (!wall) throw new Error('no wall');
  await p.evaluate(w => {
    const g = window.__w2;
    const V = g.player.pos.constructor;
    const n = new V(...w.normal);
    const pt = new V(...w.point);
    g.player.pos.copy(pt).addScaledVector(n, 2.2);
    g.player.pos.y = pt.y - 1.4 + 0.02;
    g.player.vel.set(0, 0, 0);
    // Face the wall: camera behind the rider looking at it
    g.cam.yaw = Math.atan2(-n.x, -n.z) + Math.PI;
  }, wall);
  await step(40);
  await p.screenshot({ path: `${OUT}/${TAG}-0-before.png` });

  const btn = await p.evaluate(() => !!document.querySelector('[data-mural=enter]'));
  console.log('MURAL chip visible:', btn);
  // Enter: aim at the wall then press the chip (or call enter)
  await p.evaluate(w => {
    const g = window.__w2;
    const V = g.player.pos.constructor;
    g.graffiti.aim = { point: new V(...w.point), normal: new V(...w.normal) };
    const ok = g.mural.enter();
    window.__enter = ok;
  }, wall);
  console.log('entered', await p.evaluate(() => window.__enter));
  for (let i = 0; i < 6; i++) await step(5);
  const st = await p.evaluate(() => ({ ...window.__w2.mural.state, view: window.__w2.mural.state.view }));
  console.log('state', JSON.stringify(st));
  await p.screenshot({ path: `${OUT}/${TAG}-1-mural.png` });

  const pen = async (type, x, y, force, tiltX = 0, buttons = 1) =>
    cdp.send('Input.dispatchMouseEvent', {
      type, x, y, button: type === 'mouseMoved' && buttons === 0 ? 'none' : 'left', buttons,
      clickCount: 1, pointerType: 'pen', force, tiltX, tiltY: 0,
    });
  // Pressure stroke: a wave left → right, light → hard → light
  const timing = [];
  const stroke = async (y0, amp, f) => {
    const x0 = W * 0.22;
    const x1 = W * 0.78;
    await pen('mousePressed', x0, y0, f(0));
    const N = 90;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const s = Date.now();
      await pen('mouseMoved', x0 + (x1 - x0) * t, y0 + Math.sin(t * Math.PI * 3) * amp, f(t));
      timing.push(Date.now() - s);
      if (i % 30 === 0) await step(1);
    }
    await pen('mouseReleased', x1, y0, 0, 0, 0);
    await step(2);
  };
  await stroke(H * 0.35, 40, t => 0.05 + 0.95 * Math.sin(t * Math.PI));
  await p.evaluate(() => window.__w2.graffiti.setColor('#ffc110'));
  await stroke(H * 0.55, 25, t => (t < 0.5 ? 0.1 + t * 1.8 : 1 - (t - 0.5) * 1.6));
  // A steady-pressure line for comparison
  await p.evaluate(() => window.__w2.graffiti.setColor('#254efb'));
  await stroke(H * 0.72, 0, () => 0.5);
  const perSample = await p.evaluate(() => {
    // Cost of one pen sample (raycast + capture), measured in the page
    const g = window.__w2;
    const m = g.mural;
    const W = innerWidth, H = innerHeight;
    m.paintStart(W * 0.3, H * 0.85, 20);
    const t = performance.now();
    for (let i = 0; i < 240; i++) m.paintMove(W * 0.3 + i * 2, H * 0.85 + Math.sin(i / 9) * 10, 10 + (i % 40));
    const ms = (performance.now() - t) / 240;
    m.paintCancel();
    return ms;
  });
  console.log('per pen sample ms', perSample.toFixed(3));
  await step(3);
  await p.screenshot({ path: `${OUT}/${TAG}-2-pressure.png` });

  // What went out: decode the strokes from the pending / offline store
  await p.evaluate(() => window.__w2.graffiti.flush());
  const wire = await p.evaluate(async () => {
    const s = await import('/src/miniapps/world2/graffiti/strokes.ts');
    const raw = JSON.parse(Object.keys(localStorage).filter(k => k.startsWith('w2-graffiti-offline')).map(k => localStorage.getItem(k)).find(Boolean) || '{}');
    let strokes = 0, joined = 0, tags = 0;
    for (const list of Object.values(raw)) for (const d of list) {
      const t = s.decodeTag(typeof d === 'string' ? d : d.d ?? d);
      if (!t || t.kind !== 'strokes') continue;
      tags++;
      for (const st of t.tag.strokes) { strokes++; if (st.join) joined++; }
    }
    return { tags, strokes, joined, keys: Object.keys(raw).length };
  });
  console.log('wire', JSON.stringify(wire));

  // Fingers: pinch out (zoom in) about the middle, then pan with one finger
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i + 1, radiusX: 8, radiusY: 8, force: 1 })),
  });
  const cx = W / 2, cy = H / 2;
  await touch('touchStart', [[cx - 60, cy], [cx + 60, cy]]);
  for (let i = 1; i <= 10; i++) await touch('touchMove', [[cx - 60 - i * 18, cy], [cx + 60 + i * 18, cy]]);
  await touch('touchEnd', []);
  await step(2);
  const z1 = await p.evaluate(() => window.__w2.mural.state.view);
  console.log('after pinch', JSON.stringify(z1));
  await p.waitForTimeout(600); // out of the palm window
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 8; i++) await touch('touchMove', [[cx + i * 15, cy + i * 5]]);
  await touch('touchEnd', []);
  await step(3);
  const z2 = await p.evaluate(() => window.__w2.mural.state.view);
  console.log('after pan', JSON.stringify(z2));
  await p.screenshot({ path: `${OUT}/${TAG}-3-zoomed.png` });

  // Two-finger tap = undo, three = redo
  const before = await p.evaluate(() => window.__w2.graffiti.tools.canRedo);
  await touch('touchStart', [[cx - 50, cy], [cx + 50, cy]]);
  await touch('touchEnd', []);
  await step(2);
  const afterUndo = await p.evaluate(() => ({ redo: window.__w2.graffiti.tools.canRedo }));
  await p.evaluate(() => { window.__pt = []; for (const t of ['pointerdown', 'pointerup']) window.addEventListener(t, e => window.__pt.push([t, e.pointerId, Math.round(e.timeStamp), e.target.className || e.target.tagName]), true); });
  await touch('touchStart', [[cx - 80, cy], [cx, cy], [cx + 80, cy]]);
  await touch('touchEnd', []);
  await step(2);
  const afterRedo = await p.evaluate(() => ({ redo: window.__w2.graffiti.tools.canRedo }));
  console.log('3-finger events', JSON.stringify(await p.evaluate(() => window.__pt)));
  console.log('tap undo/redo', before, JSON.stringify(afterUndo), JSON.stringify(afterRedo));

  // FIT, grid, picker, pen feel
  await p.evaluate(() => window.__w2.mural.fit());
  await step(12);
  await p.tap('[data-mural=grid-toggle]');
  await p.tap('[data-mural=colour]');
  await step(2);
  await p.screenshot({ path: `${OUT}/${TAG}-4-picker-grid.png` });
  // Drag in the SV square with the pen
  const sv = await p.locator('[data-mural=sv]').boundingBox();
  await pen('mousePressed', sv.x + sv.width * 0.8, sv.y + sv.height * 0.2, 0.5);
  await pen('mouseMoved', sv.x + sv.width * 0.9, sv.y + sv.height * 0.1, 0.5);
  await pen('mouseReleased', sv.x + sv.width * 0.9, sv.y + sv.height * 0.1, 0, 0, 0);
  console.log('picked colour', await p.evaluate(() => window.__w2.graffiti.tools.hex));
  await p.tap('[data-mural=feel-toggle]');
  await step(2);
  await p.screenshot({ path: `${OUT}/${TAG}-5-feel.png` });
  await p.tap('[data-mural=feel-toggle]');

  // The size pad: press the top half with a hard pen for ~1 s
  const r0 = await p.evaluate(() => window.__w2.graffiti.tools.radius);
  const pad = await p.locator('[data-mural=pad-size]').boundingBox();
  if (pad) {
    await pen('mousePressed', pad.x + pad.width / 2, pad.y + pad.height * 0.2, 0.95);
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${OUT}/${TAG}-6-sizepad.png` });
    await pen('mouseReleased', pad.x + pad.width / 2, pad.y + pad.height * 0.2, 0, 0, 0);
  }
  const r1 = await p.evaluate(() => window.__w2.graffiti.tools.radius);
  console.log('size pad radius', r0, '→', r1);

  // Leave: player where they were, camera back
  const pos0 = await p.evaluate(() => window.__w2.player.pos.toArray());
  await p.tap('[data-mural=exit]');
  await step(10);
  const after = await p.evaluate(() => ({ active: window.__w2.mural.active, rig: window.__w2.cam.rig, pos: window.__w2.player.pos.toArray(), vis: window.__w2.me.root.visible }));
  console.log('exit', JSON.stringify(after), 'pos before', JSON.stringify(pos0));
  await p.screenshot({ path: `${OUT}/${TAG}-7-after.png` });
  console.log('pen move dispatch ms p50', timing.sort((a, b) => a - b)[timing.length >> 1]);
  await b.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
