import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CampUi, INTRO_CSS } from './CampUi';

const fakeGame = (intro: boolean) => {
  const camp = { view: { prompt: null, intro }, subscribe: () => () => {}, act: () => {} };
  return { camp } as unknown as Parameters<typeof CampUi>[0]['game'];
};

describe("CAMP's intro overlay", () => {
  it('never covers the picture with black (the "blinks black once" report)', () => {
    const { container } = render(<CampUi game={fakeGame(true)} touch={false} />);
    const intro = container.querySelector('[data-camp=intro]')!;
    expect(intro).not.toBeNull();
    // only the letterbox bars are black, never a full-screen layer
    for (const el of intro.querySelectorAll('div')) {
      const full = el.className.includes('inset-0') && !el.className.includes('inset-x-0');
      expect(full && el.className.includes('bg-black')).toBe(false);
    }
    // and nothing animates in from full opacity
    expect(INTRO_CSS).not.toMatch(/from\s*{\s*opacity:\s*1/);
  });
});
