// ── MOCHI's little sounds (synthesized; through the sfx bus, so mute applies) ──

import type { Sfx } from '../audio/sfx/Sfx';

type Kind = 'squeak' | 'happy' | 'poof' | 'hop' | 'snore' | 'adopt';

/** A squeak: a short sine blip that slides up then down (mouse-sized). */
function blip(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  f0: number,
  f1: number,
  len: number,
  level: number,
) {
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + len * 0.45);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + len + 0.02);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
  };
}

function hiss(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  len: number,
  level: number,
  f0: number,
  f1: number,
) {
  const n = Math.max(1, Math.floor(ctx.sampleRate * len));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f1, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(level, t + len * 0.15);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
  src.onended = () => {
    src.disconnect();
    bp.disconnect();
    g.disconnect();
  };
}

/** Play one of the pet's sounds. `level` 0..1 (distance falloff is the caller's). */
export function petSound(sfx: Sfx, kind: Kind, level = 1) {
  if (level <= 0.01) return;
  sfx.voice((ctx, out) => {
    const t = ctx.currentTime;
    const v = 0.22 * level;
    const r = 0.92 + Math.random() * 0.16;
    switch (kind) {
      case 'squeak':
        blip(ctx, out, t, 1900 * r, 3100 * r, 0.12, v);
        break;
      case 'happy':
        blip(ctx, out, t, 1700 * r, 2900 * r, 0.09, v);
        blip(ctx, out, t + 0.11, 2100 * r, 3500 * r, 0.09, v);
        blip(ctx, out, t + 0.22, 2500 * r, 4200 * r, 0.14, v);
        break;
      case 'adopt':
        blip(ctx, out, t, 1500, 2600, 0.12, v);
        blip(ctx, out, t + 0.14, 1900, 3300, 0.12, v);
        blip(ctx, out, t + 0.28, 2400, 4400, 0.2, v * 1.1);
        break;
      case 'hop':
        blip(ctx, out, t, 2600 * r, 3200 * r, 0.05, v * 0.5);
        break;
      case 'poof':
        hiss(ctx, out, t, 0.32, v * 1.4, 2400, 500);
        blip(ctx, out, t + 0.12, 2200 * r, 3600 * r, 0.1, v * 0.8);
        break;
      case 'snore':
        hiss(ctx, out, t, 0.9, v * 0.35, 380, 220);
        break;
    }
  });
}
