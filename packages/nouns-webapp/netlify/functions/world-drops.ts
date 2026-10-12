import { connectLambda, getStore } from '@netlify/blobs';
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';

import { megaBlocked, terrainHeight } from '../../src/miniapps/world2/world/mountain/terrain';
import { tracks } from '../../src/miniapps/world2/world/mountain/tracks';
import { STRIDE, decodeTrace, verifyRun } from '../lib/runProof';

// Noun World drop party v2: items on the NounWorldDrops contract, placed in
// the world, picked up by riding into them.
//
// GET → { enabled: false }
//     | { enabled: true, chainId, contract, drops: PublicDrop[] }
//
// POST { action: 'claim', dropId, address, proof }
//   proof: the ride that reached the drop (base64 Float32 samples of
//   [t, x, y, z, speed, state], the run-proof format, ../lib/runProof.ts).
//   It must pass the physics check and hold a sample within REACH m of the
//   drop. Then the drop is reserved for `address` for a few minutes and the
//   server's key signs an EIP-712 voucher, Claim(dropId, claimer, deadline),
//   that only `address` can use. First valid claimer wins; anyone else gets
//   409 { error: 'taken' } until the reservation (and so the voucher) lapses.
//   → { voucher: { dropId, claimer, deadline, signature }, contract, chainId }
//
// POST { action: 'claimed', dropId }
//   The contract says the drop was claimed (read on-chain): take it off the map.
//
// Admin (header `x-admin-token: $WORLD_DROPS_ADMIN_TOKEN`):
// POST { action: 'place', dropId, position?: {x,y,z}, asset?, expiresAt? }
//   Put on-chain drop `dropId` in the world: at `position`, or a random spot
//   on a dirt track `minDown`..`maxDown` m below the city (default 150..1200).
//   The asset summary and expiry are read from the contract unless given.
// POST { action: 'remove', dropId }
//
// Env: WORLD_DROPS_SIGNER_KEY, WORLD_DROPS_ADMIN_TOKEN, WORLD_DROPS_ADDRESS
// (or VITE_WORLD_DROPS_ADDRESS) turn it on; WORLD_DROPS_CHAIN_ID (default 1)
// and WORLD_DROPS_RPC_URL are optional.

interface HandlerEvent {
  body: string | null;
  blobs?: string;
  headers?: Record<string, string | undefined>;
  httpMethod: string;
}

interface HandlerResponse {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
}

export type AssetKind = 'eth' | 'erc20' | 'erc721' | 'erc1155';

export interface DropAsset {
  kind: AssetKind;
  /** "0.05 ETH", "100 USDC", "Nouns #12". */
  label: string;
  token?: string;
  tokenId?: string;
  amount?: string;
  image?: string;
}

interface Reservation {
  address: string;
  /** Voucher deadline (unix s). */
  deadline: number;
  signature: string;
  /** Held until (ms): the deadline plus a little clock slack. */
  until: number;
}

interface StoredDrop {
  dropId: string;
  x: number;
  y: number;
  z: number;
  asset: DropAsset;
  /** On-chain expiry (ms). */
  expiresAt: number;
  placedAt: number;
  status: 'open' | 'claimed';
  claimedBy?: string;
  reservation?: Reservation;
}

interface State {
  drops: StoredDrop[];
}

export interface PublicDrop {
  dropId: string;
  x: number;
  y: number;
  z: number;
  asset: DropAsset;
  expiresAt: number;
  /** Someone holds a live voucher for it. */
  taken: boolean;
}

/** A trace sample this close to the drop counts as reaching it (m). */
const REACH = 4;
/** How long a voucher (and its reservation) lasts. */
const VOUCHER_S = 5 * 60;
/** A drop this close to expiry is no longer handed out (the tx needs time). */
const EXPIRY_MARGIN_MS = 2 * 60_000;
const MAX_PROOF_CHARS = 1_500_000;
const MAX_DROPS = 200;
const KEY = 'state';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-token',
  'Cache-Control': 'no-store',
};
const json = (status: number, body: unknown): HandlerResponse => ({
  statusCode: status,
  headers,
  body: JSON.stringify(body),
});

export const DROPS_ABI = parseAbi([
  'function claim(uint256 dropId, uint256 deadline, bytes signature)',
  'function getDrop(uint256 dropId) view returns ((address depositor, uint64 expiresAt, uint8 kind, uint8 status, address token, uint256 tokenId, uint256 amount, address claimer))',
]);
const TOKEN_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
  'function tokenURI(uint256) view returns (string)',
  'function uri(uint256) view returns (string)',
]);

/** EIP-712 typed data for a voucher (must match NounWorldDrops.sol). */
export const CLAIM_TYPES = {
  Claim: [
    { name: 'dropId', type: 'uint256' },
    { name: 'claimer', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const;

interface Config {
  signerKey: Hex;
  adminToken: string;
  contract: Address;
  chainId: number;
  rpcUrl: string;
}

function config(): Config | null {
  const key = (process.env.WORLD_DROPS_SIGNER_KEY ?? '').trim();
  const adminToken = (process.env.WORLD_DROPS_ADMIN_TOKEN ?? '').trim();
  const contract = (
    process.env.WORLD_DROPS_ADDRESS ??
    process.env.VITE_WORLD_DROPS_ADDRESS ??
    ''
  ).trim();
  if (!/^0x[\dA-Fa-f]{64}$/.test(key) || adminToken.length < 16 || !isAddress(contract))
    return null;
  const chainId = Number(process.env.WORLD_DROPS_CHAIN_ID ?? 1) || 1;
  const rpcUrl =
    process.env.WORLD_DROPS_RPC_URL ??
    (chainId === sepolia.id
      ? 'https://ethereum-sepolia-rpc.publicnode.com'
      : 'https://ethereum-rpc.publicnode.com');
  return { signerKey: key as Hex, adminToken, contract: getAddress(contract), chainId, rpcUrl };
}

function client(c: Config) {
  const chain = c.chainId === sepolia.id ? sepolia : mainnet;
  return createPublicClient({ chain, transport: http(c.rpcUrl, { timeout: 8000 }) });
}

/** Constant-time string compare (the admin token). */
function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

function header(event: HandlerEvent, name: string): string {
  const h = event.headers ?? {};
  for (const k of Object.keys(h)) if (k.toLowerCase() === name) return h[k] ?? '';
  return '';
}

const dropIdOf = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return /^\d{1,30}$/.test(s) && s !== '0' ? BigInt(s).toString() : null;
};

const live = (d: StoredDrop, now: number) => d.status === 'open' && d.expiresAt > now;

function toPublic(d: StoredDrop, now: number): PublicDrop {
  return {
    dropId: d.dropId,
    x: d.x,
    y: d.y,
    z: d.z,
    asset: d.asset,
    expiresAt: d.expiresAt,
    taken: d.reservation !== undefined && d.reservation.until > now,
  };
}

// ── Placement ───────────────────────────────────────────────────────────

/** A random spot on a dirt track `minDown`..`maxDown` m out, clear of ramps. */
export function randomTrackSpot(minDown = 150, maxDown = 1200, rand = Math.random) {
  const p = { x: 0, z: 0, h: 0, k: 0 };
  const lo = Math.max(20, Math.min(minDown, maxDown));
  const hi = Math.max(lo + 1, maxDown);
  for (let attempt = 0; attempt < 40; attempt++) {
    const t = tracks.main(Math.floor(rand() * 3));
    if (t === undefined) continue;
    const s = lo + rand() * (hi - lo);
    tracks.pointAt(t, t.s0 + s, p);
    // Not on a launch ramp or a mega ramp terrace
    if (tracks.rampsIn(p.x - 40, p.z - 40, p.x + 40, p.z + 40).length > 0) continue;
    if (megaBlocked(p.x, p.z)) continue;
    const y = terrainHeight(p.x, p.z);
    if (!Number.isFinite(y)) continue;
    return { x: p.x, y: y + 1.1, z: p.z };
  }
  return null;
}

/** Fetch an NFT's image from its metadata URI (best effort). */
async function nftImage(uri: string, tokenId: bigint): Promise<string | undefined> {
  const gw = (u: string) => (u.startsWith('ipfs://') ? `https://ipfs.io/ipfs/${u.slice(7)}` : u);
  try {
    const u = uri.replace('{id}', tokenId.toString(16).padStart(64, '0'));
    let meta: { image?: string; image_url?: string };
    if (u.startsWith('data:application/json;base64,'))
      meta = JSON.parse(Buffer.from(u.slice(29), 'base64').toString('utf8'));
    else if (u.startsWith('data:application/json'))
      meta = JSON.parse(decodeURIComponent(u.slice(u.indexOf(',') + 1)));
    else {
      const res = await fetch(gw(u), { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return undefined;
      meta = await res.json();
    }
    const img = meta.image ?? meta.image_url;
    if (typeof img !== 'string') return undefined;
    // Inline SVGs stay small enough to keep; everything else is a URL
    if (img.startsWith('data:') && img.length > 200_000) return undefined;
    return gw(img);
  } catch {
    return undefined;
  }
}

/** Asset summary + expiry of an on-chain drop. */
async function readDrop(c: Config, dropId: string) {
  const pc = client(c);
  const d = await pc.readContract({
    address: c.contract,
    abi: DROPS_ABI,
    functionName: 'getDrop',
    args: [BigInt(dropId)],
  });
  const kind = (['eth', 'erc20', 'erc721', 'erc1155'] as const)[d.kind] ?? 'eth';
  const token = d.token;
  const asset: DropAsset = { kind, label: '' };
  if (kind === 'eth') {
    asset.amount = d.amount.toString();
    asset.label = `${formatUnits(d.amount, 18)} ETH`;
  } else if (kind === 'erc20') {
    const [sym, dec] = await Promise.all([
      pc.readContract({ address: token, abi: TOKEN_ABI, functionName: 'symbol' }).catch(() => '?'),
      pc.readContract({ address: token, abi: TOKEN_ABI, functionName: 'decimals' }).catch(() => 18),
    ]);
    Object.assign(asset, { token, amount: d.amount.toString() });
    asset.label = `${formatUnits(d.amount, Number(dec))} ${sym}`;
  } else {
    const name = await pc
      .readContract({ address: token, abi: TOKEN_ABI, functionName: 'name' })
      .catch(() => 'NFT');
    const uri = await pc
      .readContract({
        address: token,
        abi: TOKEN_ABI,
        functionName: kind === 'erc721' ? 'tokenURI' : 'uri',
        args: [d.tokenId],
      })
      .catch(() => null);
    Object.assign(asset, { token, tokenId: d.tokenId.toString(), amount: d.amount.toString() });
    asset.label = `${name} #${d.tokenId}${kind === 'erc1155' && d.amount > 1n ? ` ×${d.amount}` : ''}`;
    if (uri !== null) asset.image = await nftImage(uri, d.tokenId);
  }
  return { asset, expiresAt: Number(d.expiresAt) * 1000, status: d.status, claimer: d.claimer };
}

function cleanAsset(raw: unknown): DropAsset | null {
  if (raw === null || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  const kind = String(a.kind ?? '') as AssetKind;
  if (!['eth', 'erc20', 'erc721', 'erc1155'].includes(kind)) return null;
  const str = (v: unknown, n: number) =>
    v === undefined || v === null ? undefined : String(v).slice(0, n);
  const label = str(a.label, 80);
  if (!label) return null;
  const image = str(a.image, 2000);
  return {
    kind,
    label,
    token: str(a.token, 42),
    tokenId: str(a.tokenId, 80),
    amount: str(a.amount, 80),
    image: image !== undefined && /^(https:|ipfs:|data:image\/)/.test(image) ? image : undefined,
  };
}

// ── Proof ───────────────────────────────────────────────────────────────

/** Did this ride (a valid run proof) reach (x, y, z)? */
export function traceReaches(
  b64: unknown,
  at: { x: number; y: number; z: number },
): { ok: true } | { ok: false; reason: string } {
  if (typeof b64 !== 'string' || b64.length === 0) return { ok: false, reason: 'no proof' };
  if (b64.length > MAX_PROOF_CHARS) return { ok: false, reason: 'proof too long' };
  const s = decodeTrace(b64);
  if (s === null) return { ok: false, reason: 'unreadable proof' };
  const check = verifyRun(s);
  if (!check.ok) return { ok: false, reason: check.reason ?? 'bad ride' };
  const n = s.length / STRIDE;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE;
    const d = Math.hypot(s[o + 1] - at.x, s[o + 2] - at.y, s[o + 3] - at.z);
    if (d < best) best = d;
  }
  if (best > REACH) return { ok: false, reason: 'never reached the drop' };
  return { ok: true };
}

// ── Handler ─────────────────────────────────────────────────────────────

type Store = ReturnType<typeof getStore>;

async function load(store: Store) {
  const cur = await store.getWithMetadata(KEY, { type: 'json' });
  const state = ((cur?.data as State | null) ?? { drops: [] }) as State;
  return { state: { drops: state.drops.slice() }, etag: cur?.etag };
}

async function save(store: Store, state: State, etag: string | undefined) {
  const res = etag
    ? await store.setJSON(KEY, state, { onlyIfMatch: etag })
    : await store.setJSON(KEY, state, { onlyIfNew: true });
  return res.modified;
}

/** Read-modify-write with etag retries. `fn` returns the response, or null to skip saving. */
async function mutate(
  store: Store,
  fn: (state: State) => { res: HandlerResponse; write: boolean },
): Promise<HandlerResponse> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { state, etag } = await load(store);
    const { res, write } = fn(state);
    if (!write) return res;
    if (await save(store, state, etag)) return res;
  }
  return json(409, { error: 'busy, try again' });
}

export async function handler(event: HandlerEvent): Promise<HandlerResponse> {
  const method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return json(204, {});
  const c = config();
  if (c === null) {
    return method === 'GET' ? json(200, { enabled: false }) : json(404, { enabled: false });
  }
  connectLambda({
    blobs: event.blobs ?? '',
    headers: (event.headers ?? {}) as Record<string, string>,
  });
  const store = getStore('noun-world-drops');
  const now = Date.now();

  if (method === 'GET') {
    const { state } = await load(store);
    return json(200, {
      enabled: true,
      chainId: c.chainId,
      contract: c.contract,
      drops: state.drops.filter(d => live(d, now)).map(d => toPublic(d, now)),
    });
  }
  if (method !== 'POST') return json(405, { error: 'Method not allowed' });

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(event.body ?? '{}');
  } catch {
    return json(400, { error: 'Bad JSON' });
  }
  const action = String(input.action ?? '');
  const dropId = dropIdOf(input.dropId);

  // ── Admin ──
  if (action === 'place' || action === 'remove') {
    if (!sameSecret(header(event, 'x-admin-token'), c.adminToken))
      return json(401, { error: 'unauthorized' });
    if (dropId === null) return json(400, { error: 'bad dropId' });
    if (action === 'remove') {
      return mutate(store, st => {
        const before = st.drops.length;
        st.drops = st.drops.filter(d => d.dropId !== dropId);
        return { res: json(200, { ok: true, removed: before - st.drops.length }), write: true };
      });
    }
    // Position: given, or a random spot on a track
    let pos: { x: number; y: number; z: number } | null = null;
    const p = input.position as Record<string, unknown> | undefined;
    if (p !== undefined && p !== null) {
      const x = Number(p.x);
      const y = Number(p.y);
      const z = Number(p.z);
      if (![x, y, z].every(v => Number.isFinite(v) && Math.abs(v) < 1e6))
        return json(400, { error: 'bad position' });
      pos = { x, y, z };
    } else {
      pos = randomTrackSpot(
        Number(input.minDown ?? 150) || 150,
        Number(input.maxDown ?? 1200) || 1200,
      );
      if (pos === null) return json(500, { error: 'no clear spot found' });
    }
    // Asset + expiry: given, or read from the contract
    let asset = cleanAsset(input.asset);
    let expiresAt = Number(input.expiresAt);
    if (asset === null || !Number.isFinite(expiresAt)) {
      try {
        const onchain = await readDrop(c, dropId);
        if (onchain.status !== 1) return json(409, { error: 'drop is not open on-chain' });
        asset ??= onchain.asset;
        if (!Number.isFinite(expiresAt)) expiresAt = onchain.expiresAt;
      } catch (e) {
        return json(502, { error: `couldn't read drop ${dropId}: ${(e as Error).message}` });
      }
    }
    if (expiresAt <= now) return json(400, { error: 'already expired' });
    const placed: StoredDrop = {
      dropId,
      ...pos,
      asset: asset!,
      expiresAt,
      placedAt: now,
      status: 'open',
    };
    return mutate(store, st => {
      // Re-placing moves it; expired / claimed rows age out here
      st.drops = st.drops.filter(d => d.dropId !== dropId && d.expiresAt > now - 86_400_000);
      if (st.drops.length >= MAX_DROPS)
        return { res: json(400, { error: 'too many drops' }), write: false };
      st.drops.push(placed);
      return { res: json(200, { ok: true, drop: toPublic(placed, now) }), write: true };
    });
  }

  // ── Claimed: confirm on-chain, then off the map ──
  if (action === 'claimed') {
    if (dropId === null) return json(400, { error: 'bad dropId' });
    let onchain: { status: number; claimer: Address };
    try {
      onchain = await client(c).readContract({
        address: c.contract,
        abi: DROPS_ABI,
        functionName: 'getDrop',
        args: [BigInt(dropId)],
      });
    } catch {
      return json(502, { error: 'chain read failed' });
    }
    // Status.Claimed
    if (onchain.status !== 2) return json(409, { error: 'not claimed on-chain yet' });
    const claimer = onchain.claimer;
    return mutate(store, st => {
      const d = st.drops.find(x => x.dropId === dropId);
      if (d === undefined || d.status === 'claimed')
        return { res: json(200, { ok: true }), write: false };
      d.status = 'claimed';
      d.claimedBy = claimer;
      delete d.reservation;
      return { res: json(200, { ok: true, claimedBy: claimer }), write: true };
    });
  }

  // ── Claim voucher ──
  if (action !== 'claim') return json(400, { error: 'unknown action' });
  if (dropId === null) return json(400, { error: 'bad dropId' });
  const addrRaw = String(input.address ?? '');
  if (!isAddress(addrRaw)) return json(400, { error: 'bad address' });
  const claimer = getAddress(addrRaw);

  const first = (await load(store)).state.drops.find(d => d.dropId === dropId);
  if (first === undefined) return json(404, { error: 'unknown drop' });
  if (first.status === 'claimed') return json(409, { error: 'taken', claimedBy: first.claimedBy });
  if (first.expiresAt - EXPIRY_MARGIN_MS <= now) return json(410, { error: 'expired' });
  const r0 = first.reservation;
  if (r0 !== undefined && r0.until > now && r0.address !== claimer)
    return json(409, { error: 'taken', until: r0.until });

  // The ride must be real and reach the drop (checked before anything is held)
  const reach = traceReaches(input.proof, first);
  if (!reach.ok) return json(422, { error: 'proof', reason: reach.reason });

  const account = privateKeyToAccount(c.signerKey);
  const respond = (r: Reservation) =>
    json(200, {
      voucher: { dropId, claimer: r.address, deadline: r.deadline, signature: r.signature },
      contract: c.contract,
      chainId: c.chainId,
    });

  // Sign a fresh voucher (only used if the reservation below sticks)
  const deadline = Math.floor(now / 1000) + VOUCHER_S;
  const signature = await account.signTypedData({
    domain: {
      name: 'NounWorldDrops',
      version: '1',
      chainId: c.chainId,
      verifyingContract: c.contract,
    },
    types: CLAIM_TYPES,
    primaryType: 'Claim',
    message: { dropId: BigInt(dropId), claimer, deadline: BigInt(deadline) },
  });

  return mutate(store, st => {
    const d = st.drops.find(x => x.dropId === dropId);
    if (d === undefined) return { res: json(404, { error: 'unknown drop' }), write: false };
    if (d.status === 'claimed') return { res: json(409, { error: 'taken' }), write: false };
    if (d.expiresAt - EXPIRY_MARGIN_MS <= now)
      return { res: json(410, { error: 'expired' }), write: false };
    const r = d.reservation;
    if (r !== undefined && r.until > now) {
      // Still yours: the same voucher again; someone else's: taken
      if (r.address === claimer) return { res: respond(r), write: false };
      return { res: json(409, { error: 'taken', until: r.until }), write: false };
    }
    // One live voucher per address at a time
    if (
      st.drops.some(x => x !== d && x.reservation?.address === claimer && x.reservation.until > now)
    )
      return { res: json(429, { error: 'finish your other claim first' }), write: false };
    const res: Reservation = {
      address: claimer,
      deadline,
      signature,
      until: deadline * 1000 + 30_000,
    };
    d.reservation = res;
    return { res: respond(res), write: true };
  });
}
