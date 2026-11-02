// The pet up on CAMP's fridge, before you adopt it: shot in the live game
// (offline), in the real room. Needs the vite dev server on PORT (5196).
//   node scripts/camp-pet/fridge.cjs <outDir>
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 5196;
const out = path.resolve(process.argv[2] || '.');

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
    ],
  });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  p.on('pageerror', e => console.log('pageerror:', e.message));
  await p.goto(
    `http://127.0.0.1:${PORT}/world?offline=1&skip=1&q=high&bday=0&camintro=0&introfx=0`,
    {
      timeout: 600000,
    },
  );
  await p.waitForFunction(
    () => !document.querySelector('[data-w2loader]') && window.__w2?.me && window.__w2.camp?.site,
    null,
    {
      timeout: 900000,
      polling: 2000,
    },
  );
  console.log('world up');
  await p.evaluate(() => {
    const g = window.__w2;
    g.running = false;
    for (let i = 0; i < 30; i++) g.step(1 / 60);
  });
  // HUD off; the minimap is a canvas too, so hide every canvas but the game's
  await p.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = 'body *{visibility:hidden!important} canvas{visibility:visible!important}';
    document.head.appendChild(st);
    const cvs = [...document.querySelectorAll('canvas')];
    const main = cvs.reduce((a, c) => (c.width * c.height > a.width * a.height ? c : a));
    for (const c of cvs) if (c !== main) c.style.setProperty('display', 'none', 'important');
  });
  // The fridge in the room frame (world/camp/layout.ts): x -4.35, z d-0.4,
  // 0.75 x 0.7 x 1.8 m. Room x runs right to left seen from the window.
  const shots = [
    ['mochi', 'perch'],
    ['nub', 'sleep'],
    ['zip', 'idle'],
    ['bean', 'sleep'],
  ];
  for (const [id, pose] of shots) {
    for (const view of ['wide', 'close']) {
      await p.evaluate(
        async ({ id, pose, view }) => {
          const g = window.__w2;
          const m = await import('/scripts/camp-pet/concepts.ts');
          const s = g.camp.site;
          const o = s.origin;
          const V = g.player.pos.constructor;
          const fx = o.x - 4.35;
          const fz = o.z + s.d - 0.4;
          const top = o.y + 1.8;
          if (window.__pet) window.__pet.parent.remove(window.__pet);
          const pet = await m.petModel(id, pose, 0.25);
          pet.position.set(fx + 0.02, top, fz - 0.02);
          pet.rotation.y = Math.atan2(3.45, -4.3) - 0.35; // out into the room
          g.gfx.scene.add(pet);
          window.__pet = pet;
          // the rider beside the fridge, looking at it
          const rx = fx + 1.9;
          const rz = fz - 1.3;
          g.player.pos.set(rx, o.y + 0.05, rz);
          g.player.vel.set(0, 0, 0);
          g.cam.rig =
            view === 'wide'
              ? {
                  pos: new V(fx + 3.45, o.y + 1.45, fz - 4.3),
                  look: new V(fx + 0.75, o.y + 1.35, fz - 0.5),
                  fov: 50,
                }
              : {
                  pos: new V(fx + 1.2, o.y + 2.35, fz - 1.5),
                  look: new V(fx + 0.05, top + 0.22, fz - 0.05),
                  fov: 42,
                };
          for (let i = 0; i < 6; i++) g.step(1 / 60);
          g.me.root.rotation.y = Math.atan2(fx - rx, fz - rz);
          g.gfx.composer.render();
        },
        { id, pose, view },
      );
      await p.screenshot({ path: path.join(out, `fridge-${id}-${view}.png`), timeout: 300000 });
      console.log('wrote', id, view);
    }
  }
  await b.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
