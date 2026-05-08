#!/usr/bin/env node
/**
 * Ingest a creator's microsite or arbitrary web gallery into the cc0-archive.
 *
 * Generic HTML scraper — fetches the URL, extracts every <img src> and
 * <a href> pointing at media files (.png/.gif/.glb/.gltf/.mp4/etc.). Useful
 * for one-page portfolios (like Nadiecito's microsite) where there's no API.
 *
 * Use `--match <pattern>` to filter by URL substring (e.g. "noundry").
 *
 * Example:
 *   node ingest-web.mjs --creator nadiecito --url https://nadiecito.example
 *   node ingest-web.mjs --creator sebastien --url https://noundry.wtf --match .glb
 */

import { inferMediaType, loadManifest, mergeAssets, rebuildIndex, saveManifest } from './_lib.mjs';

const MEDIA_RE = /\.(png|jpe?g|gif|webp|svg|mp4|webm|mov|glb|gltf|obj|fbx|usdz|mp3|wav|ogg)(\?.*)?$/i;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--creator') args.creator = v, i++;
    else if (k === '--url') args.url = v, i++;
    else if (k === '--match') args.match = v, i++;
  }
  return args;
}

function extractUrls(html, baseUrl) {
  const urls = new Set();
  const base = new URL(baseUrl);
  // Naive but effective: grab src= and href= values.
  const srcRe = /(?:src|href|content)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = srcRe.exec(html)) !== null) {
    try {
      const u = new URL(m[1], base).toString();
      if (MEDIA_RE.test(u)) urls.add(u);
    } catch {
      /* ignore unparseable */
    }
  }
  // Also catch background-image: url(…) in inline styles.
  const cssRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  while ((m = cssRe.exec(html)) !== null) {
    try {
      const u = new URL(m[1], base).toString();
      if (MEDIA_RE.test(u)) urls.add(u);
    } catch {
      /* ignore */
    }
  }
  return [...urls];
}

function mediaToAsset(url, creatorId, sourceUrl) {
  const tail = url.split('/').pop()?.split('?')[0] ?? 'media';
  return {
    id: `${creatorId}-web-${tail.slice(0, 60)}`,
    creatorId,
    title: tail,
    source: 'web',
    sourceUrl,
    mediaUrl: url,
    mediaType: inferMediaType(url),
    tags: ['web', 'cc0'],
    license: 'CC0',
    ingestedAt: new Date().toISOString(),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.creator || !args.url) {
    console.error('--creator <id> and --url <https://…> required');
    process.exit(1);
  }
  const manifest = await loadManifest(args.creator);
  if (!manifest.creator.links?.website) {
    manifest.creator.links = { ...(manifest.creator.links || {}), website: args.url };
  }

  console.log(`fetching ${args.url}…`);
  const res = await fetch(args.url, { headers: { 'user-agent': 'noun-wtf-cc0-archive/1.0' } });
  if (!res.ok) {
    console.error(`fetch failed: ${res.status}`);
    process.exit(1);
  }
  const html = await res.text();
  let urls = extractUrls(html, args.url);
  if (args.match) urls = urls.filter(u => u.includes(args.match));
  console.log(`extracted ${urls.length} media urls${args.match ? ` (filtered by "${args.match}")` : ''}`);

  const newAssets = urls.map(u => mediaToAsset(u, args.creator, args.url));
  manifest.assets = mergeAssets(manifest.assets, newAssets);
  await saveManifest(args.creator, manifest);
  await rebuildIndex();
  console.log(`✓ ${args.creator}: ${manifest.assets.length} total assets (${newAssets.length} from web)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
