// ── Interiors + Respect: the shared contract ─────────────────────────────
//
// Every building in Noun World gets a door you can walk through: the plaza
// city, Noun Jersey, the mountain towns. Inside is a generated interior
// (a home, a cafe, a shop, a studio, a bar, a gallery…) furnished from a
// kit and seeded per building, so the same door always opens onto the same
// room. Residents (real Nouns) live there: they greet you, let you sit,
// offer you food, sell you things for COIN (trade/), and take gifts. How
// they treat you depends on your RESPECT: one number for the whole game
// that grows when you do good (gifts, helping, clean tricks, breakdance
// wins, buying local) and shrinks when you don't (bailing into people,
// tagging someone's house, stealing, walking out on food you were given).
//
// Two parts build against these types and nothing else:
//
//   interiors/  doors on every building, entering / leaving (a short
//               cutscene-free transition), the generated rooms (a pure,
//               tested layout generator + a three.js builder), residents,
//               sitting, food, the shop, gifts. It REPORTS what happened as
//               RespectEvents and READS the tier to decide how residents act.
//   respect/    the RespectSystem on `game.respect`: the score, tiers, the
//               rules turning events (from interiors AND the rest of the
//               game: tricks, bails, graffiti, trade, hoops, breakdance) into
//               points, persistence (local + the server), the HUD meter, its
//               toasts, and what each tier changes elsewhere.
//
// Change this file only additively (new optional fields, new union members),
// and say so in your report: the other part compiles against it.

// ── Respect ─────────────────────────────────────────────────────────────

/** Everything that can move your respect. `amount` overrides the rule's default. */
export type RespectEvent =
  // interiors
  | { kind: 'gift'; to: string; coin: number }
  | { kind: 'ate'; at: string; thanked: boolean }
  | { kind: 'refused_food'; at: string }
  | { kind: 'bought'; at: string; coin: number }
  | { kind: 'stole'; at: string; coin: number }
  | { kind: 'sat'; at: string }
  | { kind: 'overstayed'; at: string }
  | { kind: 'helped'; who: string }
  // the street
  | { kind: 'trick'; score: number }
  | { kind: 'bail_into'; who: string }
  | { kind: 'tagged_home'; building: string }
  | { kind: 'tagged_wall'; building?: string }
  | { kind: 'served'; town: string; tip: number }
  | { kind: 'hoops_win' | 'hoops_loss' }
  | { kind: 'break_win' | 'break_loss'; crewSize: number }
  | { kind: 'custom'; label: string; amount: number };

export type RespectTier = 'outcast' | 'stranger' | 'local' | 'regular' | 'legend';

export interface RespectState {
  /** The score: unbounded, starts at 0. */
  score: number;
  tier: RespectTier;
  /** 0..1 progress through the current tier. */
  progress: number;
  /** Recent changes, newest first (for the HUD's ticker). */
  recent: { label: string; delta: number; at: number }[];
}

/** `game.respect`. */
export interface RespectApi {
  state(): RespectState;
  /** Report something; returns the change it made (0 if it was rate-limited away). */
  add(e: RespectEvent): number;
  /** Subscribe to changes; returns an unsubscribe. */
  on(fn: (s: RespectState, delta: number, e: RespectEvent) => void): () => void;
}

// ── Buildings and interiors ─────────────────────────────────────────────

export type InteriorKind =
  | 'home'
  | 'cafe'
  | 'shop'
  | 'bar'
  | 'studio'
  | 'gallery'
  | 'arcade'
  | 'barber'
  | 'laundromat'
  | 'gym';

/** One building's way in: a door on its outside wall, in world space. */
export interface BuildingDoor {
  /** Stable id: same building → same id across loads (it seeds the interior). */
  id: string;
  /** Where it is: plaza city, Noun Jersey, a mountain town (trade TownId) … */
  area: string;
  /** Door centre on the wall (world), the outward normal's yaw (rad), width. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  width: number;
  /** Building footprint (world, axis-aligned box) for sizing the interior. */
  footprint?: { minX: number; minZ: number; maxX: number; maxZ: number; height: number };
  /** Forced kind (landmarks); otherwise picked from the seed and the area. */
  kind?: InteriorKind;
  name?: string;
}

export interface Resident {
  id: string;
  name: string;
  /** NounSeed (as the game stores it) for the character. */
  seed: unknown;
  role: 'owner' | 'resident' | 'guest' | 'staff';
  /** What they think of you, -1..1: starts from your tier, then moves with what you do here. */
  mood: number;
}

/** What `interiors/` exposes on `game.interiors`. */
export interface InteriorsApi {
  /** Inside a building right now (null when outside). */
  current(): { door: BuildingDoor; kind: InteriorKind } | null;
  /** All the doors known so far (for the minimap / debug). */
  doors(): readonly BuildingDoor[];
  /**
   * (Optional, added by respect/.) The kind a door opens onto: its forced
   * `kind`, else the seeded pick; null if unknown. respect/ uses it to tell
   * someone's home (tagging it costs respect) from a shop or a plain wall.
   */
  kindOf?(doorId: string): InteriorKind | null;
}
