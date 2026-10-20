// ── Noun World as an installed app ──────────────────────────────────────
//
// - registers /world-sw.js (scope /world) in production,
// - points the page's manifest + touch icon at Noun World's while the game
//   is mounted on /world (the rest of noun.wtf keeps the site manifest),
// - keeps the browser's install prompt (beforeinstallprompt, Chromium) so
//   the game can offer an "Install" button; iOS Safari has no prompt, so it
//   gets an "Add to Home Screen" hint instead.

export const WORLD_MANIFEST = '/world-app/manifest.webmanifest';
export const WORLD_TOUCH_ICON = '/world-app/icons/apple-touch-icon.png';
export const WORLD_SCOPE = '/world';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** installed: already an app · prompt: we hold the browser's install prompt · ios: Safari's Share → Add to Home Screen · none: nothing to offer */
export type InstallState = 'installed' | 'prompt' | 'ios' | 'none';

let deferred: InstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

/** Inside the installed app (home-screen / standalone / fullscreen). */
export function isStandalone(w: Pick<Window, 'matchMedia'> & { navigator: Navigator }): boolean {
  const nav = w.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return ['standalone', 'fullscreen', 'minimal-ui'].some(
    m => w.matchMedia(`(display-mode: ${m})`).matches,
  );
}

/** iPhone / iPad Safari (where "Add to Home Screen" is the only way in). */
export function isIosSafari(ua: string, maxTouchPoints: number): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  // other iOS browsers (CriOS, FxiOS, EdgiOS…) can't add to the home screen
  return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
}

export function installState(): InstallState {
  if (typeof window === 'undefined') return 'none';
  if (installedNow || isStandalone(window)) return 'installed';
  if (deferred !== null) return 'prompt';
  if (isIosSafari(navigator.userAgent, navigator.maxTouchPoints)) return 'ios';
  return 'none';
}

export function subscribeInstall(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Show the browser's install dialog. Resolves true when the rider accepts. */
export async function promptInstall(): Promise<boolean> {
  const ev = deferred;
  if (ev === null) return false;
  deferred = null;
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  emit();
  return outcome === 'accepted';
}

let wired = false;

/** Call once on boot, before anything lazy loads (the prompt can fire early). Idempotent. */
export function initWorldApp() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); // keep it for our own button
    deferred = e as InstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installedNow = true;
    emit();
  });
}

let registered = false;

/** Register the game's service worker (production, on /world only). */
export function registerWorldSw(pathname: string) {
  if (registered || typeof navigator === 'undefined' || !pathname.startsWith(WORLD_SCOPE)) return;
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || location.protocol !== 'https:')
    return;
  registered = true;
  navigator.serviceWorker.register('/world-sw.js', { scope: WORLD_SCOPE }).catch(() => {
    // no worker: the game still runs, just not offline
  });
}

function setHead(
  selector: string,
  make: () => HTMLElement,
  attr: string,
  value: string,
): string | null {
  let el = document.head.querySelector<HTMLElement>(selector);
  const before = el?.getAttribute(attr) ?? null;
  if (el === null) {
    el = make();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
  return before;
}

/** Point the page at Noun World's manifest while the game is up; returns the undo. */
export function applyWorldManifest(pathname: string): () => void {
  if (typeof document === 'undefined' || !pathname.startsWith(WORLD_SCOPE)) return () => undefined;
  const link = (rel: string) => () => {
    const l = document.createElement('link');
    l.rel = rel;
    return l;
  };
  const meta = (name: string) => () => {
    const m = document.createElement('meta');
    m.name = name;
    return m;
  };
  const prev = [
    ['link[rel="manifest"]', link('manifest'), 'href', WORLD_MANIFEST],
    ['link[rel="apple-touch-icon"]', link('apple-touch-icon'), 'href', WORLD_TOUCH_ICON],
    [
      'meta[name="apple-mobile-web-app-capable"]',
      meta('apple-mobile-web-app-capable'),
      'content',
      'yes',
    ],
    ['meta[name="mobile-web-app-capable"]', meta('mobile-web-app-capable'), 'content', 'yes'],
    [
      'meta[name="apple-mobile-web-app-title"]',
      meta('apple-mobile-web-app-title'),
      'content',
      'Noun World',
    ],
    [
      'meta[name="apple-mobile-web-app-status-bar-style"]',
      meta('apple-mobile-web-app-status-bar-style'),
      'content',
      'black-translucent',
    ],
  ] as const;
  const undo = prev.map(([sel, make, attr, value]) => {
    const before = setHead(sel, make, attr, value);
    return () => {
      const el = document.head.querySelector(sel);
      if (el === null) return;
      if (before === null) el.remove();
      else el.setAttribute(attr, before);
    };
  });
  return () => {
    for (const u of undo) u();
  };
}
