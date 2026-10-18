// Noun avatars for the floor: bots wear their real Noun's seed; riders get
// a stable random Noun from their id. Data URIs, cached.

import { ImageData } from '@noundry/nouns-assets';

import { nounSvgDataUri, type NounSeed } from '@/lib/marketplace/nouns-svg';

import { BOT_BY_ID } from '../engine';

const cache = new Map<string, string>();

const seedOf = (s: readonly number[]): NounSeed => ({
  background: s[0],
  body: s[1],
  accessory: s[2],
  head: s[3],
  glasses: s[4],
});

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

function riderSeed(id: string): NounSeed {
  const { images, bgcolors } = ImageData;
  let h = hash(id);
  const take = (n: number) => {
    const v = h % n;
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    return v;
  };
  return {
    background: take(bgcolors.length),
    body: take(images.bodies.length),
    accessory: take(images.accessories.length),
    head: take(images.heads.length),
    glasses: take(images.glasses.length),
  };
}

export function avatarFor(who: string): string {
  const hit = cache.get(who);
  if (hit !== undefined) return hit;
  const bot = BOT_BY_ID[who] as (typeof BOT_BY_ID)[string] | undefined;
  const uri = nounSvgDataUri(bot !== undefined ? seedOf(bot.seed) : riderSeed(who));
  cache.set(who, uri);
  return uri;
}
