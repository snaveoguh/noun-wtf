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

export class StoreQueue {
  private queue: (QueuedTag & { tries: number })[] = [];
  private busy = false;

  constructor(
    private post: (t: QueuedTag) => Promise<PostResult>,
    private wait: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
    private maxTries = 5,
  ) {}

  get pending() {
    return this.queue.length;
  }

  push(wallId: string, data: string) {
    if (this.queue.some(q => q.wallId === wallId && q.data === data)) return;
    this.queue.push({ wallId, data, tries: 0 });
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
