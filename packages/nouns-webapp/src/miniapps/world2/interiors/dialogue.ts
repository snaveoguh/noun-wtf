// ── What residents say, and what they offer you (pure data) ──────────────
//
// Lines by situation, by the kind of place, and by your respect tier
// (grouped: cold for outcasts, neutral for strangers, warm for locals and
// regulars, fan for legends). Picked with the visit's seeded rng.

import type { InteriorKind, RespectTier } from './contract';

import { pick, type Rng } from './rng';

export type Warmth = 'cold' | 'neutral' | 'warm' | 'fan';

export function warmth(tier: RespectTier): Warmth {
  switch (tier) {
    case 'outcast':
      return 'cold';
    case 'stranger':
      return 'neutral';
    case 'legend':
      return 'fan';
    default:
      return 'warm';
  }
}

const GREET: Record<'home' | 'public', Record<Warmth, string[]>> = {
  home: {
    cold: ['…oh. It’s you.', 'Wipe your feet. And don’t touch anything.', 'Make it quick.'],
    neutral: ['Oh! Hi. Come in, I guess?', 'Hey there, stranger.', 'Shoes off, please!'],
    warm: ['Hey, come in, come in!', 'Look who it is! Make yourself at home.', 'Perfect timing!'],
    fan: [
      'NO WAY. You’re actually here?!',
      'A legend in my living room! Sit, sit!',
      'Everyone, look who it is!',
    ],
  },
  public: {
    cold: ['We’re… about to close.', 'I’ve got my eye on you.', 'Buy something or move along.'],
    neutral: ['Welcome in!', 'Hi! Let me know if you need anything.', 'Hey, what can I get you?'],
    warm: ['Hey, good to see you again!', 'The usual?', 'Welcome back, friend!'],
    fan: [
      'Oh wow, it’s YOU! Anything you want.',
      'A legend walks in! Everything’s on special for you.',
      'Can I get a selfie later?',
    ],
  },
};

/** "Not today": an outcast at the door of a home that won't have them. */
export const SHUT = [
  'Not today.',
  'Nope. Not after what you did.',
  'We’re not home. …Go away.',
  'Not today, pal.',
];

/** Turned away because you were thrown out of here recently. */
export const BANNED = ['You again? Out.', 'Banned. Bye.', 'Not after last time.'];

const CHATTER: Record<InteriorKind, string[]> = {
  home: [
    'The noggles on the fountain need a clean.',
    'Did you hear the auction last night?',
    'My cousin skates the Big Six every morning.',
    'This sofa has seen things.',
    'Want to see my plant? I named it Prop.',
  ],
  cafe: [
    'Oat milk’s in the fridge.',
    'Best fries on the plaza. Don’t tell the van.',
    'We roast our own beans. Square ones.',
    'The croissants are basically CC0.',
  ],
  shop: [
    'Fresh drip just came in.',
    'Noggles are flying off the shelves.',
    'We price in COIN, no haggling.',
    'If you’re driving the van, I can load you up.',
  ],
  bar: [
    'Jukebox takes requests. Mostly.',
    'No skating on the bar, please.',
    'Pool table’s free if you’re feeling lucky.',
    'House rule: no proposals after midnight.',
  ],
  studio: [
    'Listen to this drop…',
    'Crate digging is a lifestyle.',
    'We’re mixing the next NOUN FM set.',
    'Don’t touch the faders.',
  ],
  gallery: [
    'This one’s a one-of-one.',
    'All CC0. Take a photo, it lasts longer.',
    'The artist used only sixteen colours.',
    'Please don’t lick the sculptures.',
  ],
  arcade: [
    'High score on cabinet two is unbeatable.',
    'Tokens at the counter!',
    'Claw machine’s rigged. Kidding. Mostly.',
  ],
  barber: ['Square head, square cut.', 'Next chair’s free.', 'Fresh fade, fresh mind.'],
  laundromat: [
    'Machine three eats socks.',
    'Separate your lights and darks.',
    'Spin cycle is my meditation.',
  ],
  gym: ['Do you even push, bro?', 'Hydrate!', 'Leg day is every day on a board.'],
};

const OFFER: Record<Warmth, string[]> = {
  cold: ['Fine. You can have this.', 'Here. Don’t make it weird.'],
  neutral: ['Hungry? Have some {food}.', 'Want some {food}?', 'I made {food}, want some?'],
  warm: ['Here, try my {food}!', 'You have to try this {food}.', 'Saved you some {food}!'],
  fan: [
    'For you: the good stuff. {food}!',
    'Only the best for a legend: {food}.',
    'I was saving this {food} for someone special.',
  ],
};

export const THANKED = [
  'Aww, any time!',
  'You’re welcome!',
  'Glad you liked it!',
  'Come back for more!',
];
export const UNTHANKED = ['…you’re welcome, I guess.', 'Manners cost nothing.', 'Hmph.'];
export const REFUSED = ['Oh. Okay then.', 'More for me.', 'Suit yourself.', 'Your loss!'];
export const WALKED_OUT = ['Hey! Your food!', 'Rude!', 'They didn’t even finish it…'];
export const GIFT: Record<'small' | 'mid' | 'big', string[]> = {
  small: ['Oh, thanks!', 'Cute. Thank you!', 'Every coin counts!'],
  mid: ['Wow, that’s generous!', 'You didn’t have to!', 'Thank you so much!'],
  big: ['WHAT. Are you serious?!', 'I could kiss your noggles!', 'You’re a legend. Literally.'],
};
export const SOLD = ['Enjoy!', 'Pleasure doing business.', 'Good choice.', 'Come again!'];
export const HINT = [
  'Well… it’s getting late.',
  'Anyway, I should really get on with things.',
  'Don’t you have somewhere to be?',
  'We close soon, just so you know.',
];
export const KICK = ['Okay, out you go!', 'Time to leave. Now.', 'Out. Bye!'];
export const CAUGHT = ['HEY! Put that back!', 'Thief! Get out!', 'I SAW that. Out!'];
export const SIT = ['Comfy, right?', 'Take a load off.', 'That’s my favourite seat.'];

export function greeting(rnd: Rng, kind: InteriorKind, w: Warmth): string {
  return pick(rnd, GREET[kind === 'home' ? 'home' : 'public'][w]);
}

export function chatter(rnd: Rng, kind: InteriorKind): string {
  return pick(rnd, CHATTER[kind]);
}

export function offerLine(rnd: Rng, w: Warmth, food: Food): string {
  return pick(rnd, OFFER[w]).replace('{food}', food.name.toLowerCase());
}

export function giftLine(rnd: Rng, coin: number): string {
  return pick(rnd, GIFT[coin >= 25 ? 'big' : coin >= 5 ? 'mid' : 'small']);
}

// ── Food ─────────────────────────────────────────────────────────────────

export interface Food {
  name: string;
  icon: string;
  /** The good stuff (legends get this). */
  premium: boolean;
  /** What it looks like in your hand. */
  look: 'slice' | 'cup' | 'bowl' | 'plate' | 'bar' | 'cone' | 'can';
  color: number;
}

const f = (
  name: string,
  icon: string,
  look: Food['look'],
  color: number,
  premium = false,
): Food => ({
  name,
  icon,
  premium,
  look,
  color,
});

const FOOD: Record<'home' | 'cafe' | 'bar' | 'other', { plain: Food[]; good: Food[] }> = {
  home: {
    plain: [
      f('Toast', '🍞', 'slice', 0xe0a95b),
      f('Noodle soup', '🍜', 'bowl', 0xf2c94c),
      f('Pizza slice', '🍕', 'slice', 0xf2994a),
      f('Cookies', '🍪', 'plate', 0xc98a4b),
      f('Tea', '🍵', 'cup', 0x7fb069),
      f('Fries', '🍟', 'plate', 0xf2c94c),
    ],
    good: [
      f('Grandma’s lasagne', '🍝', 'plate', 0xd9542f, true),
      f('Golden noggle cake', '🎂', 'plate', 0xffd400, true),
      f('Fresh dumplings', '🥟', 'bowl', 0xf4e1c1, true),
    ],
  },
  cafe: {
    plain: [
      f('Espresso', '☕', 'cup', 0x5a3a22),
      f('Croissant', '🥐', 'slice', 0xe8b04a),
      f('Donut', '🍩', 'plate', 0xe86fa6),
      f('Iced tea', '🧋', 'cup', 0xc98a4b),
    ],
    good: [
      f('Truffle fries', '🍟', 'plate', 0xf2c94c, true),
      f('Chef’s special', '🥞', 'plate', 0xf2b134, true),
    ],
  },
  bar: {
    plain: [
      f('Lemonade', '🍋', 'cup', 0xf7e463),
      f('Nachos', '🧀', 'plate', 0xf2c94c),
      f('Root beer', '🥤', 'can', 0x6b3a22),
    ],
    good: [
      f('House special mocktail', '🍹', 'cup', 0xff7a59, true),
      f('Golden wings', '🍗', 'plate', 0xd98a2b, true),
    ],
  },
  other: {
    plain: [
      f('Water', '💧', 'cup', 0x9fd8ef),
      f('Energy bar', '🍫', 'bar', 0x6b3a22),
      f('Juice box', '🧃', 'can', 0x7fb069),
      f('Mint', '🍬', 'bar', 0x9fe0c8),
    ],
    good: [
      f('Fancy chocolate', '🍫', 'bar', 0x4a2a18, true),
      f('Ice cream', '🍦', 'cone', 0xf6d6e8, true),
    ],
  },
};

function foodGroup(kind: InteriorKind): keyof typeof FOOD {
  return kind === 'home' ? 'home' : kind === 'cafe' ? 'cafe' : kind === 'bar' ? 'bar' : 'other';
}

/** What a resident offers you: the good stuff for legends. */
export function offerFood(rnd: Rng, kind: InteriorKind, w: Warmth): Food {
  const g = FOOD[foodGroup(kind)];
  return w === 'fan' ? pick(rnd, g.good) : pick(rnd, g.plain);
}

// ── What's for sale (eat-in menus and services, paid in COIN) ─────────────

export interface MenuItem {
  id: string;
  name: string;
  icon: string;
  /** List price (COIN) before any discount. */
  price: number;
  /** Eat it here (cafes, bars) or a service (a haircut, a token). */
  use: 'eat' | 'service';
  food?: Food;
}

const MENUS: Partial<Record<InteriorKind, MenuItem[]>> = {
  cafe: [
    {
      id: 'espresso',
      name: 'Espresso',
      icon: '☕',
      price: 3,
      use: 'eat',
      food: FOOD.cafe.plain[0],
    },
    {
      id: 'croissant',
      name: 'Croissant',
      icon: '🥐',
      price: 4,
      use: 'eat',
      food: FOOD.cafe.plain[1],
    },
    { id: 'donut', name: 'Donut', icon: '🍩', price: 3, use: 'eat', food: FOOD.cafe.plain[2] },
    {
      id: 'special',
      name: 'Chef’s special',
      icon: '🥞',
      price: 9,
      use: 'eat',
      food: FOOD.cafe.good[1],
    },
  ],
  bar: [
    { id: 'lemonade', name: 'Lemonade', icon: '🍋', price: 3, use: 'eat', food: FOOD.bar.plain[0] },
    { id: 'nachos', name: 'Nachos', icon: '🧀', price: 6, use: 'eat', food: FOOD.bar.plain[1] },
    {
      id: 'mocktail',
      name: 'House mocktail',
      icon: '🍹',
      price: 8,
      use: 'eat',
      food: FOOD.bar.good[0],
    },
  ],
  barber: [
    { id: 'trim', name: 'Square trim', icon: '💈', price: 8, use: 'service' },
    { id: 'fade', name: 'Fresh fade', icon: '✂️', price: 14, use: 'service' },
  ],
  arcade: [
    { id: 'tokens', name: '10 tokens', icon: '🪙', price: 5, use: 'service' },
    { id: 'claw', name: 'Claw machine go', icon: '🧸', price: 2, use: 'service' },
  ],
  gym: [
    { id: 'pass', name: 'Day pass', icon: '🏋', price: 6, use: 'service' },
    {
      id: 'shake',
      name: 'Protein shake',
      icon: '🥤',
      price: 4,
      use: 'eat',
      food: f('Protein shake', '🥤', 'cup', 0xe8d8c0),
    },
  ],
  laundromat: [
    { id: 'wash', name: 'Wash & dry', icon: '🧺', price: 4, use: 'service' },
    { id: 'soap', name: 'Soap', icon: '🫧', price: 1, use: 'service' },
  ],
  gallery: [{ id: 'print', name: 'Signed print', icon: '🖼', price: 12, use: 'service' }],
  studio: [{ id: 'session', name: 'Studio hour', icon: '🎙', price: 10, use: 'service' }],
};

/** The place's paid menu (empty for homes; shops sell goods through the market). */
export function menuOf(kind: InteriorKind): MenuItem[] {
  return MENUS[kind] ?? [];
}

/** What your tier knocks off (legends 25%, regulars 10%), never below 1 COIN. */
export function discounted(price: number, tier: RespectTier): number {
  const k = tier === 'legend' ? 0.75 : tier === 'regular' ? 0.9 : tier === 'outcast' ? 1.25 : 1;
  return Math.max(1, Math.round(price * k));
}
