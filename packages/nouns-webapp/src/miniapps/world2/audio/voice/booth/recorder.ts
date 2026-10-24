// ── Voice Booth recorder: live mic only, MediaRecorder + a level meter ────
//
// getUserMedia → MediaRecorder (opus in webm where the browser has it,
// AAC in mp4 on Safari), stopped by the player or by the clip's time limit.
// An AnalyserNode on the same stream feeds the level meter. There's no file
// input anywhere in the booth: every clip is a live recording.

/** Container/codec preference: Chrome / Firefox / Android first, then Safari. */
export const MIME_PREFS = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const;

/** The first type this browser can record ('' = let it pick). */
export function pickMime(supported: (t: string) => boolean): string {
  for (const t of MIME_PREFS) if (supported(t)) return t;
  return '';
}

/** Low bitrate: speech, and 4 s fits well under the 64 KB upload cap. */
const BITS = 32_000;

export function recorderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder === 'function' &&
    navigator.mediaDevices?.getUserMedia !== undefined
  );
}

export interface Take {
  blob: Blob;
  mime: string;
}

/**
 * Record an AudioBuffer (a chat line the player's model just spoke) into a
 * small compressed clip: played into a MediaStream destination in real time
 * (not to the speakers), so it takes the line's own length. null when this
 * browser can't record.
 */
export function recordBuffer(ctx: AudioContext, buf: AudioBuffer): Promise<Take | null> {
  if (
    typeof window === 'undefined' ||
    typeof window.MediaRecorder !== 'function' ||
    typeof ctx.createMediaStreamDestination !== 'function'
  )
    return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const dest = ctx.createMediaStreamDestination();
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      const mime = pickMime(t => MediaRecorder.isTypeSupported?.(t) === true);
      const rec = new MediaRecorder(dest.stream, {
        ...(mime !== '' ? { mimeType: mime } : {}),
        audioBitsPerSecond: BITS,
      });
      const chunks: Blob[] = [];
      rec.ondataavailable = e => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => {
        src.disconnect();
        const type = rec.mimeType || mime || 'audio/webm';
        resolve(chunks.length > 0 ? { blob: new Blob(chunks, { type }), mime: type } : null);
      };
      rec.onerror = () => resolve(null);
      src.onended = () => window.setTimeout(() => rec.state !== 'inactive' && rec.stop(), 120);
      rec.start();
      src.start();
    } catch {
      resolve(null);
    }
  });
}

export class MicRecorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private rec: MediaRecorder | null = null;
  private timer = 0;
  private buf = new Float32Array(1024);

  /** Ask for the mic (once; the stream is reused for every take). */
  async open(): Promise<void> {
    if (this.stream !== null) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      src.connect(this.analyser);
    } catch {
      this.analyser = null; // no meter, recording still works
    }
  }

  get recording(): boolean {
    return this.rec !== null && this.rec.state === 'recording';
  }

  /** 0..1 input level right now (RMS, scaled for a meter). */
  level(): number {
    const a = this.analyser;
    if (a === null) return 0;
    a.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (const v of this.buf) s += v * v;
    return Math.min(1, Math.sqrt(s / this.buf.length) * 4);
  }

  /** Start a take; resolves with the recording when it stops (by stop() or the limit). */
  async record(maxS: number): Promise<Take> {
    await this.open();
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
    const stream = this.stream!;
    const mime = pickMime(t => MediaRecorder.isTypeSupported?.(t) === true);
    const rec = new MediaRecorder(stream, {
      ...(mime !== '' ? { mimeType: mime } : {}),
      audioBitsPerSecond: BITS,
    });
    this.rec = rec;
    const chunks: Blob[] = [];
    return new Promise<Take>((resolve, reject) => {
      rec.ondataavailable = e => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onerror = () => reject(new Error('recording failed'));
      rec.onstop = () => {
        window.clearTimeout(this.timer);
        this.rec = null;
        const type = rec.mimeType || mime || chunks[0]?.type || 'audio/webm';
        resolve({ blob: new Blob(chunks, { type }), mime: type });
      };
      rec.start();
      this.timer = window.setTimeout(() => this.stop(), maxS * 1000);
    });
  }

  stop() {
    if (this.rec !== null && this.rec.state !== 'inactive') this.rec.stop();
  }

  /** Release the mic (the browser's recording indicator goes off). */
  close() {
    this.stop();
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.analyser = null;
  }
}
