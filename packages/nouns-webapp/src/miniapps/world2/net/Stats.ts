// ── Noun World stats: records, lifetime totals, how many people played ──
//
// The world-stats Netlify function keeps one row per rider (a random
// per-browser id, so everyone on the default name isn't one row): records
// that only ever go up (top speed, best combo, best session, highest jump,
// hang time, longest grind, furthest downhill) and lifetime totals (km
// skated, tricks landed, time played), plus site-wide session counts.
//
// StatsTracker watches the rider each frame, keeps this browser's bests in
// localStorage, and posts what changed every ~20 s and when the page hides.

import type { Player } from '../skate/Player';
import type { ComboState } from '../skate/Tricks';

const URL_ = '/.netlify/functions/world-stats';
const RIDER_KEY = 'noun-world-rider-id';
const BEST_KEY = 'noun-world-stats-best';
// Bests kept before the stats board existed
const OLD_KMH_KEY = 'noun-world-fastest-kmh';
const OLD_COMBO_KEY = 'noun-world-best-combo';
const OLD_COMBO_LABEL_KEY = 'noun-world-best-combo-label';

export type BestKey = 'kmh' | 'combo' | 'session' | 'airM' | 'airS' | 'grindM' | 'downM';
export type AddKey = 'km' | 'tricks' | 'playS';
export type StatKey = BestKey | AddKey;

export interface StatRow {
  name: string;
  value: number;
  label?: string;
  at: number;
}

export interface WorldStats {
  riders: number;
  sessions: number;
  days: Record<string, number>;
  boards: Partial<Record<StatKey, StatRow[]>>;
}

export interface MyBests {
  best: Partial<Record<BestKey, number>>;
  comboLabel: string;
}

/** Display metadata for each board. */
export const STAT_INFO: Record<
  StatKey,
  { tab: string; title: string; fmt: (v: number) => string }
> = {
  kmh: { tab: 'SPEED', title: 'Top speed', fmt: v => `${Math.round(v)} km/h` },
  combo: { tab: 'COMBO', title: 'Best combo', fmt: v => `${Math.round(v).toLocaleString()} pts` },
  session: {
    tab: 'SESSION',
    title: 'Best session',
    fmt: v => `${Math.round(v).toLocaleString()} pts`,
  },
  airM: { tab: 'AIR', title: 'Highest jump', fmt: v => `${v.toFixed(1)} m` },
  airS: { tab: 'HANG', title: 'Longest hang time', fmt: v => `${v.toFixed(2)} s` },
  grindM: { tab: 'GRIND', title: 'Longest grind', fmt: v => `${Math.round(v)} m` },
  downM: { tab: 'DOWNHILL', title: 'Furthest downhill', fmt: v => `${(v / 1000).toFixed(2)} km` },
  km: { tab: 'KM', title: 'Distance skated (all time)', fmt: v => `${v.toFixed(1)} km` },
  tricks: {
    tab: 'TRICKS',
    title: 'Tricks landed (all time)',
    fmt: v => Math.round(v).toLocaleString(),
  },
  playS: {
    tab: 'TIME',
    title: 'Time played (all time)',
    fmt: v => (v >= 3600 ? `${(v / 3600).toFixed(1)} h` : `${Math.round(v / 60)} min`),
  },
};

function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    // private mode etc.
  }
}

/** Random id per browser: one row per rider, whatever their name. */
function riderId(): string {
  let id = load(RIDER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    save(RIDER_KEY, id);
  }
  return id;
}

function loadBests(): MyBests {
  try {
    const raw = load(BEST_KEY);
    if (raw) return JSON.parse(raw) as MyBests;
  } catch {
    // fall through
  }
  const best: MyBests['best'] = {};
  const kmh = Number(load(OLD_KMH_KEY));
  if (kmh > 0) best.kmh = kmh;
  const combo = Number(load(OLD_COMBO_KEY));
  if (combo > 0) best.combo = combo;
  return { best, comboLabel: load(OLD_COMBO_LABEL_KEY) ?? '' };
}

export async function fetchStats(): Promise<WorldStats | null> {
  try {
    const res = await fetch(URL_, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as WorldStats;
  } catch {
    return null;
  }
}

export class StatsTracker {
  mine: MyBests = loadBests();
  /** Something new to post (a raised best or lifetime deltas). */
  private dirty = true;
  private sessionPosted = false;
  /** Only games that actually reached the world count as a session. */
  private started = false;
  private posting = false;
  private flushAcc = 0;
  private add = { km: 0, tricks: 0, playS: 0 };
  // Air / grind in progress
  private airStartY: number | null = null;
  private airMaxY = 0;
  private airT = 0;
  private grindM = 0;
  private lastBankedAt = -1;
  private disposers: (() => void)[] = [];

  constructor(
    private getName: () => string,
    private isOffline: () => boolean,
  ) {
    // Last chance to send totals when the tab closes or backgrounds
    const onHide = () => {
      if (document.visibilityState === 'hidden') this.flush(true);
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    this.disposers.push(
      () => document.removeEventListener('visibilitychange', onHide),
      () => window.removeEventListener('pagehide', onHide),
    );
  }

  dispose() {
    this.flush(true);
    for (const d of this.disposers) d();
  }

  private raise(k: BestKey, v: number) {
    if (!(v > (this.mine.best[k] ?? 0))) return false;
    this.mine.best[k] = v;
    this.dirty = true;
    return true;
  }

  /** Call every frame while in the world. */
  update(dt: number, p: Player, combo: ComboState, downM: number) {
    this.started = true;
    this.add.playS += dt;
    if (p.mode === 'board' && p.state !== 'bail') {
      this.add.km += (p.speed * dt) / 1000;
      this.raise('kmh', Math.round(p.speed * 3.6 * 10) / 10);
    }
    if (downM > 0) this.raise('downM', downM);

    // Air: height above take-off and time aloft, per jump
    if (p.state === 'air') {
      if (this.airStartY === null) {
        this.airStartY = p.pos.y;
        this.airMaxY = p.pos.y;
        this.airT = 0;
      }
      this.airT += dt;
      this.airMaxY = Math.max(this.airMaxY, p.pos.y);
    } else if (this.airStartY !== null) {
      if (p.state !== 'bail') {
        this.raise('airM', Math.round((this.airMaxY - this.airStartY) * 100) / 100);
        this.raise('airS', Math.round(this.airT * 100) / 100);
      }
      this.airStartY = null;
    }

    // Grind: length of each one
    if (p.state === 'grind') this.grindM += p.speed * dt;
    else if (this.grindM > 0) {
      this.raise('grindM', Math.round(this.grindM * 10) / 10);
      this.grindM = 0;
    }

    // Banked combos: best combo, best session, tricks landed
    const b = combo.lastBanked;
    if (b !== null && b.at !== this.lastBankedAt) {
      this.lastBankedAt = b.at;
      if (!b.bailed) {
        this.add.tricks += b.label ? b.label.split(' + ').length : 0;
        this.dirty = true;
        if (this.raise('combo', b.points)) this.mine.comboLabel = b.label;
      }
    }
    this.raise('session', combo.session);

    this.flushAcc += dt;
    if (this.flushAcc >= 20) {
      this.flushAcc = 0;
      this.flush(false);
    }
  }

  /** Post records + lifetime deltas. `beacon` for page hide (fire and forget). */
  flush(beacon: boolean) {
    if (!this.started) return;
    save(BEST_KEY, JSON.stringify(this.mine));
    if (this.isOffline() || this.posting || (!this.dirty && this.sessionPosted)) return;
    const add = {
      km: Math.round(this.add.km * 1000) / 1000,
      tricks: this.add.tricks,
      playS: Math.round(this.add.playS),
    };
    const body = JSON.stringify({
      rider: riderId(),
      name: this.getName(),
      session: !this.sessionPosted,
      best: this.mine.best,
      comboLabel: this.mine.comboLabel,
      add,
    });
    const sent = () => {
      this.sessionPosted = true;
      this.dirty = false;
      this.add.km -= add.km;
      this.add.tricks -= add.tricks;
      this.add.playS -= add.playS;
    };
    if (beacon && navigator.sendBeacon?.(URL_, body)) {
      sent();
      return;
    }
    this.posting = true;
    void fetch(URL_, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      .then(res => {
        if (res.ok) sent();
      })
      .catch(() => undefined)
      .finally(() => {
        this.posting = false;
      });
  }
}
