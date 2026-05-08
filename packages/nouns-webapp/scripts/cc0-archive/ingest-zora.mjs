#!/usr/bin/env node
/**
 * Ingest a creator's Zora drops into the cc0-archive.
 *
 * Uses Zora's public API. Provide a creator address via `--address`. No API
 * key required for the public endpoints. Walks all tokens minted by the
 * given address.
 *
 * Example:
 *   node ingest-zora.mjs --creator duckhead --address 0xabcd…
 */

import { inferMediaType, loadManifest, mergeAssets, rebuildIndex, saveManifest } from './_lib.mjs';

const ZORA_BASE = 'https://api.zora.co/discover/tokens';

function parseArgs(argv) {
  const args = { limit: 200, chain: 'ZORA' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--creator') args.creator = v, i++;
    else if (k === '--address') args.address = v.toLowerCase(), i++;
    else if (k === '--chain') args.chain = v, i++;
    else if (k === '--limit') args.limit = Number(v), i++;
  }
  return args;
}

function gatewayUrl(uri) {
  if (!uri) return undefined;
  if (uri.startsWith('ipfs://')) {
    return `https://magic.decentralized-content.com/ipfs/${uri.slice('ipfs://'.length)}`;
  }
  if (uri.startsWith('ar://')) return `https://arweave.net/${uri.slice('ar://'.length)}`;
  return uri;
}

async function fetchZoraTokens(address, chain, limit) {
  const out = [];
  let cursor;
  while (out.length < limit) {
    const url = new URL(ZORA_BASE);
    url.searchParams.set('creator_address', address);
    url.searchParams.set('chain_name', chain);
    url.searchParams.set('limit', String(Math.min(50, limit - out.length)));
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`zora → ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const tokens = data?.tokens ?? data?.results ?? [];
    if (tokens.length === 0) break;
    out.push(...tokens);
    cursor = data?.next?.cursor || data?.cursor;
    if (!cursor) break;
  }
  return out;
}

function tokenToAsset(token, creatorId) {
  const meta = token.metadata ?? token.token?.metadata ?? {};
  const animationUrl = gatewayUrl(meta.animation_url || meta.animationUrl);
  const imageUrl = gatewayUrl(meta.image || meta.image_url);
  const mediaUrl = animationUrl ?? imageUrl;
  if (!mediaUrl) return null;
  const mime = meta.content?.mime || meta.mime_type;
  const mediaType = inferMediaType(mediaUrl, mime);
  const contractAddr = (token.contract_address || token.contract?.address || '').toLowerCase();
  const tokenId = token.token_id ?? token.tokenId;
  if (!contractAddr || tokenId == null) return null;
  return {
    id: `${creatorId}-zora-${contractAddr.slice(2, 10)}-${tokenId}`,
    creatorId,
    title: meta.name || `Zora token ${tokenId}`,
    description: meta.description,
    source: 'zora',
    sourceUrl: `https://zora.co/collect/zora:${contractAddr}/${tokenId}`,
    mediaUrl,
    mediaType,
    mimeType: mime,
    tags: ['zora', 'cc0', ...(Array.isArray(meta.tags) ? meta.tags : [])],
    license: 'CC0',
    ingestedAt: new Date().toISOString(),
    createdAt: token.minted_at || token.mintedAt,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.creator || !args.address) {
    console.error('--creator <id> and --address <0x…> required');
    process.exit(1);
  }
  const manifest = await loadManifest(args.creator);
  manifest.creator.links = manifest.creator.links || {};
  manifest.creator.links.zora = {
    address: args.address,
    profileUrl: `https://zora.co/${args.address}`,
  };

  console.log(`fetching tokens for ${args.address} on ${args.chain}…`);
  const tokens = await fetchZoraTokens(args.address, args.chain, args.limit);
  console.log(`got ${tokens.length} tokens`);

  const newAssets = tokens.map(t => tokenToAsset(t, args.creator)).filter(Boolean);
  manifest.assets = mergeAssets(manifest.assets, newAssets);
  await saveManifest(args.creator, manifest);
  await rebuildIndex();
  console.log(`✓ ${args.creator}: ${manifest.assets.length} total assets (${newAssets.length} from zora)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
