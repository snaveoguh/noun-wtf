// ── Noun World missions: the cast and their mission lines (pure data) ────
//
// Shared by the game and the world-stats Netlify function (which validates
// what riders post), so no DOM and no three.js in here.
//
// Every character is a real Noun: the seeds below are the exact on-chain
// seeds (NounsToken.seeds(id) on mainnet, 0x9C8f…dC03), read once and
// hard-coded so the game needs no network for them. Order: background,
// body, accessory, head, glasses.
//
// The Oracle is the hub: talking to her starts everything, and her first
// mission ("Wake up") opens every other character's line. Each line is a
// chain (a mission needs the one before it); a character's first mission
// shows once you've met them. Record missions (speed / air / hang time)
// only complete from values the server accepted with a run proof.

export type NpcId =
  | 'oracle'
  | 'keymaker'
  | 'dj'
  | 'writer'
  | 'courier'
  | 'captain'
  | 'baller'
  | 'twins';

export interface NpcDef {
  id: NpcId;
  name: string;
  /** Real Noun IDs (the Twins are two). */
  nouns: number[];
  /** Exact on-chain seeds, [background, body, accessory, head, glasses]. */
  seeds: [number, number, number, number, number][];
  /** Where to find them (journal hint). */
  where: string;
  /** Heavy build (NounCharacter.setWeight). */
  weight?: number;
}

export const NPCS: Record<NpcId, NpcDef> = {
  oracle: {
    id: 'oracle',
    name: 'The Oracle',
    nouns: [115],
    seeds: [[1, 13, 18, 65, 20]], // crystal ball head, grayscale-9 (near black) body, dusk gradient
    where: 'her kitchen table by the fountain',
    weight: 1,
  },
  keymaker: {
    id: 'keymaker',
    name: 'The Keymaker',
    nouns: [1859],
    seeds: [[0, 8, 53, 120, 19]], // lock head
    where: 'the GO DOWN alley, west side of the plaza',
  },
  dj: {
    id: 'dj',
    name: 'Selector',
    nouns: [1062],
    seeds: [[0, 4, 35, 20, 16]], // boombox head
    where: 'the ice cream van (COMMUNITY RADIO)',
  },
  writer: {
    id: 'writer',
    name: 'Ink',
    nouns: [1024],
    seeds: [[1, 22, 23, 145, 18]], // paintbrush head
    where: 'the Ledge Garden wall',
  },
  courier: {
    id: 'courier',
    name: 'Parcel',
    nouns: [271],
    seeds: [[1, 4, 65, 122, 12]], // mailbox head
    where: 'the DOWNHILL alley, south side of the plaza',
  },
  captain: {
    id: 'captain',
    name: 'Cap',
    nouns: [297],
    seeds: [[1, 14, 91, 63, 16]], // crown head
    where: 'the top of Main St, Noun Jersey (19 km down the DOWNHILL line)',
  },
  baller: {
    id: 'baller',
    name: 'Swish',
    nouns: [569],
    seeds: [[0, 17, 89, 8, 21]], // basketball head
    where: 'the Noun Jersey court',
  },
  twins: {
    id: 'twins',
    name: 'The Twins',
    nouns: [911, 2044],
    seeds: [
      [1, 19, 52, 99, 12], // hair head + fries
      [0, 9, 52, 99, 22], // hair head + fries
    ],
    where: 'the MOUNTAIN alley, east side of the plaza',
  },
};

export const NPC_IDS = Object.keys(NPCS) as NpcId[];

export type RecordKey = 'kmh' | 'airM' | 'airS';

/** What finishing a mission takes. */
export type Objective =
  /** Land (bank, no bail) a trick whose name matches `re`. */
  | { k: 'trick'; re: string }
  /** Land a combo of `n`+ tricks (in Noun Jersey / in the Upside Down). */
  | { k: 'combo'; n: number; where?: 'nj' | 'ud' }
  /** Spray a tag (in a given colour). */
  | { k: 'tag'; color?: string }
  /** Tune the radio to NOUN FM. */
  | { k: 'fm' }
  /** Ride `s` seconds on the board while tuned to NOUN FM. */
  | { k: 'fmRide'; s: number }
  /** Reach a secret spot. */
  | { k: 'spot'; spot: 'nj' | 'bowl' }
  /** Step through the Keymaker's door. */
  | { k: 'door' }
  /** One unbroken mountain run of `s` seconds (the streak clock). */
  | { k: 'streak'; s: number }
  /** One grind of `m` metres. */
  | { k: 'grind'; m: number }
  /** Ride alongside the Jersey crew for `s` seconds in all. */
  | { k: 'crew'; s: number }
  /** Finish (win) a game of Noun Hoops. */
  | { k: 'hoops'; win: boolean }
  /** Carry a parcel to someone within `s` seconds. */
  | { k: 'deliver'; to: NpcId; s: number }
  /** Beat the Twins `m` metres down the mountain. */
  | { k: 'race'; m: number }
  /** In the Upside Down: hang time of `s` seconds in one air. */
  | { k: 'udHang'; s: number }
  /** In the Upside Down: ride `m` metres. */
  | { k: 'udRide'; m: number }
  /** A record the server holds (accepted with its run proof). */
  | { k: 'record'; key: RecordKey; min: number; surface?: 'grass' };

export type Tier = 1 | 2 | 3 | 4;
export const TIER_NAMES: Record<Tier, string> = {
  1: 'starter',
  2: 'core',
  3: 'hard',
  4: 'legendary',
};

export interface MissionDef {
  id: string;
  npc: NpcId;
  tier: Tier;
  title: string;
  /** What the character says when giving it. */
  flavour: string;
  /** The objective in plain words. */
  goal: string;
  obj: Objective;
  /** Missions that must be done first (same line, or the Oracle's start). */
  after: string[];
  /** Cosmetic title it unlocks. */
  reward: string;
}

export const MISSIONS: MissionDef[] = [
  // ── The Oracle: the hub, and the record line ──
  {
    id: 'wake-up',
    npc: 'oracle',
    tier: 1,
    title: 'Wake up',
    flavour: 'Before you can see the hill for what it is, you have to flip it. Just once.',
    goal: 'Land a kickflip (J on a keyboard).',
    obj: { k: 'trick', re: 'kickflip' },
    after: [],
    reward: 'Awake',
  },
  {
    id: 'free-your-mind',
    npc: 'oracle',
    tier: 3,
    title: 'Free your mind',
    flavour: 'Ten seconds between the ground and the ground. The board does not fly. You do.',
    goal: 'Set a hang time of 10 s on the board (a saved record).',
    obj: { k: 'record', key: 'airS', min: 10 },
    after: ['wake-up'],
    reward: 'Unbound',
  },
  {
    id: 'deja-vu',
    npc: 'oracle',
    tier: 3,
    title: 'Déjà vu',
    flavour: 'You have been this fast before. Someone has. Go and meet them at a thousand.',
    goal: 'Set a top speed of 1,000 km/h (a saved record).',
    obj: { k: 'record', key: 'kmh', min: 1000 },
    after: ['free-your-mind'],
    reward: 'Glitch',
  },
  {
    id: 'the-one',
    npc: 'oracle',
    tier: 4,
    title: 'The One',
    flavour:
      'Ten thousand. Nobody has. The hill has no top speed, only a memory. Make it remember you.',
    goal: 'Set a top speed of 10,000 km/h (a saved record).',
    obj: { k: 'record', key: 'kmh', min: 10_000 },
    after: ['deja-vu'],
    reward: 'The One',
  },

  // ── Selector, the NOUN FM DJ ──
  {
    id: 'hear-the-signal',
    npc: 'dj',
    tier: 1,
    title: 'Hear the signal',
    flavour: 'Everybody hears the van. Few tune in. Press M till it says COMMUNITY RADIO.',
    goal: 'Tune your radio to COMMUNITY RADIO.',
    obj: { k: 'fm' },
    after: ['wake-up'],
    reward: 'Listener',
  },
  {
    id: 'stay-tuned',
    npc: 'dj',
    tier: 2,
    title: 'Stay tuned',
    flavour: 'A set is a ride. Keep the station on and keep rolling for three minutes.',
    goal: 'Ride for 3 minutes in all with COMMUNITY RADIO on.',
    obj: { k: 'fmRide', s: 180 },
    after: ['hear-the-signal'],
    reward: 'Selector',
  },

  // ── Ink, the graffiti writer ──
  {
    id: 'leave-a-mark',
    npc: 'writer',
    tier: 1,
    title: 'Leave a mark',
    flavour: 'Off the board, point at a wall, hold the mouse (or G). The city keeps it.',
    goal: 'Spray a tag on any wall.',
    obj: { k: 'tag' },
    after: ['wake-up'],
    reward: 'Toy',
  },
  {
    id: 'code-green',
    npc: 'writer',
    tier: 2,
    title: 'Code green',
    flavour:
      'Everyone sprays the red the can comes with. My colour is the bright green. Paint in it and I’ll know it was you.',
    goal: 'Spray a tag in bright green (#4bea69: aim at a wall and press 0, or T to cycle).',
    obj: { k: 'tag', color: '#4bea69' },
    after: ['leave-a-mark'],
    reward: 'Writer',
  },

  // ── Parcel, the lost courier ──
  {
    id: 'special-delivery',
    npc: 'courier',
    tier: 2,
    title: 'Special delivery',
    flavour:
      'This box is for Cap at Noun Jersey, top of Main St, 19 km down the DOWNHILL line. Fifteen minutes. Don’t ask what’s in it.',
    goal: 'Carry the parcel to Cap in Noun Jersey within 15 minutes.',
    obj: { k: 'deliver', to: 'captain', s: 900 },
    after: ['wake-up'],
    reward: 'Courier',
  },
  {
    id: 'there-is-no-road',
    npc: 'courier',
    tier: 3,
    title: 'There is no road',
    flavour:
      'The dirt line is the fast way. Everyone knows. The grass drags at your wheels, so only a long memory carries you through it.',
    goal: 'Hit 300 km/h on grass (and have it saved as a top speed).',
    obj: { k: 'record', key: 'kmh', min: 300, surface: 'grass' },
    after: ['special-delivery'],
    reward: 'Off Road',
  },

  // ── Cap, the Noun Jersey crew captain ──
  {
    id: 'ride-with-the-crew',
    npc: 'captain',
    tier: 2,
    title: 'Ride with the crew',
    flavour: 'Skate with my lot. Stay close, keep moving, twenty seconds and you’re one of us.',
    goal: 'Ride within 6 m of a rolling Jersey crew skater for 20 s in all.',
    obj: { k: 'crew', s: 20 },
    after: ['wake-up'],
    reward: 'Jersey',
  },
  {
    id: 'jersey-line',
    npc: 'captain',
    tier: 2,
    title: 'Jersey line',
    flavour: 'Five tricks, one line, inside the park. No bails.',
    goal: 'Land a 5-trick combo inside Noun Jersey.',
    obj: { k: 'combo', n: 5, where: 'nj' },
    after: ['ride-with-the-crew'],
    reward: 'Local',
  },
  {
    id: 'bend-the-spoon',
    npc: 'captain',
    tier: 3,
    title: 'Bend the spoon',
    flavour: 'There is no rail. There is only how long you stay on it. Two hundred metres.',
    goal: 'Grind 200 m in one go.',
    obj: { k: 'grind', m: 200 },
    after: ['jersey-line'],
    reward: 'Spoon Bender',
  },

  // ── Swish, the baller ──
  {
    id: 'play-the-game',
    npc: 'baller',
    tier: 1,
    title: 'Play the game',
    flavour: 'Court’s open. Step on it, start a game, play it out.',
    goal: 'Finish a game of Noun Hoops.',
    obj: { k: 'hoops', win: false },
    after: ['wake-up'],
    reward: 'Hooper',
  },
  {
    id: 'take-the-court',
    npc: 'baller',
    tier: 2,
    title: 'Take the court',
    flavour: 'Now win one.',
    goal: 'Win a game of Noun Hoops.',
    obj: { k: 'hoops', win: true },
    after: ['play-the-game'],
    reward: 'Baller',
  },

  // ── The Twins ──
  {
    id: 'outrun-the-twins',
    npc: 'twins',
    tier: 2,
    title: 'Outrun the Twins',
    flavour: 'We go when you go. First to two kilometres down. We don’t bail. We don’t brake.',
    goal: 'Beat the Twins 2 km down the MOUNTAIN line.',
    obj: { k: 'race', m: 2000 },
    after: ['wake-up'],
    reward: 'Twin Killer',
  },
  {
    id: 'the-long-chase',
    npc: 'twins',
    tier: 3,
    title: 'The long chase',
    flavour: 'Again. Six kilometres. We get faster the longer we ride. So do you.',
    goal: 'Beat the Twins 6 km down the MOUNTAIN line.',
    obj: { k: 'race', m: 6000 },
    after: ['outrun-the-twins'],
    reward: 'Ghost',
  },

  // ── The Keymaker, and the Upside Down ──
  {
    id: 'unbroken',
    npc: 'keymaker',
    tier: 2,
    title: 'Unbroken',
    flavour:
      'Every door wants a key. Mine is five minutes on the mountain, never under thirty, never down.',
    goal: 'Ride 5 minutes of one unbroken mountain run (the streak clock, which only ticks at 30 km/h+).',
    obj: { k: 'streak', s: 300 },
    after: ['wake-up'],
    reward: 'Unbroken',
  },
  {
    id: 'white-rabbit',
    npc: 'keymaker',
    tier: 2,
    title: 'Follow the white rabbit',
    flavour: 'Straight down the DOWNHILL line, nineteen kilometres. There is a town nobody built.',
    goal: 'Find Noun Jersey.',
    obj: { k: 'spot', spot: 'nj' },
    after: ['unbroken'],
    reward: 'Rabbit',
  },
  {
    id: 'deepest-door',
    npc: 'keymaker',
    tier: 3,
    title: 'The deepest door',
    flavour:
      'Down the GO DOWN line, past forty kilometres, a bowl. At the bottom of it, a door. Bring the key.',
    goal: 'Reach the Noggle Bowl and step through the door at the bottom.',
    obj: { k: 'door' },
    after: ['white-rabbit'],
    reward: 'Keyholder',
  },
  {
    id: 'weightless',
    npc: 'keymaker',
    tier: 3,
    title: 'Weightless',
    flavour:
      'In there the ground lets go of you. Stay up fifteen seconds. It doesn’t count. Do it anyway.',
    goal: 'In the Upside Down: one air of 15 s.',
    obj: { k: 'udHang', s: 15 },
    after: ['deepest-door'],
    reward: 'Weightless',
  },
  {
    id: 'spore-trail',
    npc: 'keymaker',
    tier: 3,
    title: 'Spore trail',
    flavour: 'Ride its dark for three kilometres and come back to tell me.',
    goal: 'In the Upside Down: ride 3 km.',
    obj: { k: 'udRide', m: 3000 },
    after: ['deepest-door'],
    reward: 'Upside Down',
  },
];

export const MISSION_BY_ID: Record<string, MissionDef> = Object.fromEntries(
  MISSIONS.map(m => [m.id, m]),
);

/** Missions only the server's accepted records can complete. */
export const isRecordMission = (m: MissionDef) => m.obj.k === 'record';

/** Oldest plausible completion time (well before missions existed). */
export const MISSIONS_EPOCH = Date.UTC(2026, 0, 1);

/**
 * Server side: the missions a post may add, given what the row already
 * holds and its server-accepted records. Unknown ids, bad timestamps,
 * missions whose chain isn't complete and record missions the row's
 * records don't back are all dropped. Nothing is ever removed.
 */
export function validateMissions(
  raw: unknown,
  prev: Record<string, number> | undefined,
  best: Partial<Record<RecordKey, number>>,
  now: number,
): Record<string, number> {
  const out: Record<string, number> = { ...(prev ?? {}) };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const cand: Record<string, number> = {};
  for (const [id, ts] of Object.entries(raw as Record<string, unknown>).slice(
    0,
    2 * MISSIONS.length,
  )) {
    const m = MISSION_BY_ID[id];
    if (m === undefined || out[id] !== undefined) continue;
    if (typeof ts !== 'number' || !Number.isInteger(ts)) continue;
    if (ts < MISSIONS_EPOCH || ts > now + 60_000) continue;
    if (m.obj.k === 'record' && !((best[m.obj.key] ?? 0) >= m.obj.min)) continue;
    cand[id] = ts;
  }
  // Chains: add what's backed by missions already held (repeat: a post can
  // carry a whole line at once)
  for (let changed = true; changed; ) {
    changed = false;
    for (const [id, ts] of Object.entries(cand)) {
      if (!MISSION_BY_ID[id]!.after.every(a => out[a] !== undefined)) continue;
      out[id] = ts;
      delete cand[id];
      changed = true;
    }
  }
  return out;
}

/** The title a mission id unlocks, if that mission is done. */
export function titleFor(done: Record<string, number> | undefined, id: unknown): string | null {
  if (typeof id !== 'string' || done?.[id] === undefined) return null;
  return MISSION_BY_ID[id]?.reward ?? null;
}
