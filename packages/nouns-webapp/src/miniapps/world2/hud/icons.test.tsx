import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HudIcon, ICON_NAMES, INK } from './icons';

describe('HUD icons', () => {
  it('draws every icon with the ink outline', () => {
    expect(ICON_NAMES.length).toBeGreaterThan(25);
    for (const name of ICON_NAMES) {
      const html = renderToStaticMarkup(<HudIcon name={name} />);
      expect([name, html.startsWith('<svg')]).toEqual([name, true]);
      expect([name, html.includes(INK)]).toEqual([name, true]);
      // something drawn, not an empty frame
      expect([name, /<(path|rect|circle)/.test(html)]).toEqual([name, true]);
    }
  });

  it('is decorative unless titled', () => {
    expect(renderToStaticMarkup(<HudIcon name="coin" />)).toContain('aria-hidden="true"');
    const titled = renderToStaticMarkup(<HudIcon name="coin" title="COIN" />);
    expect(titled).toContain('<title>COIN</title>');
    expect(titled).toContain('role="img"');
  });
});
