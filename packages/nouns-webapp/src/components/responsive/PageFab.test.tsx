import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageFab } from './PageFab';

describe('PageFab', () => {
  it('is sticky to the bottom of the page, never fixed to the viewport', () => {
    render(
      <PageFab offset={24}>
        <button type="button">Latest</button>
      </PageFab>,
    );
    const wrap = screen.getByRole('button').closest('[data-page-fab]') as HTMLElement;
    expect(wrap.className).toContain('sticky');
    expect(wrap.className).not.toContain('fixed');
    expect(wrap.style.bottom).toBe('24px');
    expect(wrap.style.justifyContent).toBe('flex-end');
  });

  it('can float in the start corner', () => {
    render(
      <PageFab side="start">
        <button type="button">Back</button>
      </PageFab>,
    );
    const wrap = screen.getByRole('button').closest('[data-page-fab]') as HTMLElement;
    expect(wrap.style.justifyContent).toBe('flex-start');
  });
});
