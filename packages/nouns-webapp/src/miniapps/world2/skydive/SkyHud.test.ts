import { describe, expect, it, vi } from 'vitest';

import { SkyHud, type SkyHudView } from './SkyHud';

const view = (over: Partial<SkyHudView> = {}): SkyHudView => ({
  on: false,
  freefall: false,
  alt: 80,
  kmh: 0,
  bar: 0.5,
  floor: 0.2,
  hint: '',
  prompt: '',
  offer: false,
  offerKey: 'SPACE',
  touch: false,
  ready: false,
  ...over,
});

describe('the skydive HUD offering a skydive', () => {
  it('shows SKYDIVE? with its key, and a SKYDIVE touch button that takes it', () => {
    const parent = document.createElement('div');
    const take = vi.fn();
    const hud = new SkyHud(parent, take, 'SPACE', 'DUCK');
    hud.update(view({ offer: true, offerKey: 'TAP SKYDIVE', touch: true }));
    expect(hud.root.className).toContain('on');
    expect(hud.root.className).toContain('offer');
    const pull = hud.root.querySelector('.w2sky-pull')!;
    expect(pull.className).toContain('on');
    expect(pull.firstChild!.textContent).toBe('SKYDIVE?');
    expect(pull.lastChild!.textContent).toBe('TAP SKYDIVE');
    const btn = hud.root.querySelector('.w2sky-btn') as HTMLButtonElement;
    expect(btn.textContent).toBe('SKYDIVE');
    btn.dispatchEvent(new Event('pointerdown'));
    expect(take).toHaveBeenCalledTimes(1);
    // once in freefall it's the usual HUD again
    hud.update(view({ on: true, freefall: true, touch: true }));
    expect(hud.root.className).not.toContain('offer');
    expect(btn.textContent).toBe('PULL');
    hud.update(view());
    expect(hud.root.className).not.toContain('on');
    hud.dispose();
  });
});
