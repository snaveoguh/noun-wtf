// Where a snapshot's files go. Pluggable; keys come from env only.
//
//   pinata  IPFS through Pinata's pinning API (PINATA_JWT). The whole snapshot
//           is one directory: ipfs://<dirCID>/manifest.json, …/p/<hash>.json.
//           Files are content-addressed, so a piece that didn't change since
//           yesterday is the same block and costs nothing more to pin.
//   irys    Arweave through Irys (IRYS_KEY: a Base-funded EVM key; needs the
//           optional @irys/upload + @irys/upload-ethereum packages). Each file
//           is its own data item, then an Arweave path manifest ties them into
//           ar://<manifestId>/manifest.json. Permanent: paid once, up front.
//   dryrun  Nothing leaves the machine. URIs are dryrun://<sha256> and are
//           never committed on-chain.

import type { SnapshotFile } from './snapshot';

import { sha256, stringToBytes } from 'viem';

export interface SnapshotStorage {
  readonly name: 'pinata' | 'irys' | 'dryrun';
  /** Upload a snapshot directory; returns its base URI (no trailing slash). */
  upload(files: SnapshotFile[], label: string): Promise<string>;
}

type Fetch = typeof fetch;

// ── dry run ─────────────────────────────────────────────────────────────

export class DryRunStorage implements SnapshotStorage {
  readonly name = 'dryrun' as const;
  /** Every upload, by base URI (tests read them back). */
  readonly uploads = new Map<string, SnapshotFile[]>();

  async upload(files: SnapshotFile[]): Promise<string> {
    const all = files.map(f => `${f.path}\n${sha256(stringToBytes(f.body))}`).join('\n');
    const uri = `dryrun://${sha256(stringToBytes(all)).slice(2)}`;
    this.uploads.set(uri, files);
    return uri;
  }
}

// ── IPFS (Pinata) ───────────────────────────────────────────────────────

export const PINATA_PIN_URL = 'https://api.pinata.cloud/pinning/pinFileToIPFS';

export class PinataStorage implements SnapshotStorage {
  readonly name = 'pinata' as const;
  constructor(
    private readonly jwt: string,
    private readonly fetchFn: Fetch = fetch,
  ) {
    if (!jwt) throw new Error('pinata: PINATA_JWT is empty');
  }

  async upload(files: SnapshotFile[], label: string): Promise<string> {
    const form = new FormData();
    // A shared top folder makes Pinata pin one directory and answer with its CID
    for (const f of files)
      form.append('file', new Blob([f.body], { type: 'application/json' }), `${label}/${f.path}`);
    form.append('pinataMetadata', JSON.stringify({ name: label }));
    form.append('pinataOptions', JSON.stringify({ cidVersion: 1, wrapWithDirectory: false }));
    const res = await this.fetchFn(PINATA_PIN_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.jwt}` },
      body: form,
    });
    if (!res.ok) throw new Error(`pinata: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const out = (await res.json()) as { IpfsHash?: string };
    if (typeof out.IpfsHash !== 'string' || !/^[\dA-Za-z]{46,}$/.test(out.IpfsHash))
      throw new Error('pinata: no CID in the answer');
    return `ipfs://${out.IpfsHash}`;
  }
}

// ── Arweave (Irys) ──────────────────────────────────────────────────────

/** The slice of the Irys uploader this uses (an `@irys/upload` Uploader). */
export interface IrysClient {
  upload(data: string, opts: { tags: { name: string; value: string }[] }): Promise<{ id: string }>;
}

/** Arweave path manifest (https://docs.arweave.org, "path manifests" v0.2.0). */
export function arweavePathManifest(ids: Record<string, string>, index: string) {
  const paths: Record<string, { id: string }> = {};
  for (const p of Object.keys(ids).sort()) paths[p] = { id: ids[p] };
  return { manifest: 'arweave/paths', version: '0.2.0', index: { path: index }, paths };
}

export class IrysStorage implements SnapshotStorage {
  readonly name = 'irys' as const;
  constructor(private readonly client: IrysClient) {}

  async upload(files: SnapshotFile[], label: string): Promise<string> {
    const ids: Record<string, string> = {};
    for (const f of files) {
      const r = await this.client.upload(f.body, {
        tags: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'App-Name', value: 'noun-world-snapshot' },
          { name: 'Snapshot', value: label },
        ],
      });
      ids[f.path] = r.id;
    }
    const index = files.some(f => f.path === 'manifest.json') ? 'manifest.json' : files[0].path;
    const man = await this.client.upload(JSON.stringify(arweavePathManifest(ids, index)), {
      tags: [
        { name: 'Type', value: 'manifest' },
        { name: 'Content-Type', value: 'application/x.arweave-manifest+json' },
        { name: 'Snapshot', value: label },
      ],
    });
    return `ar://${man.id}`;
  }
}

/** Load the optional Irys SDK (kept out of the bundle: only the job uses it). */
export async function irysClient(key: string, rpc?: string): Promise<IrysClient> {
  const mod = (name: string) => import(/* @vite-ignore */ name) as Promise<Record<string, unknown>>;
  let up: Record<string, unknown>;
  let eth: Record<string, unknown>;
  try {
    [up, eth] = await Promise.all([mod('@irys/upload'), mod('@irys/upload-ethereum')]);
  } catch {
    throw new Error(
      'irys: install the SDK first (pnpm --filter @nouns/webapp add -D @irys/upload @irys/upload-ethereum)',
    );
  }
  type Builder = {
    withWallet(k: string): Builder;
    withRpc(r: string): Builder;
    then: Promise<IrysClient>['then'];
  };
  const Uploader = up.Uploader as (token: unknown) => Builder;
  let b = Uploader(eth.BaseEth).withWallet(key);
  if (rpc) b = b.withRpc(rpc);
  return await b;
}

// ── From env ────────────────────────────────────────────────────────────

export type Env = Record<string, string | undefined>;

/**
 * SNAPSHOT_STORAGE picks one (pinata | irys | dryrun); unset, it's pinata if
 * PINATA_JWT is set, irys if IRYS_KEY is, else a dry run.
 */
export async function storageFromEnv(env: Env, fetchFn: Fetch = fetch): Promise<SnapshotStorage> {
  const want =
    env.SNAPSHOT_STORAGE || (env.PINATA_JWT ? 'pinata' : env.IRYS_KEY ? 'irys' : 'dryrun');
  if (want === 'pinata') return new PinataStorage(env.PINATA_JWT ?? '', fetchFn);
  if (want === 'irys') {
    if (!env.IRYS_KEY) throw new Error('irys: IRYS_KEY is empty');
    return new IrysStorage(await irysClient(env.IRYS_KEY, env.IRYS_RPC));
  }
  if (want === 'dryrun') return new DryRunStorage();
  throw new Error(`SNAPSHOT_STORAGE: unknown backend "${want}"`);
}

/** An ipfs:// or ar:// URI as an HTTPS gateway URL (for the page and the job's checks). */
export function gatewayUrl(
  uri: string,
  ipfsGateway = 'https://ipfs.io/ipfs/',
  arGateway = 'https://arweave.net/',
) {
  if (uri.startsWith('ipfs://')) return ipfsGateway + uri.slice(7);
  if (uri.startsWith('ar://')) return arGateway + uri.slice(5);
  return uri;
}
