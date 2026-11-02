// Render the CAMP pet concept frames (see concepts.ts).
// Needs the vite dev server on PORT (default 5196). Usage:
//   node scripts/camp-pet/render.cjs <outDir> [variant ...]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || 5196;
const out = path.resolve(process.argv[2] || '.claude/camp-pet-shots/concepts/frames');
const only = process.argv.slice(3);

// Per variant: turnaround, the three follow modes on a rider, three moods.
const SHOTS = [
  ['turn-front', { pose: 'stand', yaw: 0 }],
  ['turn-34', { pose: 'stand', yaw: 40 }],
  ['turn-side', { pose: 'stand', yaw: 90 }],
  ['turn-back', { pose: 'stand', yaw: 180, pitch: 14 }],
  ['mode-head', { pose: 'perch', yaw: 28, pitch: 6, rider: 'head', petYaw: 0 }],
  ['mode-beside', { pose: 'run', phase: 0.3, yaw: 48, pitch: 6, rider: 'beside', petYaw: 0 }],
  ['mode-fly', { pose: 'fly', phase: 0.22, yaw: 40, pitch: 6, rider: 'fly', petYaw: 0 }],
  ['pose-idle', { pose: 'idle', yaw: 25 }],
  ['pose-happy', { pose: 'happy', yaw: 20 }],
  ['pose-sleep', { pose: 'sleep', yaw: 30, pitch: 22 }],
];

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
  const p = await b.newPage({ viewport: { width: 900, height: 900 } });
  p.on('console', m => m.type() === 'error' && console.log('console:', m.text()));
  p.on('pageerror', e => console.log('pageerror:', e.message));
  await p.goto(`http://127.0.0.1:${PORT}/robots.txt`);
  await p.evaluate(async () => {
    await import('/scripts/camp-pet/concepts.ts');
    await window.petConcepts.setup();
  });
  const sizes = await p.evaluate(() => window.petConcepts.measure());
  fs.writeFileSync(path.join(out, 'sizes.json'), JSON.stringify(sizes, null, 2));
  console.log('sizes', sizes);
  const variants = await p.evaluate(() => window.petConcepts.VARIANTS.map(v => v.id));
  for (const v of variants) {
    if (only.length && !only.includes(v)) continue;
    for (const [name, spec] of SHOTS) {
      const url = await p.evaluate(s => window.petConcepts.shot(s), { variant: v, ...spec });
      fs.writeFileSync(
        path.join(out, `${v}-${name}.png`),
        Buffer.from(url.split(',')[1], 'base64'),
      );
      console.log('wrote', v, name);
    }
  }
  // Lineup: every variant beside one rider
  if (!only.length) {
    const url = await p.evaluate(s => window.petConcepts.shot(s), {
      variant: 'lineup',
      pose: 'stand',
      yaw: 12,
    });
    fs.writeFileSync(path.join(out, 'lineup.png'), Buffer.from(url.split(',')[1], 'base64'));
  }
  await b.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
