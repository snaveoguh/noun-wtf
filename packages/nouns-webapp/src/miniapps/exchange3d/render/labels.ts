// ── 3D Grand Exchange: bubbles over heads (a small pool of DOM nodes) ───
//
// At most MAX_BUBBLES show (sim/bubbles.ts picks which); each frame only
// moves them. Content is rewritten only when it changes, and a fill's
// bubble gets the pop animation by re-adding its class.
//
// A bubble stays inside the floor's box: near an edge it's nudged in rather
// than cut off by it (narrow windows and phones cut most of them off). Its
// size is measured only when its content changes.

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
  /** Unscaled size of each node's content (measured when it changes). */
  private sizes: { w: number; h: number }[] = [];

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
      this.sizes.push({ w: 0, h: 0 });
    }
  }

  render(list: readonly LabelSpec[]) {
    const bw = this.layer.clientWidth;
    const bh = this.layer.clientHeight;
    for (let k = 0; k < this.els.length; k++) {
      const el = this.els[k]!;
      const s = list[k];
      if (s === undefined) {
        if (el.style.display !== 'none') el.style.display = 'none';
        continue;
      }
      el.style.display = '';
      const key = `${s.i}|${s.stamp}|${s.text}|${s.name}|${s.kind}|${s.real}|${s.followed}`;
      if (key !== this.keys[k]) {
        this.keys[k] = key;
        this.fill(el, s);
        this.sizes[k] = { w: el.offsetWidth, h: el.offsetHeight };
      }
      const { x, y } = keepInside(s.x, s.y, this.sizes[k]!, s.scale, bw, bh);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${s.scale.toFixed(2)})`;
      el.style.zIndex = String(s.followed ? 100000 : s.you ? 90000 : Math.round(10000 - s.y));
    }
  }

  private fill(el: HTMLDivElement, s: LabelSpec) {
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

  dispose() {
    for (const el of this.els) el.remove();
    this.els = [];
    void this.layer;
  }
}

const EDGE = 2;
/** The speech bubble's tail hangs this far under the box. */
const TAIL = 7;

/**
 * Where to draw a bubble anchored (bottom centre) at (x, y) so its box, of
 * unscaled size `size` drawn at `scale`, stays inside a bw × bh layer. A box
 * wider (taller) than the layer stays centred on its anchor.
 */
export function keepInside(
  x: number,
  y: number,
  size: { w: number; h: number },
  scale: number,
  bw: number,
  bh: number,
): { x: number; y: number } {
  const hw = (size.w * scale) / 2;
  const h = size.h * scale;
  if (bw > 0 && hw * 2 + EDGE * 2 <= bw) x = Math.min(bw - hw - EDGE, Math.max(hw + EDGE, x));
  if (bh > 0 && h + EDGE * 2 + TAIL <= bh) y = Math.min(bh - EDGE - TAIL, Math.max(h + EDGE, y));
  return { x, y };
}
