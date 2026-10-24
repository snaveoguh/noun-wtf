// Data hooks for the CC0 Library. Each source loads on its own and fails on
// its own: the archive is static JSON (lazy, only when /cc0 opens), cc0-lib.wtf
// is best-effort (it may be down), uploads come from the cc0-uploads function.

import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';

import { loadAllArchive } from '@/cc0-archive';

import {
  archiveAssets,
  CC0_LIB_API,
  CC0_LIB_TAGS,
  cc0LibAssets,
  mergeAssets,
  uploadToAsset,
  type Cc0Asset,
} from './assets';
import { parseUploads, UPLOADS_URL } from './uploadRules';

export type SourceState = 'loading' | 'ok' | 'down';

const PROBE_TIMEOUT_MS = 6_000;

/**
 * Probe cc0-lib.wtf tag by tag (its rate limit is 10 requests / 10 s). If the
 * first probe can't reach it at all, give up: the site is down, not empty.
 */
export async function fetchCc0Lib(
  f: typeof fetch = fetch,
  wait = (ms: number) => new Promise(r => setTimeout(r, ms)),
): Promise<Cc0Asset[]> {
  const got: unknown[] = [];
  let reached = false;
  for (const tag of CC0_LIB_TAGS) {
    try {
      const res = await f(`${CC0_LIB_API}?tag=${encodeURIComponent(tag)}`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      reached = true;
      if (res.ok && (res.headers.get('content-type') ?? '').includes('json'))
        got.push(await res.json());
    } catch {
      if (!reached) throw new Error('cc0-lib.wtf is unreachable');
    }
    await wait(250);
  }
  if (got.length === 0) throw new Error('cc0-lib.wtf returned nothing');
  return cc0LibAssets(got);
}

export async function fetchUploads(f: typeof fetch = fetch): Promise<Cc0Asset[]> {
  const res = await f(UPLOADS_URL);
  if (!res.ok) throw new Error(`uploads: ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json')) return []; // dev server without functions
  return parseUploads(await res.json()).map(uploadToAsset);
}

const state = (q: { isPending: boolean; isError: boolean }): SourceState =>
  q.isPending ? 'loading' : q.isError ? 'down' : 'ok';

export function useCc0Assets() {
  const archive = useQuery({
    queryKey: ['cc0-archive'],
    queryFn: async () => archiveAssets(await loadAllArchive()),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
  const cc0Lib = useQuery({
    queryKey: ['cc0-lib'],
    queryFn: () => fetchCc0Lib(),
    staleTime: 30 * 60_000,
    retry: false,
  });
  const uploads = useQuery({
    queryKey: ['cc0-uploads'],
    queryFn: () => fetchUploads(),
    staleTime: 60_000,
    retry: false,
  });

  const assets = useMemo(
    () => mergeAssets({ uploads: uploads.data, cc0Lib: cc0Lib.data, archive: archive.data }),
    [uploads.data, cc0Lib.data, archive.data],
  );

  return {
    assets,
    sources: { archive: state(archive), cc0Lib: state(cc0Lib), uploads: state(uploads) },
    loading: archive.isPending,
  };
}
