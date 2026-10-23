// ── WAV encoding + resample length math (pure) ───────────────────────────
//
// The voice dataset export (dataset.ts) writes LJSpeech-style WAVs: 22050 Hz,
// mono, 16-bit PCM, which is what Piper's trainer expects.

/** Piper's training sample rate. */
export const DATASET_RATE = 22050;

/** Samples after resampling `srcLen` samples from `srcRate` to `dstRate`. */
export function resampledLength(srcLen: number, srcRate: number, dstRate: number): number {
  if (srcLen <= 0 || srcRate <= 0 || dstRate <= 0) return 0;
  return Math.max(1, Math.ceil((srcLen * dstRate) / srcRate));
}

/** Sample range [start, end) of a trim window (s) in a buffer of `len` samples. */
export function trimRange(t0: number, t1: number, rate: number, len: number): [number, number] {
  const a = Math.max(0, Math.min(len, Math.floor(t0 * rate)));
  const b = Math.max(a, Math.min(len, Math.ceil(t1 * rate)));
  return [a, b];
}

/** Mono float samples → a 16-bit PCM WAV file (gain applied, clipped). */
export function encodeWav(samples: Float32Array, rate: number, gain = 1): Uint8Array {
  const n = samples.length;
  const out = new Uint8Array(44 + n * 2);
  const dv = new DataView(out.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i);
  };
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true); // byte rate
  dv.setUint16(32, 2, true); // block align
  dv.setUint16(34, 16, true); // bits
  str(36, 'data');
  dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]! * gain));
    dv.setInt16(44 + i * 2, v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff), true);
  }
  return out;
}
