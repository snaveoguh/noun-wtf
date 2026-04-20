// ── Procedural Sound Effects — Retro Arcade Meets Heavy Impact ──────
//
// All sounds synthesized via Web Audio API. No external files.
// Fire-and-forget: each play* function creates nodes, schedules
// envelopes, and auto-disposes when done.
//
// ROUTING: every emitter connects to the shared `sfxBus` from
// `audioFx.ts`, which routes through a lowpass biquad to `masterGain`.
// During slomo the biquad cutoff sweeps down to muffle SFX. Voice
// (VOIP) routes through a separate `voiceBus` and never gets filtered.

import { getSfxContext, getSfxBus, getMasterGain } from './audioFx';

let masterVolume = 0.7;

function getCtx(): AudioContext {
  const ac = getSfxContext();
  // Apply the sounds.ts master volume onto the shared master gain.
  // We do this every call (cheap) so the first emitter after volume
  // changes always sees the right level.
  const master = getMasterGain();
  if (master.gain.value !== masterVolume) {
    master.gain.value = masterVolume;
  }
  return ac;
}

/** Set master volume (0-1). */
export function setMasterVolume(v: number): void {
  masterVolume = Math.max(0, Math.min(1, v));
  try {
    getMasterGain().gain.value = masterVolume;
  } catch {
    // Audio context not yet initialized — value will be applied on next play.
  }
}

export function getMasterVolume(): number {
  return masterVolume;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Create a gain node routed to the SFX bus, with optional volume multiplier. */
function makeGain(vol: number = 1): GainNode {
  const ac = getCtx();
  const g = ac.createGain();
  g.gain.value = vol;
  g.connect(getSfxBus());
  return g;
}

/** White noise buffer (cached). */
let noiseBuffer: AudioBuffer | null = null;
function getNoiseBuffer(): AudioBuffer {
  const ac = getCtx();
  if (!noiseBuffer || noiseBuffer.sampleRate !== ac.sampleRate) {
    const len = ac.sampleRate * 2; // 2 seconds of noise
    noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }
  return noiseBuffer;
}

/** Create a noise source node. */
function makeNoise(): AudioBufferSourceNode {
  const ac = getCtx();
  const src = ac.createBufferSource();
  src.buffer = getNoiseBuffer();
  src.loop = true;
  return src;
}

/** Schedule a gain envelope: instant attack, exponential decay. */
function envelope(
  gain: GainNode,
  peak: number,
  attackMs: number,
  decayMs: number,
  startTime: number,
): void {
  const g = gain.gain;
  g.setValueAtTime(0.001, startTime);
  g.linearRampToValueAtTime(peak, startTime + attackMs / 1000);
  g.exponentialRampToValueAtTime(0.001, startTime + (attackMs + decayMs) / 1000);
}

/** Auto-stop and disconnect a set of nodes after duration (ms). */
function autoCleanup(
  nodes: (AudioBufferSourceNode | OscillatorNode)[],
  gains: GainNode[],
  durationMs: number,
): void {
  const ac = getCtx();
  const stopAt = ac.currentTime + durationMs / 1000 + 0.05;
  for (const n of nodes) {
    try {
      n.stop(stopAt);
    } catch {
      /* already stopped */
    }
  }
  setTimeout(() => {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* ok */
      }
    }
    for (const g of gains) {
      try {
        g.disconnect();
      } catch {
        /* ok */
      }
    }
  }, durationMs + 100);
}

// ── Sound Generators ────────────────────────────────────────────────

/**
 * Punch — short bass thud.
 * 60Hz sine, 100ms, fast decay.
 */
export function playPunchSound(volume: number = 1): void {
  const ac = getCtx();
  const t = ac.currentTime;

  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(80, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);

  const g = makeGain(0);
  envelope(g, 0.6 * volume, 2, 98, t);

  osc.connect(g);
  osc.start(t);

  autoCleanup([osc], [g], 120);
}

/**
 * Kick — deeper thud with crack.
 * 40Hz sine + white noise burst, 150ms.
 */
export function playKickSound(volume: number = 1): void {
  const ac = getCtx();
  const t = ac.currentTime;

  // Low thud
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(50, t);
  osc.frequency.exponentialRampToValueAtTime(25, t + 0.15);

  const gOsc = makeGain(0);
  envelope(gOsc, 0.7 * volume, 3, 147, t);
  osc.connect(gOsc);
  osc.start(t);

  // Noise crack
  const noise = makeNoise();
  const hpf = ac.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 800;

  const gNoise = makeGain(0);
  envelope(gNoise, 0.35 * volume, 1, 60, t);

  noise.connect(hpf);
  hpf.connect(gNoise);
  gNoise.connect(getSfxBus());
  noise.start(t);

  autoCleanup([osc, noise], [gOsc, gNoise], 170);
}

/**
 * Headbutt — heavy impact.
 * 30Hz sine + 80Hz sine, 200ms, slow decay.
 */
export function playHeadbuttSound(volume: number = 1): void {
  const ac = getCtx();
  const t = ac.currentTime;

  // Ultra-low
  const osc1 = ac.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(35, t);
  osc1.frequency.exponentialRampToValueAtTime(20, t + 0.2);

  const g1 = makeGain(0);
  envelope(g1, 0.8 * volume, 5, 195, t);
  osc1.connect(g1);
  osc1.start(t);

  // Mid impact
  const osc2 = ac.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(90, t);
  osc2.frequency.exponentialRampToValueAtTime(50, t + 0.2);

  const g2 = makeGain(0);
  envelope(g2, 0.5 * volume, 3, 197, t);
  osc2.connect(g2);
  osc2.start(t);

  // Noise layer
  const noise = makeNoise();
  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 400;

  const gN = makeGain(0);
  envelope(gN, 0.3 * volume, 2, 80, t);
  noise.connect(lpf);
  lpf.connect(gN);
  gN.connect(getSfxBus());
  noise.start(t);

  autoCleanup([osc1, osc2, noise], [g1, g2, gN], 250);
}

/**
 * Gunshot — sharp crack.
 * White noise burst + high freq sine sweep 2000->200Hz, 100ms.
 */
export function playGunshot(volume: number = 1): void {
  const ac = getCtx();
  const t = ac.currentTime;

  // Noise burst
  const noise = makeNoise();
  const bpf = ac.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.value = 3000;
  bpf.Q.value = 0.5;

  const gN = makeGain(0);
  envelope(gN, 0.8 * volume, 1, 70, t);
  noise.connect(bpf);
  bpf.connect(gN);
  gN.connect(getSfxBus());
  noise.start(t);

  // Sine sweep
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(2000, t);
  osc.frequency.exponentialRampToValueAtTime(200, t + 0.08);

  const gO = makeGain(0);
  envelope(gO, 0.4 * volume, 1, 90, t);
  osc.connect(gO);
  osc.start(t);

  autoCleanup([noise, osc], [gN, gO], 130);
}

/**
 * Shotgun — boom.
 * Low-freq noise + 50Hz sine, 300ms with simulated reverb tail.
 */
export function playShotgunSound(volume: number = 1): void {
  const ac = getCtx();
  const t = ac.currentTime;

  // Noise boom
  const noise = makeNoise();
  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(4000, t);
  lpf.frequency.exponentialRampToValueAtTime(200, t + 0.3);

  const gN = makeGain(0);
  envelope(gN, 0.9 * volume, 2, 298, t);
  noise.connect(lpf);
  lpf.connect(gN);
  gN.connect(getSfxBus());
  noise.start(t);

  // Low sine
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(55, t);
  osc.frequency.exponentialRampToValueAtTime(30, t + 0.3);

  const gO = makeGain(0);
  envelope(gO, 0.7 * volume, 3, 297, t);
  osc.connect(gO);
  osc.start(t);

  // Reverb tail — second noise layer, delayed slightly, longer decay
  const noise2 = makeNoise();
  const lpf2 = ac.createBiquadFilter();
  lpf2.type = 'lowpass';
  lpf2.frequency.value = 1200;

  const gR = makeGain(0);
  envelope(gR, 0.25 * volume, 20, 380, t + 0.02);
  noise2.connect(lpf2);
  lpf2.connect(gR);
  gR.connect(getSfxBus());
  noise2.start(t);

  autoCleanup([noise, osc, noise2], [gN, gO, gR], 450);
}

/**
 * Footstep — subtle tap.
 * High-pass filtered noise, 50ms, very quiet.
 */
export function playFootstep(volume: number = 0.15): void {
  const ac = getCtx();
  const t = ac.currentTime;

  const noise = makeNoise();
  const hpf = ac.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 2000;

  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 5000;

  const g = makeGain(0);
  envelope(g, 0.3 * volume, 2, 48, t);

  noise.connect(hpf);
  hpf.connect(lpf);
  lpf.connect(g);
  g.connect(getSfxBus());
  noise.start(t);

  autoCleanup([noise], [g], 80);
}

/**
 * Death — low rumble + descending tone.
 */
export function playDeathSound(volume: number = 1): void {
  const ac = getCtx();
  const t = ac.currentTime;

  // Descending tone
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(300, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.5);

  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 600;

  const gO = makeGain(0);
  envelope(gO, 0.5 * volume, 5, 495, t);
  osc.connect(lpf);
  lpf.connect(gO);
  gO.connect(getSfxBus());
  osc.start(t);

  // Rumble
  const noise = makeNoise();
  const lpf2 = ac.createBiquadFilter();
  lpf2.type = 'lowpass';
  lpf2.frequency.value = 200;

  const gN = makeGain(0);
  envelope(gN, 0.4 * volume, 10, 490, t);
  noise.connect(lpf2);
  lpf2.connect(gN);
  gN.connect(getSfxBus());
  noise.start(t);

  autoCleanup([osc, noise], [gO, gN], 550);
}

/**
 * Pickup — bright ascending chime.
 * Sine sweep 400->800Hz, 200ms.
 */
export function playPickupSound(volume: number = 1): void {
  const ac = getCtx();
  const t = ac.currentTime;

  // Primary tone
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, t);
  osc.frequency.exponentialRampToValueAtTime(800, t + 0.15);

  const gO = makeGain(0);
  envelope(gO, 0.4 * volume, 5, 195, t);
  osc.connect(gO);
  osc.start(t);

  // Harmonic shimmer
  const osc2 = ac.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(800, t);
  osc2.frequency.exponentialRampToValueAtTime(1600, t + 0.15);

  const g2 = makeGain(0);
  envelope(g2, 0.15 * volume, 5, 195, t);
  osc2.connect(g2);
  osc2.start(t);

  autoCleanup([osc, osc2], [gO, g2], 250);
}

/**
 * Combo — satisfying multi-hit.
 * 3 rapid ascending tones.
 */
export function playComboSound(volume: number = 1): void {
  const ac = getCtx();
  const t = ac.currentTime;

  const freqs = [500, 700, 1000];
  const nodes: OscillatorNode[] = [];
  const gains: GainNode[] = [];

  for (let i = 0; i < 3; i++) {
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freqs[i];

    const g = makeGain(0);
    const offset = i * 0.06;
    envelope(g, 0.3 * volume, 2, 55, t + offset);

    osc.connect(g);
    osc.start(t + offset);

    nodes.push(osc);
    gains.push(g);
  }

  autoCleanup(nodes, gains, 250);
}

/**
 * Jump — whoosh.
 * Filtered noise sweep, 200ms.
 */
export function playJumpSound(volume: number = 0.4): void {
  const ac = getCtx();
  const t = ac.currentTime;

  const noise = makeNoise();
  const bpf = ac.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.setValueAtTime(400, t);
  bpf.frequency.exponentialRampToValueAtTime(2000, t + 0.15);
  bpf.Q.value = 2;

  const g = makeGain(0);
  envelope(g, 0.3 * volume, 5, 195, t);

  noise.connect(bpf);
  bpf.connect(g);
  g.connect(getSfxBus());
  noise.start(t);

  autoCleanup([noise], [g], 250);
}

/**
 * Block — metallic clang.
 * High sine + harmonics, 100ms.
 */
export function playBlockSound(volume: number = 1): void {
  const ac = getCtx();
  const t = ac.currentTime;

  const fundamentals = [1200, 2400, 3600];
  const vols = [0.4, 0.2, 0.1];
  const nodes: OscillatorNode[] = [];
  const gains: GainNode[] = [];

  for (let i = 0; i < fundamentals.length; i++) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = fundamentals[i];
    // Slight detuning for metallic quality
    osc.detune.value = (i - 1) * 15;

    const g = makeGain(0);
    envelope(g, vols[i] * volume, 1, 99, t);

    osc.connect(g);
    osc.start(t);

    nodes.push(osc);
    gains.push(g);
  }

  // Noise transient for the "clang" attack
  const noise = makeNoise();
  const hpf = ac.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 4000;

  const gN = makeGain(0);
  envelope(gN, 0.25 * volume, 1, 30, t);
  noise.connect(hpf);
  hpf.connect(gN);
  gN.connect(getSfxBus());
  noise.start(t);

  nodes.push(noise as unknown as OscillatorNode);
  gains.push(gN);

  autoCleanup(nodes as any[], gains, 130);
}

// ── Spatial Audio ───────────────────────────────────────────────────

/**
 * Play a sound with distance-based attenuation.
 * @param soundFn - One of the play* functions
 * @param x,y,z - Sound source position
 * @param lx,ly,lz - Listener position
 * @param maxDist - Distance at which sound is inaudible (default 50)
 */
export function playSoundAt(
  soundFn: (volume?: number) => void,
  x: number,
  y: number,
  z: number,
  lx: number,
  ly: number,
  lz: number,
  maxDist: number = 50,
): void {
  const dx = x - lx;
  const dy = y - ly;
  const dz = z - lz;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (distance >= maxDist) return; // too far to hear

  // Inverse-distance falloff (clamped)
  const attenuation = Math.max(0, 1 - distance / maxDist);
  // Square for more natural falloff
  const vol = attenuation * attenuation;

  soundFn(vol);
}
