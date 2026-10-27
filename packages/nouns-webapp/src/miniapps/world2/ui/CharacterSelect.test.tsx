import type { Game } from '../Game';

import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { outfitFromSeed, type Outfit } from '../character/outfit';

import { CharacterSelect, type SavedCharacter } from './CharacterSelect';

vi.mock('../character/GlbHead', () => ({ prefetchGlbHead: () => {} }));

/** Just what the select screen drives on the Game. */
function fakeGame() {
  return {
    setSeed: vi.fn(),
    setBoardType: vi.fn(),
    setWeight: vi.fn(),
    setOutfit: vi.fn(),
    showroomFrame: null,
    showroomSway: 0,
    showroomSpin: 0,
  };
}

const SEED = { background: 0, body: 7, accessory: 11, head: 40, glasses: 3 };

/** Open the select screen, press → on the HEAD row, confirm; returns what got worn + saved. */
function changeHead(initial: SavedCharacter) {
  const game = fakeGame();
  const onConfirm = vi.fn();
  render(
    <CharacterSelect
      game={game as unknown as Game}
      initial={initial}
      auctionSeed={null}
      onConfirm={onConfirm}
    />,
  );
  // The NOUN tab opens on the HEAD row
  act(() => {
    fireEvent.keyDown(window, { code: 'ArrowRight' });
  });
  act(() => {
    fireEvent.keyDown(window, { code: 'Enter' });
  });
  const saved = onConfirm.mock.calls[0][0] as SavedCharacter;
  const worn = game.setOutfit.mock.calls.at(-1)?.[0] as Outfit | null;
  return { saved, worn };
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => localStorage.clear());

describe('CharacterSelect: changing the head', () => {
  it('keeps the seed-default outfit the rider was wearing', () => {
    const wornBefore = outfitFromSeed(SEED);
    const { saved, worn } = changeHead({ seed: SEED, name: 'TEST' });
    expect(saved.seed.head).toBe(SEED.head + 1);
    expect(saved.seed).toMatchObject({ glasses: 3, body: 7, accessory: 11 });
    // The new head's own default would be different clothes...
    expect(outfitFromSeed(saved.seed)).not.toEqual(wornBefore);
    // ...but the rider keeps (and saves, so remote players get it as `of`) the old ones
    expect(worn).toEqual(wornBefore);
    expect(saved.outfit).toEqual(wornBefore);
  });

  it('keeps a picked outfit', () => {
    const pick: Outfit = { pants: 'shorts', pantsColor: 10, shoes: 'boot', shoeColor: 8 };
    const { saved, worn } = changeHead({ seed: SEED, name: 'TEST', outfit: pick });
    expect(saved.seed.head).toBe(SEED.head + 1);
    expect(worn).toEqual(pick);
    expect(saved.outfit).toEqual(pick);
  });
});
