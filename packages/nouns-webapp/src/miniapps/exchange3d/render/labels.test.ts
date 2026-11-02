import { describe, expect, it } from 'vitest';

import { keepInside } from './labels';

const size = { w: 100, h: 30 };

describe('keepInside', () => {
  it('leaves a bubble well inside the layer where it is', () => {
    expect(keepInside(200, 200, size, 1, 400, 400)).toEqual({ x: 200, y: 200 });
  });
  it('nudges a bubble off the left / right edges in, by its scaled half width', () => {
    expect(keepInside(10, 200, size, 1, 400, 400).x).toBe(52);
    expect(keepInside(395, 200, size, 0.5, 400, 400).x).toBe(400 - 25 - 2);
  });
  it('keeps the top of the box and the tail under it inside', () => {
    expect(keepInside(200, 5, size, 1, 400, 400).y).toBe(32);
    expect(keepInside(200, 420, size, 1, 400, 400).y).toBe(400 - 2 - 7);
  });
  it('leaves a box bigger than the layer centred on its anchor', () => {
    expect(keepInside(10, 10, size, 1, 80, 20)).toEqual({ x: 10, y: 10 });
  });
});
