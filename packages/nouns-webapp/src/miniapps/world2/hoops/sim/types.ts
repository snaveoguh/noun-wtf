// hoops/sim internals: everything beyond the public SimState that the sim
// needs to resume exactly. Plain JSON only (it rides in SimState.sim).

import type { BallerAction, DunkStyle, TeamId } from '../contract';

export interface Ratings {
  speed: number;
  shooting: number;
  dunking: number;
  defense: number;
  passing: number;
}

export type BotIntent =
  | 'idle'
  | 'clear'
  | 'drive'
  | 'probe'
  | 'spot'
  | 'cut'
  | 'screen'
  | 'crash'
  | 'chase'
  | 'guard'
  | 'help'
  | 'boxout'
  | 'receive'
  | 'back';

export interface Brain {
  /** Sim time of the next decision. */
  next: number;
  /** Reaction delay (s). */
  react: number;
  intent: BotIntent;
  tx: number;
  tz: number;
  sprint: boolean;
  spot: number;
  /** Timed button presses (sim time; -1 = none). */
  jumpAt: number;
  stealAt: number;
  shootAt: number;
  passAt: number;
  moveAt: number;
  passTo: string;
  alley: boolean;
  /** Jumper: release when the meter reaches this. */
  release: number;
  /** Hold the shoot button this step (rebound / contest jumps are one tap). */
  holdShoot: boolean;
  /** Intent timers. */
  until: number;
  nextCut: number;
  /** Anti-stuck. */
  stuckT: number;
  lx: number;
  lz: number;
  sideT: number;
  side: number;
  /** Shot we already reacted to (shooter id + tick), so bots jump once. */
  sawShot: string;
  /** Calling for the ball until. */
  callUntil: number;
  /** On-ball guard distance (-1 = off the ball). */
  gap: number;
}

export interface PInt {
  id: string;
  rate: Ratings;
  act: BallerAction;
  /** Elapsed / total of the current action (s). */
  at: number;
  dur: number;
  /** Scripted jump: elapsed, duration, height, hang shape. */
  jt: number;
  jdur: number;
  jh: number;
  jhang: boolean;
  /** Previous button levels: 1 shoot, 2 pass, 4 move. */
  btn: number;
  cdMove: number;
  cdSteal: number;
  cdCatch: number;
  cdJump: number;
  /** Ball hand: +1 right, -1 left. */
  hand: number;
  /** Dribble phase 0..1 (floor at 0.5). */
  drib: number;
  /** Time spent in the current gather. */
  gather: number;
  meter: number;
  streak: number;
  onFire: boolean;
  stamina: number;
  calling: boolean;
  /** Scripted glide (layup / dunk / alley-oop): from, to, slam / release point (0..1). */
  mx0: number;
  mz0: number;
  mx1: number;
  mz1: number;
  slamAt: number;
  slammed: boolean;
  style: DunkStyle | '';
  /** Alley-oop catch: has the ball arrived. */
  oopCaught: boolean;
  /** Pre-pause target spot (scored / turnover jog). */
  sx: number;
  sz: number;
  /** Index into the other team of the man this player guards. */
  mark: number;
  brain: Brain;
}

export interface PassInt {
  from: string;
  to: string;
  alley: boolean;
  t: number;
  dur: number;
  /** Defenders who already rolled for the interception. */
  rolled: string[];
}

export type ShotKind = 'jumper' | 'layup' | 'dunk' | 'alleyoop';

export interface ShotInt {
  by: string;
  team: TeamId;
  value: number;
  kind: ShotKind;
  rim: 0 | 1;
  touchedRim: boolean;
  touchedBoard: boolean;
  t: number;
  /** Can still score. */
  live: boolean;
  /** Defenders who already tried to block it. */
  rolled: string[];
  /** Uncleared half-court offense (a make won't count). */
  unclear: boolean;
  three: boolean;
  assist: string;
}

export interface SimInternal {
  v: 1;
  rng: number;
  cleared: boolean;
  lastTouch: TeamId;
  /** Continuous time the current holder has had the ball. */
  heldT: number;
  holdBy: string;
  looseT: number;
  stuckBallT: number;
  pass: PassInt | null;
  shot: ShotInt | null;
  /** Last completed pass (for assists). */
  assistFrom: string;
  assistT: number;
  /** Team that checks next after the pause. */
  nextTeam: TeamId;
  players: PInt[];
}
