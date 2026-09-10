import { useEffect, useRef } from 'react';

import { useLocation } from 'react-router';

/**
 * First-party pageview beacon (replaces Plausible). Posts one tiny record per
 * route change to the nouns-api, which stores it without cookies or raw IPs.
 * Skipped on localhost unless VITE_PAGEVIEW_BEACON=true.
 */

const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function beaconEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if (import.meta.env.VITE_PAGEVIEW_BEACON === 'true') return true;
  return !LOCAL_HOSTS.has(window.location.hostname);
}

export function sendPageview(path: string, referrer: string): void {
  if (!beaconEnabled()) return;
  const width = window.innerWidth || window.screen?.width || 0;
  const payload = JSON.stringify({ p: path, r: referrer, w: width });
  const url = `${API_URL}/api/pv`;
  try {
    // text/plain keeps this a "simple" request: no CORS preflight, so the
    // beacon survives tab close / navigation away.
    const blob = new Blob([payload], { type: 'text/plain' });
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, blob)) return;
    void fetch(url, {
      method: 'POST',
      body: payload,
      headers: { 'Content-Type': 'text/plain' },
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch {
    // Analytics must never break the app.
  }
}

/** Mount once inside the router: fires a pageview on every pathname change. */
export function usePageviewBeacon(): void {
  const { pathname } = useLocation();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    // Only the first view of a session carries the external referrer;
    // in-app navigations have none.
    const referrer = lastPath.current === null ? document.referrer : '';
    lastPath.current = pathname;
    sendPageview(pathname, referrer);
  }, [pathname]);
}
