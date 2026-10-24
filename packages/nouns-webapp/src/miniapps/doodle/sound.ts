/**
 * Doodle Garden sounds: tiny WebAudio synth (no files) plus the browser's
 * speech voice for counting out loud.
 */

const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let musicTimer: number | null = null;

const audio = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (Ctor === undefined) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
};

/** Call from a tap/click so mobile browsers allow sound. */
export const unlockAudio = () => {
  audio();
};

export const setMuted = (m: boolean) => {
  muted = m;
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.55, ctx.currentTime, 0.02);
  if (m && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
};

export const isMuted = () => muted;

const tone = (
  freq: number,
  dur: number,
  type: OscillatorType = 'sine',
  vol = 0.3,
  when = 0,
  slideTo?: number,
) => {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
};

/** Bell that climbs the scale as the count goes up. */
export const sfxCatch = (n: number) => {
  const f = PENTA[n % PENTA.length];
  tone(f, 0.5, 'sine', 0.35);
  tone(f * 2, 0.3, 'triangle', 0.08);
};

export const sfxPop = () => {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime;
  const len = Math.floor(a.sampleRate * 0.12);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = a.createBufferSource();
  src.buffer = buf;
  const g = a.createGain();
  g.gain.value = 0.5;
  src.connect(g).connect(master);
  src.start(t);
  tone(900, 0.12, 'sine', 0.25, 0, 300);
};

export const sfxBoing = () => tone(180, 0.35, 'sine', 0.35, 0, 700);
export const sfxJump = () => tone(300, 0.2, 'triangle', 0.18, 0, 800);

export const sfxFanfare = () => {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    tone(f, 0.35, 'triangle', 0.22, i * 0.12);
    tone(f / 2, 0.35, 'sine', 0.12, i * 0.12);
  });
  tone(1046.5, 0.9, 'sine', 0.25, 0.5);
  tone(1318.51, 0.9, 'sine', 0.18, 0.5);
};

// Gentle background tune: a looping pentatonic melody, quiet under the sfx.
const TUNE = [0, 2, 4, 2, 3, 4, 5, -1, 4, 3, 2, 0, 1, 2, 0, -1];
export const startMusic = () => {
  if (musicTimer !== null || typeof window === 'undefined') return;
  let step = 0;
  musicTimer = window.setInterval(() => {
    const n = TUNE[step % TUNE.length];
    if (n >= 0) tone(PENTA[n] / 2, 0.45, 'triangle', 0.06);
    if (step % 4 === 0) tone(PENTA[[0, 3, 4, 0][(step / 4) % 4]] / 4, 0.8, 'sine', 0.07);
    step++;
  }, 330);
};

export const stopMusic = () => {
  if (musicTimer !== null) window.clearInterval(musicTimer);
  musicTimer = null;
};

/** Say something out loud (counting, cheering). Silently skipped if unsupported. */
export const say = (text: string) => {
  if (muted || typeof speechSynthesis === 'undefined') return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.pitch = 1.3;
    u.rate = 1.05;
    u.volume = 1;
    speechSynthesis.speak(u);
  } catch {
    // no voice available
  }
};
