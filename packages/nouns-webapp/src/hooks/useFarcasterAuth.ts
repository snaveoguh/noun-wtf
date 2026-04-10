import { useCallback, useEffect, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FarcasterUser {
  fid: number;
  username: string;
  display_name: string;
  pfp_url: string;
}

export interface FarcasterAuth {
  signer_uuid: string;
  fid: number;
  user: FarcasterUser;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'noun_wtf_farcaster_auth';
const NEYNAR_LOGIN_URL = 'https://app.neynar.com/login';
const NEYNAR_AUTH_ORIGIN = 'https://app.neynar.com';

const NEYNAR_CLIENT_ID =
  import.meta.env.VITE_NEYNAR_CLIENT_ID || '';

const API_URL =
  import.meta.env.VITE_API_URL ||
  'https://spirited-flexibility-production-3c30.up.railway.app';

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadAuth(): FarcasterAuth | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.signer_uuid && parsed?.fid) return parsed;
    return null;
  } catch {
    return null;
  }
}

function saveAuth(auth: FarcasterAuth) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
}

function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFarcasterAuth() {
  const [auth, setAuth] = useState<FarcasterAuth | null>(loadAuth);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Listen for SIWN popup postMessage
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== NEYNAR_AUTH_ORIGIN) return;
      if (!event.data?.is_authenticated) return;

      const { signer_uuid, fid, user } = event.data;
      if (!signer_uuid || !fid) return;

      const authData: FarcasterAuth = {
        signer_uuid,
        fid,
        user: {
          fid,
          username: user?.username ?? `fid:${fid}`,
          display_name: user?.display_name ?? user?.username ?? '',
          pfp_url: user?.pfp_url ?? '',
        },
      };

      saveAuth(authData);
      setAuth(authData);
      setIsLoggingIn(false);
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const login = useCallback(() => {
    if (!NEYNAR_CLIENT_ID) {
      console.error('[FarcasterAuth] No VITE_NEYNAR_CLIENT_ID configured');
      return;
    }

    setIsLoggingIn(true);
    const url = `${NEYNAR_LOGIN_URL}?client_id=${encodeURIComponent(NEYNAR_CLIENT_ID)}`;
    const w = 600;
    const h = 700;
    const left = window.screenX + (window.innerWidth - w) / 2;
    const top = window.screenY + (window.innerHeight - h) / 2;
    window.open(url, 'neynar_siwn', `width=${w},height=${h},left=${left},top=${top}`);
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setAuth(null);
  }, []);

  // ─── Write helpers ──────────────────────────────────────────────────────────

  const publishCast = useCallback(
    async (text: string, opts?: { channel_id?: string; parent?: string }) => {
      if (!auth) throw new Error('Not authenticated');
      const res = await fetch(`${API_URL}/api/farcaster/cast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signer_uuid: auth.signer_uuid,
          text,
          ...opts,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    [auth],
  );

  const react = useCallback(
    async (target: string, reaction_type: 'like' | 'recast') => {
      if (!auth) throw new Error('Not authenticated');
      const res = await fetch(`${API_URL}/api/farcaster/reaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signer_uuid: auth.signer_uuid,
          reaction_type,
          target,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    [auth],
  );

  const unreact = useCallback(
    async (target: string, reaction_type: 'like' | 'recast') => {
      if (!auth) throw new Error('Not authenticated');
      const res = await fetch(`${API_URL}/api/farcaster/reaction`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signer_uuid: auth.signer_uuid,
          reaction_type,
          target,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    [auth],
  );

  return {
    auth,
    isLoggedIn: !!auth,
    isLoggingIn,
    login,
    logout,
    publishCast,
    react,
    unreact,
  };
}
