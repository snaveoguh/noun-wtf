#!/usr/bin/env node
/**
 * Ingest a creator's GitHub repository into the cc0-archive.
 *
 * Walks a public GitHub repo via the contents/git-tree API, filters to media
 * files (.glb/.gltf/.obj/.png/.gif/.svg/.mp4/etc.), and stores each as an
 * ArchiveAsset pointing at raw.githubusercontent.com URLs.
 *
 * Anonymous use is rate-limited to 60 req/hr — pass `GITHUB_TOKEN` env var to
 * lift the cap to 5000/hr.
 *
 * Examples:
 *   node ingest-github.mjs --creator sebastien --repo 0x572f00/NOUNDRY
 *   GITHUB_TOKEN=ghp_… node ingest-github.mjs --creator hugo --repo hugo/something
 */

import { inferMediaType, loadManifest, mergeAssets, rebuildIndex, saveManifest } from './_lib.mjs';

const MEDIA_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg',
  'mp4', 'webm', 'mov',
  'mp3', 'wav', 'ogg', 'm4a',
  'glb', 'gltf', 'obj', 'fbx', 'usdz', 'stl',
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--creator') args.creator = v, i++;
    else if (k === '--repo') args.repo = v, i++;
    else if (k === '--branch') args.branch = v, i++;
    else if (k === '--match') args.match = v, i++;
  }
  return args;
}

function ghHeaders() {
  const h = { accept: 'application/vnd.github+json', 'user-agent': 'noun-wtf-cc0-archive/1.0' };
  if (process.env.GITHUB_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function ghFetch(url) {
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`github ${url} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function defaultBranch(owner, repo) {
  const meta = await ghFetch(`https://api.github.com/repos/${owner}/${repo}`);
  return meta.default_branch;
}

async function listTree(owner, repo, branch) {
  const ref = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`);
  const sha = ref.object?.sha;
  if (!sha) throw new Error(`no sha for ${branch}`);
  const tree = await ghFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
  );
  if (tree.truncated) {
    console.warn('warning: tree response truncated — repo may have >100k files; only partial ingest');
  }
  return (tree.tree ?? []).filter(n => n.type === 'blob');
}

function entryToAsset({ owner, repo, branch, path, size, sha }, creatorId) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  if (!MEDIA_EXTS.has(ext)) return null;
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const sourceUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${path}`;
  const filename = path.split('/').pop() || path;
  return {
    id: `${creatorId}-gh-${sha.slice(0, 10)}`,
    creatorId,
    title: filename,
    description: `${owner}/${repo} · ${path}`,
    source: 'web',
    sourceUrl,
    mediaUrl: rawUrl,
    mediaType: inferMediaType(rawUrl),
    tags: ['github', 'cc0', `repo-${repo.toLowerCase()}`, ext],
    license: 'CC0',
    ingestedAt: new Date().toISOString(),
    meta: size ? { size } : undefined,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.creator || !args.repo) {
    console.error('--creator <id> and --repo <owner/repo> required');
    process.exit(1);
  }
  const [owner, repo] = args.repo.split('/');
  if (!owner || !repo) {
    console.error('--repo must be in owner/repo format');
    process.exit(1);
  }

  const manifest = await loadManifest(args.creator);
  manifest.creator.links = manifest.creator.links || {};
  manifest.creator.links.github = `https://github.com/${owner}`;

  const branch = args.branch || (await defaultBranch(owner, repo));
  console.log(`walking tree of ${owner}/${repo}@${branch}…`);
  let blobs = await listTree(owner, repo, branch);
  if (args.match) blobs = blobs.filter(b => b.path.includes(args.match));
  console.log(`${blobs.length} blobs found`);

  const newAssets = blobs
    .map(b => entryToAsset({ owner, repo, branch, path: b.path, size: b.size, sha: b.sha }, args.creator))
    .filter(Boolean);

  console.log(`${newAssets.length} media assets`);
  manifest.assets = mergeAssets(manifest.assets, newAssets);
  await saveManifest(args.creator, manifest);
  await rebuildIndex();
  console.log(`✓ ${args.creator}: ${manifest.assets.length} total assets`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
