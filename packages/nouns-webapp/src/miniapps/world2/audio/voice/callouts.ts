// ── The rider's own callouts: what they shout, and when ──────────────────
//
// Pure. A bank of lines per event (a bail, going fast, a new personal best),
// each with a clean alternative where it swears. CalloutBrain decides when a
// callout fires: one cooldown per event, at least 30 s between any two, never
// the same line twice running, and speed only once per run (it re-arms after
// you slow right down).

export type CalloutEvent = 'bail' | 'speed' | 'record';

export interface CalloutLine {
  say: string;
  /** What clean mode says instead (lines with no swearing have none). */
  clean?: string;
}

export const CALLOUTS: Record<CalloutEvent, readonly CalloutLine[]> = {
  bail: [
    { say: 'Ahh, shit!', clean: 'Ahh, shoot!' },
    { say: 'Ow!' },
    { say: 'My ankle!' },
    { say: 'Oof. That hurt.' },
    { say: 'Damn it!', clean: 'Dang it!' },
    { say: 'Shit shit shit!', clean: 'Nope nope nope!' },
    { say: 'Oh no no no!' },
    { say: 'Not again!' },
    { say: 'Ow, my everything.' },
    { say: 'Son of a bitch!', clean: 'Son of a gun!' },
  ],
  speed: [
    { say: "Let's gooo!" },
    { say: 'Speed demon!' },
    { say: 'Hell yeah, send it!', clean: 'Yeah, send it!' },
    { say: 'Woo! Full send!' },
    { say: 'Wheeee!' },
    { say: "Holy shit, I'm flying!", clean: "Holy moly, I'm flying!" },
    { say: 'Nobody can catch me!' },
  ],
  record: [
    { say: 'Fuck yeah, baby!', clean: 'Heck yeah, baby!' },
    { say: 'New record, baby!' },
    { say: 'Hell yeah! Personal best!', clean: 'Oh yeah! Personal best!' },
    { say: 'Write that down!' },
    // Two beats: each sentence is synthesized on its own with a real pause
    // between (piperText.sentences); the "..." makes it the long one
    { say: "Who's the goat?... Me." },
    { say: 'Fuck yes! Fuck yes!', clean: 'Yes! Yes! Yes!' },
  ],
};

const SWEARS = /\b(shit|fuck\w*|damn|hell|bitch\w*|ass|bollocks|crap|piss\w*)\b/i;

/** Does a line swear? */
export const isProfane = (text: string) => SWEARS.test(text);

/** The text to say for a line in the current mode. */
export const lineText = (l: CalloutLine, clean: boolean) => (clean ? (l.clean ?? l.say) : l.say);

/** Every line an event can say in this mode (what gets pre-synthesized). */
export function bank(ev: CalloutEvent, clean: boolean): string[] {
  return CALLOUTS[ev].map(l => lineText(l, clean));
}

/** Seconds before the same event may fire again. */
export const COOLDOWN: Record<CalloutEvent, number> = { bail: 45, speed: 60, record: 30 };
/** Seconds between any two callouts (the rider talks rarely; lines inside it are dropped). */
export const GAP = 30;
/** Speed callout fires crossing UP km/h, re-arms below DOWN. */
export const SPEED_UP_KMH = 50;
export const SPEED_DOWN_KMH = 28;

export class CalloutBrain {
  clean = false;
  private last: Record<CalloutEvent, number> = {
    bail: -Infinity,
    speed: -Infinity,
    record: -Infinity,
  };
  private lastAny = -Infinity;
  private lastLine: Partial<Record<CalloutEvent, number>> = {};
  private speedArmed = true;

  constructor(private rand: () => number = Math.random) {}

  /** Try an event at time `now` (s). Returns the line to say, or null. */
  fire(ev: CalloutEvent, now: number): string | null {
    if (now - this.last[ev] < COOLDOWN[ev]) return null;
    if (now - this.lastAny < GAP) return null;
    const lines = CALLOUTS[ev];
    let i = Math.floor(this.rand() * lines.length) % lines.length;
    if (lines.length > 1 && i === this.lastLine[ev]) i = (i + 1) % lines.length;
    this.lastLine[ev] = i;
    this.last[ev] = now;
    this.lastAny = now;
    return lineText(lines[i]!, this.clean);
  }

  /** Feed the rider's speed every frame: fires once on crossing the threshold. */
  speed(kmh: number, now: number): string | null {
    if (kmh < SPEED_DOWN_KMH) {
      this.speedArmed = true;
      return null;
    }
    if (!this.speedArmed || kmh < SPEED_UP_KMH) return null;
    const line = this.fire('speed', now);
    if (line !== null) this.speedArmed = false;
    return line;
  }
}
