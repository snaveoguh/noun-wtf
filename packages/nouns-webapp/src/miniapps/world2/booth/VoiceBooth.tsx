// ── VOICE BOOTH: record your rider's callouts, train your own voice ───────
//
// Three tabs:
//   CALLOUTS        record each callout line (≤ 4 s): tap to start, tap to
//                   stop, a level meter while it listens, play / retake /
//                   delete. Clips are trimmed + normalised and kept in this
//                   browser (IndexedDB); your rider uses them at once. A
//                   consent box shares them so other players hear them.
//   TRAIN MY VOICE  read 100 sentences (≤ 8 s each), kept on this device
//                   only, then download them as a Piper training dataset.
//   MY VOICE MODEL  load the .onnx + .onnx.json you trained; two plain,
//                   off-by-default toggles say what it's used for.
// Live mic only: there is no way to upload an audio file.
//
// Used in the world2 settings panel (as an overlay) and at /world/voice.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import {
  analyseClip,
  boothLines,
  CLIP_MAX_BYTES,
  CLIP_MAX_S,
  progress,
  TRAIN_MAX_S,
  type BoothLine,
} from '../audio/voice/booth/clips';
import { buildDataset } from '../audio/voice/booth/dataset';
import { myVoice } from '../audio/voice/booth/myVoice';
import { looksLikeOnnx, validatePiperConfig } from '../audio/voice/booth/piperConfig';
import { MicRecorder, recorderSupported } from '../audio/voice/booth/recorder';
import { TRAIN_PROMPTS } from '../audio/voice/booth/trainPrompts';
import { type StoredClip } from '../audio/voice/booth/voiceDb';
import { deleteShared, uploadClip, voiceNet } from '../audio/voice/booth/voiceSync';
import { defaultWorker, TtsEngine } from '../audio/voice/TtsEngine';
import { MODEL_VOICE } from '../audio/voice/ttsVoice';
import { riderId } from '../net/Stats';
import { settings, type WorldSettings } from '../settings/store';

type Tab = 'callouts' | 'train' | 'model';
const TABS: { id: Tab; label: string }[] = [
  { id: 'callouts', label: 'CALLOUTS' },
  { id: 'train', label: 'TRAIN MY VOICE' },
  { id: 'model', label: 'MY VOICE MODEL' },
];

const EV_TITLES = { bail: 'BAILS', speed: 'GOING FAST', record: 'NEW RECORDS' } as const;

function useSettings(): WorldSettings {
  return useSyncExternalStore(settings.subscribe, settings.get);
}
function useMyVoice() {
  return useSyncExternalStore(myVoice.subscribe, myVoice.get);
}

let sharedCtx: AudioContext | null = null;
function audioCtx(): AudioContext {
  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  sharedCtx ??= new AC();
  if (sharedCtx.state === 'suspended') void sharedCtx.resume();
  return sharedCtx;
}

/** Play a stored clip's trimmed speech at its level. */
async function playStored(c: StoredClip): Promise<void> {
  const ctx = audioCtx();
  const buf = await ctx.decodeAudioData(await c.blob.arrayBuffer());
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  g.gain.value = c.gain;
  src.buffer = buf;
  src.connect(g).connect(ctx.destination);
  const t0 = Math.min(c.t0, buf.duration);
  src.start(ctx.currentTime + 0.02, t0, Math.max(0.05, Math.min(buf.duration, c.t1) - t0));
  await new Promise<void>(r => (src.onended = () => r()));
}

// ── Recording state shared by both tabs ──────────────────────────────────

interface RecState {
  /** Key being recorded ('' = none). */
  key: string;
  level: number;
  elapsed: number;
  error: string;
  /** Key being played back. */
  playing: string;
}

function useBoothRecorder() {
  const rec = useRef<MicRecorder | null>(null);
  const [st, setSt] = useState<RecState>({ key: '', level: 0, elapsed: 0, error: '', playing: '' });
  const raf = useRef(0);

  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      rec.current?.close();
    },
    [],
  );

  const record = useCallback(
    async (kind: 'clips' | 'train', key: string, maxS: number, after?: (c: StoredClip) => void) => {
      if (rec.current?.recording === true) {
        rec.current.stop();
        return;
      }
      rec.current ??= new MicRecorder();
      const r = rec.current;
      setSt(s => ({ ...s, key, error: '', level: 0, elapsed: 0 }));
      try {
        await r.open();
      } catch {
        setSt(s => ({
          ...s,
          key: '',
          error: 'No microphone: allow mic access for this site and try again.',
        }));
        return;
      }
      const t0 = performance.now();
      const loop = () => {
        setSt(s => ({ ...s, level: r.level(), elapsed: (performance.now() - t0) / 1000 }));
        raf.current = requestAnimationFrame(loop);
      };
      raf.current = requestAnimationFrame(loop);
      try {
        const take = await r.record(maxS);
        cancelAnimationFrame(raf.current);
        const ctx = audioCtx();
        const buf = await ctx.decodeAudioData(await take.blob.arrayBuffer());
        const shape = analyseClip(buf.getChannelData(0), buf.sampleRate, maxS);
        if (shape === null)
          throw new Error("Didn't hear anything. Try again a bit closer to the mic.");
        if (kind === 'clips' && take.blob.size > CLIP_MAX_BYTES)
          throw new Error('That take came out too big. Try a shorter one.');
        await myVoice.saveClip(kind, key, take.blob, take.mime, shape);
        setSt(s => ({ ...s, key: '', level: 0 }));
        const saved = myVoice.get()[kind].get(key);
        if (saved !== undefined) {
          after?.(saved);
          setSt(s => ({ ...s, playing: key }));
          await playStored(saved).catch(() => undefined);
          setSt(s => ({ ...s, playing: '' }));
        }
      } catch (err) {
        cancelAnimationFrame(raf.current);
        setSt(s => ({
          ...s,
          key: '',
          level: 0,
          error: err instanceof Error ? err.message : 'Recording failed.',
        }));
      }
    },
    [],
  );

  const play = useCallback(async (key: string, c: StoredClip) => {
    setSt(s => ({ ...s, playing: key }));
    await playStored(c).catch(() => undefined);
    setSt(s => ({ ...s, playing: '' }));
  }, []);

  return { st, record, play };
}

// ── Pieces ───────────────────────────────────────────────────────────────

function Meter({ level, elapsed, max }: { level: number; elapsed: number; max: number }) {
  return (
    <div className="flex items-center gap-2" data-booth-meter="">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-[#3ddc84] transition-[width] duration-75"
          style={{ width: `${Math.round(Math.min(1, level) * 100)}%` }}
        />
      </div>
      <span className="w-14 text-right text-[11px] tabular-nums opacity-80">
        {elapsed.toFixed(1)} / {max}s
      </span>
    </div>
  );
}

function Btn({
  children,
  onClick,
  tone = 'plain',
  disabled,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: 'plain' | 'rec' | 'go' | 'warn';
  disabled?: boolean;
  label?: string;
}) {
  const bg =
    tone === 'rec'
      ? 'bg-[#ff4d4d] text-white'
      : tone === 'go'
        ? 'bg-[#ffd400] text-black'
        : tone === 'warn'
          ? 'bg-white/10 text-[#ff8080]'
          : 'bg-white/10 text-white';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-[36px] min-w-[36px] rounded-xl px-3 text-xs font-bold disabled:opacity-40 ${bg}`}
    >
      {children}
    </button>
  );
}

function Toggle({
  name,
  on,
  onClick,
  hint,
}: {
  name: string;
  on: boolean;
  onClick: () => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`flex min-h-[40px] w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs ${on ? 'bg-[#3ddc84]/20 ring-1 ring-[#3ddc84]' : 'bg-white/10'}`}
    >
      <span>
        <b>{name}</b>
        {hint !== undefined && <span className="mt-0.5 block opacity-70">{hint}</span>}
      </span>
      <span className="shrink-0 text-[10px] font-bold">{on ? 'ON' : 'OFF'}</span>
    </button>
  );
}

function Bar({ done, total }: { done: number; total: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full bg-[#ffd400]"
        style={{ width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` }}
      />
    </div>
  );
}

// ── Callouts tab ─────────────────────────────────────────────────────────

function LineRow({
  line,
  clip,
  rec,
  onRecord,
  onPlay,
  onDelete,
}: {
  line: BoothLine;
  clip: StoredClip | undefined;
  rec: RecState;
  onRecord: () => void;
  onPlay: () => void;
  onDelete: () => void;
}) {
  const recording = rec.key === line.key;
  const busy = rec.key !== '' && !recording;
  return (
    <li
      className={`flex flex-col gap-1.5 rounded-xl px-3 py-2 ${recording ? 'bg-[#ff4d4d]/15 ring-1 ring-[#ff4d4d]' : 'bg-white/5'}`}
      data-booth-line={line.key}
      data-recorded={clip !== undefined ? '1' : '0'}
    >
      <div className="flex items-center gap-2">
        <span className={`w-4 text-center text-xs ${clip ? 'text-[#3ddc84]' : 'opacity-40'}`}>
          {clip ? '●' : '○'}
        </span>
        <span className="flex-1 text-sm">
          “{line.text}”
          {line.swear && <span className="ml-1 text-[10px] opacity-60">(swear version)</span>}
        </span>
        <div className="flex shrink-0 gap-1">
          <Btn
            tone="rec"
            onClick={onRecord}
            disabled={busy}
            label={recording ? 'Stop recording' : clip ? 'Retake' : 'Record'}
          >
            {recording ? '■' : clip ? '↻' : '● REC'}
          </Btn>
          {clip !== undefined && !recording && (
            <>
              <Btn onClick={onPlay} disabled={busy} label="Play">
                {rec.playing === line.key ? '♪' : '▶'}
              </Btn>
              <Btn tone="warn" onClick={onDelete} disabled={busy} label="Delete">
                ✕
              </Btn>
            </>
          )}
        </div>
      </div>
      {recording && <Meter level={rec.level} elapsed={rec.elapsed} max={CLIP_MAX_S} />}
    </li>
  );
}

function CalloutsTab({ boothRec }: { boothRec: ReturnType<typeof useBoothRecorder> }) {
  const s = useSettings();
  const mv = useMyVoice();
  const { st, record, play } = boothRec;
  const lines = boothLines(s.cleanVoices, s.boothSwears);
  const have = new Set(mv.clips.keys());
  const p = progress(lines, have);
  const [sync, setSync] = useState('');

  const share = useCallback(async (c: StoredClip) => {
    if (!settings.get().shareRecordings || !voiceNet.enabled) return;
    try {
      const meta = await uploadClip(riderId(), { ...c, mime: c.mime });
      await myVoice.markUploaded(c.key, meta.v);
    } catch (err) {
      setSync(err instanceof Error ? err.message : 'upload failed');
    }
  }, []);

  const shareAll = useCallback(async () => {
    const todo = [...myVoice.get().clips.values()].filter(c => c.uploadedAt === 0);
    let n = 0;
    for (const c of todo) {
      setSync(`Sharing ${++n} of ${todo.length}…`);
      await share(c);
    }
    setSync(voiceNet.enabled ? 'All shared.' : 'Offline: they will be shared when you are online.');
  }, [share]);

  const groups = (['bail', 'speed', 'record'] as const).map(ev => ({
    ev,
    lines: lines.filter(l => l.ev === ev),
  }));
  const shared = [...mv.clips.values()].filter(c => c.uploadedAt > 0).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <b data-booth-progress={`${p.done}/${p.total}`}>
            {p.done} of {p.total} lines recorded
          </b>
          <span className="opacity-60">the rest use the TTS voice</span>
        </div>
        <Bar done={p.done} total={p.total} />
      </div>
      <Toggle
        name="Use my voice"
        on={s.myVoice}
        onClick={() => settings.update({ myVoice: !s.myVoice })}
        hint="Your rider shouts your recordings. Lines you haven't recorded use the TTS voice."
      />
      {s.cleanVoices && (
        <Toggle
          name="Also record the swear versions"
          on={s.boothSwears}
          onClick={() => settings.update({ boothSwears: !s.boothSwears })}
          hint="Clean mode is on, so the clean lines are listed. Swear versions play when clean mode is off."
        />
      )}
      <p className="text-[11px] opacity-70">
        Tap ● REC, shout the line, tap ■ (it stops by itself after {CLIP_MAX_S} s). Silence is
        trimmed and the level evened out.
      </p>
      {groups.map(g => (
        <div key={g.ev} className="flex flex-col gap-1.5">
          <div className="text-[10px] font-bold tracking-[0.2em] opacity-60">{EV_TITLES[g.ev]}</div>
          <ul className="flex flex-col gap-1.5">
            {g.lines.map(l => (
              <LineRow
                key={l.key}
                line={l}
                clip={mv.clips.get(l.key)}
                rec={st}
                onRecord={() => void record('clips', l.key, CLIP_MAX_S, c => void share(c))}
                onPlay={() => {
                  const c = mv.clips.get(l.key);
                  if (c) void play(l.key, c);
                }}
                onDelete={() => {
                  const c = mv.clips.get(l.key);
                  void myVoice.deleteClip('clips', l.key);
                  if (c !== undefined && c.uploadedAt > 0 && voiceNet.enabled)
                    void deleteShared(riderId(), l.key).catch(() => undefined);
                }}
              />
            ))}
          </ul>
        </div>
      ))}
      <ShareBox shared={shared} total={mv.clips.size} status={sync} onShare={shareAll} />
    </div>
  );
}

function ShareBox({
  shared,
  total,
  status,
  onShare,
}: {
  shared: number;
  total: number;
  status: string;
  onShare: () => Promise<void>;
}) {
  const s = useSettings();
  const [agree, setAgree] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-white/5 p-3 text-xs" data-booth-share="">
      <b className="text-[10px] tracking-[0.2em] opacity-70">LET OTHER PLAYERS HEAR THEM</b>
      {s.shareRecordings ? (
        <>
          <p>
            Sharing is on: {shared} of {total} recordings shared. Other players near you hear them
            when your rider shouts. New takes are shared as you record them.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Btn tone="go" onClick={() => void onShare()}>
              Share any unshared
            </Btn>
            <Btn
              tone="warn"
              onClick={() => {
                settings.update({ shareRecordings: false });
                if (voiceNet.enabled) void deleteShared(riderId()).catch(() => undefined);
                for (const c of myVoice.get().clips.values()) void myVoice.markUploaded(c.key, 0);
              }}
            >
              Stop sharing + delete from server
            </Btn>
          </div>
        </>
      ) : (
        <>
          <p>
            Your recordings stay on this device unless you share them. If you share them,{' '}
            <b>other players will hear these recordings</b> when your rider shouts in multiplayer.
            Anyone can report a voice; moderators can remove it. You can stop sharing any time,
            which deletes them from the server.
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={agree}
              onChange={e => setAgree(e.target.checked)}
              data-booth-consent=""
            />
            <span>I understand other players will hear my recordings.</span>
          </label>
          <Btn
            tone="go"
            disabled={!agree || total === 0}
            onClick={() => {
              settings.update({ shareRecordings: true });
              void onShare();
            }}
          >
            Share my recordings
          </Btn>
        </>
      )}
      {status !== '' && <p className="opacity-70">{status}</p>}
    </div>
  );
}

// ── Train tab ────────────────────────────────────────────────────────────

function TrainTab({ boothRec }: { boothRec: ReturnType<typeof useBoothRecorder> }) {
  const mv = useMyVoice();
  const { st, record, play } = boothRec;
  const firstTodo = TRAIN_PROMPTS.findIndex(p => !mv.train.has(p.id));
  const [i, setI] = useState(Math.max(0, firstTodo));
  const [exp, setExp] = useState('');
  const prompt = TRAIN_PROMPTS[i]!;
  const clip = mv.train.get(prompt.id);
  const recording = st.key === prompt.id;
  const done = mv.train.size;

  const download = async () => {
    setExp('Building…');
    try {
      const r = await buildDataset(mv.train, mv.clips, (d, t) =>
        setExp(`Converting ${d} of ${t}…`),
      );
      const url = URL.createObjectURL(r.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'noun-voice-dataset.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setExp(`Downloaded ${r.count} recordings (${(r.seconds / 60).toFixed(1)} min of audio).`);
    } catch (err) {
      setExp(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs opacity-80">
        Read {TRAIN_PROMPTS.length} short sentences in your normal voice. Use a <b>quiet room</b>{' '}
        and the <b>same mic</b> at the same distance throughout. These stay on this device: they’re
        never uploaded. When you’re done, download them as a dataset and train your own voice model
        for free (instructions inside the zip).
      </p>
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between text-xs">
          <b data-booth-train={`${done}/${TRAIN_PROMPTS.length}`}>
            {done} of {TRAIN_PROMPTS.length} sentences recorded
          </b>
          <span className="opacity-60">up to {TRAIN_MAX_S} s each</span>
        </div>
        <Bar done={done} total={TRAIN_PROMPTS.length} />
      </div>
      <div
        className={`flex flex-col gap-3 rounded-2xl p-4 ${recording ? 'bg-[#ff4d4d]/15 ring-1 ring-[#ff4d4d]' : 'bg-white/5'}`}
        data-booth-prompt={prompt.id}
      >
        <div className="flex justify-between text-[11px] opacity-60">
          <span>
            {i + 1} / {TRAIN_PROMPTS.length}
          </span>
          <span>{clip ? '● recorded' : '○ not yet'}</span>
        </div>
        <p className="text-lg leading-snug">{prompt.text}</p>
        {recording && <Meter level={st.level} elapsed={st.elapsed} max={TRAIN_MAX_S} />}
        <div className="flex flex-wrap items-center gap-1.5">
          <Btn
            onClick={() => setI(Math.max(0, i - 1))}
            disabled={st.key !== '' || i === 0}
            label="Previous"
          >
            ◀
          </Btn>
          <Btn
            tone="rec"
            disabled={st.key !== '' && !recording}
            onClick={() =>
              void record('train', prompt.id, TRAIN_MAX_S, () => {
                // On to the next unrecorded sentence
                const next = TRAIN_PROMPTS.findIndex(
                  (p, j) => j > i && !myVoice.get().train.has(p.id),
                );
                if (next >= 0) setI(next);
              })
            }
          >
            {recording ? '■ STOP' : clip ? '↻ RETAKE' : '● REC'}
          </Btn>
          {clip && !recording && (
            <>
              <Btn onClick={() => void play(prompt.id, clip)} label="Play">
                ▶
              </Btn>
              <Btn
                tone="warn"
                onClick={() => void myVoice.deleteClip('train', prompt.id)}
                label="Delete"
              >
                ✕
              </Btn>
            </>
          )}
          <Btn
            onClick={() => setI(Math.min(TRAIN_PROMPTS.length - 1, i + 1))}
            disabled={st.key !== '' || i === TRAIN_PROMPTS.length - 1}
            label="Next"
          >
            ▶▶
          </Btn>
        </div>
      </div>
      <div className="flex flex-wrap gap-1" aria-label="Sentences">
        {TRAIN_PROMPTS.map((p, j) => (
          <button
            key={p.id}
            type="button"
            onClick={() => st.key === '' && setI(j)}
            aria-label={`Sentence ${j + 1}`}
            className={`h-3.5 w-3.5 rounded-sm ${j === i ? 'ring-2 ring-[#ffd400]' : ''} ${mv.train.has(p.id) ? 'bg-[#3ddc84]' : 'bg-white/15'}`}
          />
        ))}
      </div>
      <div className="flex flex-col gap-1.5 rounded-xl bg-white/5 p-3 text-xs">
        <Btn
          tone="go"
          disabled={done + mv.clips.size === 0 || exp.endsWith('…')}
          onClick={() => void download()}
        >
          ⬇ Download my voice dataset (.zip)
        </Btn>
        <span className="opacity-70">
          {exp ||
            'LJSpeech format for Piper: 22050 Hz WAVs + metadata.csv, plus your callout recordings. Training is free on Google Colab and takes roughly 1–3 h.'}
        </span>
      </div>
    </div>
  );
}

// ── Model tab ────────────────────────────────────────────────────────────

function ModelTab({ modelState }: { modelState?: () => string }) {
  const s = useSettings();
  const mv = useMyVoice();
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    const onnx = list.find(f => /\.onnx$/i.test(f.name));
    const json = list.find(f => /\.json$/i.test(f.name));
    if (onnx === undefined || json === undefined) {
      setMsg('Pick both files: my-voice.onnx and my-voice.onnx.json.');
      return;
    }
    const cfg = validatePiperConfig(await json.text());
    if (!cfg.ok) {
      setMsg(`That config won't work: ${cfg.error}.`);
      return;
    }
    const head = new Uint8Array(await onnx.slice(0, 4).arrayBuffer());
    if (!looksLikeOnnx(head, onnx.size)) {
      setMsg("That .onnx doesn't look like a Piper voice model.");
      return;
    }
    await myVoice.setModel(onnx, JSON.stringify(cfg.config), onnx.name);
    setMsg(`Loaded ${onnx.name}. It stays in this browser.`);
  };

  const test = async () => {
    const d = await myVoice.modelData();
    if (d === null) return;
    setMsg('Loading your voice…');
    const eng = new TtsEngine(defaultWorker, () => ({
      t: 'init-bytes',
      model: d.model,
      config: d.config,
    }));
    eng.load();
    const ok = await Promise.race([
      eng.whenReady().then(() => true),
      new Promise<boolean>(r => setTimeout(() => r(false), 60_000)),
    ]);
    if (!ok || !eng.ready) {
      setMsg(
        `Your model didn't load (${eng.status.error || 'timed out'}). The rider keeps the stock voice.`,
      );
      eng.dispose();
      return;
    }
    const ctx = audioCtx();
    const buf = await eng.synth(ctx, 'Hey! This is my voice in Noun World.', MODEL_VOICE);
    eng.dispose();
    if (buf === null) {
      setMsg('Your model loaded but could not speak that line.');
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start();
    setMsg('That was your model.');
  };

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-2 rounded-xl bg-white/5 p-3">
        <p>
          Trained your own voice (see TRAIN MY VOICE)? Load it here. <b>Both switches start off</b>{' '}
          and you can change them any time, here or in settings.
        </p>
        <Toggle
          name="Use my voice model for my character"
          on={s.modelVoice}
          onClick={() => settings.update({ modelVoice: !s.modelVoice })}
          hint="Callouts you haven't recorded, and the chat you type, are spoken in your trained voice. Only you hear this unless you turn on the next switch."
        />
        <Toggle
          name="Let other players hear my voice"
          on={s.modelShare}
          onClick={() => settings.update({ modelShare: !s.modelShare })}
          hint="When you type in chat, a short clip of that line in your voice is generated on your device and shared with players nearby for 10 minutes. Your model itself is never uploaded."
        />
      </div>
      <div className="flex flex-col gap-2 rounded-xl bg-white/5 p-3">
        <b className="text-[10px] tracking-[0.2em] opacity-70">MY VOICE MODEL</b>
        {mv.model ? (
          <p data-booth-model="loaded">
            {mv.model.name} · {Math.round(mv.model.bytes / 1e6)} MB, stored in this browser
            {modelState !== undefined && ` · ${modelState()}`}
          </p>
        ) : (
          <p data-booth-model="none">
            No model loaded. Pick your <code>.onnx</code> and <code>.onnx.json</code> together.
          </p>
        )}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".onnx,.json,application/json,application/octet-stream"
          className="hidden"
          onChange={e => void load(e.target.files)}
        />
        <div className="flex flex-wrap gap-1.5">
          <Btn tone="go" onClick={() => fileRef.current?.click()}>
            Load my voice model
          </Btn>
          {mv.model && (
            <>
              <Btn onClick={() => void test()}>▶ Test it</Btn>
              <Btn tone="warn" onClick={() => void myVoice.clearModel()}>
                Remove
              </Btn>
            </>
          )}
        </div>
        {msg !== '' && <p className="opacity-80">{msg}</p>}
      </div>
    </div>
  );
}

// ── The booth ────────────────────────────────────────────────────────────

export default function VoiceBooth({
  onClose,
  modelState,
}: {
  onClose?: () => void;
  /** The running game's own-model engine state (settings overlay). */
  modelState?: () => string;
}) {
  const [tab, setTab] = useState<Tab>('callouts');
  const boothRec = useBoothRecorder();
  const mv = useMyVoice();
  const supported = recorderSupported();
  return (
    <div
      className="flex w-full max-w-[640px] flex-col gap-3 text-sm text-white"
      data-voice-booth=""
    >
      <div className="flex items-center justify-between gap-2">
        <b className="text-base tracking-wide">🎙 VOICE BOOTH</b>
        {onClose !== undefined && (
          <button
            type="button"
            className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold"
            onClick={onClose}
          >
            close
          </button>
        )}
      </div>
      <p className="text-xs opacity-70">
        Your rider shouts on bails, top speed and new records. Record those lines in your own voice.
      </p>
      {!supported && (
        <p className="rounded-xl bg-[#ff4d4d]/20 p-2 text-xs">
          This browser can’t record audio. Try a recent Chrome or Safari.
        </p>
      )}
      {mv.ready && !mv.persistent && (
        <p className="rounded-xl bg-[#ffd400]/15 p-2 text-xs">
          This browser won’t let the booth save (private mode?): recordings last until you close the
          page.
        </p>
      )}
      {boothRec.st.error !== '' && (
        <p className="rounded-xl bg-[#ff4d4d]/20 p-2 text-xs" role="alert">
          {boothRec.st.error}
        </p>
      )}
      <div className="flex gap-1" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            disabled={boothRec.st.key !== ''}
            onClick={() => setTab(t.id)}
            className={`min-h-[34px] flex-1 rounded-xl px-1 text-[10px] font-bold tracking-wide sm:text-xs ${tab === t.id ? 'bg-[#ffd400] text-black' : 'bg-white/10'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'callouts' && <CalloutsTab boothRec={boothRec} />}
      {tab === 'train' && <TrainTab boothRec={boothRec} />}
      {tab === 'model' && <ModelTab modelState={modelState} />}
    </div>
  );
}
