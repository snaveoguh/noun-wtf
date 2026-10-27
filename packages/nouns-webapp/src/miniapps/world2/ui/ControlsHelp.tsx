// ── The controls card (H): grouped, scannable, keycaps first ─────────────
//
// One long list grew to 26 lines nobody read. Now: sections in columns
// (what you do most first), each line a keycap or two and a few words. The
// gamepad gets its own shorter set. Secrets stay secret.

export interface ControlLine {
  /** Keycaps (each string is one cap; "+" joins a chord). */
  keys: string[];
  what: string;
}
export interface ControlGroup {
  title: string;
  lines: ControlLine[];
}

export const KEYBOARD: ControlGroup[] = [
  {
    title: 'RIDE',
    lines: [
      { keys: ['W'], what: 'push' },
      { keys: ['A', 'D'], what: 'carve · spin in the air' },
      { keys: ['S'], what: 'brake · powerslide' },
      { keys: ['SPACE'], what: 'hold to crouch, let go to ollie' },
      { keys: ['F'], what: 'board on / off' },
      { keys: ['R'], what: 'respawn (fountain or van)' },
    ],
  },
  {
    title: 'TRICKS',
    lines: [
      { keys: ['J', 'L', 'K', 'U'], what: 'kickflip · heelflip · shove-it · 360' },
      { keys: ['I', 'O'], what: 'grabs' },
      { keys: ['SHIFT', 'Q'], what: 'manual · nose manual (W/S balance)' },
      { keys: ['RMB drag'], what: 'flick-it: pull down, flick up' },
      { keys: ['Y'], what: 'replay your last run' },
    ],
  },
  {
    title: 'ON FOOT',
    lines: [
      { keys: ['RIGHT-DRAG'], what: 'look around' },
      { keys: ['W', '→ wall'], what: 'climb any building (SPACE wall-jump, F let go)' },
      { keys: ['E'], what: 'go inside · talk to someone' },
    ],
  },
  {
    title: 'PARKOUR',
    lines: [
      { keys: ['SHIFT', 'SPACE'], what: 'beside a wall: wall run · at a wall: run up it' },
      { keys: ['SPACE'], what: 'on a wall: wall jump · tic-tac (A/D aims it)' },
      { keys: ['JUMP', '→ ledge'], what: 'grab it · A/D shimmy · W pull up · SPACE+dir leap' },
      { keys: ['JUMP', '→ pole'], what: 'lamp posts: slide · A/D swing · SPACE launch' },
      { keys: ['Q'], what: 'sprinting: slide · landing: roll · ledge: drop' },
      { keys: ['RUN', '→ bench'], what: 'vaults on its own' },
    ],
  },
  {
    title: 'PAINT',
    lines: [
      { keys: ['CLICK+DRAG', 'G'], what: 'spray where you point' },
      { keys: ['T', '1–0'], what: 'colour · swatch' },
      { keys: ['[ ]'], what: 'nozzle size' },
      { keys: ['⇧+CLICK'], what: 'straight line' },
      { keys: ['⌘/CTRL+Z'], what: 'undo' },
    ],
  },
  {
    title: 'WORLD',
    lines: [
      { keys: ['B'], what: 'map' },
      { keys: ['X'], what: 'missions (the Oracle by the fountain)' },
      { keys: ['C'], what: 'camera' },
      { keys: ['P'], what: 'time of day' },
      { keys: ['ALT'], what: 'hold: drag the HUD around' },
      { keys: ['ARCHES'], what: 'ride out of the city: endless downhill' },
    ],
  },
  {
    title: 'PLACES',
    lines: [
      { keys: ['E', 'cab'], what: 'drive the ice cream van (H horn, SHIFT boost)' },
      { keys: ['E', 'decks'], what: 'van DJ decks: queue a track' },
      { keys: ['E', 'cypher'], what: 'breakdance battle (plaza)' },
      { keys: ['E', 'court'], what: 'hoops (Noun Jersey)' },
    ],
  },
  {
    title: 'MUSIC & TALK',
    lines: [
      { keys: ['M'], what: 'radio: community → NOUN BEATS → off' },
      { keys: ['.'], what: 'next track' },
      { keys: ['V'], what: 'mic' },
      { keys: ['ENTER'], what: 'chat' },
    ],
  },
];

export const GAMEPAD: ControlGroup[] = [
  {
    title: 'RIDE',
    lines: [
      { keys: ['L STICK'], what: 'carve · spin' },
      { keys: ['A', 'X'], what: 'push' },
      { keys: ['B'], what: 'brake' },
      { keys: ['Y'], what: 'board on / off' },
    ],
  },
  {
    title: 'TRICKS',
    lines: [
      { keys: ['R STICK'], what: 'flick-it (down → up = ollie)' },
      { keys: ['LT', 'RT'], what: 'grabs' },
    ],
  },
  {
    title: 'ON FOOT',
    lines: [
      { keys: ['WALL'], what: 'walk into any wall to climb · A wall-jump · Y let go' },
      { keys: ['A'], what: 'by a wall: wall run · at one: run up it · ledges, poles' },
      { keys: ['B'], what: 'slide · roll on landing · drop from a ledge' },
      { keys: ['RT'], what: 'spray paint · R3 colour' },
    ],
  },
  {
    title: 'WORLD',
    lines: [{ keys: ['ARCHES'], what: 'ride out of the city: endless downhill' }],
  },
];

export function ControlsHelp({ pad }: { pad: boolean }) {
  const groups = pad ? GAMEPAD : KEYBOARD;
  return (
    <div className="w2-help pointer-events-auto absolute bottom-[76px] left-[292px] right-4 hidden max-w-[980px] md:block">
      <style>{HELP_CSS}</style>
      <div className="w2-help-head">
        <b>CONTROLS</b>
        <span>H to hide</span>
      </div>
      <div className="w2-help-grid">
        {groups.map(g => (
          <section key={g.title}>
            <h4>{g.title}</h4>
            {g.lines.map(l => (
              <div key={l.keys.join('|') + l.what} className="w2-help-line">
                <span className="w2-help-keys">
                  {l.keys.map(k => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </span>
                <span className="w2-help-what">{l.what}</span>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

const HELP_CSS = `
.w2-help{background:rgba(10,12,20,.72);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:12px 16px 14px;font-family:system-ui,sans-serif;color:#fff;max-height:calc(100vh - 200px);overflow:auto}
.w2-help-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px}
.w2-help-head b{font-size:13px;font-weight:900;letter-spacing:.16em;color:#ffd400}
.w2-help-head span{font-size:11px;opacity:.5}
.w2-help-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px 22px}
.w2-help h4{font-size:10px;font-weight:900;letter-spacing:.18em;opacity:.55;margin:0 0 5px;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:3px}
.w2-help-line{display:flex;align-items:center;gap:8px;font-size:12px;line-height:1.25;margin:3px 0}
.w2-help-keys{display:flex;flex-wrap:wrap;gap:3px;flex:none;max-width:120px}
.w2-help kbd{font:700 10px/1 system-ui,sans-serif;color:#ffd400;background:rgba(255,255,255,.08);border:1px solid rgba(255,212,0,.35);border-bottom-width:2px;border-radius:5px;padding:3px 5px;white-space:nowrap}
.w2-help-what{opacity:.88}
`;
