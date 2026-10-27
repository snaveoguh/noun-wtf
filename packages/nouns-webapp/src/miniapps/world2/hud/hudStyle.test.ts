import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SETTINGS_CSS } from '../settings/hudCss';

import { HUD_CSS } from './hudStyle';

/** Every `{` closed, never more `}` than opened (comments and strings skipped). */
function balanced(css: string): boolean {
  const s = css.replace(/\/\*[\S\s]*?\*\//g, '').replace(/"[^"]*"|'[^']*'/g, '');
  let depth = 0;
  for (const ch of s) {
    if (ch === '{') depth++;
    else if (ch === '}' && --depth < 0) return false;
  }
  return depth === 0;
}

describe('HUD stylesheets', () => {
  it('balance their braces (an unclosed @media once hid the whole desktop HUD)', () => {
    expect(balanced(HUD_CSS)).toBe(true);
    expect(balanced(SETTINGS_CSS)).toBe(true);
    // The page's own CSS sits in front of the HUD's in one <style>
    const page = readFileSync(join(__dirname, '../World2Page.tsx'), 'utf8');
    const css = /const CSS = `([\S\s]*?)`;/.exec(page)?.[1];
    expect(css).toBeDefined();
    expect(balanced(css!)).toBe(true);
  });

  it('knows a broken one', () => {
    expect(balanced('@media (pointer:coarse){.a{b:c}\n.d{e:f}')).toBe(false);
    expect(balanced('.a{}}')).toBe(false);
  });

  it('stops its motion under prefers-reduced-motion', () => {
    expect(HUD_CSS).toContain('@media (prefers-reduced-motion:reduce)');
  });
});
