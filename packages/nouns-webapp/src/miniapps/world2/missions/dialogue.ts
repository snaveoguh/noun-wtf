// ── What the characters say ────────────────────────────────────────────
//
// The Oracle's riddles are cryptic but true: each one maps to a rule in
// skate/Player.ts (or a real place / feature), noted alongside. Keep them in
// step if the rules change.

import type { NpcId } from './defs';

export interface Riddle {
  text: string;
  /** What it's really about (shown after you've heard it, on "explain"). */
  plain: string;
}

export const ORACLE_RIDDLES: Riddle[] = [
  {
    // STREAK_ACCEL × runTime/60, runTime only ticks at speed ≥ STREAK_MIN_SPEED
    text: 'The hill remembers how long you have stayed up. But only the time you spend flying, not crawling. Dawdle and it forgets nothing, but it learns nothing either.',
    plain:
      'On the mountain, every minute of one unbroken run at 30 km/h or more adds +0.35 m/s² of push (when you’re over 3 m/s and not braking).',
  },
  {
    // drag / (1 + run / RUN_DRAG_K)
    text: 'Distance thins the air. Every metre since your last fall makes the wind a little weaker against you.',
    plain:
      'Air drag on the mountain is divided by (1 + metres ridden since your last bail / 400). Distance always counts, at any speed.',
  },
  {
    // run = runTime = 0 on bail, respawn, getting off the board
    text: 'A bail wipes the hill’s memory. So does stepping off your board. So does asking to be carried home.',
    plain:
      'A bail, a respawn (R or a rescue) or getting off the board resets both the push and the thin air.',
  },
  {
    // the streak only applies on the mountain; mega ramps / Noun Jersey bring city physics
    text: 'The memory lives only on the slopes. The city keeps its own law, and so do the giants’ ramps and the town nobody built.',
    plain:
      'The streak is mountain-only. In the city, on the mega ramps and in Noun Jersey you ride with city friction and drag, and no streak.',
  },
  {
    // grass: friction + 1.1, drag × 2.2
    text: 'The dirt line is the fast road. The grass drags at your wheels; only a long memory carries you through it.',
    plain:
      'Grass adds rolling friction and more than doubles air drag. Stay on the dirt track for speed.',
  },
  {
    // tuck = 1 − 0.35 × crouch
    text: 'Make yourself small and the wind has less of you to hold.',
    plain: 'Crouching (hold SPACE) tucks you: about a third less rolling friction and air drag.',
  },
  {
    // the myth
    text: 'You ask if leaving your game open for a week makes you faster. The hill does not count days. It counts riding: on the board, on its slopes, fast. A hidden window barely breathes.',
    plain:
      'Idling does nothing. The streak clock only runs while you ride the mountain at 30 km/h+, and background tabs are throttled anyway.',
  },
  {
    text: 'A record is only real when it can show the ride that made it.',
    plain:
      'Top speed, jump height and hang time are saved with a trace of the ride, checked against the game’s physics. Missions for records only count once the record is saved.',
  },
  {
    text: 'Nineteen kilometres down the DOWNHILL line there is a town nobody built. Its people skate. One of them keeps a crown.',
    plain: 'Noun Jersey, a secret skatepark town, sits about 19 km down the DOWNHILL alley’s line.',
  },
  {
    text: 'Past forty-two kilometres down the GO DOWN line, the ground opens like a mouth. At the bottom of the mouth, a door.',
    plain:
      'The Noggle Bowl is about 42–48 km down the GO DOWN alley’s line. The Keymaker knows about the door.',
  },
  {
    text: 'Some ramps are taller than the houses. They wear glasses.',
    plain: 'Noggles mega ramps stand on the mountain lines (R can respawn you at the first one).',
  },
  {
    text: 'The ice cream van has a voice, and anyone can lend it theirs.',
    plain:
      'COMMUNITY RADIO broadcasts from the van: press M to tune in, or step inside and press E to queue a track.',
  },
  {
    text: 'Walls remember paint.',
    plain:
      'Off the board, aim at a wall and hold the mouse (or G) to spray. Tags are saved for everyone.',
  },
  {
    text: 'In the town nobody built there is a court. The ball does not care who you are.',
    plain: 'Noun Hoops: a basketball court in Noun Jersey. Walk onto it to start a game.',
  },
  {
    text: 'At kilometres a second, everything is far away and arrives at once. Someone has done a thousand. Nobody has done ten.',
    plain: 'The top speed board has passed 1,000 km/h. 10,000 km/h is The One.',
  },
];

/** First words, before you've accepted anything. */
export const GREETING: Record<NpcId, string> = {
  oracle:
    'Oh, you’re here. Sit, if you like. Have a cookie. You’ll feel right as rain. I know why you came: you want to know if the hill is real. Let’s find out what you can do first.',
  keymaker:
    'Every door has a key, and every key has a door. I make them. The one you want is the deepest, and it is not given. It is earned.',
  dj: 'Selector on the decks. The van is a station: COMMUNITY RADIO, live, for everyone in the world at once.',
  writer: 'You ride the city. I sign it. Want to leave something behind?',
  courier: 'Lost. Late. Holding a box that isn’t mine to open. You look fast.',
  captain: 'Welcome to Jersey. Nobody built it and nobody leaves. Skate with us.',
  baller: 'Court’s free. You any good?',
  twins: 'We go when you go. We don’t bail. We don’t brake. We do get bored.',
};

/** When a character has nothing left for you. */
export const DONE_LINE: Record<NpcId, string> = {
  oracle: 'You didn’t come here to be told you’re The One. You came to find out. Now you know.',
  keymaker: 'The door knows you now. It will open for you whenever you come down to it.',
  dj: 'Stay locked. The station never sleeps.',
  writer: 'Your mark is on the city. It stays.',
  courier: 'Everything delivered. I might even go home.',
  captain: 'You’re Jersey now. Come back any time.',
  baller: 'Rematch whenever.',
  twins: 'Again some day. We’ll be faster.',
};

/** Waiting on someone else's line first. */
export const LOCKED_LINE: Record<NpcId, string> = {
  oracle: '',
  keymaker: 'Not yet. Go and see the Oracle. She’ll know when you’re ready.',
  dj: 'Have you seen the Oracle? She sends the good ones my way.',
  writer: 'The Oracle sent you? No? Go see her, then come back.',
  courier: 'Go see the Oracle by the fountain first. She’ll vouch for you.',
  captain: 'The Oracle hasn’t mentioned you. Come back when she has.',
  baller: 'See the Oracle, then come play.',
  twins: 'She hasn’t told us about you. Go see the Oracle.',
};
