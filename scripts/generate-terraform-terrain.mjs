#!/usr/bin/env node
/**
 * generate-terraform-terrain.mjs
 *
 * Fetches terrain data for all 9,910 Terraforms parcels using the contract's
 * tokenTerrainValues(tokenId) → int256[32][32] (actual signed terrain heights,
 * typically -50K to +50K) and tokenSupplementalData for zone colors.
 *
 * Per-token normalization maps terrain values to 0-9:
 *   0 = lowest point (valley), 9 = highest point (peak)
 *
 * Color mapping: zoneColors[9 - height] where zoneColors[0] = peak color
 * (This matches the SVG class system: class a = peak, class j = background)
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

const TERRAIN_ABI = [{
  name: 'tokenTerrainValues',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{ name: '', type: 'int256[32][32]' }],
}];

const SUPPLEMENTAL_ABI = [{
  name: 'tokenSupplementalData',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'tokenId', type: 'uint256' }],
  outputs: [{
    name: '', type: 'tuple',
    components: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'level', type: 'uint256' },
      { name: 'xCoordinate', type: 'uint256' },
      { name: 'yCoordinate', type: 'uint256' },
      { name: 'elevation', type: 'int256' },
      { name: 'structureSpaceX', type: 'uint256' },
      { name: 'structureSpaceY', type: 'uint256' },
      { name: 'structureSpaceZ', type: 'uint256' },
      { name: 'zoneName', type: 'string' },
      { name: 'zoneColors', type: 'string[10]' },
      { name: 'characterSet', type: 'string[9]' },
    ],
  }],
}];

// ─── CLI Args ──────────────────────────────────────────────────────────────

function getArg(name, defaultVal) {
  const idx = process.argv.indexOf('--' + name);
  if (idx === -1) return defaultVal;
  return process.argv[idx + 1] || defaultVal;
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

// ─── Data Processing ───────────────────────────────────────────────────────

/**
 * Convert int256[32][32] terrain values to compact grid string.
 * Uses per-token normalization: maps [min, max] → [0, 9].
 * Output: 1024-char string, each char '0'-'9' (0=valley, 9=peak).
 */
function terrainToGrid(tv) {
  // Flatten and find range
  const flat = [];
  for (let row = 0; row < 32; row++) {
    for (let col = 0; col < 32; col++) {
      flat.push(Number(tv[row][col]));
    }
  }

  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const range = max - min;

  // Normalize to 0-9
  let grid = '';
  for (const val of flat) {
    const height = range > 0
      ? Math.min(9, Math.floor(((val - min) / range) * 9.999))
      : 0;
    grid += height.toString();
  }
  return grid;
}

/**
 * Extract zone colors from supplemental data.
 * Returns array of 10 hex color strings.
 */
function extractColors(supplemental) {
  const colors = [...supplemental.zoneColors]
    .map(c => c.length > 0 ? c.toLowerCase() : null);
  for (let i = 0; i < 10; i++) {
    if (!colors[i]) colors[i] = '#000000';
  }
  return colors;
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
        const [tv, meta] = await Promise.all([
          client.readContract({
            address: TERRAFORMS_ADDRESS, abi: TERRAIN_ABI,
            functionName: 'tokenTerrainValues', args: [BigInt(id)],
          }),
          client.readContract({
            address: TERRAFORMS_ADDRESS, abi: SUPPLEMENTAL_ABI,
            functionName: 'tokenSupplementalData', args: [BigInt(id)],
          }),
        ]);

        const grid = terrainToGrid(tv);
        const colors = extractColors(meta);

        console.log('  Zone: ' + meta.zoneName + ', Level: ' + Number(meta.level));
        console.log('  Colors: ' + colors.join(', '));
        console.log('  Grid (row 0):  ' + grid.slice(0, 32));
        console.log('  Grid (row 15): ' + grid.slice(15 * 32, 16 * 32));
        console.log('  Grid (row 31): ' + grid.slice(31 * 32));

        const dist = {};
        for (const ch of grid) dist[ch] = (dist[ch] || 0) + 1;
        console.log('  Heights:');
        for (let h = 0; h <= 9; h++) {
          const count = dist[h.toString()] || 0;
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

    // Build multicall: heightmap + supplemental for each token
    const calls = ids.flatMap(id => [
      {
        address: TERRAFORMS_ADDRESS, abi: TERRAIN_ABI,
        functionName: 'tokenTerrainValues', args: [BigInt(id)],
      },
      {
        address: TERRAFORMS_ADDRESS, abi: SUPPLEMENTAL_ABI,
        functionName: 'tokenSupplementalData', args: [BigInt(id)],
      },
    ]);

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
          const tvResult = results[i * 2];
          const metaResult = results[i * 2 + 1];
          const id = ids[i];

          if (tvResult.status !== 'success' || metaResult.status !== 'success') {
            console.warn('\n  Token #' + id + ': call failed');
            failed++;
            continue;
          }

          const grid = terrainToGrid(tvResult.result);
          const colors = extractColors(metaResult.result);

          // Store: [colors[10], gridString(1024)]
          tokens[id] = [colors, grid];
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

  const output = { v: 1, count: Object.keys(tokens).length, tokens };
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
