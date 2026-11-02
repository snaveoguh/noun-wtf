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
/** Sidewalk top in the weird towns (weirdKit.ts SIDEWALK.y). */
export const SIDEWALK_Y = 0.22;

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
  // The weird towns: customers on the sidewalks (SIDEWALK_Y), seeds read
  // from NounsToken.seeds(id) the same way (2026-10-19)
  noggle: [
    def('noggle', 232, [1, 7, 19, 93, 20], 'Big Lens', -8.6, 62, SIDEWALK_Y), // big glasses head
    def('noggle', 297, [1, 14, 91, 63, 16], 'King Shades', 8.6, 88, SIDEWALK_Y), // crown head
    def('noggle', 296, [0, 12, 41, 66, 20], 'Ice', -8.6, 116, SIDEWALK_Y), // blue diamond head
    def('noggle', 299, [1, 1, 86, 67, 16], 'Ruby', 8.6, 142, SIDEWALK_Y), // red diamond head
    def('noggle', 582, [1, 10, 103, 96, 11], 'Coinz', -8.6, 170, SIDEWALK_Y), // gold coin head
    def('noggle', 230, [1, 3, 42, 177, 12], 'Robo Rita', 8.6, 222, SIDEWALK_Y), // robot head
  ],
  shroom: [
    def('shroom', 329, [0, 8, 88, 134, 4], 'Morel', -8.6, 54, SIDEWALK_Y), // mushroom head
    def('shroom', 33, [1, 27, 60, 89, 9], 'Ribbit', 8.6, 82, SIDEWALK_Y), // frog head
    def('shroom', 391, [0, 6, 32, 94, 0], 'Gnorm', -8.6, 110, SIDEWALK_Y), // gnome head
    def('shroom', 213, [0, 17, 26, 143, 2], 'Hoot', 8.6, 138, SIDEWALK_Y), // owl head
    def('shroom', 365, [1, 1, 19, 134, 1], 'Porcini', -8.6, 168, SIDEWALK_Y), // mushroom head
    def('shroom', 190, [1, 11, 46, 19, 11], 'Bonzo', 8.6, 196, SIDEWALK_Y), // bonsai head
  ],
  neon: [
    def('neon', 441, [1, 4, 21, 174, 10], 'RGB', 8.6, 58, SIDEWALK_Y), // rgb head
    def('neon', 123, [1, 0, 106, 64, 20], 'Blue Screen', -8.6, 86, SIDEWALK_Y), // crt head
    def('neon', 401, [0, 12, 2, 20, 6], 'Bass', 8.6, 114, SIDEWALK_Y), // boombox head
    def('neon', 107, [1, 20, 100, 37, 7], 'Disc', -8.6, 142, SIDEWALK_Y), // cd head
    def('neon', 82, [0, 15, 93, 116, 20], 'Volt', 8.6, 170, SIDEWALK_Y), // lightning bolt head
    def('neon', 160, [0, 21, 33, 199, 5], 'Sparkle', -8.6, 198, SIDEWALK_Y), // star sparkles head
  ],
  crater: [
    def('crater', 163, [0, 29, 54, 212, 11], 'Zorp', 8.6, 60, SIDEWALK_Y), // ufo head
    def('crater', 64, [0, 22, 134, 128, 19], 'Luna', -8.6, 88, SIDEWALK_Y), // moon head
    def('crater', 68, [1, 24, 74, 184, 18], 'Rings', 8.6, 116, SIDEWALK_Y), // saturn head
    def('crater', 818, [0, 13, 125, 248, 14], 'Ping', -8.6, 144, SIDEWALK_Y), // satellite head
    def('crater', 90, [1, 3, 29, 217, 17], 'Magma', 8.6, 172, SIDEWALK_Y), // volcano head
    def('crater', 63, [0, 12, 27, 186, 18], 'Stinger', -8.6, 200, SIDEWALK_Y), // scorpion head
  ],
  // The road trip's side towns, on their sidewalks; seeds read from
  // NounsToken.seeds(id) the same way (2026-11-02)
  peak: [
    def('peak', 32, [0, 15, 92, 191, 15], 'Chairlift Charlie', -8.6, 30, SIDEWALK_Y), // skilift head
    def('peak', 456, [1, 2, 20, 238, 10], 'Frosty Fran', 8.6, 52, SIDEWALK_Y), // snowman head
    def('peak', 165, [1, 22, 121, 194, 11], 'Revvy', -8.6, 66, SIDEWALK_Y), // snowmobile head
    def('peak', 184, [0, 24, 29, 14, 1], 'Yeti Betty', 8.6, 112, SIDEWALK_Y), // yeti head
    def('peak', 305, [0, 10, 27, 131, 3], 'Summit Sam', -8.6, 134, SIDEWALK_Y), // snowcap mountain head
    def('peak', 131, [0, 3, 96, 193, 11], 'Globe', 8.6, 156, SIDEWALK_Y), // snowglobe head
  ],
  pines: [
    def('pines', 105, [0, 10, 102, 129, 7], 'Mo Moose', -8.6, 26, SIDEWALK_Y), // moose head
    def('pines', 113, [1, 2, 45, 74, 10], 'Mallory', 8.6, 50, SIDEWALK_Y), // duck head
    def('pines', 274, [1, 26, 119, 10, 4], 'Big Bruin', -8.6, 64, SIDEWALK_Y), // bear head
    def('pines', 39, [0, 21, 26, 133, 20], 'Java Jo', 8.6, 110, SIDEWALK_Y), // mug head
    def('pines', 377, [0, 25, 16, 89, 14], 'Croaky', -8.6, 136, SIDEWALK_Y), // frog head
    def('pines', 208, [1, 5, 80, 228, 0], 'Howler', 8.6, 160, SIDEWALK_Y), // werewolf head
  ],
  diesel: [
    def('diesel', 84, [0, 12, 124, 106, 18], 'Frank', -8.6, 40, SIDEWALK_Y), // hotdog head
    def('diesel', 8, [1, 20, 7, 202, 19], 'Taco Tina', 8.6, 56, SIDEWALK_Y), // taco head
    def('diesel', 101, [1, 18, 92, 27, 14], 'Dollar Menu Don', -8.6, 70, SIDEWALK_Y), // burger head
    def('diesel', 688, [1, 29, 8, 33, 19], 'Gearhead', 8.6, 118, SIDEWALK_Y), // car head
    def('diesel', 71, [0, 29, 7, 176, 3], 'Highway Hal', -8.6, 140, SIDEWALK_Y), // road head
    def('diesel', 97, [1, 28, 36, 69, 17], 'Rex', 8.6, 162, SIDEWALK_Y), // dino head
  ],
};
