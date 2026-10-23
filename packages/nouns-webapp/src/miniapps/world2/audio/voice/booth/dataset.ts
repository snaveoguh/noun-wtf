// ── "Download my voice dataset": LJSpeech-style zip for Piper training ────
//
//   noun-voice-dataset/
//     wavs/<id>.wav      22050 Hz, mono, 16-bit PCM (trimmed + normalised)
//     metadata.csv       <id>|<text>, one line per wav
//     README.txt         how to train a Piper voice from it for free
//
// Built entirely in the browser: each recording is decoded with WebAudio,
// cut to its trimmed speech, resampled through an OfflineAudioContext and
// written as WAV (wav.ts), then stored in a zip (zip.ts). Nothing is uploaded.

import type { StoredClip } from './voiceDb';

import { parseClipKey } from './clips';
import { TRAIN_PROMPTS } from './trainPrompts';
import { DATASET_RATE, encodeWav, resampledLength, trimRange } from './wav';
import { zipStore, type ZipEntry } from './zip';

export const DATASET_DIR = 'noun-voice-dataset';

/** Dataset id for a callout recording (keys have dots). */
export const calloutId = (key: string) => `callout_${key.replace(/\./g, '_')}`;

/** The rows a dataset would hold (pure: ids + text, training sentences first). */
export function datasetRows(
  train: ReadonlyMap<string, StoredClip>,
  clips: ReadonlyMap<string, StoredClip>,
): { id: string; text: string; clip: StoredClip }[] {
  const rows: { id: string; text: string; clip: StoredClip }[] = [];
  for (const p of TRAIN_PROMPTS) {
    const c = train.get(p.id);
    if (c !== undefined) rows.push({ id: p.id, text: p.text, clip: c });
  }
  for (const [key, c] of clips) {
    const line = parseClipKey(key);
    if (line !== null) rows.push({ id: calloutId(key), text: line.text, clip: c });
  }
  return rows;
}

/** metadata.csv text (LJSpeech: id|text, no header). */
export function metadataCsv(rows: readonly { id: string; text: string }[]): string {
  return (
    rows
      .map(
        r =>
          `${r.id}|${r.text
            .replace(/[\n\r|]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()}`,
      )
      .join('\n') + '\n'
  );
}

type AnyAudioCtx = typeof OfflineAudioContext;
const OAC = (): AnyAudioCtx =>
  window.OfflineAudioContext ??
  (window as unknown as { webkitOfflineAudioContext: AnyAudioCtx }).webkitOfflineAudioContext;

/** One recording → trimmed, 22050 Hz mono samples. */
async function toDatasetRate(c: StoredClip): Promise<Float32Array | null> {
  const Ctx = OAC();
  try {
    const dec = await new Ctx(1, 1, 44100).decodeAudioData(await c.blob.arrayBuffer());
    const [a, b] = trimRange(c.t0, c.t1, dec.sampleRate, dec.length);
    if (b - a < dec.sampleRate * 0.1) return null;
    // Mono: average the channels over the trimmed range
    const src = new Ctx(1, b - a, dec.sampleRate).createBuffer(1, b - a, dec.sampleRate);
    const mono = src.getChannelData(0);
    for (let ch = 0; ch < dec.numberOfChannels; ch++) {
      const d = dec.getChannelData(ch);
      for (let i = a; i < b; i++) mono[i - a]! += d[i]! / dec.numberOfChannels;
    }
    const len = resampledLength(b - a, dec.sampleRate, DATASET_RATE);
    const off = new Ctx(1, len, DATASET_RATE);
    const node = off.createBufferSource();
    node.buffer = src;
    node.connect(off.destination);
    node.start(0);
    const out = await off.startRendering();
    return out.getChannelData(0);
  } catch {
    return null;
  }
}

/** Build the dataset zip. `onProgress(done, total)` while it works. */
export async function buildDataset(
  train: ReadonlyMap<string, StoredClip>,
  clips: ReadonlyMap<string, StoredClip>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ blob: Blob; count: number; seconds: number }> {
  const rows = datasetRows(train, clips);
  const files: ZipEntry[] = [];
  const kept: { id: string; text: string }[] = [];
  let seconds = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const pcm = await toDatasetRate(r.clip);
    if (pcm !== null) {
      files.push({
        name: `${DATASET_DIR}/wavs/${r.id}.wav`,
        data: encodeWav(pcm, DATASET_RATE, r.clip.gain),
      });
      kept.push(r);
      seconds += pcm.length / DATASET_RATE;
    }
    onProgress?.(i + 1, rows.length);
  }
  files.unshift(
    { name: `${DATASET_DIR}/metadata.csv`, data: metadataCsv(kept) },
    { name: `${DATASET_DIR}/README.txt`, data: readme(kept.length, seconds) },
  );
  const zip = zipStore(files);
  return {
    blob: new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }),
    count: kept.length,
    seconds,
  };
}

/** Free training instructions, shipped inside the zip. */
export function readme(count: number, seconds: number): string {
  const mins = (seconds / 60).toFixed(1);
  return `NOUN WORLD VOICE DATASET
========================

${count} recordings, ${mins} minutes of your voice, recorded in the Noun World
Voice Booth (noun.wtf). Everything here stayed on your device until you
downloaded it.

  wavs/<id>.wav   22050 Hz, mono, 16-bit PCM, silence trimmed, level normalised
  metadata.csv    <id>|<text>   (LJSpeech format, single speaker)

What this is for: fine-tuning a Piper text-to-speech voice that sounds like
you. Piper is the open-source TTS engine Noun World already uses for its
character voices. When you have your own .onnx + .onnx.json, load them in the
Voice Booth ("Load my voice model") and your rider can speak in your voice.

It costs nothing: you train on Google Colab's free GPU tier. Expect roughly
1-3 hours of training for a usable voice. More minutes of clean audio make a
better voice; the full 100 sentences plus your callouts is a good start.

Official Piper project (the only source you need):
  https://github.com/rhasspy/piper          original repo (training guide: TRAINING.md)
  https://github.com/OHF-Voice/piper1-gpl   where development continues (docs/TRAINING.md)
  Pretrained checkpoints to fine-tune from:
  https://huggingface.co/datasets/rhasspy/piper-checkpoints

STEP BY STEP (free)
-------------------
1. Go to https://colab.research.google.com, make a new notebook and pick
   Runtime > Change runtime type > T4 GPU (free).
2. Upload this zip to the notebook (Files panel) and unzip it:
     !unzip -q noun-voice-dataset.zip
3. Install Piper's training code by following TRAINING.md in the Piper repo
   above (clone the repo, install its training requirements, build the
   small monotonic-align extension it describes).
4. Download a single-speaker English medium checkpoint (.ckpt) from the
   piper-checkpoints link above, for example an en_US "medium" voice.
   Fine-tuning from a checkpoint is what makes this take hours, not days.
5. Preprocess the dataset (as TRAINING.md describes for an LJSpeech-format,
   single-speaker dataset at 22050 Hz, language en-us). In the original repo
   that is:
     python3 -m piper_train.preprocess --language en-us \\
       --input-dir noun-voice-dataset --output-dir training \\
       --dataset-format ljspeech --single-speaker --sample-rate 22050
6. Train, resuming from the checkpoint, for a few hundred extra epochs
   (1-3 h on the free T4). In the original repo:
     python3 -m piper_train --dataset-dir training --accelerator gpu \\
       --devices 1 --batch-size 16 --validation-split 0.0 \\
       --num-test-examples 0 --max_epochs <checkpoint epoch + 300> \\
       --resume_from_checkpoint <the .ckpt> --checkpoint-epochs 1 \\
       --precision 32
   Colab's free tier disconnects after a while: save the training folder to
   Google Drive so you can resume.
7. Export to ONNX and copy the config next to it:
     python3 -m piper_train.export_onnx <your last .ckpt> my-voice.onnx
     cp training/config.json my-voice.onnx.json
   (If you use piper1-gpl, its docs/TRAINING.md has the equivalent
   commands; the result is the same pair of files.)
8. Download my-voice.onnx and my-voice.onnx.json, open the Voice Booth in
   Noun World, choose "Load my voice model" and pick both files.

Your model stays in your browser. Other players never get it: if you turn on
"Let other players hear my voice", they only hear short clips of your own
chat lines, generated on your device.
`;
}
