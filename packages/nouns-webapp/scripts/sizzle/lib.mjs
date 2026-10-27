// Sizzle reels: the browser side. Launch headless Chromium, open a scene,
// render frames deterministically (the game loop stopped, a fixed dt per
// frame, one screenshot each). See README.md.

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Render size. SwiftShader's cost is per pixel, so frames render at
 * 960×540 and cut.mjs scales them to 1280×720 (SIZZLE_W / SIZZLE_H to change).
 */
export const W = Number(process.env.SIZZLE_W ?? 960);
export const H = Number(process.env.SIZZLE_H ?? 540);
export const FPS = 30;

/** Headless Chromium with software WebGL (works without a GPU). */
export async function launch() {
  const { chromium } = require('playwright');
  const exe = process.env.SIZZLE_CHROMIUM ?? '/opt/pw-browsers/chromium';
  return chromium.launch({
    timeout: 900_000,
    executablePath: exe,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
}

export async function newPage(browser, log = console.log) {
  const p = await browser.newPage({ viewport: { width: W, height: H } });
  p.setDefaultTimeout(900_000);
  p.on('pageerror', e => log('PAGEERROR', String(e).slice(0, 300)));
  return p;
}

/**
 * Hide every bit of DOM except the biggest canvas (the 3D view), plus any
 * selectors in `keep` (e.g. the exchange's shout bubbles, which are DOM).
 */
export async function cleanFrame(p, keep = [], canvas = 'canvas') {
  await p.evaluate(([keep, canvas]) => {
    document.getElementById('__sizzle_clean')?.remove();
    const st = document.createElement('style');
    st.id = '__sizzle_clean';
    st.textContent =
      // Hidden DOM still animates and decodes: stop that too (CPU is the bottleneck)
      'body *{visibility:hidden!important;animation-play-state:paused!important;transition:none!important}' +
      keep.map(k => `${k},${k} *{visibility:visible!important;animation-play-state:running!important}`).join('');
    document.head.appendChild(st);
    const cs = [...document.querySelectorAll(canvas)].sort(
      (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
    );
    cs[0]?.style.setProperty('visibility', 'visible', 'important');
    for (const v of document.querySelectorAll('video')) v.pause();
  }, [keep, canvas]);
}

/**
 * Render `n` frames of a shot into `dir/f0000.jpg…`. The shot's setup has
 * installed `window.__sizzleFrame(i)` in the page: it advances the scene
 * one frame (1/FPS s) and leaves it rendered. `every` keeps only each k-th
 * frame (previews).
 */
export async function shoot(p, dir, n, { arg, every = 1, quality = 92, log } = {}) {
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const keep = i % every === 0;
    // Frames a preview drops only advance the scene (no draw) if the shot can
    await p.evaluate(
      ([i, arg, keep]) => (!keep && window.__sizzleSkip ? window.__sizzleSkip : window.__sizzleFrame)(i, arg),
      [i, arg, keep],
    );
    if (!keep) continue;
    await p.screenshot({
      path: join(dir, `f${String(i).padStart(4, '0')}.jpg`),
      type: 'jpeg',
      quality,
      timeout: 900_000,
    });
    if (log && i % 30 === 0) log(`  ${dir.split('/').pop()} ${i}/${n}`);
  }
  return { n, secs: Math.round((Date.now() - t0) / 1000) };
}
