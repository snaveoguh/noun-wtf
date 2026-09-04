/**
 * Data hooks for the wallet gamer profile. Every request goes to the Ponder
 * API on Railway; with the dev fixture switched on (`?fixture=1` or
 * localStorage) the hooks resolve the fake profile instead so the page can be
 * checked before the API ships.
 */
import type {
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

/** Build the exact message the API verifies for a PUT /autopilot. */
export async function buildAutopilotMessage(address: string, prefs: AutopilotPrefs) {
  const prefsHash = await sha256Hex(JSON.stringify(prefs));
  const nonce = Date.now();
  const message = `noun.wtf autopilot\naddress: ${address.toLowerCase()}\nnonce: ${nonce}\nprefs: ${prefsHash}`;
  return { message, nonce, prefsHash };
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
