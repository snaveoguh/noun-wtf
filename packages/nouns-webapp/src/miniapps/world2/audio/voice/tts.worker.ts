/// <reference lib="webworker" />
// ── Real-voice worker: Piper (VITS) on onnxruntime-web, off the main thread ──
//
// Loads once, on the first `init`: the eSpeak NG phonemizer (bundled in this
// worker's chunk), onnxruntime-web's WASM runtime (from jsDelivr, version-
// pinned to the package) and the Piper model (Hugging Face, pinned revision),
// kept in Cache Storage so it downloads once per browser. Then each `synth`
// is text → eSpeak IPA → phoneme ids → one ONNX run → PCM, transferred back.
// Synthesis never touches the render loop.

import type { TtsIn, TtsOut } from './ttsProtocol';

import * as ort from 'onnxruntime-web/wasm';
import { phonemize } from 'phonemizer';

import { validatePiperConfig, type PiperConfig } from './booth/piperConfig';
import { sentences, toIds, toPhonemes } from './piperText';

const ORT_VERSION = '1.22.0';
const CACHE = 'noun-world-voices-v1';

let session: ort.InferenceSession | null = null;
let config: PiperConfig | null = null;
let loading: Promise<void> | null = null;

const post = (m: TtsOut, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

/** A URL's bytes, from Cache Storage if we've had it before (progress while fetching). */
async function fetchCached(
  url: string,
  progress?: (loaded: number, total: number) => void,
): Promise<{ buf: ArrayBuffer; cached: boolean }> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit !== undefined) return { buf: await hit.arrayBuffer(), cached: true };
  } catch {
    cache = null; // no Cache Storage (private mode): just fetch
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url.split('/').pop() ?? ''}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let buf: ArrayBuffer;
  if (res.body !== null && progress !== undefined) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    let lastPost = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      const now = performance.now();
      if (now - lastPost > 250) {
        lastPost = now;
        progress(loaded, total);
      }
    }
    const out = new Uint8Array(loaded);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.byteLength;
    }
    buf = out.buffer;
    progress(loaded, total || loaded);
  } else buf = await res.arrayBuffer();
  try {
    await cache?.put(
      url,
      new Response(buf.slice(0), { headers: { 'content-type': 'application/octet-stream' } }),
    );
  } catch {
    // quota: it'll download again next visit
  }
  return { buf, cached: false };
}

function setupOrt() {
  ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
  ort.env.wasm.numThreads = self.crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 1)
    : 1;
  ort.env.logLevel = 'error';
}

/** Config text → checked config (throws with the reason). */
function parseConfig(text: string): PiperConfig {
  const c = validatePiperConfig(text);
  if (!c.ok) throw new Error(c.error);
  return c.config;
}

async function start(t0: number, cfg: PiperConfig, model: ArrayBuffer, cached: boolean) {
  config = cfg;
  session = await ort.InferenceSession.create(new Uint8Array(model), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  // Warm up: the first run pays for kernel setup
  await synth('Hey.', 0, [0.667, 1, 0.8]);
  post({
    t: 'ready',
    ms: Math.round(performance.now() - t0),
    bytes: model.byteLength,
    cached,
    speakers: cfg.num_speakers,
  });
}

async function init(modelUrl: string, configUrl: string) {
  const t0 = performance.now();
  setupOrt();
  const cfg = await fetchCached(configUrl);
  const parsed = parseConfig(new TextDecoder().decode(cfg.buf));
  const model = await fetchCached(modelUrl, (loaded, total) =>
    post({ t: 'progress', loaded, total }),
  );
  await start(t0, parsed, model.buf, model.cached);
}

/** A player's own model (Voice Booth): bytes from IndexedDB, only the runtime is fetched. */
async function initBytes(model: ArrayBuffer, configText: string) {
  const t0 = performance.now();
  setupOrt();
  await start(t0, parseConfig(configText), model, true);
}

async function synth(
  text: string,
  speaker: number,
  scales: [number, number, number],
): Promise<{ pcm: Float32Array; sampleRate: number }> {
  if (session === null || config === null) throw new Error('not loaded');
  const lang = config.espeak.voice || 'en-us';
  const ph = await toPhonemes(text, async t => (await phonemize(t, lang)).join(' '));
  const ids = toIds(ph, config.phoneme_id_map);
  const n = ids.length;
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, n]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(n)]), [1]),
    scales: new ort.Tensor('float32', Float32Array.from(scales), [3]),
  };
  if (config.num_speakers > 1) {
    const sid = Math.max(0, Math.min(config.num_speakers - 1, Math.floor(speaker)));
    feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(sid)]), [1]);
  }
  const out = await session.run(feeds);
  const data = out.output.data as Float32Array;
  // Own buffer (transferable), trimmed of the model's silent tail
  let end = data.length;
  while (end > 0 && Math.abs(data[end - 1]!) < 1e-3) end--;
  const pcm = new Float32Array(data.subarray(0, Math.min(data.length, end + 1200)));
  return { pcm, sampleRate: config.audio.sample_rate };
}

/** A line, one sentence per run with real silence between (Piper's own sentence_silence). */
async function synthLine(
  text: string,
  speaker: number,
  scales: [number, number, number],
  gap: number,
): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const parts = sentences(text, gap);
  if (parts.length <= 1) return synth(parts[0]?.text ?? text, speaker, scales);
  const clips: Float32Array[] = [];
  let sampleRate = 22050;
  let n = 0;
  for (const s of parts) {
    const r = await synth(s.text, speaker, scales);
    sampleRate = r.sampleRate;
    clips.push(r.pcm);
    const silence = new Float32Array(Math.round(s.pause * sampleRate));
    clips.push(silence);
    n += r.pcm.length + silence.length;
  }
  const pcm = new Float32Array(n);
  let o = 0;
  for (const c of clips) {
    pcm.set(c, o);
    o += c.length;
  }
  return { pcm, sampleRate };
}

self.onmessage = (e: MessageEvent<TtsIn>) => {
  const m = e.data;
  if (m.t === 'init' || m.t === 'init-bytes') {
    loading ??= (
      m.t === 'init' ? init(m.modelUrl, m.configUrl) : initBytes(m.model, m.config)
    ).catch((err: unknown) => {
      loading = null;
      post({ t: 'error', message: err instanceof Error ? err.message : String(err) });
    });
    return;
  }
  if (m.t === 'synth') {
    const t0 = performance.now();
    synthLine(m.text, m.speaker, m.scales, m.gap)
      .then(({ pcm, sampleRate }) =>
        post({ t: 'audio', id: m.id, pcm, sampleRate, ms: Math.round(performance.now() - t0) }, [
          pcm.buffer,
        ]),
      )
      .catch((err: unknown) =>
        post({ t: 'fail', id: m.id, message: err instanceof Error ? err.message : String(err) }),
      );
  }
};
