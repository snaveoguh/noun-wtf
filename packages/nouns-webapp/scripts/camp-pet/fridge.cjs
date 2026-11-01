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
  await p.addStyleTag({
    content: 'body *{visibility:hidden!important} canvas{visibility:visible!important}',
  });
  // fridge in the room frame (world/camp/layout.ts): x -4.35, z d-0.4, 0.75 x 0.7 x 1.8, yaw PI-0.25
  const shots = [
    ['mochi', 'perch', 'perched'],
    ['nub', 'sleep', 'napping'],
    ['zip', 'idle', 'watching'],
    ['bean', 'sleep', 'napping'],
  ];
  for (const [id, pose, cap] of shots) {
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
          pet.position.set(fx, top, fz + 0.05);
          // facing the room (and the window), turned a bit to the camera
          pet.rotation.y = Math.PI + 0.25 + 0.5;
          g.gfx.scene.add(pet);
          window.__pet = pet;
          // the rider stands below, looking up at it
          g.player.pos.set(fx + 1.05, o.y + 0.05, fz - 1.2);
          g.player.vel.set(0, 0, 0);
          for (let i = 0; i < 8; i++) g.step(1 / 60);
          g.me.root.rotation.y = Math.atan2(fx - (fx + 1.05), fz - (fz - 1.2));
          const look =
            view === 'wide' ? new V(fx + 0.6, o.y + 1.35, fz - 0.4) : new V(fx, top + 0.25, fz);
          const pos =
            view === 'wide'
              ? new V(fx + 3.2, o.y + 1.7, fz - 3.6)
              : new V(fx + 1.0, top + 0.5, fz - 1.25);
          g.cam.rig = { pos, look, fov: view === 'wide' ? 55 : 40 };
          for (let i = 0; i < 4; i++) g.step(1 / 60);
        },
        { id, pose, view },
      );
      await p.waitForTimeout(500);
      await p.screenshot({ path: path.join(out, `fridge-${id}-${view}.png`), timeout: 300000 });
      console.log('wrote', id, view, cap);
    }
  }
  await b.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
