// ── WarfareLobby: the match browser + whichever session I'm in ─────────
//
// Owns one transport. Routes `wf:*` traffic: the open-match list and join
// replies here, everything about a match to the current WarfareSession.

import type { ModeId, MapId } from '../sim/types';

import {
  cleanName,
  newGid,
  type HumanInfo,
  type NetMatchCfg,
  type WfListing,
  type WfMsg,
  type WfTransport,
} from './protocol';
import { WarfareSession } from './session';

const JOIN_TIMEOUT_MS = 8000;
const MODES = new Set(['tdm', 'turf', 'elim', 'ffa']);
const MAPS = new Set(['nouncity', 'warehouse']);

function cleanListing(v: unknown): WfListing[] {
  if (!Array.isArray(v)) return [];
  const out: WfListing[] = [];
  for (const x of v.slice(0, 50)) {
    if (x === null || typeof x !== 'object') continue;
    const l = x as Record<string, unknown>;
    if (typeof l.gid !== 'string' || typeof l.code !== 'string') continue;
    const size = Number(l.size);
    out.push({
      gid: l.gid.slice(0, 64),
      code: l.code.slice(0, 8),
      host: cleanName(l.host),
      mode: MODES.has(l.mode as string) ? (l.mode as ModeId) : 'tdm',
      map: MAPS.has(l.map as string) ? (l.map as MapId) : 'nouncity',
      size: [2, 4, 6].includes(size) ? size : 4,
      humans: Math.max(0, Number(l.humans) | 0),
      max: Math.max(0, Number(l.max) | 0),
      status: l.status === 'live' ? 'live' : 'waiting',
    });
  }
  return out;
}

export class WarfareLobby {
  matches: WfListing[] = [];
  session: WarfareSession | null = null;
  /** Bumps on any change the UI should re-read. */
  ver = 0;
  private listeners = new Set<() => void>();
  private joining: {
    resolve: (s: WarfareSession) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(
    readonly transport: WfTransport,
    private now: () => number = () => performance.now(),
  ) {
    transport.onMessage = m => this.route(m);
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit() {
    this.ver++;
    for (const l of this.listeners) l();
  }

  get online() {
    return this.transport.online;
  }

  route(m: WfMsg) {
    switch (m.type) {
      case 'wf:matches':
        this.matches = cleanListing(m.list);
        this.emit();
        return;
      case 'wf:nojoin':
        if (this.joining !== null) this.failJoin(m.reason);
        return;
      case 'wf:welcome':
        if (this.joining !== null && m.to === this.transport.id) {
          const j = this.joining;
          this.joining = null;
          clearTimeout(j.timer);
          this.session?.leave();
          this.session = WarfareSession.join(this.transport, m, this.now);
          j.resolve(this.session);
          this.emit();
        }
        return;
      case 'wf:reject':
        if (this.joining !== null && m.to === this.transport.id) this.failJoin(m.reason);
        return;
      default:
        this.session?.onMessage(m);
    }
  }

  private failJoin(reason: string) {
    const j = this.joining;
    if (j === null) return;
    this.joining = null;
    clearTimeout(j.timer);
    j.reject(new Error(typeof reason === 'string' ? reason.slice(0, 60) : "couldn't join"));
  }

  refresh() {
    this.transport.send({ type: 'wf:list' });
  }

  host(cfg: NetMatchCfg, me: HumanInfo, pub: boolean): WarfareSession {
    this.leave();
    this.session = WarfareSession.host(this.transport, {
      cfg,
      me,
      pub,
      gid: newGid(),
      now: this.now,
    });
    this.session.onHosted = () => this.emit();
    this.emit();
    return this.session;
  }

  /** Join by code (any match) or gid (public matches from the list). */
  join(target: { code?: string; gid?: string }, me: HumanInfo): Promise<WarfareSession> {
    this.leave();
    if (this.joining !== null) this.failJoin('cancelled');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.failJoin('no answer from the host'), JOIN_TIMEOUT_MS);
      this.joining = { resolve, reject, timer };
      this.transport.send({
        type: 'wf:join',
        ...(target.code !== undefined ? { code: target.code.trim().toUpperCase() } : {}),
        ...(target.gid !== undefined ? { gid: target.gid } : {}),
        name: cleanName(me.name),
        look: me.look,
        weapons: me.weapons,
      });
    });
  }

  /**
   * QUICK PLAY: the open public match with the most humans (waiting ones
   * first), else host a public one with `fallback`.
   */
  async quickPlay(fallback: NetMatchCfg, me: HumanInfo): Promise<WarfareSession> {
    const open = this.matches
      .filter(m => m.humans < m.max)
      .sort(
        (a, b) =>
          (a.status === 'waiting' ? 0 : 1) - (b.status === 'waiting' ? 0 : 1) ||
          b.humans - a.humans,
      );
    for (const m of open.slice(0, 3)) {
      try {
        return await this.join({ gid: m.gid }, me);
      } catch {
        // try the next
      }
    }
    return this.host(fallback, me, true);
  }

  leave() {
    if (this.session !== null) {
      this.session.leave();
      this.session = null;
      this.emit();
    }
  }

  dispose() {
    this.leave();
    this.transport.onMessage = null;
    this.listeners.clear();
  }
}
