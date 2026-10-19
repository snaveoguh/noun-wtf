// ── The authored scenes (pure data, built once) ─────────────────────────
//
// Each is written in its anchor's frame (timeline.ts): x across, y up, z the
// way the anchor faces. Spoken lines are laid out back to back from the
// speaker's voice timing (voiceParams.lineDuration), and the camera moves are
// placed around them, so a slower voice makes a longer scene, never a cut-off
// line.
//
//   oracle    first meeting: slow push-in on her table, the crystal ball lights
//   keymaker  accepting his line: the keys, a crane down the GO DOWN alley
//   twins     the race start: line-up, countdown, whip-pan down the line
//   door      the deepest door: push through, red flash, the world drains
//   one       10,000 km/h: time stops, the camera circles the rider

import { npcVoice } from '../audio/voice/cast';
import { lineDuration } from '../audio/voice/voiceParams';
import { NPCS, type NpcId } from '../missions/defs';
import { SEEN_IDS } from '../missions/progress';

import { duration, type CamPose, type Script, type Step } from './timeline';

/** The scenes (their seen-flags live in the missions store: progress.ts SEEN_IDS). */
export const SCENE_IDS = SEEN_IDS;
export type SceneId = (typeof SCENE_IDS)[number];
export const isSceneId = (x: unknown): x is SceneId =>
  typeof x === 'string' && (SCENE_IDS as readonly string[]).includes(x);

/** Journal names. */
export const SCENE_TITLES: Record<SceneId, string> = {
  oracle: 'The Oracle',
  keymaker: 'The Keymaker',
  twins: 'The Twins',
  door: 'The deepest door',
  one: 'The One',
};

/** What each scene centres on (CutscenePlayer finds it in the world). */
export const SCENE_ANCHOR: Record<SceneId, NpcId | 'door' | 'rider'> = {
  oracle: 'oracle',
  keymaker: 'keymaker',
  twins: 'twins',
  door: 'door',
  one: 'rider',
};

/** Lines back to back from `at`; returns the steps and when the last one ends. */
export function sayChain(
  at: number,
  who: NpcId,
  lines: readonly string[],
  idPrefix: string,
  gap = 0.2,
): { steps: Step[]; end: number; starts: number[] } {
  const v = npcVoice(who);
  const steps: Step[] = [];
  const starts: number[] = [];
  let t = at;
  lines.forEach((text, i) => {
    const dur = lineDuration(text, v, 0.8);
    starts.push(t);
    steps.push({
      k: 'say',
      at: t,
      dur,
      speaker: NPCS[who].name,
      text,
      voice: who,
      lineId: `${idPrefix}.${i}`,
    });
    t += dur + gap;
  });
  return { steps, end: t - gap, starts };
}

const pose = (pos: CamPose['pos'], look: CamPose['look'], fov: number): CamPose => ({
  pos,
  look,
  fov,
});

/** Close a scene: bars out and an ease back to the gameplay camera, ending it at `end`. */
function outro(end: number, blend = 1): Step[] {
  return [
    { k: 'bars', at: end - blend * 0.9, on: false, dur: blend * 0.7 },
    { k: 'blendOut', at: end - blend, dur: blend },
  ];
}

// ── The Oracle: first meeting ──

function oracle(): Script {
  const lines = sayChain(
    1.2,
    'oracle',
    [
      'Oh, you’re here.',
      'Sit, if you like. Have a cookie.',
      'You’ll feel right as rain.',
      'I know why you came: you want to know if the hill is real.',
      'Let’s find out what you can do first.',
    ],
    'oracle.first',
  );
  const [, l2, l3, l4] = lines.starts as [number, number, number, number, number];
  const end = lines.end + 1.4;
  const wide = pose([3.0, 2.6, 6.0], [0, 1.3, 0.5], 45);
  const table = pose([1.1, 1.5, 3.0], [0, 1.05, 0.6], 40);
  const face = pose([0.36, 1.6, 2.67], [0, 1.5, 0.3], 34);
  return {
    id: 'oracle',
    title: 'The Oracle',
    steps: [
      { k: 'bars', at: 0, on: true, dur: 0.7 },
      { k: 'music', at: 0, cue: 'oracle', dur: end },
      { k: 'act', at: 0.3, who: 'oracle', do: 'look' },
      { k: 'shot', at: 0, dur: 2.6, from: 'start', to: wide, ease: 'inOut' },
      // The slow push-in on her table
      { k: 'shot', at: 2.6, dur: l3 - 2.6, from: wide, to: table, ease: 'inOut' },
      // The crystal ball wakes
      { k: 'cue', at: l2 + 0.4, name: 'oracleGlow', dur: 2 },
      { k: 'sfx', at: l2 + 0.4, id: 'crystal-hum', gain: 0.5 },
      { k: 'sfx', at: l2 + 0.9, id: 'crystal-chime', gain: 0.6 },
      { k: 'shot', at: l3, dur: l4 + 1.2 - l3, from: table, to: face, ease: 'inOut' },
      // ...and a slow drift round her as she sends you off
      {
        k: 'orbit',
        at: l4 + 1.2,
        dur: end - (l4 + 1.2),
        centre: [0, 1.5, 0.3],
        radius: 2.4,
        height: 0.1,
        from: 0.15,
        to: -0.32,
        fov: 34,
      },
      { k: 'shake', at: 0, dur: end, amp: 0.012 },
      { k: 'sfx', at: l4, id: 'crystal-chime', gain: 0.35, rate: 0.8 },
      ...lines.steps,
      { k: 'act', at: end - 1.2, who: 'oracle', do: 'release' },
      ...outro(end, 1.1),
    ],
  };
}

// ── The Keymaker: accepting his line ──

function keymaker(): Script {
  const lines = sayChain(
    1.4,
    'keymaker',
    [
      'Then it’s agreed.',
      'The deepest door is forty-two kilometres down the GO DOWN line.',
      'Ride to the bottom of the bowl. The key will know you.',
    ],
    'keymaker.accept',
  );
  const [, l2, l3] = lines.starts as [number, number, number];
  const end = lines.end + 1.2;
  const front = pose([1.0, 1.9, 3.6], [0, 1.5, -0.2], 44);
  const crane0 = pose([0.2, 2.6, 1.6], [-2, 1.7, -12], 48);
  // GO DOWN alley runs out behind him, a little to his left (local -x)
  const crane1 = pose([-4.5, 4.5, -4], [-5, 0, -120], 52);
  // The orbit below starts behind him (angle π) at this pose
  const behind = pose([0, 1.9, -3.0], [0, 1.5, 0], 44);
  return {
    id: 'keymaker',
    title: 'The Keymaker',
    steps: [
      { k: 'bars', at: 0, on: true, dur: 0.6 },
      { k: 'music', at: 0, cue: 'keys', dur: end },
      { k: 'act', at: 0.2, who: 'keymaker', do: 'look' },
      { k: 'shot', at: 0, dur: l2, from: 'start', to: front, ease: 'inOut' },
      { k: 'sfx', at: 0.9, id: 'coins', gain: 0.7, rate: 1.15 },
      { k: 'act', at: l2 - 0.4, who: 'keymaker', do: 'wave' },
      // Up and over his shoulder, down the alley to where the door is
      { k: 'shot', at: l2, dur: 0.9, from: front, to: crane0, ease: 'inOut' },
      { k: 'sfx', at: l2, id: 'whoosh', gain: 0.4 },
      { k: 'shot', at: l2 + 0.9, dur: l3 - l2 - 0.9, from: crane0, to: crane1, ease: 'inOut' },
      { k: 'shot', at: l3, dur: 0.7, from: crane1, to: behind, ease: 'whip' },
      { k: 'sfx', at: l3, id: 'whoosh', gain: 0.5, rate: 1.3 },
      {
        k: 'orbit',
        at: l3 + 0.7,
        dur: end - (l3 + 0.7),
        centre: [0, 1.5, 0],
        radius: 3.0,
        height: 0.4,
        from: Math.PI,
        to: 0.4,
        fov: 42,
        ease: 'inOut',
      },
      { k: 'sfx', at: end - 1.6, id: 'mission-accept', gain: 0.6 },
      { k: 'shake', at: 0, dur: end, amp: 0.01 },
      ...lines.steps,
      { k: 'act', at: end - 1, who: 'keymaker', do: 'release' },
      ...outro(end, 1),
    ],
  };
}

// ── The Twins: the race start (exactly as long as the race countdown) ──

/** The race's countdown (s), MissionSystem.startRace: the scene ends on GO. */
export const RACE_COUNT = 3;

function twins(): Script {
  // Line-up, a dolly along them, the whip down the line
  const lineup = pose([0, 0.9, 6.5], [0, 1.3, 0], 48);
  const along = pose([3.8, 1.2, 3.2], [-0.5, 1.3, 0], 44);
  const down = pose([1.4, 2.0, -2.0], [0, -3, 60], 62);
  const T = RACE_COUNT;
  return {
    id: 'twins',
    title: 'The Twins',
    steps: [
      { k: 'bars', at: 0, on: true, dur: 0.35 },
      { k: 'shot', at: 0, dur: 0.9, from: 'start', to: lineup, ease: 'out' },
      { k: 'shot', at: 0.9, dur: 1.1, from: lineup, to: along, ease: 'inOut' },
      { k: 'shot', at: 2.0, dur: 0.55, from: along, to: down, ease: 'whip' },
      { k: 'sfx', at: 2.0, id: 'whoosh', gain: 0.6, rate: 1.4 },
      { k: 'title', at: 0, dur: 0.9, text: '3' },
      { k: 'sfx', at: 0, id: 'beep' },
      { k: 'title', at: 1, dur: 0.9, text: '2' },
      { k: 'sfx', at: 1, id: 'beep' },
      { k: 'title', at: 2, dur: 0.9, text: '1' },
      { k: 'sfx', at: 2, id: 'beep' },
      { k: 'title', at: T - 0.05, dur: 0.45, text: 'GO!' },
      { k: 'sfx', at: T - 0.05, id: 'go' },
      { k: 'sfx', at: T - 0.05, id: 'cut-hit', gain: 0.5 },
      {
        k: 'say',
        at: 0.1,
        dur: 1.7,
        speaker: NPCS.twins.name,
        text: 'We go when you go.',
        voice: 'twins',
        lineId: 'twins.race.0',
      },
      { k: 'shake', at: 0, dur: T + 0.4, amp: 0.02 },
      ...outro(T + 0.4, 0.6),
    ],
  };
}

// ── The deepest door: into the Upside Down ──

function door(): Script {
  const behind = pose([0.6, 2.2, 6.0], [0, 1.4, 0], 50);
  const through = pose([0, 1.3, -0.9], [0, 1.25, -7], 82);
  // The far side, looking back at the door (the flash hides the cut)
  const far0 = pose([1.7, 0.8, -2.6], [0, 1.4, 1.5], 56);
  const far1 = pose([-1.1, 1.15, -3.4], [0, 1.3, 1.5], 50);
  const end = 5.3;
  return {
    id: 'door',
    title: 'The deepest door',
    steps: [
      { k: 'bars', at: 0, on: true, dur: 0.6 },
      { k: 'music', at: 0, cue: 'door', dur: end },
      { k: 'shot', at: 0, dur: 1.4, from: 'start', to: behind, ease: 'inOut' },
      { k: 'cue', at: 0.5, name: 'doorGlow', dur: 2 },
      { k: 'sfx', at: 0.55, id: 'door-creak', gain: 0.9 },
      { k: 'shot', at: 1.4, dur: 1.0, from: behind, to: through, ease: 'in' },
      { k: 'sfx', at: 1.75, id: 'whoosh', gain: 0.7, rate: 0.8 },
      { k: 'flash', at: 2.3, dur: 0.7, color: '#c81d25', peak: 0.95 },
      { k: 'sfx', at: 2.27, id: 'cut-boom', gain: 0.9 },
      { k: 'cue', at: 2.32, name: 'enterUD', must: true },
      { k: 'sfx', at: 2.5, id: 'ud-accent', gain: 0.8 },
      { k: 'shot', at: 2.4, dur: 2.2, from: far0, to: far1, ease: 'out' },
      { k: 'title', at: 2.8, dur: 1.9, text: 'THE UPSIDE DOWN', sub: 'nothing here counts' },
      { k: 'shake', at: 1.4, dur: 1.2, amp: 0.03 },
      { k: 'shake', at: 2.4, dur: end - 2.4, amp: 0.015 },
      ...outro(end, 0.9),
    ],
  };
}

// ── The One: 10,000 km/h ──

function one(): Script {
  const lines = sayChain(
    1.7,
    'oracle',
    ['You didn’t come here to be told you’re The One.', 'You came to find out.'],
    'oracle.one',
  );
  const end = Math.max(6.8, lines.end + 1.1);
  return {
    id: 'one',
    title: 'The One',
    steps: [
      { k: 'time', at: 0, scale: 0 },
      { k: 'bars', at: 0, on: true, dur: 0.45 },
      { k: 'flash', at: 0, dur: 0.35, color: '#ffffff', peak: 0.7 },
      { k: 'sfx', at: 0, id: 'cut-hit', gain: 0.8 },
      { k: 'music', at: 0.1, cue: 'one', dur: end - 0.1 },
      { k: 'sfx', at: 0.8, id: 'sparkle', gain: 0.8 },
      { k: 'sfx', at: 1.5, id: 'crystal-chime', gain: 0.5 },
      {
        k: 'orbit',
        at: 0,
        dur: end - 0.9,
        centre: [0, 1.4, 0],
        radius: 4.2,
        height: 0.5,
        from: Math.PI * 0.85,
        to: Math.PI * 0.85 - 4.2,
        fov: 52,
        ease: 'inOut',
      },
      { k: 'title', at: 0.8, dur: Math.min(5, end - 1.9), text: 'THE ONE', sub: '10,000 km/h' },
      ...lines.steps,
      { k: 'time', at: end - 1.0, scale: 1, dur: 0.4 },
      { k: 'flash', at: end - 0.9, dur: 0.5, color: '#ffffff', peak: 0.45 },
      ...outro(end, 0.9),
    ],
  };
}

const BUILD: Record<SceneId, () => Script> = { oracle, keymaker, twins, door, one };
const built = new Map<SceneId, Script>();

export function scene(id: SceneId): Script {
  let s = built.get(id);
  if (s === undefined) {
    s = BUILD[id]();
    built.set(id, s);
  }
  return s;
}

/** Seconds a scene runs. */
export const sceneLength = (id: SceneId) => duration(scene(id));
