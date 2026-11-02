// ── NOUN TAXI: what passengers shout (pure) ───────────────────────────────
//
// One pool per moment. `{to}` is the destination's name. LineGate keeps
// them from talking over themselves: at most one line per LINE_GAP s, and
// the moments that matter (getting in / out, bailing) always get through.

import type { Rand } from './fares';
import type { Grade } from './pay';

export type LineEvent =
  | 'hail'
  | 'greet'
  | 'greetLong'
  | 'hitchHi'
  | 'hitchChat'
  | 'fast'
  | 'air'
  | 'drift'
  | 'nearMiss'
  | 'crash'
  | 'slow'
  | 'bail'
  | 'thanksS'
  | 'thanksA'
  | 'thanksB'
  | 'thanksC'
  | 'hitchBye';

export const LINES: Record<LineEvent, readonly string[]> = {
  hail: ['TAXI!', 'over here!', 'hey! cab!', 'yo, noun cab!'],
  greet: [
    '{to}, and step on it!',
    'take me to {to}!',
    '{to}. I am SO late.',
    'to {to}, quick quick!',
  ],
  greetLong: [
    '{to}. yeah, the far one. go go go!',
    'all the way to {to}. I hope you have snacks.',
    '{to}! my cousin owes me money.',
    '{to}, please. the scenic route is NOT ok.',
  ],
  hitchHi: [
    'finally! heading to {to}?',
    "bless you. {to}, if you're going that way",
    'my feet! {to}, please',
  ],
  hitchChat: [
    'so… you come here often?',
    "I walked from the plaza. don't ask.",
    'nice wheels. are they yours?',
    'I saw a dragon up there once. swear.',
    'is the radio on? turn it up.',
    'I used to skate this line before the ramps.',
  ],
  fast: ['WOOO!', 'faster! FASTER!', "now we're moving!", 'my hat! forget the hat!'],
  air: ["we're FLYING!", 'did we just jump?!', 'AAAAAH!', 'again! again!'],
  drift: ['so sideways!', "that's the stuff!", 'smell that rubber!'],
  nearMiss: ['that was CLOSE!', 'watch out!', 'inches! INCHES!', 'oh my noggles'],
  crash: ['OW!', 'my neck!', 'are you even licensed?!', "that's coming out of your tip"],
  slow: ['hurry up!', 'I could walk faster!', 'tick tock, cabbie!', 'come ON!'],
  bail: ["forget it, I'll walk!", "I'm getting out here!", "you're fired!"],
  thanksS: ["NOW that's a taxi!", 'keep the change! all of it!', 'legendary. five noggles.'],
  thanksA: ['nice driving!', 'thanks, that was fun!', 'here, a little extra.'],
  thanksB: ['thanks, I guess.', 'we made it. somehow.', 'ok. bye.'],
  thanksC: ['finally…', "I'm late now. thanks for nothing.", 'never again.'],
  hitchBye: ['thanks for the lift!', "you're a legend. here, for gas.", 'safe travels!'],
};

export const LINE_GAP = 4.5;

/** Always spoken, even inside the gap. */
const URGENT: ReadonlySet<LineEvent> = new Set([
  'greet',
  'greetLong',
  'hitchHi',
  'bail',
  'thanksS',
  'thanksA',
  'thanksB',
  'thanksC',
  'hitchBye',
]);

export function thanksFor(g: Grade): LineEvent {
  return g === 'S' ? 'thanksS' : g === 'A' ? 'thanksA' : g === 'B' ? 'thanksB' : 'thanksC';
}

export function lineFor(ev: LineEvent, to: string, rand: Rand): string {
  const pool = LINES[ev];
  return pool[Math.floor(rand() * pool.length)]!.replace('{to}', to);
}

export class LineGate {
  private last = -Infinity;
  /** Whether `ev` may be said at `now` (and if so, the gap starts again). */
  allow(ev: LineEvent, now: number): boolean {
    if (!URGENT.has(ev) && now - this.last < LINE_GAP) return false;
    this.last = now;
    return true;
  }
}
