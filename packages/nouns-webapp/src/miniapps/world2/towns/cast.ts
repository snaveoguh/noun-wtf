// ── Town customers: real Nouns at the roadside (pure data) ───────────────
//
// Every customer is a real Noun: the seeds are the exact on-chain seeds
// (NounsToken.seeds(id) on mainnet, 0x9C8f…dC03), from the same one-off
// read of ids 0–2099 that missions/defs.ts uses, hard-coded so the game
// needs no network. Order: background, body, accessory, head, glasses.
// Heads picked to suit the town (cacti and horses out west, sea life at
// the beach).
//
// Spots are in town coords (towns/site.ts): v' across the line (+ = far
// side), u down it from the top of the pad; everyone faces the street.

import type { GrownTown } from './site';

export interface CustomerDef {
  /** Stable id (sent as TradeAction 'serve' customer): '<town>:<noun id>'. */
  id: string;
  noun: number;
  seed: [number, number, number, number, number];
  name: string;
  /** Roadside spot (town coords) and height above the pad. */
  vp: number;
  u: number;
  y: number;
}

const def = (
  town: GrownTown,
  noun: number,
  seed: CustomerDef['seed'],
  name: string,
  vp: number,
  u: number,
  y = 0,
): CustomerDef => ({ id: `${town}:${noun}`, noun, seed, name, vp, u, y });

/** Boardwalk top in Dry Gulch (build.ts lays the boards at this height). */
export const WALK_Y = 0.32;
/** Boardwalk edge (v') each side of main street. */
export const WALK_EDGE = 7.6;

export const CAST: Record<GrownTown, CustomerDef[]> = {
  cowboy: [
    def('cowboy', 273, [1, 6, 31, 181, 8], 'Saguaro Sal', -8.4, 52, WALK_Y), // saguaro head
    def('cowboy', 159, [1, 23, 115, 105, 12], 'Dobbin', 8.4, 74, WALK_Y), // deep-fried horse head
    def('cowboy', 100, [1, 17, 9, 59, 19], 'Moo Mae', -8.4, 106, WALK_Y), // cow head
    def('cowboy', 3, [1, 6, 79, 21, 7], 'Boots', 8.4, 134, WALK_Y), // boot head
    def('cowboy', 316, [0, 25, 19, 190, 4], 'Sheriff Bones', -8.4, 166, WALK_Y), // skeleton hat
    def('cowboy', 1319, [0, 26, 15, 253, 11], 'Rattler', 8.4, 194, WALK_Y), // green snake head
  ],
  beach: [
    def('beach', 200, [0, 23, 44, 60, 13], 'Captain Pinch', 8.2, 48), // crab head
    def('beach', 227, [1, 22, 39, 97, 15], 'Goldie', -8.4, 78), // goldfish head
    def('beach', 47, [1, 14, 21, 187, 16], 'Bruce', 8.2, 108), // shark head
    def('beach', 210, [0, 13, 57, 225, 19], 'Big Wave Dave', 8.2, 146), // wave head
    def('beach', 27, [0, 27, 6, 111, 0], 'Jelly', -8.4, 172), // jellyfish head
    def('beach', 2, [1, 3, 3, 157, 20], 'Piña', 8.2, 204), // pineapple head
  ],
};
