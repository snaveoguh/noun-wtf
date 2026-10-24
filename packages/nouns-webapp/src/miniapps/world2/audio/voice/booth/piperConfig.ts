// ── Checking a Piper voice's .onnx.json (pure) ───────────────────────────
//
// A player's own trained voice (Voice Booth → "Load my voice model") comes
// with the config Piper's exporter writes next to the .onnx. Anything that
// doesn't look like one is refused up front; the rider then keeps the stock
// voice from their Noun seed.

export interface PiperConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  phoneme_id_map: Record<string, number[]>;
  num_speakers: number;
  inference: { noise_scale: number; length_scale: number; noise_w: number };
}

export type ConfigCheck = { ok: true; config: PiperConfig } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const fin = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Parsed JSON (or its text) → a usable config, or why not. */
export function validatePiperConfig(raw: unknown): ConfigCheck {
  let o: unknown = raw;
  if (typeof raw === 'string') {
    try {
      o = JSON.parse(raw);
    } catch {
      return { ok: false, error: 'the .onnx.json is not valid JSON' };
    }
  }
  if (!isObj(o)) return { ok: false, error: 'the .onnx.json is not a Piper config' };
  const audio = isObj(o.audio) ? o.audio : {};
  const rate = audio.sample_rate;
  if (typeof rate !== 'number' || !Number.isInteger(rate) || rate < 8000 || rate > 48000)
    return { ok: false, error: 'config has no valid audio.sample_rate' };
  const map = o.phoneme_id_map;
  if (!isObj(map) || Object.keys(map).length < 10)
    return { ok: false, error: 'config has no phoneme_id_map' };
  for (const [k, v] of Object.entries(map))
    if (!Array.isArray(v) || v.some(x => typeof x !== 'number' || !Number.isInteger(x) || x < 0))
      return { ok: false, error: `bad phoneme id for "${k}"` };
  if (map['^'] === undefined || map.$ === undefined || map._ === undefined)
    return { ok: false, error: 'phoneme_id_map is missing ^ $ _' };
  const espeak = isObj(o.espeak) ? o.espeak : {};
  const voice = typeof espeak.voice === 'string' && espeak.voice !== '' ? espeak.voice : 'en-us';
  const inf = isObj(o.inference) ? o.inference : {};
  return {
    ok: true,
    config: {
      audio: { sample_rate: rate },
      espeak: { voice },
      phoneme_id_map: map as Record<string, number[]>,
      num_speakers: Math.max(1, Math.floor(fin(o.num_speakers, 1))),
      inference: {
        noise_scale: fin(inf.noise_scale, 0.667),
        length_scale: fin(inf.length_scale, 1),
        noise_w: fin(inf.noise_w, 0.8),
      },
    },
  };
}

/** Rough sanity check on the model file: ONNX is a protobuf starting with field 1 (0x08), MBs big. */
export function looksLikeOnnx(head: Uint8Array, size: number): boolean {
  return size > 500_000 && size < 300_000_000 && head[0] === 0x08;
}
