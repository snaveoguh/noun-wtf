// ── Messages between TtsEngine (main thread) and tts.worker ──────────────

export type TtsIn =
  | { t: 'init'; modelUrl: string; configUrl: string }
  /** A player's own trained voice (Voice Booth), from bytes held in this browser. */
  | { t: 'init-bytes'; model: ArrayBuffer; config: string }
  | {
      t: 'synth';
      id: number;
      text: string;
      speaker: number;
      scales: [number, number, number];
      /** Silence between sentences (s, in the synthesized clip). */
      gap: number;
    };

export type TtsOut =
  | { t: 'progress'; loaded: number; total: number }
  | { t: 'ready'; ms: number; bytes: number; cached: boolean; speakers: number }
  | { t: 'error'; message: string }
  | { t: 'audio'; id: number; pcm: Float32Array; sampleRate: number; ms: number }
  | { t: 'fail'; id: number; message: string };
