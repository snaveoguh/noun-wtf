// ── Noun Warfare online: wire messages ─────────────────────────────────
//
// Everything rides PartyKit room `noun-warfare` (packages/nouns-party,
// warfareRelay.ts). The host's browser runs the authoritative WarfareSim;
// the room is a registry + relay. Shapes here are what goes over the wire
// (all JSON, numbers quantised by codec.ts).

import type { Difficulty, MapId, ModeId, TeamSize } from '../sim/types';
import type { WeaponId } from '../sim/weapons';

export const WF_ROOM = 'noun-warfare';

/** What a client needs to build the same match locally. */
export interface NetMatchCfg {
  mode: ModeId;
  map: MapId;
  teamSize: TeamSize;
  difficulty: Difficulty;
  seed: number;
  target?: number;
  timeLimit?: number;
}

/** Per slot: who's in it. Bots have id ''. */
export interface RosterSlot {
  id: string;
  name: string;
  look: string;
  bot: boolean;
  weapons: WeaponId[];
  /** Round-trip to the relay (ms), humans only (-1 unknown). */
  ping: number;
}

export type NetStatus = 'waiting' | 'live';

export interface WfListing {
  gid: string;
  code: string;
  host: string;
  mode: string;
  map: string;
  size: number;
  humans: number;
  max: number;
  status: NetStatus;
}

export interface HumanInfo {
  name: string;
  look: string;
  weapons: WeaponId[];
}

export type WfMsg =
  // lobby
  | { type: 'wf:list' }
  | { type: 'wf:matches'; list: WfListing[] }
  | {
      type: 'wf:host';
      gid: string;
      pub: boolean;
      mode: ModeId;
      map: MapId;
      size: TeamSize;
      name: string;
    }
  | { type: 'wf:hosted'; gid: string; code: string }
  | { type: 'wf:meta'; gid: string; humans: number; status: NetStatus }
  | {
      type: 'wf:join';
      gid?: string;
      code?: string;
      /** Set by the relay. */
      from?: string;
      name: string;
      look: string;
      weapons: string[];
    }
  | { type: 'wf:nojoin'; reason: string }
  | {
      type: 'wf:welcome';
      gid: string;
      to: string;
      code: string;
      pub: boolean;
      cfg: NetMatchCfg;
      slot: number;
      roster: RosterSlot[];
      status: NetStatus;
      /** Set by the relay (the host's id). */
      from?: string;
    }
  | { type: 'wf:reject'; gid: string; to: string; reason: string }
  // match
  | {
      type: 'wf:in';
      gid: string;
      /** Seq of the last input in `i` (the ones before count down). */
      q: number;
      /** INPUT_FIELDS numbers per tick, oldest first. */
      i: number[];
      /** My ping to the relay (ms), now and then. */
      pg?: number;
      /** Set by the relay. */
      id?: string;
    }
  | {
      type: 'wf:s';
      gid: string;
      d: number[];
      /** Packed events since the last snapshot. */
      e?: unknown[][];
      /** Projectile births since the last snapshot. */
      b?: number[];
    }
  | { type: 'wf:roster'; gid: string; roster: RosterSlot[]; status: NetStatus }
  | { type: 'wf:end'; gid: string }
  | { type: 'wf:leave'; gid: string }
  | { type: 'wf:left'; gid: string; id: string; host: string }
  | { type: 'wf:ping'; t: number }
  | { type: 'wf:pong'; t: number };

export interface WfTransport {
  /** My connection id. */
  readonly id: string;
  readonly online: boolean;
  send(m: WfMsg): void;
  onMessage: ((m: WfMsg) => void) | null;
}

/** Client-side clamp for names coming off the wire (the relay does too). */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return 'NOUN';
  const s = v
    .replace(/[^\p{L}\p{N} _.\-!?#⌐◨]/gu, '')
    .trim()
    .slice(0, 16);
  return s === '' ? 'NOUN' : s;
}

const SHARE_ORIGIN = () =>
  typeof window !== 'undefined' ? window.location.origin : 'https://noun.wtf';

export function shareUrl(code: string): string {
  return `${SHARE_ORIGIN()}/warfare?join=${encodeURIComponent(code)}`;
}

export function newGid(): string {
  const r = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `wf-${Date.now().toString(36)}-${r}`;
}
