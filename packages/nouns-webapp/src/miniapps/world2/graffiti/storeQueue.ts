// ── Writes to the permanent graffiti store (pure: no three.js, no DOM) ──
//
// Tags go to the `world-graffiti` function one at a time, in order, and a
// failed write (network blip, function busy) is tried again with backoff
// instead of being dropped. One at a time also keeps the in-flight bodies
// under the browser's 64 KB keepalive budget: firing a burst of 8 KB tags at
// once (a flush across several walls, or old PartyKit tags carried over)
// used to get the extras rejected before they left the page.

export type PostResult = 'ok' | 'retry' | 'drop';

export interface QueuedTag {
  wallId: string;
  data: string;
}

/**
 * Where tags wait until the store has them (localStorage in the game), so
 * paint isn't lost to a closed tab or a long outage: a tag leaves the outbox
 * only once the store took it ('ok') or refused it for good ('drop').
 */
export interface Outbox {
  load(): QueuedTag[];
  save(tags: QueuedTag[]): void;
}

const sameTag = (a: QueuedTag, b: QueuedTag) => a.wallId === b.wallId && a.data === b.data;

export class StoreQueue {
  private queue: (QueuedTag & { tries: number })[] = [];
  private busy = false;
  /** Everything not yet stored, including tags parked after too many tries. */
  private unsent: QueuedTag[] = [];

  constructor(
    private post: (t: QueuedTag) => Promise<PostResult>,
    private wait: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
    private maxTries = 5,
    private outbox: Outbox | null = null,
  ) {}

  /** Re-send whatever an earlier visit couldn't store. */
  restore() {
    if (this.outbox === null) return;
    let saved: QueuedTag[] = [];
    try {
      saved = this.outbox.load();
    } catch {
      // unreadable: nothing to restore
    }
    for (const t of saved)
      if (typeof t?.wallId === 'string' && typeof t?.data === 'string') this.push(t.wallId, t.data);
  }

  /** Tags not yet in the store (queued, in flight or parked for next visit). */
  get unsentCount() {
    return this.unsent.length;
  }

  private persist() {
    try {
      this.outbox?.save(this.unsent);
    } catch {
      // storage blocked or full: the in-memory queue still has them
    }
  }

  private settle(t: QueuedTag) {
    const i = this.unsent.findIndex(u => sameTag(u, t));
    if (i >= 0) {
      this.unsent.splice(i, 1);
      this.persist();
    }
  }

  get pending() {
    return this.queue.length;
  }

  push(wallId: string, data: string) {
    const t = { wallId, data };
    if (this.queue.some(q => sameTag(q, t))) return;
    if (!this.unsent.some(u => sameTag(u, t))) {
      this.unsent.push(t);
      this.persist();
    }
    this.queue.push({ ...t, tries: 0 });
    void this.pump();
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue[0];
        let res: PostResult;
        try {
          res = await this.post(job);
        } catch {
          res = 'retry';
        }
        if (res === 'retry' && ++job.tries < this.maxTries) {
          await this.wait(Math.min(15_000, 600 * 2 ** (job.tries - 1)));
          continue;
        }
        this.queue.shift();
        // Stored or refused for good: done. Still failing: it stays in the
        // outbox and goes again on the next visit (restore()).
        if (res !== 'retry') this.settle(job);
      }
    } finally {
      this.busy = false;
    }
  }
}

/** POST one tag; a 4xx other than 409/429 means it will never be taken. */
export async function postTag(url: string, t: QueuedTag): Promise<PostResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallId: t.wallId, data: t.data }),
    keepalive: true,
  });
  if (res.ok) return 'ok';
  if (res.status >= 400 && res.status < 500 && res.status !== 409 && res.status !== 429)
    return 'drop';
  return 'retry';
}
