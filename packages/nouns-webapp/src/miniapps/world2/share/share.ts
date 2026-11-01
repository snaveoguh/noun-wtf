// ── Sharing from inside Noun World: a play-as link, or a snapshot ──────────
//
// The link: in a Farcaster mini app it opens a cast with the link embedded
// (the embed shows the rider card with PLAY AS ME); on a phone the system
// share sheet; on desktop it's copied. The snapshot: the game canvas as it
// is now, with a strip along the bottom carrying the link, shared as a
// file on phones (Web Share level 2) and downloaded on desktop.

import type { RiderSeed } from './playLink';

import { miniAppSdk } from './miniApp';
import { playAsUrl } from './playLink';

export type ShareRoute = 'cast' | 'sheet' | 'copy';

/** How a link goes out: a cast in a mini app, the share sheet on touch screens, else the clipboard. */
export function linkRoute(env: {
  miniApp: boolean;
  canShare: boolean;
  touch: boolean;
}): ShareRoute {
  if (env.miniApp) return 'cast';
  if (env.canShare && env.touch) return 'sheet';
  return 'copy';
}

/** A snapshot goes to the share sheet when the browser can share files, else it downloads. */
export function snapshotRoute(env: {
  canShareFiles: boolean;
  touch: boolean;
}): 'sheet' | 'download' {
  return env.canShareFiles && env.touch ? 'sheet' : 'download';
}

/** The default name a rider gets (`noun 120`) isn't worth putting in a link. */
export function shareName(name: string): string {
  return /^noun \d+$/i.test(name.trim()) ? '' : name;
}

export function shareText(name: string): string {
  const n = shareName(name);
  return n.length > 0
    ? `Play as ${n} in Noun World. No download, just the link:`
    : 'Play as me in Noun World. No download, just the link:';
}

/** noun-world-2026-11-01-1432.png */
export function snapshotFileName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `noun-world-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.png`;
}

/** Links point at the site you're on (noun.wtf, the dev site, a deploy preview), else noun.wtf. */
export function shareOrigin(loc: { hostname: string; origin: string }): string | undefined {
  return loc.hostname === 'noun.wtf' || loc.hostname.endsWith('.netlify.app')
    ? loc.origin
    : undefined;
}

const isTouch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Share or copy the play-as link. Resolves with what happened (for the toast). */
export async function shareRider(
  seed: RiderSeed,
  name: string,
): Promise<'cast' | 'shared' | 'copied' | 'failed'> {
  const url = playAsUrl(seed, { name: shareName(name), origin: shareOrigin(location) });
  const text = shareText(name);
  const sdk = await miniAppSdk();
  const route = linkRoute({
    miniApp: sdk !== null,
    canShare: typeof navigator.share === 'function',
    touch: isTouch(),
  });
  try {
    if (route === 'cast' && sdk !== null) {
      await sdk.actions.composeCast({ text, embeds: [url] });
      return 'cast';
    }
    if (route === 'sheet') {
      await navigator.share({ title: 'Noun World', text, url });
      return 'shared';
    }
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch (e) {
    // The user closing the share sheet isn't a failure worth a toast
    if (e instanceof DOMException && e.name === 'AbortError') return 'shared';
    try {
      await navigator.clipboard.writeText(url);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
}

/** The strip along a snapshot's bottom: height for an image `h` tall. */
export function stripHeight(h: number): number {
  return Math.max(28, Math.round(h * 0.06));
}

/**
 * The canvas as a PNG with the link strip. `draw` must draw a frame right
 * before (the WebGL canvas keeps no frame after it's composited).
 */
export async function captureSnapshot(
  canvas: HTMLCanvasElement,
  draw: () => void,
  link: string,
): Promise<Blob | null> {
  draw();
  const w = canvas.width;
  const h = canvas.height;
  const out = document.createElement('canvas');
  const sh = stripHeight(h);
  out.width = w;
  out.height = h + sh;
  const c = out.getContext('2d');
  if (c === null || w === 0 || h === 0) return null;
  c.drawImage(canvas, 0, 0);
  c.fillStyle = '#ffd400';
  c.fillRect(0, h, w, sh);
  c.fillStyle = '#0b0b12';
  c.font = `900 ${Math.round(sh * 0.5)}px system-ui, sans-serif`;
  c.textBaseline = 'middle';
  c.fillText('⌐◨-◨ NOUN WORLD', Math.round(sh * 0.4), h + sh / 2);
  c.textAlign = 'right';
  c.fillText(
    `▶ ${link.replace(/^https?:\/\//, '')}`.slice(0, 80),
    w - Math.round(sh * 0.4),
    h + sh / 2,
  );
  return new Promise(res => out.toBlob(b => res(b), 'image/png'));
}

/** Share a snapshot (phones) or download it (desktop). */
export async function shareSnapshot(blob: Blob, link: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], snapshotFileName(new Date()), { type: 'image/png' });
  const canShareFiles =
    typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  if (snapshotRoute({ canShareFiles, touch: isTouch() }) === 'sheet') {
    try {
      await navigator.share({ files: [file], text: `${shareText('')} ${link}` });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'shared';
      // fall through to a download
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return 'downloaded';
}
