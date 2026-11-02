#!/usr/bin/env node
// Sizzle reels: cut rendered shots into a finished clip (webm + mp4 +
// poster) from an edit list. See README.md.
//
//   node scripts/sizzle/cut.mjs scripts/sizzle/edits/big-drop.json [--frames <dir>] [--out <dir>]
//
// Edit list:
//   { "name": "hero-big-drop",          // files: <out>/<name>.webm|.mp4, <name>-poster.jpg
//     "length": 12.0,                   // optional: exact length (s); pads by holding the last frame
//     "poster": 4.2,                    // poster still at this time (s)
//     "grade": "eq=…,unsharp=…",        // optional ffmpeg filters on the whole cut
//     "music": { "file": "scripts/sizzle/music/noun-drop.mp3", "in": 0 },  // optional soundtrack
//     "cuts": [ { "shot": "bd-summit", "in": 0, "dur": 2.0, "fade": 0.2 }, … ],
//     "size": [1080, 1920],             // optional: output size (default 1920×1080)
//     "out": "public/clips",            // optional: output folder from packages/nouns-webapp (default public/home)
//     "frames": ".frames-v" }           // optional: frames folder under scripts/sizzle (render.mjs uses it too)
// A cut takes `shot` (rendered frames) or `video` (an existing gameplay clip,
// path from packages/nouns-webapp, e.g. "public/home/hero-hoops.mp4").
// `in` / `dur` are seconds into the shot's frames, `fade` a crossfade from
// the previous cut (0 or missing: a hard cut). Every `shot` is a folder of
// frames (f0000.jpg…, 30 fps) under --frames (default scripts/sizzle/.frames).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FPS = 30;

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const editPath = args.find(a => a.endsWith('.json'));
if (!editPath) {
  console.error('usage: cut.mjs <edit.json> [--frames dir] [--out dir]');
  process.exit(1);
}
const edit = JSON.parse(readFileSync(editPath, 'utf8'));
/** Output size (the hero is full-bleed; phones get the same file). Social clips set `size`. */
const [OUT_W, OUT_H] = edit.size ?? [1920, 1080];
const framesDir = resolve(
  opt('--frames', process.env.SIZZLE_FRAMES ?? join(HERE, edit.frames ?? '.frames')),
);
const outDir = resolve(opt('--out', join(HERE, '../..', edit.out ?? 'public/home')));
mkdirSync(outDir, { recursive: true });

const inputs = [];
const chains = [];
let total = 0;
let label = '';
edit.cuts.forEach((c, i) => {
  const n = Math.round(c.dur * FPS);
  if (c.video !== undefined) {
    // An existing gameplay clip (a path from packages/nouns-webapp), from `in` s
    const file = resolve(HERE, '../..', c.video);
    if (!existsSync(file)) throw new Error(`no video ${file}`);
    inputs.push('-ss', String(c.in ?? 0), '-i', file);
    chains.push(
      `[${i}:v]fps=${FPS},trim=end_frame=${n},setpts=PTS-STARTPTS,scale=${OUT_W}:${OUT_H}:flags=lanczos,setsar=1,format=yuv420p[c${i}]`,
    );
  } else {
    const dir = join(framesDir, c.shot);
    if (!existsSync(dir)) throw new Error(`no frames for shot ${c.shot} (${dir}): render it first`);
    const have = readdirSync(dir).filter(f => /^f\d{4}\.jpg$/.test(f)).length;
    const a = Math.round((c.in ?? 0) * FPS);
    if (a + n > have) throw new Error(`${c.shot}: wants frames ${a}..${a + n} but has ${have}`);
    inputs.push('-framerate', String(FPS), '-start_number', String(a), '-i', join(dir, 'f%04d.jpg'));
    chains.push(
      `[${i}:v]trim=end_frame=${n},setpts=PTS-STARTPTS,scale=${OUT_W}:${OUT_H}:flags=lanczos,setsar=1,format=yuv420p[c${i}]`,
    );
  }
  if (i === 0) {
    label = 'c0';
    total = c.dur;
    return;
  }
  // Hard cuts are a one-frame "fade" so every join goes through xfade.
  // Whole frames only: an offset between frames makes xfade drop the rest
  // of the reel (a 0.15 s fade cut hero-parkour off at 7.2 s)
  const fade = Math.max(1, Math.round((c.fade ?? 0) * FPS)) / FPS;
  const off = total - fade;
  chains.push(
    `[${label}][c${i}]xfade=transition=fade:duration=${fade.toFixed(4)}:offset=${off.toFixed(4)}[x${i}]`,
  );
  label = `x${i}`;
  total = off + c.dur;
});
const length = edit.length ?? total;
const post = [];
if (length > total + 1e-3) post.push(`tpad=stop_mode=clone:stop_duration=${(length - total + 0.1).toFixed(3)}`);
if (edit.grade) post.push(edit.grade);
chains.push(`[${label}]${post.length ? post.join(',') : 'null'}[out]`);
const graph = chains.join(';');

// Music (optional): `"music": { "file": "scripts/sizzle/music/x.mp3", "in": 0 }`,
// a path from packages/nouns-webapp; faded out over the last 0.9 s and
// loudness-normalised. The slide's clip then needs `audio: true` in rows.ts
// (it plays only once the visitor turns sound on).
const music = edit.music;
const audioIn = [];
const audioMap = [];
if (music !== undefined) {
  const file = resolve(HERE, '../..', music.file);
  if (!existsSync(file)) throw new Error(`no music ${file}`);
  audioIn.push('-ss', String(music.in ?? 0), '-t', length.toFixed(3), '-i', file);
  audioMap.push(
    '-map', `${inputs.filter(a => a === '-i').length}:a`,
    '-af', `afade=t=out:st=${Math.max(0, length - 0.9).toFixed(3)}:d=0.9,loudnorm=I=-16:TP=-1.5:LRA=11`,
    '-ar', '48000',
  );
}

function ff(extra, file, audio) {
  const r = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, ...audioIn, '-filter_complex', graph, '-map', '[out]', ...audioMap, '-t', length.toFixed(3), '-r', String(FPS), ...extra, ...(music !== undefined ? audio : ['-an']), file],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${file}`);
}

const base = join(outDir, edit.name);
const crf = edit.crf ?? {};
// Quality first (crf), with a bitrate ceiling so a busy reel stays under
// ~4 MB: 2.4 Mbit/s is 3.6 MB for 12 s (`edit.maxrate` in Mbit/s to change)
const cap = edit.maxrate ?? 2.4;
ff(['-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf.mp4 ?? 23), '-maxrate', `${cap}M`, '-bufsize', `${cap * 2}M`, '-pix_fmt', 'yuv420p', '-movflags', '+faststart'], `${base}.mp4`, ['-c:a', 'aac', '-b:a', '128k']);
// VP9 constrained quality: crf, with -b:v as the ceiling
ff(['-c:v', 'libvpx-vp9', '-crf', String(crf.webm ?? 34), '-b:v', `${cap * 0.9}M`, '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p'], `${base}.webm`, ['-c:a', 'libopus', '-b:a', '112k']);
const pr = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(edit.poster ?? 0), '-i', `${base}.mp4`, '-frames:v', '1', '-q:v', '3', `${base}-poster.jpg`], { stdio: 'inherit' });
if (pr.status !== 0) throw new Error('poster failed');
console.log(`${edit.name}: ${length.toFixed(2)} s (cuts ${total.toFixed(2)} s) -> ${base}.{mp4,webm}, -poster.jpg`);
