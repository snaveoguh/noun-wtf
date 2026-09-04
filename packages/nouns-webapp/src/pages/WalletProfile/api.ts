/**
 * Data hooks for the wallet gamer profile. Every request goes to the Ponder
 * API on Railway; with the dev fixture switched on (`?fixture=1` or
 * localStorage) the hooks resolve the fake profile instead so the page can be
 * checked before the API ships.
 */
import type {
  AutopilotDao,
  AutopilotDelegation,
  AutopilotPrefs,
  AutopilotState,
  OverviewText,
  WalletActivityPage,
  WalletProfile,
} from './types';

import { useCallback } from 'react';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSignMessage } from 'wagmi';

import {
  FIXTURE_ACTIVITY,
  FIXTURE_AUTOPILOT,
  FIXTURE_PROFILE,
  profileFixtureEnabled,
} from './walletProfileFixtures';

export const API_BASE: string =
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';

const STALE = 60_000;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (r.status === 404) throw new Error('not found');
  if (!r.ok) throw new Error(`API ${r.status}`);
  return (await r.json()) as T;
}

const enc = (identity: string) => encodeURIComponent(identity.trim());

// ─── Profile ───────────────────────────────────────────────────────────────

export function useWalletProfile(identity: string | undefined) {
  const fixture = profileFixtureEnabled();
  return useQuery<WalletProfile>({
    queryKey: ['wallet-profile', identity?.toLowerCase(), fixture],
    queryFn: async () => {
      if (fixture) return FIXTURE_PROFILE;
      return getJson<WalletProfile>(`${API_BASE}/api/wallet/${enc(identity ?? '')}/profile`);
    },
    enabled: !!identity,
    staleTime: STALE,
    retry: 1,
  });
}

// ─── Activity (infinite) ───────────────────────────────────────────────────

export function useWalletActivity(identity: string | undefined, enabled = true) {
  const fixture = profileFixtureEnabled();
  return useInfiniteQuery<
    WalletActivityPage,
    Error,
    { pages: WalletActivityPage[] },
    unknown[],
    number | undefined
  >({
    queryKey: ['wallet-activity', identity?.toLowerCase(), fixture],
    initialPageParam: undefined,
    queryFn: async ({ pageParam }) => {
      if (fixture) return FIXTURE_ACTIVITY;
      const before = pageParam != null ? `&before=${pageParam}` : '';
      const page = await getJson<Partial<WalletActivityPage>>(
        `${API_BASE}/api/wallet/${enc(identity ?? '')}/activity?limit=50${before}`,
      );
      return {
        events: Array.isArray(page.events) ? page.events : [],
        hasMore: page.hasMore === true,
        oldestBlock: typeof page.oldestBlock === 'number' ? page.oldestBlock : 0,
      };
    },
    getNextPageParam: last =>
      last.hasMore && last.oldestBlock > 0 && last.events.length > 0 ? last.oldestBlock : undefined,
    enabled: !!identity && enabled,
    staleTime: STALE,
    retry: 1,
  });
}

// ─── AI overview ───────────────────────────────────────────────────────────

export function useRefreshOverview(identity: string | undefined) {
  const qc = useQueryClient();
  const fixture = profileFixtureEnabled();
  return useMutation<OverviewText | null>({
    mutationFn: async () => {
      if (fixture) {
        return {
          ...FIXTURE_PROFILE.overview,
          generatedAt: Math.floor(Date.now() / 1000),
          cached: true,
        };
      }
      const r = await fetch(`${API_BASE}/api/wallet/${enc(identity ?? '')}/overview/refresh`, {
        method: 'POST',
      });
      if (!r.ok) throw new Error(`API ${r.status}`);
      return (await r.json()) as OverviewText | null;
    },
    onSuccess: data => {
      if (data == null) return;
      qc.setQueryData<WalletProfile>(['wallet-profile', identity?.toLowerCase(), fixture], prev =>
        prev ? { ...prev, overview: data } : prev,
      );
    },
  });
}

// ─── Autopilot ─────────────────────────────────────────────────────────────

export function useAutopilot(address: string | undefined, enabled: boolean) {
  const fixture = profileFixtureEnabled();
  return useQuery<AutopilotState>({
    queryKey: ['wallet-autopilot', address?.toLowerCase(), fixture],
    queryFn: async () => {
      if (fixture) return FIXTURE_AUTOPILOT;
      return getJson<AutopilotState>(`${API_BASE}/api/wallet/${enc(address ?? '')}/autopilot`);
    },
    enabled: !!address && enabled,
    staleTime: STALE,
    retry: 1,
  });
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Ownership proof shared by every autopilot write (PUT /autopilot, POST and
 * DELETE /delegations): a signed message binding the connected address to a
 * sha256 of the payload plus a ms nonce.
 */
export async function buildOwnershipMessage(address: string, payload: string) {
  const prefsHash = await sha256Hex(payload);
  const nonce = Date.now();
  const message = `noun.wtf autopilot\naddress: ${address.toLowerCase()}\nnonce: ${nonce}\nprefs: ${prefsHash}`;
  return { message, nonce, prefsHash };
}

/** Build the exact message the API verifies for a PUT /autopilot. */
export function buildAutopilotMessage(address: string, prefs: AutopilotPrefs) {
  return buildOwnershipMessage(address, JSON.stringify(prefs));
}

export function useSaveAutopilot(address: string | undefined) {
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const fixture = profileFixtureEnabled();

  const mutation = useMutation<AutopilotState, Error, { prefs: AutopilotPrefs; enabled: boolean }>({
    mutationFn: async ({ prefs, enabled }) => {
      if (!address) throw new Error('Connect a wallet first');
      const { message } = await buildAutopilotMessage(address, prefs);
      const signature = await signMessageAsync({ message });
      if (fixture) {
        return { ...FIXTURE_AUTOPILOT, prefs, enabled, updatedAt: Math.floor(Date.now() / 1000) };
      }
      const r = await fetch(`${API_BASE}/api/wallet/${enc(address)}/autopilot`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, signature, prefs, enabled }),
      });
      if (r.status === 401) throw new Error('Signature rejected (401)');
      if (r.status === 409) throw new Error('Stale nonce — try again (409)');
      if (!r.ok) throw new Error(`API ${r.status}`);
      const body = (await r.json().catch(() => null)) as AutopilotState | null;
      return body ?? { enabled, prefs, updatedAt: Math.floor(Date.now() / 1000) };
    },
    onSuccess: data => {
      qc.setQueryData<AutopilotState>(
        ['wallet-autopilot', address?.toLowerCase(), fixture],
        prev => ({
          ...(prev ?? {}),
          ...data,
          recommendations: data.recommendations ?? prev?.recommendations ?? [],
        }),
      );
      qc.setQueryData<WalletProfile>(['wallet-profile', address?.toLowerCase(), fixture], prev =>
        prev
          ? { ...prev, autopilot: { enabled: data.enabled === true, updatedAt: data.updatedAt } }
          : prev,
      );
    },
  });

  const save = useCallback(
    (prefs: AutopilotPrefs, enabled: boolean) => mutation.mutateAsync({ prefs, enabled }),
    [mutation],
  );

  return { save, isPending: mutation.isPending, error: mutation.error };
}

// ─── Auto-vote delegations (EIP-7702 + ERC-7710) ───────────────────────────

const DELEGATION_CACHE_KEY = 'noun-wtf-autopilot-delegations';

/**
 * The API row may omit the serialized delegation; keep a local copy keyed by
 * delegation hash so the on-chain revoke can still be built from this device.
 */
export function cacheSerializedDelegation(hash: string, serialized: string) {
  try {
    const raw = window.localStorage.getItem(DELEGATION_CACHE_KEY);
    const map = raw != null ? (JSON.parse(raw) as Record<string, string>) : {};
    map[hash.toLowerCase()] = serialized;
    window.localStorage.setItem(DELEGATION_CACHE_KEY, JSON.stringify(map));
  } catch {
    /* storage blocked — nothing to do */
  }
}

export function readCachedDelegation(hash: string | undefined | null): string | null {
  if (!hash) return null;
  try {
    const raw = window.localStorage.getItem(DELEGATION_CACHE_KEY);
    const map = raw != null ? (JSON.parse(raw) as Record<string, string>) : {};
    return map[hash.toLowerCase()] ?? null;
  } catch {
    return null;
  }
}

function patchAutopilot(
  qc: ReturnType<typeof useQueryClient>,
  address: string | undefined,
  fixture: boolean,
  fn: (prev: AutopilotState) => AutopilotState,
) {
  qc.setQueryData<AutopilotState>(['wallet-autopilot', address?.toLowerCase(), fixture], prev =>
    fn(prev ?? {}),
  );
}

export function useSaveDelegation(address: string | undefined) {
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const fixture = profileFixtureEnabled();

  return useMutation<
    AutopilotDelegation,
    Error,
    { dao: AutopilotDao; serialized: string; hash: string; expiresAt: number; maxVotes?: number }
  >({
    mutationFn: async ({ dao, serialized, hash, expiresAt, maxVotes }) => {
      if (!address) throw new Error('Connect a wallet first');
      const { message } = await buildOwnershipMessage(address, serialized);
      // Fixture mode has no wallet — skip the proof so the flow can be clicked through.
      const signature = fixture ? '0x' : await signMessageAsync({ message });
      cacheSerializedDelegation(hash, serialized);
      if (fixture) {
        return {
          id: `fx-${Date.now()}`,
          dao,
          delegator: address.toLowerCase(),
          redeemer: FIXTURE_AUTOPILOT.relayer?.address ?? undefined,
          hash,
          expiresAt,
          maxVotes: maxVotes ?? null,
          uses: 0,
          createdAt: Math.floor(Date.now() / 1000),
          revokedAt: null,
          onchainDisabled: false,
          status: 'active',
          delegation: serialized,
        };
      }
      const r = await fetch(`${API_BASE}/api/wallet/${enc(address)}/delegations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dao, delegation: serialized, message, signature }),
      });
      if (r.status === 400) {
        const body = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Delegation rejected (400)');
      }
      if (r.status === 401) throw new Error('Signature rejected (401)');
      if (r.status === 409) throw new Error('Stale nonce — try again (409)');
      if (!r.ok) throw new Error(`API ${r.status}`);
      const row = (await r.json()) as AutopilotDelegation;
      return { ...row, delegation: row.delegation ?? serialized };
    },
    onSuccess: row => {
      patchAutopilot(qc, address, fixture, prev => ({
        ...prev,
        delegations: [row, ...(prev.delegations ?? []).filter(d => d.id !== row.id)],
      }));
    },
  });
}

export function useRevokeDelegation(address: string | undefined) {
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const fixture = profileFixtureEnabled();

  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      if (!address) throw new Error('Connect a wallet first');
      if (fixture) return;
      const { message } = await buildOwnershipMessage(address, id);
      const signature = await signMessageAsync({ message });
      const r = await fetch(`${API_BASE}/api/wallet/${enc(address)}/delegations/${enc(id)}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });
      if (r.status === 401) throw new Error('Signature rejected (401)');
      if (r.status === 409) throw new Error('Stale nonce — try again (409)');
      if (!r.ok && r.status !== 404) throw new Error(`API ${r.status}`);
    },
    onSuccess: (_d, { id }) => {
      const now = Math.floor(Date.now() / 1000);
      patchAutopilot(qc, address, fixture, prev => ({
        ...prev,
        delegations: (prev.delegations ?? []).map(d =>
          d.id === id ? { ...d, status: 'revoked', revokedAt: now } : d,
        ),
      }));
    },
  });
}

/** Mark a delegation as disabled on-chain in the cache (after the revoke tx is sent). */
export function useMarkOnchainDisabled(address: string | undefined) {
  const qc = useQueryClient();
  const fixture = profileFixtureEnabled();
  return useCallback(
    (id: string) =>
      patchAutopilot(qc, address, fixture, prev => ({
        ...prev,
        delegations: (prev.delegations ?? []).map(d =>
          d.id === id ? { ...d, onchainDisabled: true } : d,
        ),
      })),
    [qc, address, fixture],
  );
}
