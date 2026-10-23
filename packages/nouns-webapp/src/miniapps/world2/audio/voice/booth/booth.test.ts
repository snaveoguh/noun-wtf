import { describe, expect, it } from 'vitest';

import { CALLOUTS, CalloutBrain } from '../callouts';

import {
  allClipKeys,
  analyseClip,
  bleep,
  chatSwears,
  boothLines,
  CLIP_MAX_BYTES,
  clipKey,
  MAX_CLIPS,
  parseClipKey,
  pickSource,
  playableClips,
  progress,
  resolveCallout,
  SOURCE_ORDER,
  validateClip,
  validateClipBytes,
} from './clips';
import { looksLikeOnnx, validatePiperConfig } from './piperConfig';
import { TRAIN_PROMPTS } from './trainPrompts';
import { DATASET_RATE, encodeWav, resampledLength, trimRange } from './wav';
import { crc32, zipStore } from './zip';

const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
const MP4 = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
const goodClip = {
  key: 'bail.0',
  mime: 'audio/webm;codecs=opus',
  t0: 0.1,
  t1: 1.2,
  gain: 2,
  dur: 1.5,
};

describe('clip keys and booth lines', () => {
  it('keys round-trip to their lines, clean alternatives get .c', () => {
    expect(clipKey('bail', 0, false)).toBe('bail.0');
    expect(clipKey('bail', 0, true)).toBe('bail.0.c');
    // A line without a clean version keeps its plain key in clean mode
    expect(clipKey('bail', 1, true)).toBe('bail.1');
    expect(parseClipKey('bail.0.c')).toEqual({
      ev: 'bail',
      index: 0,
      clean: true,
      text: CALLOUTS.bail[0]!.clean,
    });
    for (const bad of ['bail.1.c', 'bail.99', 'jump.0', 'bail.0;', '../x', 7, null])
      expect(parseClipKey(bad)).toBeNull();
  });

  it('every key fits under the server cap', () => {
    const keys = allClipKeys();
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBeLessThanOrEqual(MAX_CLIPS);
    for (const k of keys) expect(parseClipKey(k)).not.toBeNull();
  });

  it('clean mode lists clean lines, swears only on request', () => {
    const clean = boothLines(true, false);
    expect(clean.some(l => /shit|fuck/i.test(l.text))).toBe(false);
    const both = boothLines(true, true);
    expect(both.length).toBeGreaterThan(clean.length);
    expect(both.filter(l => l.swear).every(l => !l.key.endsWith('.c'))).toBe(true);
    const spicy = boothLines(false, false);
    expect(spicy.length).toBe(clean.length);
    expect(spicy.every(l => !l.key.endsWith('.c'))).toBe(true);
    expect(progress(clean, new Set(['bail.0.c', 'bail.0']))).toEqual({
      done: 1,
      total: clean.length,
    });
  });

  it('the brain remembers which line fired (and keeps the 30 s gap)', () => {
    const b = new CalloutBrain(() => 0);
    b.clean = true;
    expect(b.fire('bail', 0)).toBe(CALLOUTS.bail[0]!.clean);
    expect(b.lastPick).toEqual({ ev: 'bail', index: 0, clean: true, text: 'Ahh, shoot!' });
    expect(b.fire('record', 10)).toBeNull();
    expect(b.fire('record', 30)).not.toBeNull();
  });
});

describe('clip validation and limits', () => {
  it('accepts a good upload, strips codec params', () => {
    const v = validateClip(goodClip);
    expect(v.ok && v.value.mime).toBe('audio/webm');
  });

  it('refuses unknown lines, bad types, overlong clips and bad trims', () => {
    for (const bad of [
      { ...goodClip, key: 'nope.1' },
      { ...goodClip, mime: 'audio/wav' },
      { ...goodClip, mime: 'text/html' },
      { ...goodClip, dur: 9 },
      { ...goodClip, dur: 6, t0: 0.5, t1: 5 }, // 4.5 s of speech
      { ...goodClip, t1: 0.05 },
      { ...goodClip, t1: 3 },
      { ...goodClip, gain: 0 },
      { ...goodClip, gain: 50 },
    ])
      expect(validateClip(bad).ok).toBe(false);
  });

  it('checks the bytes: size cap and container magic', () => {
    expect(validateClipBytes(WEBM, 'audio/webm').ok).toBe(true);
    expect(validateClipBytes(MP4, 'audio/mp4').ok).toBe(true);
    expect(validateClipBytes(MP4, 'audio/webm').ok).toBe(false);
    expect(validateClipBytes(new Uint8Array(0), 'audio/webm').ok).toBe(false);
    const big = new Uint8Array(CLIP_MAX_BYTES + 1);
    big.set(WEBM);
    expect(validateClipBytes(big, 'audio/webm').ok).toBe(false);
  });

  it('trims silence and normalises the level', () => {
    const rate = 8000;
    const s = new Float32Array(rate * 2);
    // 0.5 s .. 1.25 s of a quiet tone, silence around it
    for (let i = 4000; i < 10000; i++) s[i] = 0.2 * Math.sin(i / 3);
    const a = analyseClip(s, rate)!;
    expect(a.dur).toBe(2);
    expect(a.t0).toBeGreaterThan(0.4);
    expect(a.t0).toBeLessThan(0.5);
    expect(a.t1).toBeGreaterThan(1.25);
    expect(a.t1).toBeLessThan(1.35);
    expect(a.gain).toBeCloseTo(0.89 / 0.2, 1);
    expect(analyseClip(new Float32Array(8000), rate)).toBeNull();
  });

  it('a late stop (busy device) still plays at most the limit', () => {
    const rate = 8000;
    const s = new Float32Array(rate * 6);
    for (let i = 0; i < s.length; i++) s[i] = 0.3 * Math.sin(i / 3);
    const a = analyseClip(s, rate, 4)!;
    expect(a.dur).toBe(6);
    expect(a.t1 - a.t0).toBeLessThanOrEqual(4);
    expect(validateClip({ ...goodClip, ...a }).ok).toBe(true);
  });
});

describe('who says a line: recording > local model > TTS', () => {
  it('follows the order', () => {
    expect(SOURCE_ORDER).toEqual(['recording', 'local-model', 'tts']);
    const all = { hasClip: true, allowClip: true, localModel: true, tts: true };
    expect(pickSource(all)).toBe('recording');
    expect(pickSource({ ...all, allowClip: false })).toBe('local-model');
    expect(pickSource({ ...all, hasClip: false })).toBe('local-model');
    expect(pickSource({ ...all, hasClip: false, localModel: false })).toBe('tts');
    expect(
      pickSource({ hasClip: false, allowClip: true, localModel: false, tts: false }),
    ).toBeNull();
  });

  it('a remote callout plays their clip, else falls back to TTS text', () => {
    const clips = { 'bail.0': {}, 'speed.1': {} };
    const base = { allowClip: true, tts: true, clips, listenerClean: false };
    expect(resolveCallout({ ...base, ev: 'bail', index: 0, clean: false })).toEqual({
      key: 'bail.0',
      text: 'Ahh, shit!',
      source: 'recording',
    });
    expect(resolveCallout({ ...base, ev: 'bail', index: 2, clean: false })?.source).toBe('tts');
    // Muted custom voices
    expect(
      resolveCallout({ ...base, allowClip: false, ev: 'bail', index: 0, clean: false })?.source,
    ).toBe('tts');
    // A clean listener never hears the swear clip
    expect(
      resolveCallout({ ...base, listenerClean: true, ev: 'bail', index: 0, clean: false }),
    ).toEqual({ key: 'bail.0.c', text: 'Ahh, shoot!', source: 'tts' });
    expect(resolveCallout({ ...base, ev: 'bail', index: 42, clean: false })).toBeNull();
  });

  it('manifests drop hidden clips and junk', () => {
    const m = playableClips({
      clips: {
        'bail.0': { mime: 'audio/webm', bytes: 10, v: 1, t0: 0, t1: 1, gain: 1, dur: 1 },
        'bail.1': {
          mime: 'audio/webm',
          bytes: 10,
          v: 1,
          t0: 0,
          t1: 1,
          gain: 1,
          dur: 1,
          hidden: true,
        },
        'evil.0': { mime: 'audio/webm', bytes: 10, v: 1, t0: 0, t1: 1, gain: 1, dur: 1 },
        'bail.2': { mime: 'text/html', bytes: 10, v: 1, t0: 0, t1: 1, gain: 1, dur: 1 },
      },
    });
    expect(Object.keys(m)).toEqual(['bail.0']);
    expect(playableClips(null)).toEqual({});
  });
});

describe('chat said aloud', () => {
  it('clean mode bleeps swears before synthesis', () => {
    expect(bleep('holy shit that was fucking sick')).toBe('holy bleep that was bleep sick');
    expect(bleep('nice line')).toBe('nice line');
    expect(chatSwears('Shit!')).toBe(true);
    expect(chatSwears('scrap metal')).toBe(false);
  });
});

describe('training prompts', () => {
  it('about 100 short, unique sentences with stable ids', () => {
    expect(TRAIN_PROMPTS.length).toBe(100);
    expect(new Set(TRAIN_PROMPTS.map(p => p.text)).size).toBe(100);
    for (const p of TRAIN_PROMPTS) {
      const words = p.text.split(/\s+/).length;
      expect(words).toBeGreaterThanOrEqual(6);
      expect(words).toBeLessThanOrEqual(14);
      expect(p.text).not.toContain('|');
      expect(p.id).toMatch(/^train_\d{3}$/);
    }
  });
});

describe('WAV + resampling', () => {
  it('resample length math', () => {
    expect(resampledLength(48000, 48000, DATASET_RATE)).toBe(22050);
    expect(resampledLength(44100, 44100, 22050)).toBe(22050);
    expect(resampledLength(1, 48000, 22050)).toBe(1);
    expect(resampledLength(0, 48000, 22050)).toBe(0);
    expect(trimRange(0.5, 1, 1000, 800)).toEqual([500, 800]);
    expect(trimRange(-1, 0.2, 1000, 800)).toEqual([0, 200]);
  });

  it('writes a 22050 Hz mono 16-bit header and clipped samples', () => {
    const w = encodeWav(new Float32Array([0, 0.5, -1, 2]), DATASET_RATE, 1);
    const dv = new DataView(w.buffer);
    const s = (o: number) => String.fromCharCode(...w.slice(o, o + 4));
    expect(s(0)).toBe('RIFF');
    expect(s(8)).toBe('WAVE');
    expect(dv.getUint32(4, true)).toBe(w.length - 8);
    expect(dv.getUint16(20, true)).toBe(1);
    expect(dv.getUint16(22, true)).toBe(1);
    expect(dv.getUint32(24, true)).toBe(22050);
    expect(dv.getUint16(34, true)).toBe(16);
    expect(dv.getUint32(40, true)).toBe(8);
    expect([0, 1, 2, 3].map(i => dv.getInt16(44 + i * 2, true))).toEqual([0, 16384, -32768, 32767]);
  });
});

/** Minimal ZIP reader: walks the central directory, checks every CRC. */
function unzip(z: Uint8Array): Record<string, Uint8Array> {
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const end = z.length - 22;
  expect(dv.getUint32(end, true)).toBe(0x06054b50);
  const n = dv.getUint16(end + 10, true);
  let o = dv.getUint32(end + 16, true);
  const out: Record<string, Uint8Array> = {};
  const dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    expect(dv.getUint32(o, true)).toBe(0x02014b50);
    const crc = dv.getUint32(o + 16, true);
    const size = dv.getUint32(o + 20, true);
    const nameLen = dv.getUint16(o + 28, true);
    const local = dv.getUint32(o + 42, true);
    const name = dec.decode(z.slice(o + 46, o + 46 + nameLen));
    expect(dv.getUint32(local, true)).toBe(0x04034b50);
    expect(dv.getUint16(local + 8, true)).toBe(0); // stored
    const lnl = dv.getUint16(local + 26, true);
    const data = z.slice(local + 30 + lnl, local + 30 + lnl + size);
    expect(crc32(data)).toBe(crc);
    out[name] = data;
    o += 46 + nameLen;
  }
  return out;
}

describe('zip writer', () => {
  it('CRC-32 matches the reference value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('round-trips files through a parser', () => {
    const wav = encodeWav(new Float32Array(100).fill(0.1), DATASET_RATE);
    const z = zipStore([
      { name: 'voice/metadata.csv', data: 'a|Hello.\n' },
      { name: 'voice/wavs/a.wav', data: wav },
      { name: 'voice/README.txt', data: 'naïve ✓' },
    ]);
    const files = unzip(z);
    expect(Object.keys(files)).toEqual([
      'voice/metadata.csv',
      'voice/wavs/a.wav',
      'voice/README.txt',
    ]);
    expect(new TextDecoder().decode(files['voice/metadata.csv'])).toBe('a|Hello.\n');
    expect(files['voice/wavs/a.wav']).toEqual(wav);
    expect(new TextDecoder().decode(files['voice/README.txt'])).toBe('naïve ✓');
  });
});

describe('piper config', () => {
  const map: Record<string, number[]> = { _: [0], '^': [1], $: [2] };
  'abcdefghijk'.split('').forEach((c, i) => (map[c] = [i + 3]));
  it('accepts a real-looking config and fills defaults', () => {
    const v = validatePiperConfig(
      JSON.stringify({ audio: { sample_rate: 22050 }, phoneme_id_map: map }),
    );
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.config.num_speakers).toBe(1);
      expect(v.config.espeak.voice).toBe('en-us');
      expect(v.config.inference.noise_scale).toBeCloseTo(0.667);
    }
  });
  it('refuses junk', () => {
    expect(validatePiperConfig('{').ok).toBe(false);
    expect(validatePiperConfig({ phoneme_id_map: map }).ok).toBe(false);
    expect(validatePiperConfig({ audio: { sample_rate: 22050 } }).ok).toBe(false);
    expect(
      validatePiperConfig({ audio: { sample_rate: 22050 }, phoneme_id_map: { ...map, x: ['a'] } })
        .ok,
    ).toBe(false);
    expect(looksLikeOnnx(new Uint8Array([0x08]), 60e6)).toBe(true);
    expect(looksLikeOnnx(new Uint8Array([0x50]), 60e6)).toBe(false);
  });
});
