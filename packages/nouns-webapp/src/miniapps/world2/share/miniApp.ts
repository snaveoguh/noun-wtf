// ── Noun World as a Farcaster mini app ────────────────────────────────────
//
// Inside a Farcaster client (a webview on phones, an iframe on the web) the
// host shows its splash until the app calls `sdk.actions.ready()`. The SDK
// is only fetched there, from esm.sh (Farcaster's documented CDN build), so
// the normal site pays nothing for it. The manifest is
// public/.well-known/farcaster.json; the embed tags come from og-proposal.
//
// Safe areas: the host reports its insets in `context.client.safeAreaInsets`;
// they're set as --w2-safe-top/right/bottom/left, which the HUD reads ahead
// of env(safe-area-inset-*) (Farcaster's webview doesn't always fill env()).

export const SDK_URL = 'https://esm.sh/@farcaster/miniapp-sdk@0.4.0';

interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The slice of @farcaster/miniapp-sdk this uses. */
export interface MiniAppSdk {
  isInMiniApp(): Promise<boolean>;
  context: Promise<{ client?: { safeAreaInsets?: Insets } } | undefined>;
  actions: {
    ready(opts?: { disableNativeGestures?: boolean }): Promise<void>;
    composeCast(opts: { text?: string; embeds?: [string] | [string, string] }): Promise<unknown>;
  };
}

/** Could this page be inside a mini app host? (Cheap; the SDK decides for sure.) */
export function maybeMiniApp(
  w: { parent?: unknown; ReactNativeWebView?: unknown } = window,
): boolean {
  return (w.parent !== undefined && w.parent !== w) || w.ReactNativeWebView !== undefined;
}

/** CSS custom properties for the host's safe-area insets (whole px, never negative). */
export function safeAreaVars(insets: Partial<Insets> | undefined): Record<string, string> {
  const px = (n: number | undefined) => `${Math.max(0, Math.round(Number.isFinite(n) ? n! : 0))}px`;
  return {
    '--w2-safe-top': px(insets?.top),
    '--w2-safe-right': px(insets?.right),
    '--w2-safe-bottom': px(insets?.bottom),
    '--w2-safe-left': px(insets?.left),
  };
}

let sdkPromise: Promise<MiniAppSdk | null> | null = null;

/** The SDK when this page is running as a mini app, else null (and nothing is fetched). */
export function miniAppSdk(): Promise<MiniAppSdk | null> {
  if (typeof window === 'undefined' || !maybeMiniApp()) return Promise.resolve(null);
  sdkPromise ??= import(/* @vite-ignore */ SDK_URL)
    .then(async (m: { sdk: MiniAppSdk }) => ((await m.sdk.isInMiniApp()) ? m.sdk : null))
    .catch(() => null);
  return sdkPromise;
}

/**
 * Called once when /world mounts: in a mini app, apply the host's safe
 * areas, tag the page (`body[data-miniapp]`) and hide the host's splash.
 * Native gestures are off: the game uses swipes and drags.
 */
export async function startMiniApp(): Promise<boolean> {
  const sdk = await miniAppSdk();
  if (sdk === null) return false;
  try {
    const ctx = await sdk.context;
    const vars = safeAreaVars(ctx?.client?.safeAreaInsets);
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
  } catch {
    // no context: the HUD falls back to env()
  }
  document.body.setAttribute('data-miniapp', '');
  await sdk.actions.ready({ disableNativeGestures: true }).catch(() => undefined);
  return true;
}
