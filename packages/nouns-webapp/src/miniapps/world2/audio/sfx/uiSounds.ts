// ── UI clicks for every button in the game's HUD and panels ───────────────
//
// One delegated listener on the page root instead of a sound in every
// onClick: a close / cancel button gets the cancel sound, a big yellow
// accept gets confirm, anything else a soft click.

import type { Sfx } from './Sfx';

export type UiSound = 'ui-click' | 'ui-confirm' | 'ui-cancel';

/** Which sound a button makes, from its text and classes. */
export function uiSoundFor(text: string, className: string): UiSound {
  if (/\bclose\b|✕|cancel|\bleave\b|\bback\b/i.test(text)) return 'ui-cancel';
  if (/\bw2-maccept\b/.test(className)) return 'ui-confirm';
  return 'ui-click';
}

export function bindUiSounds(root: HTMLElement, sfx: Pick<Sfx, 'play'>): () => void {
  const onClick = (e: MouseEvent) => {
    const t = e.target as HTMLElement | null;
    const b = t?.closest?.('button');
    if (!b || !root.contains(b) || (b as HTMLButtonElement).disabled) return;
    const id = uiSoundFor(b.textContent ?? '', b.className);
    sfx.play(id, { gain: id === 'ui-click' ? 0.35 : 0.5 });
  };
  root.addEventListener('click', onClick, true);
  return () => root.removeEventListener('click', onClick, true);
}
