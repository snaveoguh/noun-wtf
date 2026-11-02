// ── Surfboards: what the shop sells and how each one rides ──────────────
//
// foamie     the rental: free, wide and forgiving, catches anything, turns
//            like a door and barely leaves the water
// longboard  9'6": paddles fastest, catches early, glides, slow to turn
// shortboard 6'0": the hardest to catch, the fastest to turn, the one for airs

export type BoardId = 'foamie' | 'longboard' | 'shortboard';
export const BOARD_IDS: readonly BoardId[] = ['foamie', 'longboard', 'shortboard'];

export interface BoardSpec {
  id: BoardId;
  name: string;
  blurb: string;
  /** COIN (0 = free rental). */
  price: number;
  /** Paddle speed (m/s, flat water) and sprint paddle. */
  paddle: number;
  sprint: number;
  /** Fraction of the wave's speed you need to be going to catch it. */
  catchFrac: number;
  /** Turn rate standing (rad/s) and the lightest it gets at speed. */
  turn: number;
  /** Planing drag (per m) standing. */
  drag: number;
  /** Trim speed the face drives you to (m/s): it must beat the peel (~10.7 m/s along). */
  face: number;
  /** Seconds to pop up. */
  pop: number;
  /** Air launch (× the face's lift). */
  air: number;
  /** Length (m), width (m), colours (deck, rail / stripe). */
  length: number;
  width: number;
  deck: number;
  stripe: number;
}

export const BOARDS: Record<BoardId, BoardSpec> = {
  foamie: {
    id: 'foamie',
    name: 'FOAMIE',
    blurb: 'The rental. Wide, soft, forgiving. Catches anything.',
    price: 0,
    paddle: 2.6,
    sprint: 3.2,
    catchFrac: 0.55,
    turn: 1.7,
    drag: 0.028,
    face: 12.8,
    pop: 0.5,
    air: 0.6,
    length: 2.4,
    width: 0.62,
    deck: 0x5ec8f2,
    stripe: 0xffd23f,
  },
  longboard: {
    id: 'longboard',
    name: 'LONGBOARD',
    blurb: '9\'6" log. Paddles fastest, glides forever, turns slow.',
    price: 250,
    paddle: 3.0,
    sprint: 3.7,
    catchFrac: 0.5,
    turn: 1.5,
    drag: 0.018,
    face: 13.6,
    pop: 0.45,
    air: 0.7,
    length: 2.9,
    width: 0.58,
    deck: 0xf4ead2,
    stripe: 0xff6f61,
  },
  shortboard: {
    id: 'shortboard',
    name: 'SHORTBOARD',
    blurb: '6\'0" thruster. Hard to catch, carves on a dime, flies.',
    price: 600,
    paddle: 2.3,
    sprint: 2.9,
    catchFrac: 0.68,
    turn: 2.9,
    drag: 0.024,
    face: 14.6,
    pop: 0.32,
    air: 1.25,
    length: 1.85,
    width: 0.5,
    deck: 0xffffff,
    stripe: 0x1b4965,
  },
};

export const isBoardId = (v: unknown): v is BoardId =>
  typeof v === 'string' && (BOARD_IDS as readonly string[]).includes(v);
