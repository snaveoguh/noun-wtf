// ── 3D Grand Exchange: bubbles over heads (a small pool of DOM nodes) ───
//
// At most MAX_BUBBLES show (sim/bubbles.ts picks which); each frame only
// moves them. Content is rewritten only when it changes, and a fill's
// bubble gets the pop animation by re-adding its class.

import type { BubbleKind } from '../sim/bubbles';

export interface LabelSpec {
  /** Trader index (stable identity for the node's content). */
  i: number;
  x: number;
  y: number;
  /** 0.6 … 1.15 with distance. */
  scale: number;
  name: string | null;
  text: string | null;
  kind: BubbleKind | 'name';
  real: boolean;
  you: boolean;
  followed: boolean;
  /** Changes when the bubble is new (re-runs the pop). */
  stamp: number;
  pop: boolean;
}

const esc = (s: string) =>
  s.replace(
    /["&'<>]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export class Labels {
  private els: HTMLDivElement[] = [];
  private keys: string[] = [];

  constructor(
    private readonly layer: HTMLElement,
    max: number,
  ) {
    for (let k = 0; k < max; k++) {
      const el = document.createElement('div');
      el.className = 'gx3d-l';
      el.style.display = 'none';
      layer.appendChild(el);
      this.els.push(el);
      this.keys.push('');
    }
  }

  render(list: readonly LabelSpec[]) {
    for (let k = 0; k < this.els.length; k++) {
      const el = this.els[k]!;
      const s = list[k];
      if (s === undefined) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${s.scale.toFixed(2)})`;
      el.style.zIndex = String(s.followed ? 100000 : s.you ? 90000 : Math.round(10000 - s.y));
      const key = `${s.i}|${s.stamp}|${s.text}|${s.name}|${s.kind}|${s.real}|${s.followed}`;
      if (key === this.keys[k]) continue;
      this.keys[k] = key;
      const cls = ['gx3d-l', `gx3d-${s.kind}`];
      if (s.real) cls.push('gx3d-real');
      if (s.you) cls.push('gx3d-you');
      if (s.followed) cls.push('gx3d-followed');
      if (s.pop) cls.push('gx3d-pop');
      el.className = cls.join(' ');
      el.innerHTML =
        (s.name !== null ? `<i>${s.real ? '★ ' : ''}${esc(s.name)}</i>` : '') +
        (s.text !== null ? `<b>${esc(s.text)}</b>` : '');
    }
  }

  dispose() {
    for (const el of this.els) el.remove();
    this.els = [];
    void this.layer;
  }
}
