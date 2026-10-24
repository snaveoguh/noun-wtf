import type { YouTubeDeck } from '../radio/YouTubeDeck';
import type { FmItem } from '@/components/NounFm/station';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameRadio } from './GameRadio';
import { NounBeats } from './NounBeats';

class FakeDeck {
  played: string[] = [];
  state = -1;
  time = 0;
  videoId = '';
  refuse = false;
  onState?: (s: number) => void;
  onError?: (c: number) => void;
  play(id: string) {
    if (this.refuse) return false;
    this.videoId = id;
    this.played.push(id);
    return true;
  }
  stop() {
    this.videoId = '';
  }
  pause() {}
  setVolume() {}
  mount() {}
  unmount() {}
}

const items: FmItem[] = [
  ['boom bap', 'A'],
  ['instrumental hip hop', 'B'],
  ['jazz rap', 'C'],
  ['underground hip hop', 'D'],
  ['roots reggae', 'E'],
  ['funk', 'F'],
].map(([genre, a], i) => ({
  id: `vid${i}`.padEnd(11, '0'),
  title: `Song ${a}`,
  artist: `Artist ${a}`,
  genre: genre!,
  kind: 'music' as const,
  dur: 200,
}));
const HIPHOP = new Set(
  items.filter(i => !['roots reggae', 'funk'].includes(i.genre)).map(i => i.id),
);

function make(o: { offline?: boolean; native?: boolean; list?: FmItem[] } = {}) {
  const deck = new FakeDeck();
  const beats = new NounBeats({
    offline: o.offline ?? false,
    native: o.native ?? false,
    fetchPlaylist: () => Promise.resolve(o.list ?? items),
    deck: deck as unknown as YouTubeDeck,
  });
  const radio = new GameRadio();
  radio.setBeats(beats);
  const labels: string[] = [];
  radio.onNowPlaying = l => labels.push(l);
  return { deck, beats, radio, labels };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('NOUN BEATS on GameRadio', () => {
  it('selecting NOUN BEATS asks the deck for a hip-hop video and labels it', async () => {
    const { deck, radio } = make();
    radio.setMode('beats');
    await flush();
    expect(deck.played).toHaveLength(1);
    expect(HIPHOP.has(deck.played[0]!)).toBe(true);
    expect(radio.beatsOffline).toBe(false);
    expect(radio.label).toMatch(/^NOUN BEATS: Artist [A-D] – Song [A-D]$/);
  });

  it('skip (`.` / ⏭) plays another hip-hop track; tracks follow on when one ends', async () => {
    const { deck, radio } = make();
    radio.setMode('beats');
    await flush();
    radio.nextTrack();
    expect(deck.played).toHaveLength(2);
    expect(deck.played[1]).not.toBe(deck.played[0]);
    deck.onState?.(0); // ended
    expect(deck.played).toHaveLength(3);
    expect(deck.played.every(id => HIPHOP.has(id))).toBe(true);
  });

  it('leaving the station stops the video', async () => {
    const { deck, radio, beats } = make();
    radio.setMode('beats');
    await flush();
    radio.setMode('off');
    expect(deck.videoId).toBe('');
    expect(beats.getView().screen).toBe(false);
  });

  it('?offline=1 plays the generated beats, labelled offline', async () => {
    const { deck, radio } = make({ offline: true });
    radio.setMode('beats');
    await flush();
    expect(deck.played).toHaveLength(0);
    expect(radio.beatsOffline).toBe(true);
    expect(radio.label.startsWith('NOUN BEATS (offline): ')).toBe(true);
  });

  it('three tracks in a row erroring falls back to the offline beats', async () => {
    const { deck, radio, labels } = make();
    radio.setMode('beats');
    await flush();
    deck.onError?.(150);
    deck.onError?.(-1);
    expect(radio.beatsOffline).toBe(false);
    expect(deck.played).toHaveLength(3);
    deck.onError?.(101);
    expect(radio.beatsOffline).toBe(true);
    expect(deck.played).toHaveLength(3);
    expect(labels.at(-1)!.startsWith('NOUN BEATS (offline): ')).toBe(true);
    // skip now drives the worklet, not the deck
    radio.nextTrack();
    expect(deck.played).toHaveLength(3);
  });

  it('a track that plays resets the count (it has to be three in a row)', async () => {
    const { deck, radio } = make();
    radio.setMode('beats');
    await flush();
    deck.onError?.(-1);
    deck.onError?.(-1);
    deck.onState?.(1); // playing
    deck.onError?.(-1);
    deck.onError?.(-1);
    expect(radio.beatsOffline).toBe(false);
  });

  it('a deck screen that never takes the video counts as a refusal', async () => {
    const { deck, radio } = make();
    deck.refuse = true;
    radio.setMode('beats');
    await flush();
    await vi.advanceTimersByTimeAsync(3 * 22 * 250 + 1000);
    expect(radio.beatsOffline).toBe(true);
  });

  it('no playlist: offline beats', async () => {
    const { radio } = make({ list: [] });
    radio.setMode('beats');
    await flush();
    expect(radio.beatsOffline).toBe(true);
  });

  it('picking the station again after a fallback gives YouTube another go', async () => {
    const { deck, radio } = make();
    radio.setMode('beats');
    await flush();
    for (let i = 0; i < 3; i++) deck.onError?.(-1);
    expect(radio.beatsOffline).toBe(true);
    radio.setMode('off');
    radio.setMode('beats');
    await flush();
    expect(radio.beatsOffline).toBe(false);
    expect(deck.played).toHaveLength(4);
  });

  it('hidden world: the screen goes away, and comes back on show', async () => {
    const { deck, radio, beats } = make();
    radio.setMode('beats');
    await flush();
    beats.setHidden(true);
    expect(beats.getView().screen).toBe(false);
    beats.setHidden(false);
    expect(beats.getView().screen).toBe(true);
    expect(deck.played.at(-1)).toBe(deck.played[0]);
  });
});
