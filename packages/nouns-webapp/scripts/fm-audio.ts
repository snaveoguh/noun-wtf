// NOUN FM audio build: owner-made jingles / interludes / songs → compact
// web files + manifests under public/world2/fm/.
//
//   node scripts/fm-audio.ts <dir with the source mp3s>
//
// (Node 22.18+ runs this TypeScript directly.) For each interlude it writes
//   interludes/<id>.mp3        full length (the start-of-game intro, breaks)
//   interludes/<id>-sting.mp3  a ≤4.3 s cut for the 4.5 s gap between songs,
//                              the window chosen by energy/onset analysis
//                              (src/miniapps/world2/radio/stingCut.ts),
//                              10 ms fade in, 300 ms fade out
// and for each song songs/<id>.mp3. Everything is re-encoded to mp3
// (libmp3lame: decodeAudioData and <audio> play it everywhere, Safari
// included), metadata and the embedded cover-art stream stripped.
//
// To add a file: drop it in the source dir, add a row below, re-run, commit
// the outputs. Sources that aren't there are skipped (their old outputs and
// manifest rows are kept).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chooseStingCut } from '../src/miniapps/world2/radio/stingCut.ts';

interface InterludeRow {
  src: string;
  id: string;
  title: string;
  /** The first row is the main jingle (always opens the intro); others: weight as the intro's second jingle. */
  intro: number;
}
interface SongRow {
  src: string;
  id: string;
  title: string;
  artist: string;
}

const INTERLUDES: InterludeRow[] = [
  { src: 'noun-fm-jingle.mp3', id: 'noun-fm-jingle', title: 'Noun F-M', intro: 1 },
  {
    src: 'noun-fm-interlude-1.mp3',
    id: 'noun-fm-interlude-1',
    title: 'Noun F-M interlude I',
    intro: 1,
  },
  {
    src: 'noun-fm-interlude-2.mp3',
    id: 'noun-fm-interlude-2',
    title: 'Noun F-M interlude II',
    intro: 1,
  },
  {
    src: 'noun-fm-interlude-5.mp3',
    id: 'noun-fm-interlude-5',
    title: 'Noun F-M interlude V',
    intro: 1,
  },
  {
    src: 'noun-fm-interlude-6.mp3',
    id: 'noun-fm-interlude-6',
    title: 'Noun F-M interlude VI',
    intro: 1,
  },
];

const SONGS: SongRow[] = [
  { src: 'sell-it-cold.mp3', id: 'sell-it-cold', title: 'Sell It Cold', artist: 'NOUN FM' },
  { src: 'noun-city-3.mp3', id: 'noun-city', title: 'Noun City', artist: 'NOUN FM' },
];

const STING_MAX_S = 4.3;
const STING_FADE_S = 0.3;
const ANALYSIS_SR = 11025;

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../public/world2/fm');

function probe(file: string): number {
  const s = execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    file,
  ]).toString();
  return Math.round(Number(s) * 1000) / 1000;
}

function mono(file: string): Float32Array {
  const buf = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      file,
      '-map',
      '0:a:0',
      '-ac',
      '1',
      '-ar',
      String(ANALYSIS_SR),
      '-f',
      'f32le',
      '-',
    ],
    { maxBuffer: 1 << 28 },
  );
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

function encode(src: string, out: string, kbps: number, extra: string[] = []) {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    src,
    ...extra,
    '-map',
    '0:a:0',
    '-vn',
    '-map_metadata',
    '-1',
    '-id3v2_version',
    '0',
    '-write_xing',
    '1',
    '-c:a',
    'libmp3lame',
    '-b:a',
    `${kbps}k`,
    '-ar',
    '44100',
    '-ac',
    '2',
    out,
  ]);
}

function readManifest<T>(file: string, key: string): T[] {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    return Array.isArray(v[key]) ? (v[key] as T[]) : [];
  } catch {
    return [];
  }
}

interface InterludeOut {
  id: string;
  title: string;
  file: string;
  duration: number;
  full: string;
  fullDuration: number;
  intro: number;
  cut: { start: number; length: number };
}
interface SongOut {
  id: string;
  title: string;
  artist: string;
  file: string;
  duration: number;
}

function main() {
  const srcDir = process.argv[2];
  if (srcDir === undefined) {
    console.error('usage: node scripts/fm-audio.ts <source dir>');
    process.exit(1);
  }
  mkdirSync(join(OUT, 'interludes'), { recursive: true });
  mkdirSync(join(OUT, 'songs'), { recursive: true });

  const iFile = join(OUT, 'interludes/manifest.json');
  const old = new Map(readManifest<InterludeOut>(iFile, 'interludes').map(r => [r.id, r]));
  const interludes: InterludeOut[] = [];
  for (const row of INTERLUDES) {
    const src = join(srcDir, row.src);
    if (!existsSync(src)) {
      const keep = old.get(row.id);
      if (keep !== undefined) interludes.push(keep);
      console.log(`skip ${row.src} (not in ${srcDir})`);
      continue;
    }
    const full = join(OUT, 'interludes', `${row.id}.mp3`);
    encode(src, full, 128);
    const cut = chooseStingCut(mono(src), ANALYSIS_SR, STING_MAX_S);
    const start = Math.round(cut.start * 1000) / 1000;
    const len = Math.round(cut.length * 1000) / 1000;
    const sting = join(OUT, 'interludes', `${row.id}-sting.mp3`);
    encode(src, sting, 112, [
      '-ss',
      String(start),
      '-t',
      String(len),
      '-af',
      `afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, len - STING_FADE_S)}:d=${STING_FADE_S}`,
    ]);
    const r: InterludeOut = {
      id: row.id,
      title: row.title,
      file: `${row.id}-sting.mp3`,
      duration: probe(sting),
      full: `${row.id}.mp3`,
      fullDuration: probe(full),
      intro: row.intro,
      cut: { start, length: len },
    };
    interludes.push(r);
    console.log(`${row.id}: full ${r.fullDuration}s, sting ${start}s +${len}s`);
  }
  writeFileSync(iFile, `${JSON.stringify({ interludes }, null, 2)}\n`);

  const sFile = join(OUT, 'songs/manifest.json');
  const oldS = new Map(readManifest<SongOut>(sFile, 'songs').map(r => [r.id, r]));
  const songs: SongOut[] = [];
  for (const row of SONGS) {
    const src = join(srcDir, row.src);
    if (!existsSync(src)) {
      const keep = oldS.get(row.id);
      if (keep !== undefined) songs.push(keep);
      console.log(`skip ${row.src}`);
      continue;
    }
    const out = join(OUT, 'songs', `${row.id}.mp3`);
    encode(src, out, 128);
    songs.push({
      id: row.id,
      title: row.title,
      artist: row.artist,
      file: `${row.id}.mp3`,
      duration: probe(out),
    });
    console.log(`${row.id}: ${probe(out)}s`);
  }
  writeFileSync(sFile, `${JSON.stringify({ songs }, null, 2)}\n`);
}

main();
