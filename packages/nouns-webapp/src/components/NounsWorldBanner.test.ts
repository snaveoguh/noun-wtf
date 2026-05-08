import { describe, expect, it } from 'vitest';

import { NOUNS_WORLD_STORIES } from './NounsWorldBanner';

describe('NOUNS_WORLD_STORIES', () => {
  // Catches the copy-paste class of bug that shipped the Mucho story with
  // the pizza-dao banner image — same URL appeared on two stories.
  it('every story has a unique image url', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const story of NOUNS_WORLD_STORIES) {
      const prev = seen.get(story.image);
      if (prev) dupes.push(`"${story.title}" reuses image from "${prev}": ${story.image}`);
      else seen.set(story.image, story.title);
    }
    expect(dupes, dupes.join('\n')).toEqual([]);
  });

  it('every story has a unique url', () => {
    const urls = NOUNS_WORLD_STORIES.map(s => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('every story has a unique title', () => {
    const titles = NOUNS_WORLD_STORIES.map(s => s.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
