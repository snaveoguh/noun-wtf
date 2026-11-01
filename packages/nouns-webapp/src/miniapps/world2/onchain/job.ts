// The daily snapshot job: read the world the way the game does, build each
// snapshot, upload it and commit its root to NounWorldLedger. Run by
// scripts/onchain/snapshot.ts (GitHub Action `world-onchain-snapshot.yml`).
//
// Env (all optional; with none of them it's a dry run that changes nothing):
//   SNAPSHOT_SITE         where to read from (default https://noun.wtf)
//   SNAPSHOT_KINDS        "graffiti,records" (default both)
//   SNAPSHOT_STORAGE      pinata | irys | dryrun (see storage.ts), with
//   PINATA_JWT / IRYS_KEY its key
//   LEDGER_COMMITTER_KEY  0x… key holding the ledger's committer role (gas only)
//   LEDGER_ADDRESS        NounWorldLedger address (else LEDGER_DEPLOYMENTS[chain])
//   LEDGER_CHAIN_ID       84532 Base Sepolia (default) or 8453 Base
//   LEDGER_RPC            RPC override (default the public Base RPC)
//
// It commits only when real storage AND a committer key + ledger address are
// set; a dry-run upload is never committed. A kind whose root equals the
// ledger's latest of that kind is skipped before uploading (the contract
// would refuse it anyway: SameRoot).

import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

import {
  BASE_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  KIND,
  LEDGER_ABI,
  LEDGER_DEPLOYMENTS,
  PUBLIC_RPC,
  type SnapshotKind,
} from './contract';
import {
  buildSnapshot,
  graffitiPieces,
  MANIFEST_FILE,
  recordRows,
  type Snapshot,
  type StatsBoards,
  type StoredTag,
} from './snapshot';
import { storageFromEnv, type Env, type SnapshotStorage } from './storage';

type Fetch = typeof fetch;

export const GRAFFITI_LEVELS = ['plaza', 'park'] as const;
/** world-graffiti answers at most 40 wall ids per read. */
export const WALLS_PER_READ = 40;

// ── Reading the world ───────────────────────────────────────────────────

async function getJson<T>(fetchFn: Fetch, url: string): Promise<T> {
  const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

/** Every wall's tags with their stored time, as world-graffiti serves them. */
export async function readGraffiti(site: string, fetchFn: Fetch = fetch) {
  const fn = `${site}/.netlify/functions/world-graffiti`;
  const walls: Record<string, StoredTag[]> = {};
  for (const level of GRAFFITI_LEVELS) {
    const { walls: ids } = await getJson<{ walls: string[] }>(fetchFn, `${fn}?level=${level}`);
    const sorted = [...new Set(ids)].sort();
    for (let i = 0; i < sorted.length; i += WALLS_PER_READ) {
      const batch = sorted.slice(i, i + WALLS_PER_READ);
      const q = encodeURIComponent(JSON.stringify(batch));
      const got = await getJson<{ walls: Record<string, (StoredTag | string)[]> }>(
        fetchFn,
        `${fn}?level=${level}&ids=${q}&at=1`,
      );
      // an older deploy answers bare strings: keep them, time unknown
      for (const [id, tags] of Object.entries(got.walls ?? {}))
        walls[id] = tags.map(t => (typeof t === 'string' ? { d: t, at: 0 } : t));
    }
  }
  return walls;
}

export const readStats = (site: string, fetchFn: Fetch = fetch) =>
  getJson<StatsBoards>(fetchFn, `${site}/.netlify/functions/world-stats`);

export async function buildKind(
  kind: SnapshotKind,
  site: string,
  now: Date,
  fetchFn: Fetch = fetch,
): Promise<Snapshot | null> {
  if (kind === 'graffiti') {
    const walls = await readGraffiti(site, fetchFn);
    const pieces = graffitiPieces(walls);
    return buildSnapshot('graffiti', pieces, now, { walls: Object.keys(walls).length });
  }
  const stats = await readStats(site, fetchFn);
  const meta: Record<string, number> = {};
  if (typeof stats.riders === 'number') meta.riders = stats.riders;
  if (typeof stats.sessions === 'number') meta.sessions = stats.sessions;
  return buildSnapshot('records', recordRows(stats), now, meta);
}

// ── The ledger ──────────────────────────────────────────────────────────

export interface LedgerWriter {
  readonly address: Address;
  readonly chainId: number;
  latestRoot(kind: number): Promise<Hex | null>;
  commit(root: Hex, uri: string, kind: number): Promise<Hex>;
}

export interface LedgerConfig {
  chainId: number;
  address: Address | null;
  rpc: string;
  key: Hex | null;
}

export function ledgerConfig(env: Env): LedgerConfig {
  const chainId = Number(env.LEDGER_CHAIN_ID || BASE_SEPOLIA_CHAIN_ID);
  if (chainId !== BASE_CHAIN_ID && chainId !== BASE_SEPOLIA_CHAIN_ID)
    throw new Error(`LEDGER_CHAIN_ID ${chainId}: Base (8453) or Base Sepolia (84532) only`);
  const raw = env.LEDGER_ADDRESS || LEDGER_DEPLOYMENTS[chainId] || '';
  const key = env.LEDGER_COMMITTER_KEY || '';
  if (key && !/^0x[\dA-Fa-f]{64}$/.test(key))
    throw new Error('LEDGER_COMMITTER_KEY: not a 0x… 32-byte key');
  if (raw && !isAddress(raw)) throw new Error('LEDGER_ADDRESS: not an address');
  return {
    chainId,
    address: raw ? (raw as Address) : null,
    rpc: env.LEDGER_RPC || PUBLIC_RPC[chainId],
    key: key ? (key as Hex) : null,
  };
}

/** A viem-backed ledger: reads always work, writes need the committer key. */
export function viemLedger(cfg: LedgerConfig & { address: Address; key: Hex }): LedgerWriter {
  const chain = cfg.chainId === BASE_CHAIN_ID ? base : baseSepolia;
  const transport = http(cfg.rpc);
  const pub = createPublicClient({ chain, transport });
  const account = privateKeyToAccount(cfg.key);
  const wallet = createWalletClient({ chain, transport, account });
  const address = cfg.address;
  return {
    address,
    chainId: cfg.chainId,
    async latestRoot(kind) {
      const n = await pub.readContract({
        address,
        abi: LEDGER_ABI,
        functionName: 'versionCountOf',
        args: [kind],
      });
      if (n === 0n) return null;
      const [, v] = await pub.readContract({
        address,
        abi: LEDGER_ABI,
        functionName: 'latestOf',
        args: [kind],
      });
      return v.root;
    },
    async commit(root, uri, kind) {
      const committer = await pub.readContract({
        address,
        abi: LEDGER_ABI,
        functionName: 'committer',
      });
      if (committer.toLowerCase() !== account.address.toLowerCase())
        throw new Error(`ledger: ${account.address} is not the committer (${committer})`);
      const { request } = await pub.simulateContract({
        address,
        abi: LEDGER_ABI,
        functionName: 'commit',
        args: [root, uri, kind],
        account,
      });
      const hash = await wallet.writeContract(request);
      const rcpt = await pub.waitForTransactionReceipt({ hash });
      if (rcpt.status !== 'success') throw new Error(`ledger: commit ${hash} reverted`);
      return hash;
    },
  };
}

// ── The run ─────────────────────────────────────────────────────────────

export interface KindResult {
  kind: SnapshotKind;
  status: 'empty' | 'unchanged' | 'dry-run' | 'uploaded' | 'committed';
  root?: Hex;
  count?: number;
  bytes?: number;
  uri?: string;
  tx?: Hex;
}

export interface RunDeps {
  env: Env;
  now?: Date;
  fetch?: Fetch;
  log?: (msg: string) => void;
  /** Injected in tests; otherwise built from env. */
  storage?: SnapshotStorage;
  ledger?: LedgerWriter | null;
  /** Called with each built snapshot (the CLI writes a dry run to disk). */
  onSnapshot?: (s: Snapshot) => void | Promise<void>;
}

export async function runSnapshot(deps: RunDeps): Promise<KindResult[]> {
  const { env } = deps;
  const now = deps.now ?? new Date();
  const fetchFn = deps.fetch ?? fetch;
  const log = deps.log ?? (() => undefined);
  const site = (env.SNAPSHOT_SITE || 'https://noun.wtf').replace(/\/+$/, '');
  const kinds = (env.SNAPSHOT_KINDS || 'graffiti,records')
    .split(',')
    .map(s => s.trim())
    .filter((k): k is SnapshotKind => k in KIND);

  const storage = deps.storage ?? (await storageFromEnv(env, fetchFn));
  let ledger = deps.ledger;
  if (ledger === undefined) {
    const cfg = ledgerConfig(env);
    ledger =
      cfg.address && cfg.key ? viemLedger({ ...cfg, address: cfg.address, key: cfg.key }) : null;
  }
  const commits = storage.name !== 'dryrun' && ledger !== null;
  log(
    `snapshot ${now.toISOString()} from ${site}: storage ${storage.name}, ` +
      (commits ? `committing to ${ledger!.address} on ${ledger!.chainId}` : 'no commit (dry run)'),
  );

  const out: KindResult[] = [];
  for (const kind of kinds) {
    const snap = await buildKind(kind, site, now, fetchFn);
    if (snap === null) {
      log(`  ${kind}: nothing to snapshot`);
      out.push({ kind, status: 'empty' });
      continue;
    }
    await deps.onSnapshot?.(snap);
    const bytes = snap.files.reduce((n, f) => n + f.body.length, 0);
    const base = { kind, root: snap.root, count: snap.manifest.count, bytes };
    log(
      `  ${kind}: ${snap.manifest.count} leaves, ${(bytes / 1024).toFixed(1)} KB, root ${snap.root}`,
    );

    if (ledger) {
      const last = await ledger.latestRoot(KIND[kind]);
      if (last !== null && last.toLowerCase() === snap.root.toLowerCase()) {
        log(`  ${kind}: unchanged since the last version, skipped`);
        out.push({ ...base, status: 'unchanged' });
        continue;
      }
    }
    const label = `noun-world-${kind}-${now.toISOString().slice(0, 10)}`;
    const dir = await storage.upload(snap.files, label);
    const uri = `${dir}/${MANIFEST_FILE}`;
    if (!commits) {
      log(
        `  ${kind}: ${storage.name === 'dryrun' ? 'dry run' : 'uploaded, no committer key'}: ${uri}`,
      );
      out.push({ ...base, uri, status: storage.name === 'dryrun' ? 'dry-run' : 'uploaded' });
      continue;
    }
    const tx = await ledger!.commit(snap.root, uri, KIND[kind]);
    log(`  ${kind}: committed ${uri} in ${tx}`);
    out.push({ ...base, uri, tx, status: 'committed' });
  }
  return out;
}
