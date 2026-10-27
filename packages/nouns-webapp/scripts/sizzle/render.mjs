#!/usr/bin/env node
// Sizzle reels: render shots (frames) from the running dev server. See README.md.
//
//   node scripts/sizzle/render.mjs --base http://127.0.0.1:5318 --edit scripts/sizzle/edits/big-drop.json
//   node scripts/sizzle/render.mjs --base … --shots bd-summit,bd-loop [--preview]
//
// Renders every shot an edit list uses (or the ones named) into
// <frames>/<shot>/f0000.jpg…, opening each scene once for all its shots.
// --preview renders every 6th frame only (for contact sheets); --skip-done
// leaves shots that already have all their frames.

import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launch, newPage, shoot } from './lib.mjs';
import { SCENES, SHOTS } from './shots.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const base = opt('--base', process.env.SIZZLE_BASE ?? 'http://127.0.0.1:5318');
const framesDir = resolve(opt('--frames', process.env.SIZZLE_FRAMES ?? join(HERE, '.frames')));
const preview = args.includes('--preview');
const skipDone = args.includes('--skip-done');

let ids = opt('--shots', '')
  .split(',')
  .filter(Boolean);
for (const e of args.filter((a, i) => args[i - 1] === '--edit')) {
  for (const c of JSON.parse(readFileSync(e, "utf8")).cuts) if (c.shot && !ids.includes(c.shot)) ids.push(c.shot);
}
if (ids.length === 0) ids = Object.keys(SHOTS);
for (const id of ids) if (!SHOTS[id]) throw new Error(`unknown shot ${id}`);

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const done = id => {
  const d = join(framesDir, id);
  return existsSync(d) && readdirSync(d).length >= SHOTS[id].frames;
};

const byScene = new Map();
for (const id of ids) {
  if (skipDone && done(id)) continue;
  const s = SHOTS[id].scene;
  byScene.set(s, [...(byScene.get(s) ?? []), id]);
}

// Shots that change the scene for good (e.g. the fountain descent) go last
for (const [s, list] of byScene) byScene.set(s, [...list].sort((a, b) => Number(!!SHOTS[a].last) - Number(!!SHOTS[b].last)));

const browser = await launch();
try {
  for (const [scene, list] of byScene) {
    log(`scene ${scene}: ${list.join(', ')}`);
    const p = await newPage(browser, log);
    await SCENES[scene](p, base);
    for (const id of list) {
      const shot = SHOTS[id];
      const dir = join(framesDir, id);
      rmSync(dir, { recursive: true, force: true });
      await p.evaluate(shot.setup, shot.arg ?? null);
      // Node-side waits (models, textures) after the setup
      if (shot.settle) await p.waitForTimeout(shot.settle);
      const r = await shoot(p, dir, shot.frames, { every: preview ? 6 : 1, log });
      log(`shot ${id}: ${shot.frames} frames in ${r.secs} s`);
    }
    await p.close();
  }
} finally {
  await browser.close();
}
