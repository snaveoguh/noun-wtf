// ── NOUN FM: where to cut a short "sting" out of a longer interlude ──────
//
// Pure (no imports) so the build script (scripts/fm-audio.ts, run by node
// with type stripping) and vitest share it. Given a mono signal, pick the
// `maxS`-second window that sounds most like a station sting:
//   - it starts on a strong onset (a hit, the vocal "Noun F-M"), never in
//     the middle of a held note,
//   - it's loud on average (the hook, not an intro pad),
//   - it ends quieter than it peaks (so the 300 ms fade-out sounds natural),
//   - earlier is slightly better (the call sign usually comes first).

export interface StingCut {
  /** Seconds into the source. */
  start: number;
  /** Seconds long (≤ maxS). */
  length: number;
}

/** RMS per hop (seconds per frame = hop / sr). */
export function frameEnergy(x: ArrayLike<number>, hop: number): Float64Array {
  const n = Math.floor(x.length / hop);
  const out = new Float64Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) s += x[i]! * x[i]!;
    out[f] = Math.sqrt(s / hop);
  }
  return out;
}

/** Positive log-energy flux: how sharply each frame gets louder than the ones before it. */
export function onsetStrength(e: ArrayLike<number>): Float64Array {
  const out = new Float64Array(e.length);
  const db = (v: number) => 20 * Math.log10(v + 1e-6);
  for (let i = 1; i < e.length; i++) {
    // compare with the max of the previous 3 frames so a slow swell doesn't count
    let prev = 0;
    for (let k = 1; k <= 3 && i - k >= 0; k++) prev = Math.max(prev, e[i - k]!);
    out[i] = Math.max(0, db(e[i]!) - db(prev));
  }
  return out;
}

/**
 * Choose the sting window. `x` mono samples at `sr` Hz. Files no longer
 * than `maxS` are used whole (minus leading silence).
 */
export function chooseStingCut(x: ArrayLike<number>, sr: number, maxS = 4.3): StingCut {
  const hop = Math.max(1, Math.round(sr * 0.02)); // 20 ms frames
  const fs = hop / sr;
  const e = frameEnergy(x, hop);
  const n = e.length;
  const dur = x.length / sr;
  let peak = 0;
  for (const v of e) peak = Math.max(peak, v);
  if (n === 0 || peak <= 0) return { start: 0, length: Math.min(dur, maxS) };
  // leading silence: first frame within 40 dB of the peak
  let first = 0;
  while (first < n && e[first]! < peak * 0.01) first++;
  const win = Math.round(maxS / fs);
  if (n - first <= win) {
    const start = first * fs;
    return { start, length: Math.min(maxS, dur - start) };
  }
  const on = onsetStrength(e);
  let onMax = 0;
  for (const v of on) onMax = Math.max(onMax, v);
  // prefix sums for the mean energy of any window
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i]! + e[i]!;
  const tail = Math.max(1, Math.round(0.4 / fs)); // the last 400 ms (the fade)
  let best = first;
  let bestScore = -Infinity;
  for (let s = first; s + win <= n; s++) {
    const mean = (pre[s + win]! - pre[s]!) / win / peak;
    const endMean = (pre[s + win]! - pre[s + win - tail]!) / tail / peak;
    // the onset can sit a frame or two after the cut point
    let o = 0;
    for (let k = 0; k < 3 && s + k < n; k++) o = Math.max(o, on[s + k]!);
    const onset = onMax > 0 ? o / onMax : 0;
    const score = 0.45 * mean + 0.35 * onset + 0.15 * (1 - endMean) - 0.05 * (s / n);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  // back off a frame so the attack's transient isn't clipped
  const start = Math.max(0, (best - 1) * fs);
  return { start, length: Math.min(maxS, dur - start) };
}
