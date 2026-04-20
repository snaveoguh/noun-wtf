// ── glbProps — conditional GLB loader with proc fallback ──────────────
//
// Each city prop can declare a `glbUrl` (or null) in the catalog. At runtime
// we probe the URL once with a HEAD request; if it 200s we render a GLB,
// else the prop component renders its procedural fallback geometry. That way
// the scene gracefully degrades when the Kenney pack hasn't been unzipped yet.
//
// Two pieces of API:
//   • `useGlbProbe(url)` — returns `hasModel: boolean`. Cheap, no suspend.
//   • `<GlbModel url scale />` — actually loads & renders the GLB. This
//      suspends via drei's `useGLTF`, so it's wrapped in an error boundary
//      and a <Suspense fallback={null}> so a missing asset never kills the
//      scene. Callers render it conditionally under `hasModel`.
//
// GLBs are expensive to fetch on first use — keep the manifest small and
// call `preloadProps(...)` on boot so the first render isn't a jank-fest.

import { Component, Suspense, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useGLTF } from '@react-three/drei';
import type { Object3D } from 'three';

/** A URL is either reachable, missing, or we haven't checked yet. */
type ProbeState = 'unknown' | 'ok' | 'missing';

const probeCache = new Map<string, ProbeState>();
const probePromises = new Map<string, Promise<ProbeState>>();

/** Fire off a HEAD request once per URL. Resolves with the new probe state. */
function probe(url: string): Promise<ProbeState> {
  const cached = probeCache.get(url);
  if (cached && cached !== 'unknown') return Promise.resolve(cached);
  const inflight = probePromises.get(url);
  if (inflight) return inflight;

  const p = fetch(url, { method: 'HEAD' })
    .then(res => {
      const state: ProbeState = res.ok ? 'ok' : 'missing';
      probeCache.set(url, state);
      return state;
    })
    .catch(() => {
      probeCache.set(url, 'missing');
      return 'missing' as ProbeState;
    })
    .finally(() => {
      probePromises.delete(url);
    });

  probePromises.set(url, p);
  return p;
}

/**
 * Fire-and-forget preload for a manifest of GLB URLs. Probes each URL and,
 * if reachable, warms drei's useGLTF cache so the first render is instant.
 */
export function preloadProps(urls: ReadonlyArray<string>): void {
  for (const url of urls) {
    probe(url).then(state => {
      if (state === 'ok') {
        try {
          useGLTF.preload(url);
        } catch {
          // drei preload is best-effort — swallow so one bad URL doesn't kill boot
        }
      }
    });
  }
}

/**
 * Cheap hook: returns `hasModel: true` once we've confirmed the URL resolves.
 * Never suspends. Pass `null` for no-GLB entries — always returns false.
 */
export function useGlbProbe(url: string | null): { hasModel: boolean } {
  const [state, setState] = useState<ProbeState>(() => {
    if (!url) return 'missing';
    return probeCache.get(url) ?? 'unknown';
  });

  useEffect(() => {
    if (!url) {
      setState('missing');
      return;
    }
    const cached = probeCache.get(url);
    if (cached === 'ok' || cached === 'missing') {
      setState(cached);
      return;
    }
    let cancelled = false;
    probe(url).then(next => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { hasModel: state === 'ok' };
}

/**
 * Legacy-compat hook: same as `useGlbProbe` but also returns `node: null`.
 * Prefer `useGlbProbe` + `<GlbModel />` for actual rendering.
 */
export function useGlbOrFallback(url: string | null): {
  node: Object3D | null;
  hasModel: boolean;
} {
  const { hasModel } = useGlbProbe(url);
  return { node: null, hasModel };
}

// ── Error boundary so a borked GLB parse doesn't crash the scene ─────

class GlbErrorBoundary extends Component<
  { children: ReactNode; onError?: () => void },
  { errored: boolean }
> {
  override state = { errored: false };
  static getDerivedStateFromError() {
    return { errored: true };
  }
  override componentDidCatch() {
    this.props.onError?.();
  }
  override render() {
    if (this.state.errored) return null;
    return this.props.children;
  }
}

/** Actual GLB-rendering child. Suspends via useGLTF. */
function GlbPrimitive({ url, scale }: { url: string; scale: number }) {
  const gltf = useGLTF(url) as { scene: Object3D };
  // Clone so multiple instances share geometry but have independent transforms.
  const cloned = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  return <primitive object={cloned} scale={scale} />;
}

/**
 * Drop-in GLB renderer. Safe to unconditionally mount — if the URL 404s
 * or the file fails to parse, it silently renders nothing (the caller is
 * expected to render proc fallback behind/alongside it based on `hasModel`).
 */
export function GlbModel({ url, scale = 1 }: { url: string; scale?: number }): ReactNode {
  return (
    <GlbErrorBoundary
      onError={() => {
        // Mark as missing so future renders skip it.
        probeCache.set(url, 'missing');
      }}
    >
      <Suspense fallback={null}>
        <GlbPrimitive url={url} scale={scale} />
      </Suspense>
    </GlbErrorBoundary>
  );
}
