#!/usr/bin/env node
/**
 * generate-terraform-terrain.mjs
 *
 * Fetches tokenSVG for all 9,910 Terraforms parcels, parses the 32×32
 * character grids with CSS color classes, maps class letters to heights,
 * and outputs a compact static JSON for the 3D terrain renderer.
 *
 * Each token's SVG contains:
 *   - CSS classes .a through .j with color values (a=peak, j=background)
 *   - A 32×32 grid of <p class='X'>char</p> cells inside <foreignObject>
 *   - Background color in .r { background-color:... }
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
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
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

const TERRAFORMS_ABI = [{
  name: 'tokenSVG',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: '', type: 'string' }],
}];

// Class letter → height: a=9 (peak), b=8, ..., i=1, j=0 (background)
const CLASS_HEIGHT = { a: 9, b: 8, c: 7, d: 6, e: 5, f: 4, g: 3, h: 2, i: 1, j: 0 };

// ─── CLI Args ──────────────────────────────────────────────────────────────

function getArg(name, defaultVal) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  return process.argv[idx + 1] ?? defaultVal;
}
const isSample = process.argv.includes('--sample');
const isResume = process.argv.includes('--resume');
const BATCH_SIZE = parseInt(getArg('batch-size', '5'), 10);
const BATCH_DELAY = parseInt(getArg('delay', '300'), 10);
const START_FROM = parseInt(getArg('start', '1'), 10);
const RPC_URL = getArg('rpc', 'https://mainnet.infura.io/v3/03c669afb3a948d588e7f41dd1f5a70b');

// ─── RPC Client ────────────────────────────────────────────────────────────

const client = viem.createPublicClient({
  chain: chains.mainnet,
  transport: viem.http(RPC_URL),
});

// ─── SVG Parser ────────────────────────────────────────────────────────────

/**
 * Parse a tokenSVG output into terrain data.
 * Returns { bg, palette, grid } where:
 *   bg: background hex color
 *   palette: [10] hex colors for classes a-j (index 0=a, 9=j)
 *   grid: string of 1024 hex digits (0-9), each is the height at that cell
 */
function parseSVG(svg) {
  // Extract CSS color classes
  const palette = new Array(10).fill(null);
  let bg = '#000000';

  const styleMatch = svg.match(/<style>([\s\S]*?)<\/style>/);
  if (styleMatch) {
    const css = styleMatch[1];

    // Extract .a{color:#xxx} through .j{color:#xxx}
    const colorRe = /\.([a-j])\s*\{\s*color\s*:\s*(#[0-9a-fA-F]{6})\s*;?\s*\}/g;
    let m;
    while ((m = colorRe.exec(css)) !== null) {
      const idx = m[1].charCodeAt(0) - 97; // 'a'=0, 'j'=9
      palette[idx] = m[2].toLowerCase();
    }

    // Extract background from .r{background-color:#xxx}
    const bgMatch = css.match(/\.r\s*\{[^}]*background-color\s*:\s*(#[0-9a-fA-F]{6})/);
    if (bgMatch) bg = bgMatch[1].toLowerCase();
  }

  // Fill missing palette entries with background color
  for (let i = 0; i < 10; i++) {
    if (!palette[i]) palette[i] = bg;
  }

  // Extract grid cells: <p class='X'>char</p>
  const cellRe = /<p class='([a-j])'>/g;
  let grid = '';
  let cellMatch;
  while ((cellMatch = cellRe.exec(svg)) !== null) {
    const cls = cellMatch[1];
    const height = CLASS_HEIGHT[cls] ?? 0;
    grid += height.toString();
  }

  // Verify grid size
  if (grid.length !== 1024) {
    // Try alternate format: <p class="X">
    const cellRe2 = /<p class="([a-j])">/g;
    grid = '';
    while ((cellMatch = cellRe2.exec(svg)) !== null) {
      const cls = cellMatch[1];
      grid += (CLASS_HEIGHT[cls] ?? 0).toString();
    }
  }

  if (grid.length !== 1024) {
    return null; // Parse failure
  }

  return { bg, palette, grid };
}

// ─── Progress Management ───────────────────────────────────────────────────

function loadProgress() {
  if (!isResume) return {};
  try {
    if (existsSync(PROGRESS_FILE)) {
      return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function saveProgress(tokens) {
  writeFileSync(PROGRESS_FILE, JSON.stringify(tokens));
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Terraforms Terrain Generator`);
  console.log(`  RPC: ${RPC_URL}`);
  console.log(`  Batch: ${BATCH_SIZE} tokens, ${BATCH_DELAY}ms delay`);
  console.log(`  Output: ${OUTPUT_FILE}\n`);

  // Sample mode: fetch 3 tokens and print debug info
  if (isSample) {
    const sampleIds = [1, 5000, 9910];
    for (const id of sampleIds) {
      console.log(`--- Token #${id} ---`);
      try {
        const svg = await client.readContract({
          address: TERRAFORMS_ADDRESS,
          abi: TERRAFORMS_ABI,
          functionName: 'tokenSVG',
          args: [BigInt(id)],
        });
        console.log(`  SVG length: ${svg.length}`);
        const parsed = parseSVG(svg);
        if (!parsed) {
          console.log(`  PARSE FAILED (grid length != 1024)`);
          continue;
        }
        console.log(`  Background: ${parsed.bg}`);
        console.log(`  Palette: ${parsed.palette.join(', ')}`);
        console.log(`  Grid (first row): ${parsed.grid.slice(0, 32)}`);
        console.log(`  Grid (last row):  ${parsed.grid.slice(-32)}`);
        console.log(`  Height distribution:`);
        const dist = {};
        for (const ch of parsed.grid) dist[ch] = (dist[ch] || 0) + 1;
        for (const [h, count] of Object.entries(dist).sort()) {
          console.log(`    ${h}: ${'█'.repeat(Math.round(count / 20))} (${count})`);
        }
      } catch (err) {
        console.log(`  ERROR: ${err.message?.slice(0, 100)}`);
      }
      console.log();
    }
    return;
  }

  // Full generation
  const tokens = loadProgress();
  const existingCount = Object.keys(tokens).length;
  const startId = isResume ? Math.max(START_FROM, existingCount + 1) : START_FROM;

  if (existingCount > 0) {
    console.log(`Resuming from ${existingCount} cached tokens, starting at #${startId}`);
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

    // Build multicall contracts array
    const calls = ids.map(id => ({
      address: TERRAFORMS_ADDRESS,
      abi: TERRAFORMS_ABI,
      functionName: 'tokenSVG',
      args: [BigInt(id)],
    }));

    // Retry with backoff
    let success = false;
    for (let attempt = 0; attempt < 3 && !success; attempt++) {
      if (attempt > 0) {
        const wait = 2000 * Math.pow(2, attempt);
        console.log(`  Retry ${attempt}/3 after ${wait}ms...`);
        await new Promise(r => setTimeout(r, wait));
      }

      try {
        const results = await client.multicall({ contracts: calls });

        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          const id = ids[i];
          if (r.status !== 'success') {
            console.warn(`  Token #${id}: multicall failed`);
            failed++;
            continue;
          }
          const svg = r.result;
          const parsed = parseSVG(svg);
          if (!parsed) {
            console.warn(`  Token #${id}: parse failed`);
            failed++;
            continue;
          }
          // Store compact: [bg, palette, gridString]
          tokens[id] = [parsed.bg, parsed.palette, parsed.grid];
          processed++;
        }
        success = true;
      } catch (err) {
        console.warn(`  Batch ${batchStart}-${batchEnd} error: ${err.message?.slice(0, 100)}`);
      }
    }

    if (!success) {
      console.error(`  Batch ${batchStart}-${batchEnd} FAILED after 3 attempts. Saving progress.`);
      failed += ids.length;
    }

    // Progress update
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const pct = ((processed / TOTAL_SUPPLY) * 100).toFixed(1);
    const rate = processed > existingCount
      ? ((processed - existingCount) / ((Date.now() - startTime) / 1000)).toFixed(1)
      : '?';
    const remaining = rate !== '?' && parseFloat(rate) > 0
      ? (((TOTAL_SUPPLY - processed) / parseFloat(rate)) / 60).toFixed(1)
      : '?';
    process.stdout.write(
      `\r  ${processed}/${TOTAL_SUPPLY} (${pct}%) · ${elapsed}s elapsed · ${rate} tok/s · ~${remaining}min left    `
    );

    // Save progress every 50 batches
    if (processed % (BATCH_SIZE * 50) === 0) {
      saveProgress(tokens);
    }

    // Delay between batches
    await new Promise(r => setTimeout(r, BATCH_DELAY));
  }

  console.log(`\n\nDone: ${processed} tokens processed, ${failed} failed`);

  // Write output
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const output = { v: 1, count: Object.keys(tokens).length, tokens };
  const json = JSON.stringify(output);
  writeFileSync(OUTPUT_FILE, json);
  console.log(`Output: ${OUTPUT_FILE} (${(json.length / 1024 / 1024).toFixed(1)}MB)`);

  // Clean up progress file
  if (existsSync(PROGRESS_FILE) && failed === 0) {
    const { unlinkSync } = await import('fs');
    try { unlinkSync(PROGRESS_FILE); } catch {}
    console.log('Progress file cleaned up.');
  } else if (failed > 0) {
    saveProgress(tokens);
    console.log(`Progress saved. Re-run with --resume to retry ${failed} failed tokens.`);
  }
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
