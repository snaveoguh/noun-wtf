// ── Noun Golf view: build in frame slices (pure) ────────────────────────
//
// Work is a queue of generator jobs. run(budget) steps the front job until
// it's done or the frame's budget is spent, checking the clock after every
// yield; a job yields every row or so, so one frame never pays for more
// than a slice of it. Jobs are re-prioritised by the caller (nearest
// region first) through `priority`.

export interface SliceJob {
  id: string;
  /** Lower runs first (e.g. the distance to the viewer). */
  priority: number;
  /** Created on first run. */
  start: () => Iterator<void>;
  /** Called once the generator finishes. */
  done?: () => void;
  it?: Iterator<void>;
  ms?: number;
}

export class SliceQueue {
  private jobs: SliceJob[] = [];
  /** Longest single run() (ms) and the total, for the dev handle. */
  maxMs = 0;
  totalMs = 0;
  /** Finished jobs. */
  finished = 0;
  /** How long the last finished job took, summed over its slices (ms). */
  lastJobMs = 0;
  /** The longest single step (between two yields) seen, and whose. */
  worstStep = { id: '', ms: 0 };

  constructor(private now: () => number = () => performance.now()) {}

  get length() {
    return this.jobs.length;
  }

  has(id: string): boolean {
    return this.jobs.some(j => j.id === id);
  }

  push(job: SliceJob) {
    this.jobs.push(job);
  }

  /** Drop jobs (a region that went out of range before it was built). */
  remove(pred: (j: SliceJob) => boolean) {
    this.jobs = this.jobs.filter(j => !pred(j));
  }

  clear() {
    this.jobs.length = 0;
  }

  /** Re-rank the queue (a started job keeps going first). */
  sort(rank?: (j: SliceJob) => number) {
    if (rank !== undefined) for (const j of this.jobs) if (j.it === undefined) j.priority = rank(j);
    this.jobs.sort(
      (a, b) =>
        (a.it !== undefined ? -1 : 0) - (b.it !== undefined ? -1 : 0) || a.priority - b.priority,
    );
  }

  /** Step jobs for at most `budgetMs`. Returns ms spent. */
  run(budgetMs: number): number {
    const t0 = this.now();
    while (this.jobs.length > 0) {
      const j = this.jobs[0];
      const s0 = this.now();
      j.it ??= j.start();
      let finished = false;
      while (true) {
        const a = this.now();
        const r = j.it.next();
        const step = this.now() - a;
        if (step > this.worstStep.ms) this.worstStep = { id: j.id, ms: step };
        if (r.done === true) {
          finished = true;
          break;
        }
        if (this.now() - t0 >= budgetMs) break;
      }
      j.ms = (j.ms ?? 0) + (this.now() - s0);
      if (finished) {
        this.jobs.shift();
        this.finished++;
        this.lastJobMs = j.ms;
        const a = this.now();
        j.done?.();
        const step = this.now() - a;
        if (step > this.worstStep.ms) this.worstStep = { id: `${j.id}:done`, ms: step };
      }
      if (this.now() - t0 >= budgetMs) break;
    }
    const ms = this.now() - t0;
    this.totalMs += ms;
    this.maxMs = Math.max(this.maxMs, ms);
    return ms;
  }
}
