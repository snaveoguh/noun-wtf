import { FC, useCallback, useEffect, useRef, useState } from 'react';

/**
 * Procedural ambient 8-bit vaporwave music player.
 * Generates chill, emotional GameBoy-style harmonies with reverb and tape wobble.
 * No audio files — pure Web Audio API synthesis.
 * Toggle persists to localStorage.
 */

const SCALES: Record<string, number[]> = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  pentatonic: [0, 3, 5, 7, 10],
};

const CHORD_SETS: number[][][] = [
  // Emotional minor progressions
  [
    [0, 2, 4],
    [5, 0, 2],
    [3, 5, 0],
    [4, 6, 1],
  ], // i - vi - iv - v
  [
    [0, 2, 4],
    [3, 5, 0],
    [5, 0, 2],
    [4, 6, 1],
  ], // i - iv - vi - v
  [
    [0, 2, 4],
    [6, 1, 3],
    [3, 5, 0],
    [4, 6, 1],
  ], // i - VII - iv - v
  [
    [3, 5, 0],
    [0, 2, 4],
    [5, 0, 2],
    [6, 1, 3],
  ], // iv - i - vi - VII
];

const VAPOR_KEYS = [0, 2, 5, 7, 9]; // C, D, F, G, A — warm keys

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function scaleDegreeToMidi(degree: number, octave: number, key: number, scale: number[]): number {
  const octaveShift = Math.floor(degree / scale.length);
  const idx = ((degree % scale.length) + scale.length) % scale.length;
  return key + (octave + octaveShift) * 12 + scale[idx];
}

function createPulseWave(ctx: BaseAudioContext, duty: number): PeriodicWave {
  const real = new Float32Array(48);
  const imag = new Float32Array(48);
  for (let n = 1; n < 48; n++) {
    imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

function createWaveTable(ctx: BaseAudioContext): PeriodicWave {
  const real = new Float32Array(32);
  const imag = new Float32Array(32);
  for (let n = 1; n < 32; n++) {
    if (n % 2 === 1) imag[n] = (8 / (Math.PI * Math.PI * n * n)) * (n % 4 === 1 ? 1 : -1);
    if (n % 2 === 0 && n < 8) imag[n] = 0.12 / n;
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

function createReverbIR(ctx: BaseAudioContext, duration: number, decay: number): AudioBuffer {
  const length = Math.ceil(ctx.sampleRate * duration);
  const ir = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return ir;
}

interface SongState {
  key: number;
  scale: number[];
  bpm: number;
  chords: number[][];
}

function generateSong(): SongState {
  const scaleNames = Object.keys(SCALES);
  const scaleName = scaleNames[Math.floor(Math.random() * scaleNames.length)];
  return {
    key: VAPOR_KEYS[Math.floor(Math.random() * VAPOR_KEYS.length)],
    scale: SCALES[scaleName],
    bpm: 67, // locked tempo
    chords: CHORD_SETS[Math.floor(Math.random() * CHORD_SETS.length)],
  };
}

// Schedule one bar (16 steps) of ambient music
function scheduleBar(
  ctx: AudioContext,
  dest: AudioNode,
  song: SongState,
  startTime: number,
): number {
  const stepDur = 60 / song.bpm / 4;
  const { key, scale, chords } = song;
  const scaleLen = scale.length;

  // Lead — very sparse, ethereal
  const leadPattern = [
    [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0],
  ];
  const lr = leadPattern[Math.floor(Math.random() * leadPattern.length)];
  const pulseWave = createPulseWave(ctx, 0.25);

  for (let s = 0; s < 16; s++) {
    const time = startTime + s * stepDur;
    const chord = chords[Math.floor(s / 4) % chords.length];

    // Lead
    if (lr[s]) {
      const deg = chord[Math.floor(Math.random() * chord.length)] + scaleLen;
      const midi = scaleDegreeToMidi(deg, 4, key, scale);
      const freq = midiToFreq(midi);
      const dur = stepDur * 3; // Long sustain

      const gain = ctx.createGain();
      gain.connect(dest);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.06, time + 0.05);
      gain.gain.setValueAtTime(0.05, time + dur * 0.6);
      gain.gain.linearRampToValueAtTime(0, time + dur);

      const osc = ctx.createOscillator();
      osc.setPeriodicWave(pulseWave);
      osc.frequency.setValueAtTime(freq, time);
      osc.connect(gain);

      // Tape wobble
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.2 + Math.random() * 0.4;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 6;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.detune);
      lfo.start(time);
      lfo.stop(time + dur + 0.1);

      osc.start(time);
      osc.stop(time + dur);
    }
  }

  // Harmony — slow arpeggiated pad
  const harmPattern = [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0];
  const pulseWave2 = createPulseWave(ctx, 0.5);
  let arpIdx = 0;
  for (let s = 0; s < 16; s++) {
    if (!harmPattern[s]) continue;
    const time = startTime + s * stepDur;
    const chord = chords[Math.floor(s / 4) % chords.length];
    const deg = chord[arpIdx % chord.length] + scaleLen;
    arpIdx++;
    const midi = scaleDegreeToMidi(deg, 4, key, scale);
    const freq = midiToFreq(midi);
    const dur = stepDur * 2.5;

    const gain = ctx.createGain();
    gain.connect(dest);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.035, time + 0.03);
    gain.gain.setValueAtTime(0.03, time + dur * 0.5);
    gain.gain.linearRampToValueAtTime(0, time + dur);

    const osc = ctx.createOscillator();
    osc.setPeriodicWave(pulseWave2);
    osc.frequency.setValueAtTime(freq, time);
    osc.connect(gain);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.25 + Math.random() * 0.3;
    const lg = ctx.createGain();
    lg.gain.value = 5;
    lfo.connect(lg);
    lg.connect(osc.detune);
    lfo.start(time);
    lfo.stop(time + dur + 0.1);

    osc.start(time);
    osc.stop(time + dur);
  }

  // Bass — deep, sparse
  const bassPattern = [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0];
  const waveTable = createWaveTable(ctx);
  for (let s = 0; s < 16; s++) {
    if (!bassPattern[s]) continue;
    const time = startTime + s * stepDur;
    const chord = chords[Math.floor(s / 4) % chords.length];
    const midi = scaleDegreeToMidi(chord[0], 2, key, scale);
    const freq = midiToFreq(midi);
    const dur = stepDur * 6;

    const gain = ctx.createGain();
    gain.connect(dest);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.07, time + 0.04);
    gain.gain.setValueAtTime(0.06, time + dur * 0.5);
    gain.gain.linearRampToValueAtTime(0, time + dur);

    const osc = ctx.createOscillator();
    osc.setPeriodicWave(waveTable);
    osc.frequency.setValueAtTime(freq, time);
    osc.connect(gain);
    osc.start(time);
    osc.stop(time + dur);
  }

  return startTime + 16 * stepDur; // Return end time
}

const STORAGE_KEY = 'noun-ambient-music';

interface AmbientMusicProps {
  /** 'fixed' = own floating FAB at bottom-left. 'inline' = renders at flow position so parent can slot it. */
  variant?: 'fixed' | 'inline';
  /** If true and the user hasn't set a preference yet, start playing on mount. Existing off-preferences still win. */
  autoStart?: boolean;
}

const AmbientMusic: FC<AmbientMusicProps> = ({ variant = 'fixed', autoStart = false }) => {
  const [enabled, setEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'on') return true;
      if (stored === 'off') return false;
      // No preference yet — honor autoStart.
      return autoStart;
    } catch {
      return autoStart;
    }
  });
  const [started, setStarted] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const chainRef = useRef<{ input: GainNode; master: GainNode } | null>(null);
  const songRef = useRef<SongState>(generateSong());
  const nextBarTimeRef = useRef(0);
  const schedulerRef = useRef<number | null>(null);
  const barCountRef = useRef(0);

  // Persist preference
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
      /* noop */
    }
  }, [enabled]);

  const setupChain = useCallback((ctx: AudioContext) => {
    const input = ctx.createGain();
    input.gain.value = 1;

    // Warmth filter
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 2500;
    warmth.Q.value = 0.5;

    // Reverb
    const reverb = ctx.createConvolver();
    reverb.buffer = createReverbIR(ctx, 3.5, 1.0);
    const dryGain = ctx.createGain();
    dryGain.gain.value = 0.4;
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.6;

    // Delay
    const delay = ctx.createDelay(2);
    delay.delayTime.value = (60 / songRef.current.bpm) * 0.5;
    const delayFb = ctx.createGain();
    delayFb.gain.value = 0.3;
    const delayFilter = ctx.createBiquadFilter();
    delayFilter.type = 'lowpass';
    delayFilter.frequency.value = 1800;
    const delayWet = ctx.createGain();
    delayWet.gain.value = 0.25;

    // Master volume — keep it quiet for background
    const master = ctx.createGain();
    master.gain.value = 0.35;

    // Wire it up
    input.connect(warmth);
    warmth.connect(dryGain);
    warmth.connect(reverb);
    reverb.connect(wetGain);
    dryGain.connect(master);
    wetGain.connect(master);
    master.connect(delay);
    delay.connect(delayFilter);
    delayFilter.connect(delayFb);
    delayFb.connect(delay);
    delayFilter.connect(delayWet);
    delayWet.connect(ctx.destination);
    master.connect(ctx.destination);

    chainRef.current = { input, master };
    return input;
  }, []);

  const scheduleTick = useCallback(() => {
    const ctx = ctxRef.current;
    const chain = chainRef.current;
    if (!ctx || !chain) return;

    // Schedule bars ahead of time
    while (nextBarTimeRef.current < ctx.currentTime + 2) {
      // Every 8 bars, maybe switch song for variety
      if (barCountRef.current > 0 && barCountRef.current % 8 === 0) {
        songRef.current = generateSong();
      }

      nextBarTimeRef.current = scheduleBar(
        ctx,
        chain.input,
        songRef.current,
        nextBarTimeRef.current,
      );
      barCountRef.current++;
    }

    schedulerRef.current = requestAnimationFrame(scheduleTick);
  }, []);

  // Start / stop based on enabled state
  useEffect(() => {
    if (!enabled) {
      // Fade out and stop
      if (chainRef.current) {
        const master = chainRef.current.master;
        const ctx = ctxRef.current;
        if (ctx !== null && master !== null) {
          master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
          setTimeout(() => {
            if (schedulerRef.current !== null) cancelAnimationFrame(schedulerRef.current);
            ctx.close().catch(() => {});
            ctxRef.current = null;
            chainRef.current = null;
            setStarted(false);
          }, 600);
        }
      }
      return;
    }

    if (started) return;

    // Need user interaction first — register one-time listener
    const startAudio = () => {
      if (ctxRef.current) return;

      const ctx = new AudioContext();
      ctxRef.current = ctx;
      songRef.current = generateSong();
      barCountRef.current = 0;

      setupChain(ctx);

      nextBarTimeRef.current = ctx.currentTime + 0.1;
      setStarted(true);
      scheduleTick();

      document.removeEventListener('click', startAudio);
      document.removeEventListener('touchstart', startAudio);
    };

    document.addEventListener('click', startAudio, { once: false });
    document.addEventListener('touchstart', startAudio, { once: false });

    return () => {
      document.removeEventListener('click', startAudio);
      document.removeEventListener('touchstart', startAudio);
    };
  }, [enabled, started, setupChain, scheduleTick]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (schedulerRef.current !== null) cancelAnimationFrame(schedulerRef.current);
      ctxRef.current?.close().catch(() => {});
    };
  }, []);

  const fixedStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: 16,
    left: 16,
    zIndex: 9000,
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: enabled ? '2px solid rgba(185,103,255,0.6)' : '2px solid rgba(255,255,255,0.15)',
    background: enabled
      ? 'linear-gradient(135deg, rgba(255,113,206,0.2), rgba(185,103,255,0.2))'
      : 'rgba(0,0,0,0.3)',
    color: enabled ? '#ff71ce' : 'rgba(255,255,255,0.3)',
    fontSize: 16,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.3s',
    backdropFilter: 'blur(8px)',
    boxShadow: enabled ? '0 0 15px rgba(185,103,255,0.3)' : 'none',
  };

  // Slim inline variant that matches the other FAB-stack buttons (44x44, rounded 14, glass)
  const inlineStyle: React.CSSProperties = {
    width: 44,
    height: 44,
    borderRadius: 14,
    border: '1px solid rgba(255,255,255,0.4)',
    background: enabled ? 'rgba(185,103,255,0.25)' : 'rgba(255, 255, 255, 0.2)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.15) inset',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.2rem',
    color: enabled ? '#ff71ce' : 'inherit',
    transition: 'all 0.2s ease',
  };

  return (
    <button
      type="button"
      onClick={() => setEnabled(e => !e)}
      title={enabled ? 'Pause ambient music' : 'Play ambient music'}
      aria-label={enabled ? 'Pause ambient music' : 'Play ambient music'}
      style={variant === 'inline' ? inlineStyle : fixedStyle}
      onMouseEnter={e => {
        if (variant === 'inline') {
          e.currentTarget.style.background = enabled
            ? 'rgba(185,103,255,0.4)'
            : 'rgba(255, 255, 255, 0.35)';
          e.currentTarget.style.transform = 'scale(1.08)';
        }
      }}
      onMouseLeave={e => {
        if (variant === 'inline') {
          e.currentTarget.style.background = enabled
            ? 'rgba(185,103,255,0.25)'
            : 'rgba(255, 255, 255, 0.2)';
          e.currentTarget.style.transform = 'scale(1)';
        }
      }}
    >
      {enabled ? '\u23F8' : '\u25B6'}
    </button>
  );
};

export default AmbientMusic;
