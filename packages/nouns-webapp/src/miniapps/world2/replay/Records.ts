// ── Records: what the rider sees when the server answers a record ──
//
// Every proved record (speed, air, hang time) the server answered becomes a
// card: "NEW RECORD" with REPLAY, or "RECORD NOT SAVED: <why>" with REPLAY
// and APPEAL. The ride behind it is kept (memory + IndexedDB) for replays
// and appeals. Decided appeals show up as a card on the next visit.

import type { ReplayRate, ReplayView } from './ReplayView';

import { fileAppeal, myAppeals, type AppealInfo } from '../net/Appeals';
import {
  STAT_INFO,
  type ProvedKey,
  type RecordEvent,
  type RideRun,
  type StatsTracker,
} from '../net/Stats';

import { saveRun } from './replayStore';

export interface RecordCard {
  /** Changes whenever the card does (React key / dismiss check). */
  id: number;
  kind: 'saved' | 'refused' | 'appeal';
  key: ProvedKey;
  value: number;
  reason?: string;
  run?: RideRun;
  /** Appeal progress on a refused record, or a decided appeal. */
  appeal?: {
    state: 'sending' | 'saved' | 'pending' | 'approved' | 'rejected' | 'error';
    text: string;
  };
  at: number;
}

const SEEN_KEY = 'noun-world-appeals-seen';

export const fmtRecord = (k: ProvedKey, v: number) => STAT_INFO[k].fmt(v);

export class RecordsHub {
  card: RecordCard | null = null;
  private ids = 0;
  private listeners = new Set<() => void>();
  private appealsChecked = false;

  constructor(
    private stats: StatsTracker,
    readonly replay: ReplayView,
    private getName: () => string,
  ) {
    // Back from a replay: the card it came from is there again, fresh
    replay.onStop = () => {
      if (this.card === null) return;
      this.card = { ...this.card, at: performance.now() };
      this.emit();
    };
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    for (const fn of this.listeners) fn();
  }

  private show(c: Omit<RecordCard, 'id' | 'at'>) {
    this.card = { ...c, id: ++this.ids, at: performance.now() };
    this.emit();
  }

  dismiss() {
    this.card = null;
    this.emit();
  }

  /** The server answered a record (StatsTracker.onRecord). */
  onRecord(e: RecordEvent) {
    void saveRun(e.run);
    // A refusal still waiting on the rider isn't covered by good news from the same post
    const c = this.card;
    const open = c?.kind === 'refused' && !c.appeal && performance.now() - c.at < 120_000;
    if (e.kind === 'saved' && open) return;
    this.show({ kind: e.kind, key: e.key, value: e.value, reason: e.reason, run: e.run });
  }

  /** Bring a kept record ride back as its card (REPLAY / APPEAL after a reload). */
  showRun(run: RideRun) {
    if (!run.key || run.value === undefined) return;
    this.show({
      kind: run.status === 'refused' ? 'refused' : 'saved',
      key: run.key,
      value: run.value,
      reason: run.reason,
      run,
    });
  }

  /** Replay a ride: the card's, or the last run. */
  play(run: RideRun, title: string, rate?: ReplayRate) {
    return this.replay.start(run, title, rate);
  }

  /** The ride in progress, else the last one. */
  lastRun(): RideRun | null {
    return this.stats.runs()[0] ?? null;
  }

  replayLast(rate?: ReplayRate) {
    const run = this.lastRun();
    return run !== null && this.play(run, 'YOUR LAST RUN', rate);
  }

  replayCard() {
    const c = this.card;
    if (!c?.run) return false;
    const what = fmtRecord(c.key, c.value);
    const title =
      c.kind === 'saved'
        ? `NEW RECORD · ${what}`
        : `RECORD NOT SAVED · ${what}${c.reason ? `: ${c.reason}` : ''}`;
    return this.play(c.run, title);
  }

  /**
   * APPEAL on a refused record: send it again with its ride (that alone
   * fixes a proof that never arrived), else file it for review.
   */
  async appeal() {
    const c = this.card;
    if (!c || c.kind !== 'refused' || !c.run) return;
    const set = (a: RecordCard['appeal']) => {
      if (this.card?.id === c.id) {
        this.card = { ...c, appeal: a };
        this.emit();
      }
    };
    set({ state: 'sending', text: 'SENDING IT AGAIN WITH ITS RIDE…' });
    const again = await this.stats.resubmit(c.key, c.value, c.run.samples);
    if (again.saved) return set({ state: 'saved', text: 'SAVED ✓ ON THE BOARD' });
    if (again.reason === 'offline') return set({ state: 'error', text: 'OFFLINE: NOTHING SENT' });
    const filed = await fileAppeal({
      name: this.getName(),
      key: c.key,
      value: c.value,
      d: again.d,
      reason: again.reason ?? c.reason ?? '',
    });
    if (!filed.ok) return set({ state: 'error', text: `APPEAL FAILED: ${filed.error}` });
    if (filed.saved) return set({ state: 'saved', text: 'SAVED ✓ ON THE BOARD' });
    set({ state: 'pending', text: `APPEAL FILED · PENDING REVIEW (${filed.appeal.reason})` });
  }

  /** Once per visit: show appeals decided since the rider last looked. */
  async checkAppeals() {
    if (this.appealsChecked) return;
    this.appealsChecked = true;
    let seen = 0;
    try {
      seen = Number(localStorage.getItem(SEEN_KEY)) || 0;
    } catch {
      // private mode
    }
    const list = await myAppeals();
    const decided = list
      .filter(
        (a): a is AppealInfo & { decidedAt: number } =>
          a.status !== 'pending' && (a.decidedAt ?? 0) > seen,
      )
      .sort((a, b) => b.decidedAt - a.decidedAt);
    const a = decided[0];
    if (a === undefined) return;
    try {
      localStorage.setItem(SEEN_KEY, String(a.decidedAt));
    } catch {
      // private mode
    }
    if (a.status === 'approved') this.stats.adopt(a.key, a.value);
    this.show({
      kind: 'appeal',
      key: a.key,
      value: a.value,
      appeal:
        a.status === 'approved'
          ? { state: 'approved', text: 'APPEAL APPROVED ✓ ON THE BOARD' }
          : { state: 'rejected', text: `APPEAL REJECTED${a.note ? `: ${a.note}` : ''}` },
    });
  }
}
