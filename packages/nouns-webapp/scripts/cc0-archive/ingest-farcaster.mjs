#!/usr/bin/env node
/**
 * Ingest a creator's Farcaster casts (with media embeds) into the cc0-archive.
 *
 * Uses the Neynar API. Provide `NEYNAR_API_KEY` in env. Looks up the creator
 * either by `--fid` (numeric Farcaster ID) or `--handle` (@username).
 *
 * Examples:
 *   NEYNAR_API_KEY=xxx node ingest-farcaster.mjs --creator sebastien --handle sebastien
 *   NEYNAR_API_KEY=xxx node ingest-farcaster.mjs --creator hugo --fid 12345 --limit 200
 *
 * Pulls the creator's casts, filters to those with image/video/gif embeds,
 * and stores each as an ArchiveAsset.
 */

import { inferMediaType, loadManifest, mergeAssets, rebuildIndex, saveManifest } from './_lib.mjs';

const NEYNAR_BASE = 'https://api.neynar.com/v2/farcaster';

function parseArgs(argv) {
  const args = { limit: 150 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--creator') args.creator = v, i++;
    else if (k === '--fid') args.fid = Number(v), i++;
    else if (k === '--handle') args.handle = v.replace(/^@/, ''), i++;
    else if (k === '--limit') args.limit = Number(v), i++;
  }
  return args;
}

async function neynarFetch(path, apiKey) {
  const res = await fetch(`${NEYNAR_BASE}${path}`, {
    headers: { 'x-api-key': apiKey, accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`neynar ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function resolveFid(handle, apiKey) {
  const data = await neynarFetch(`/user/by_username?username=${encodeURIComponent(handle)}`, apiKey);
  if (!data?.user?.fid) throw new Error(`no fid for handle ${handle}`);
  return { fid: data.user.fid, displayName: data.user.display_name, pfp: data.user.pfp_url };
}

async function fetchCasts(fid, limit, apiKey) {
  const out = [];
  let cursor = '';
  while (out.length < limit) {
    const remaining = Math.min(150, limit - out.length);
    const qs = new URLSearchParams({ fid: String(fid), limit: String(remaining) });
    if (cursor) qs.set('cursor', cursor);
    const data = await neynarFetch(`/feed/user/casts?${qs}`, apiKey);
    const casts = data?.casts ?? [];
    if (casts.length === 0) break;
    out.push(...casts);
    cursor = data?.next?.cursor || '';
    if (!cursor) break;
  }
  return out;
}

function castToAssets(cast, creatorId) {
  const embeds = cast.embeds ?? [];
  const assets = [];
  for (const e of embeds) {
    const url = e.url;
    if (!url) continue;
    const mime = e.metadata?.content_type || '';
    const mediaType = inferMediaType(url, mime);
    if (mediaType === 'other') continue;
    const tail = url.split('/').pop()?.split('?')[0] ?? '';
    assets.push({
      id: `${creatorId}-fc-${cast.hash.slice(2, 12)}-${tail.slice(0, 20) || 'embed'}`,
      creatorId,
      title: (cast.text || '').trim().slice(0, 100) || `Cast ${cast.hash.slice(0, 10)}`,
      description: cast.text || undefined,
      source: 'farcaster',
      sourceUrl: `https://warpcast.com/${cast.author.username}/${cast.hash.slice(0, 10)}`,
      mediaUrl: url,
      mediaType,
      mimeType: mime || undefined,
      tags: ['farcaster', 'cc0'],
      license: 'CC0',
      ingestedAt: new Date().toISOString(),
      createdAt: cast.timestamp,
    });
  }
  return assets;
}

async function main() {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) {
    console.error('NEYNAR_API_KEY env var required (https://neynar.com)');
    process.exit(1);
  }
  const args = parseArgs(process.argv);
  if (!args.creator) {
    console.error('--creator <id> required');
    process.exit(1);
  }
  if (!args.fid && !args.handle) {
    console.error('--fid <n> or --handle <name> required');
    process.exit(1);
  }

  const manifest = await loadManifest(args.creator);
  let fid = args.fid;
  if (!fid) {
    const resolved = await resolveFid(args.handle, apiKey);
    fid = resolved.fid;
    if (!manifest.creator.avatar && resolved.pfp) manifest.creator.avatar = resolved.pfp;
    manifest.creator.links = manifest.creator.links || {};
    manifest.creator.links.farcaster = { fid, handle: args.handle };
  }

  console.log(`fetching ${args.limit} casts for fid ${fid}…`);
  const casts = await fetchCasts(fid, args.limit, apiKey);
  console.log(`got ${casts.length} casts; extracting media embeds…`);

  const newAssets = casts.flatMap(c => castToAssets(c, args.creator));
  console.log(`${newAssets.length} media assets found`);

  manifest.assets = mergeAssets(manifest.assets, newAssets);
  await saveManifest(args.creator, manifest);
  await rebuildIndex();
  console.log(`✓ ${args.creator}: ${manifest.assets.length} total assets`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
