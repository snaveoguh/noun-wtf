// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { SurfHud, type SurfHudView } from './SurfHud';

const view = (o: Partial<SurfHudView> = {}): SurfHudView => ({
  on: true,
  hint: '<b>W</b> paddle',
  prompt: '',
  popKey: 'SPACE',
  wipeText: 'WIPEOUT!',
  ride: false,
  kmh: 0,
  touch: true,
  button: 'duck',
  shop: '',
  ...o,
});

describe('SurfHud', () => {
  it('keeps its parts through every update (the touch button never replaces the HUD)', () => {
    const parent = document.createElement('div');
    const hud = new SurfHud(
      parent,
      () => {},
      () => {},
    );
    for (const v of [
      view(),
      view({ button: 'pop', prompt: 'pop' }),
      view({ ride: true, kmh: 38, button: 'pop' }),
      view({ prompt: 'wipe', button: '' }),
    ]) {
      hud.update(v);
      expect(hud.root.querySelector('.w2surf-hint')).not.toBeNull();
      expect(hud.root.querySelector('.w2surf-btn')).not.toBeNull();
      expect(hud.root.querySelector('.w2surf-pop')).not.toBeNull();
    }
    expect(hud.root.querySelector('.w2surf-btn')!.textContent).toBe('');
    hud.update(view({ button: 'pop' }));
    expect(hud.root.querySelector('.w2surf-btn')!.textContent).toBe('POP');
    expect(hud.root.querySelector('.w2surf-spd .w2surf-num')!.textContent).toBe('');
    hud.update(view({ ride: true, kmh: 41.6, button: 'pop' }));
    expect(hud.root.className).toContain('ride');
    expect(hud.root.querySelector('.w2surf-spd .w2surf-num')!.textContent).toBe('42');
    hud.dispose();
  });

  it('shows the shop prompt on land', () => {
    const parent = document.createElement('div');
    const hud = new SurfHud(
      parent,
      () => {},
      () => {},
    );
    hud.update(view({ on: false, shop: 'E · SURF SHOP' }));
    expect(hud.root.className).toContain('on');
    expect(hud.root.querySelector('.w2surf-shop')!.className).toContain('on');
    hud.dispose();
  });
});
