#!/usr/bin/env node
/**
 * generate-terraform-terrain.mjs
 *
 * Fetches tokenSVG for all 9,910 Terraforms parcels and parses the onchain
 * SVG to extract the EXACT per-cell colors and class assignments.
 *
 * Each SVG contains a 32×32 grid of <p class='X'>char</p> cells, where X
 * is a CSS class (a-j) with a defined color. This matches the onchain art
 * exactly — colors, class assignments, everything.
 *
 * Height is derived from the class letter: a=9 (peak), b=8, ..., i=1, j=0 (bg).
 * The renderer uses these heights for 3D extrusion while keeping exact colors.
 *
 * Output: packages/nouns-webapp/public/data/terraforms-terrain.json
 *
 * Usage:
 *   node scripts/generate-terraform-terrain.mjs            # full run (all 9910)
 *   node scripts/generate-terraform-terrain.mjs --sample    # fetch 3 tokens, print debug
 *   node scripts/generate-terraform-terrain.mjs --resume    # resume from progress file
 *   node scripts/generate-terraform-terrain.mjs --start 500 # start from token 500
 *
 * Options:
 *   --batch-size N   Tokens per multicall batch (default: 5)
 *   --delay N        Ms between batches (default: 300)
 *   --rpc URL        Custom RPC endpoint
 */

import { resolve, join, dirname } from 'path';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'packages', 'nouns-webapp', 'public', 'data');
const OUTPUT_FILE = join(OUTPUT_DIR, 'terraforms-terrain.json');
const PROGRESS_FILE = join(__dirname, '.terraform-terrain-progress.json');

// ─── Import viem from webapp's node_modules ────────────────────────────────

const viemPath = resolve(ROOT, 'packages/nouns-webapp/node_modules/viem/_cjs/index.js');
const chainsPath = resolve(ROOT, 'packages/nouns-webapp/node_modules/viem/_cjs/chains/index.js');
const [viem, chains] = await Promise.all([import(viemPath), import(chainsPath)]);

// ─── Constants ─────────────────────────────────────────────────────────────

const TERRAFORMS_ADDRESS = '0x4E1f41613c9084FdB9E34E11fAE9412427480e56';
const TOTAL_SUPPLY = 9910;

const SVG_ABI = [{
  name: 'tokenSVG',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: '', type: 'string' }],
}];

// ─── CLI Args ──────────────────────────────────────────────────────────────

function getArg(name, defaultVal) {
  const idx = process.argv.indexOf('--' + name);
  if (idx === -1) return defaultVal;
  return process.argv[idx + 1] || defaultVal;
}
const isSample = process.argv.includes('--sample');
const isResume = process.argv.includes('--resume');
const BATCH_SIZE = parseInt(getArg('batch-size', '3'), 10);
const BATCH_DELAY = parseInt(getArg('delay', '400'), 10);
const START_FROM = parseInt(getArg('start', '1'), 10);
const RPC_URL = getArg('rpc', 'https://mainnet.infura.io/v3/03c669afb3a948d588e7f41dd1f5a70b');

// ─── RPC Client ────────────────────────────────────────────────────────────

const client = viem.createPublicClient({
  chain: chains.mainnet,
  transport: viem.http(RPC_URL),
});

// ─── SVG Parser ───────────────────────────────────────────────────────────

// Class letter → 3D height: a=9 (peak), b=8, ..., i=1, j=0 (background)
const CLASS_HEIGHT = { a: 9, b: 8, c: 7, d: 6, e: 5, f: 4, g: 3, h: 2, i: 1, j: 0 };

/**
 * Parse a tokenSVG output to extract exact onchain art data.
 * Returns { bg, palette, grid, chars } where:
 *   bg: background hex color
 *   palette: [10] hex colors for classes a-j
 *   grid: 1024-char string of class letters (a-j)
 *   chars: object mapping class letter → character used
 */
function parseSVG(svg) {
  const palette = new Array(10).fill(null);
  let bg = '#000000';

  // Extract CSS color classes: .a{color:#xxx} through .j{color:#xxx}
  const styleMatch = svg.match(/<style>([\s\S]*?)<\/style>/);
  if (styleMatch) {
    const css = styleMatch[1];
    const colorRe = /\.([a-j])\s*\{\s*color\s*:\s*(#[0-9a-fA-F]{6})\s*;?\s*\}/g;
    let m;
    while ((m = colorRe.exec(css)) !== null) {
      palette[m[1].charCodeAt(0) - 97] = m[2].toLowerCase();
    }
    const bgMatch = css.match(/\.r\s*\{[^}]*background-color\s*:\s*(#[0-9a-fA-F]{6})/);
    if (bgMatch) bg = bgMatch[1].toLowerCase();
  }

  // Fill missing palette entries with background
  for (let i = 0; i < 10; i++) {
    if (!palette[i]) palette[i] = bg;
  }

  // Extract grid cells: <p class='X'>char</p>
  const cellRe = /<p class='([a-j])'>([\s\S]*?)<\/p>/g;
  let grid = '';
  const chars = {};
  let cellMatch;
  while ((cellMatch = cellRe.exec(svg)) !== null) {
    grid += cellMatch[1];
    if (!chars[cellMatch[1]]) chars[cellMatch[1]] = cellMatch[2];
  }

  // Fallback: try double-quote attributes
  if (grid.length !== 1024) {
    const cellRe2 = /<p class="([a-j])">([\s\S]*?)<\/p>/g;
    grid = '';
    while ((cellMatch = cellRe2.exec(svg)) !== null) {
      grid += cellMatch[1];
      if (!chars[cellMatch[1]]) chars[cellMatch[1]] = cellMatch[2];
    }
  }

  if (grid.length !== 1024) return null;
  return { bg, palette, grid, chars };
}

// ─── Progress Management ───────────────────────────────────────────────────

function loadProgress() {
  if (!isResume) return {};
  try {
    if (existsSync(PROGRESS_FILE)) {
      return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return {};
}

function saveProgress(tokens) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(tokens));
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('Terraforms Terrain Generator');
  console.log('  RPC: ' + RPC_URL);
  console.log('  Batch: ' + BATCH_SIZE + ' tokens, ' + BATCH_DELAY + 'ms delay');
  console.log('  Output: ' + OUTPUT_FILE + '\n');

  // ── Sample mode ────────────────────────────────────────────────────────
  if (isSample) {
    const sampleIds = [1, 5000, 9910];
    for (const id of sampleIds) {
      console.log('--- Token #' + id + ' ---');
      try {
        const svg = await client.readContract({
          address: TERRAFORMS_ADDRESS, abi: SVG_ABI,
          functionName: 'tokenSVG', args: [BigInt(id)],
        });

        console.log('  SVG: ' + svg.length + ' chars');
        const parsed = parseSVG(svg);
        if (!parsed) { console.log('  PARSE FAILED'); continue; }

        console.log('  Background: ' + parsed.bg);
        console.log('  Palette: ' + parsed.palette.join(', '));
        console.log('  Chars: ' + Object.entries(parsed.chars).map(([k,v]) => k + '=' + v).join(' '));
        console.log('  Grid (row 0):  ' + parsed.grid.slice(0, 32));
        console.log('  Grid (row 15): ' + parsed.grid.slice(15 * 32, 16 * 32));
        console.log('  Grid (row 31): ' + parsed.grid.slice(31 * 32));

        // Height distribution
        const dist = {};
        for (const ch of parsed.grid) {
          const h = CLASS_HEIGHT[ch] || 0;
          dist[h] = (dist[h] || 0) + 1;
        }
        console.log('  Heights:');
        for (let h = 0; h <= 9; h++) {
          const count = dist[h] || 0;
          const bar = Array(Math.round(count / 15)).fill('#').join('');
          console.log('    ' + h + ': ' + bar + ' (' + count + ')');
        }
      } catch (err) {
        console.log('  ERROR: ' + (err.message || '').slice(0, 150));
      }
      console.log();
    }
    return;
  }

  // ── Full generation ────────────────────────────────────────────────────
  const tokens = loadProgress();
  const existingCount = Object.keys(tokens).length;
  const startId = isResume && existingCount > 0
    ? Math.max(START_FROM, existingCount + 1)
    : START_FROM;

  if (existingCount > 0) {
    console.log('Resuming from ' + existingCount + ' cached tokens, starting at #' + startId);
  }

  let processed = existingCount;
  let failed = 0;
  const startTime = Date.now();

  for (let batchStart = startId; batchStart <= TOTAL_SUPPLY; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, TOTAL_SUPPLY);
    const ids = [];
    for (let id = batchStart; id <= batchEnd; id++) {
      if (!tokens[id]) ids.push(id);
    }
    if (ids.length === 0) continue;

    // Build multicall: tokenSVG for each token
    const calls = ids.map(id => ({
      address: TERRAFORMS_ADDRESS, abi: SVG_ABI,
      functionName: 'tokenSVG', args: [BigInt(id)],
    }));

    let success = false;
    for (let attempt = 0; attempt < 3 && !success; attempt++) {
      if (attempt > 0) {
        const wait = 2000 * Math.pow(2, attempt);
        console.log('\n  Retry ' + attempt + '/3 after ' + wait + 'ms...');
        await new Promise(r => setTimeout(r, wait));
      }

      try {
        const results = await client.multicall({ contracts: calls });

        for (let i = 0; i < ids.length; i++) {
          const r = results[i];
          const id = ids[i];

          if (r.status !== 'success') {
            console.warn('\n  Token #' + id + ': call failed');
            failed++;
            continue;
          }

          const parsed = parseSVG(r.result);
          if (!parsed) {
            console.warn('\n  Token #' + id + ': SVG parse failed');
            failed++;
            continue;
          }

          // Store: [bg, palette[10], classGrid(1024), chars{a:'⛓',...}]
          tokens[id] = [parsed.bg, parsed.palette, parsed.grid, parsed.chars];
          processed++;
        }
        success = true;
      } catch (err) {
        console.warn('\n  Batch ' + batchStart + '-' + batchEnd + ' error: ' + (err.message || '').slice(0, 100));
      }
    }

    if (!success) {
      console.error('\n  Batch ' + batchStart + '-' + batchEnd + ' FAILED after 3 attempts.');
      failed += ids.length;
    }

    // Progress update
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const pct = ((processed / TOTAL_SUPPLY) * 100).toFixed(1);
    const newTokens = processed - existingCount;
    const rate = newTokens > 0
      ? (newTokens / ((Date.now() - startTime) / 1000)).toFixed(1)
      : '?';
    const remaining = rate !== '?' && parseFloat(rate) > 0
      ? (((TOTAL_SUPPLY - processed) / parseFloat(rate)) / 60).toFixed(1)
      : '?';
    process.stdout.write(
      '\r  ' + processed + '/' + TOTAL_SUPPLY + ' (' + pct + '%) | ' + elapsed + 's | ' + rate + ' tok/s | ~' + remaining + 'min left    '
    );

    // Save progress every 50 batches
    if (newTokens > 0 && newTokens % (BATCH_SIZE * 50) === 0) {
      saveProgress(tokens);
    }

    await new Promise(r => setTimeout(r, BATCH_DELAY));
  }

  console.log('\n\nDone: ' + processed + ' tokens, ' + failed + ' failed');

  // ── Write output ───────────────────────────────────────────────────────
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const output = { v: 2, count: Object.keys(tokens).length, tokens };
  const json = JSON.stringify(output);
  writeFileSync(OUTPUT_FILE, json);
  console.log('Output: ' + OUTPUT_FILE + ' (' + (json.length / 1024 / 1024).toFixed(1) + 'MB)');

  // Clean up
  if (existsSync(PROGRESS_FILE) && failed === 0) {
    try { unlinkSync(PROGRESS_FILE); } catch (e) { /* ignore */ }
    console.log('Progress file cleaned up.');
  } else if (failed > 0) {
    saveProgress(tokens);
    console.log('Progress saved. Re-run with --resume to retry ' + failed + ' failed tokens.');
  }
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
