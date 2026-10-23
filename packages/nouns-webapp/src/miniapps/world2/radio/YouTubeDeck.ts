// ── YouTube on NOUN FM: the official IFrame Player API, nothing else ────
//
// YouTube tracks are never downloaded, extracted, proxied or played
// hidden. A real embedded player sits in a visible "deck screen" (at least
// 200×200 px) while it plays; YouTube decides and shows its own ads and we
// never touch them. If the screen is closed or hidden (unmounted, tab in
// the background, the world paused under the NounOS desk) the video stops.

interface YTPlayer {
  loadVideoById(o: { videoId: string; startSeconds?: number }): void;
  cueVideoById(o: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(s: number, allowSeekAhead: boolean): void;
  setVolume(v: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData?: () => { title?: string; author?: string; video_id?: string };
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    o: {
      width: number | string;
      height: number | string;
      videoId?: string;
      playerVars?: Record<string, number | string>;
      events?: {
        onReady?: () => void;
        onStateChange?: (e: { data: number }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YTPlayer;
}

/** Minimum size YouTube requires for an embedded player. */
export const YT_MIN_PX = 200;
export const YT_PLAYING = 1;

let apiP: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (apiP !== null) return apiP;
  apiP = new Promise<YTNamespace>((resolve, reject) => {
    const w = window as unknown as {
      YT?: YTNamespace & { loaded?: number };
      onYouTubeIframeAPIReady?: () => void;
    };
    if (w.YT?.Player !== undefined) {
      resolve(w.YT);
      return;
    }
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (w.YT !== undefined) resolve(w.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => {
      apiP = null;
      reject(new Error("couldn't load the YouTube player"));
    };
    document.head.appendChild(s);
  });
  return apiP;
}

export class YouTubeDeck {
  private host: HTMLElement | null = null;
  private slot: HTMLDivElement | null = null;
  private player: YTPlayer | null = null;
  private ready = false;
  private pending: { id: string; at: number; cue: boolean } | null = null;
  videoId = '';
  /** Last error code from the player (101/150 = embedding disabled by the owner). */
  error: number | null = null;
  onState?: (state: number) => void;
  /** The player refused the video (see `error` for the code). */
  onError?: (code: number) => void;
  private volume = 0.6;

  /** The visible screen element is ready (React mounted it). */
  mount(el: HTMLElement) {
    if (this.host === el) return;
    this.unmount();
    this.host = el;
  }

  /** The screen is gone: the video must stop. */
  unmount() {
    try {
      this.player?.destroy();
    } catch {
      // already gone
    }
    this.player = null;
    this.ready = false;
    this.slot?.remove();
    this.slot = null;
    this.host = null;
    this.videoId = '';
    this.pending = null;
  }

  get mounted(): boolean {
    return this.host !== null;
  }

  /** Play `id` from `at` seconds. Refuses (false) without a visible screen. */
  play(id: string, at: number, cue = false): boolean {
    const host = this.host;
    if (host === null || !host.isConnected) return false;
    const r = host.getBoundingClientRect();
    if (r.width < YT_MIN_PX || r.height < YT_MIN_PX) return false;
    this.error = null;
    if (this.player !== null && this.ready) {
      if (this.videoId === id) {
        if (!cue) this.player.playVideo();
        return true;
      }
      this.videoId = id;
      if (cue) this.player.cueVideoById({ videoId: id, startSeconds: at });
      else this.player.loadVideoById({ videoId: id, startSeconds: at });
      return true;
    }
    this.videoId = id;
    this.pending = { id, at, cue };
    if (this.player !== null) return true; // still booting
    const slot = document.createElement('div');
    host.appendChild(slot);
    this.slot = slot;
    void loadApi()
      .then(YT => {
        if (this.slot !== slot) return;
        this.player = new YT.Player(slot, {
          width: '100%',
          height: '100%',
          playerVars: {
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            controls: 1,
            origin: location.origin,
          },
          events: {
            onReady: () => {
              this.ready = true;
              this.player?.setVolume(Math.round(this.volume * 100));
              const p = this.pending;
              this.pending = null;
              if (p !== null) {
                if (p.cue) this.player?.cueVideoById({ videoId: p.id, startSeconds: p.at });
                else this.player?.loadVideoById({ videoId: p.id, startSeconds: p.at });
              }
            },
            onStateChange: e => this.onState?.(e.data),
            onError: e => {
              this.error = e.data;
              this.onError?.(e.data);
            },
          },
        });
      })
      .catch(() => {
        this.error = -1;
        this.onError?.(-1);
      });
    return true;
  }

  pause() {
    try {
      if (this.ready) this.player?.pauseVideo();
    } catch {
      // fine
    }
  }

  stop() {
    try {
      if (this.ready) this.player?.stopVideo();
    } catch {
      // fine
    }
    this.videoId = '';
    this.pending = null;
  }

  seek(s: number) {
    if (this.ready) this.player?.seekTo(s, true);
  }

  setVolume(v: number) {
    const c = Math.max(0, Math.min(1, v));
    if (Math.abs(c - this.volume) < 0.01) return;
    this.volume = c;
    if (this.ready) this.player?.setVolume(Math.round(c * 100));
  }

  get state(): number {
    try {
      return this.ready ? (this.player?.getPlayerState() ?? -1) : -1;
    } catch {
      return -1;
    }
  }

  get time(): number {
    try {
      return this.ready ? (this.player?.getCurrentTime() ?? 0) : 0;
    } catch {
      return 0;
    }
  }

  /** Duration + title once a cued/loaded video is known (0 / '' until then). */
  info(): { dur: number; title: string; artist: string } {
    try {
      if (!this.ready || this.player === null) return { dur: 0, title: '', artist: '' };
      const d = this.player.getVideoData?.() ?? {};
      return { dur: this.player.getDuration() || 0, title: d.title ?? '', artist: d.author ?? '' };
    } catch {
      return { dur: 0, title: '', artist: '' };
    }
  }
}
