// ── NOUN FM decks panel + YouTube deck screen ──────────────────────────
//
// Opened at the decks inside the ice cream van. Paste an Audius, YouTube
// or direct audio link, see what it is (title, artist, length), queue it,
// move or drop your own entries; or book a DJ set for today. The deck
// screen is the one visible YouTube player NOUN FM plays through.

import type { Game } from '../Game';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
  FM_MAX_TRACK_S,
  FM_PER_RIDER,
  FM_SET_MAX_TRACKS,
  setEnd,
  setLength,
  type FmSrc,
  type FmTrack,
} from '../../../../../nouns-party/src/fmStation';

import { type FmView, type NounFm } from './NounFm';
import { YouTubeDeck, YT_MIN_PX } from './YouTubeDeck';

export function useFm(fm: NounFm): FmView {
  return useSyncExternalStore(fm.subscribe, fm.getView);
}

export function fmtDur(s: number): string {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

function parseDur(v: string): number {
  const p = v.trim().split(':').map(Number);
  if (p.some(n => !Number.isFinite(n))) return 0;
  return p.reduce((a, n) => a * 60 + n, 0);
}

const KIND: Record<FmSrc['kind'], string> = {
  youtube: 'YouTube',
  audius: 'Audius',
  direct: 'file',
};

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The visible preview player that reads a YouTube video's title + length. */
function YtPreview({ id, onInfo }: { id: string; onInfo: (t: Omit<FmTrack, 'src'>) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onInfo);
  cb.current = onInfo;
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const deck = new YouTubeDeck();
    deck.mount(el);
    deck.setVolume(0.4);
    let tries = 0;
    let started = false;
    const iv = window.setInterval(() => {
      if (!started) started = deck.play(id, 0, true);
      const i = deck.info();
      if (i.dur > 0) {
        cb.current({
          title: i.title || 'YouTube video',
          artist: i.artist || 'YouTube',
          dur: i.dur,
        });
        window.clearInterval(iv);
      } else if (++tries > 40) window.clearInterval(iv);
    }, 400);
    return () => {
      window.clearInterval(iv);
      deck.unmount();
    };
  }, [id]);
  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-lg bg-black"
      style={{ width: YT_MIN_PX, height: YT_MIN_PX }}
    />
  );
}

/** Paste a link → a checked, described track. */
function LinkAdder({
  fm,
  cta,
  onTrack,
}: {
  fm: NounFm;
  cta: string;
  onTrack: (t: FmTrack) => void;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [found, setFound] = useState<FmTrack | null>(null);
  const [yt, setYt] = useState<(FmSrc & { kind: 'youtube' }) | null>(null);
  const [manual, setManual] = useState('');

  const look = async () => {
    setErr(null);
    setFound(null);
    setYt(null);
    setBusy(true);
    const r = await fm.inspect(url);
    setBusy(false);
    if (!r.ok) setErr(r.reason);
    else if ('preview' in r) setYt(r.preview);
    else setFound(r.track);
  };
  const reset = () => {
    setUrl('');
    setFound(null);
    setYt(null);
    setManual('');
  };
  const tooLong = found !== null && found.dur > FM_MAX_TRACK_S;
  return (
    <div className="flex flex-col gap-1.5">
      <form
        className="flex gap-1.5"
        onSubmit={e => {
          e.preventDefault();
          void look();
        }}
      >
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="paste an Audius, YouTube or .mp3 link"
          className="min-w-0 flex-1 rounded-lg border border-white/20 bg-black/50 px-2 py-1.5 text-xs text-white outline-none"
          data-fm="url"
        />
        <button
          type="submit"
          disabled={busy || url.trim() === ''}
          className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
        >
          {busy ? '…' : 'LOOK UP'}
        </button>
      </form>
      {err !== null && <div className="text-[11px] text-[#ff6b5b]">{err}</div>}
      {yt !== null && found === null && (
        <div className="flex flex-col items-start gap-1">
          <YtPreview id={yt.id} onInfo={i => setFound({ src: yt, ...i, dur: Math.round(i.dur) })} />
          <div className="text-[10px] opacity-70">
            YouTube plays in its own player on the deck screen, ads and all.
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            length (if it won&apos;t load)
            <input
              value={manual}
              onChange={e => setManual(e.target.value)}
              placeholder="3:45"
              className="w-16 rounded border border-white/20 bg-black/50 px-1 py-0.5"
            />
            <button
              type="button"
              className="rounded bg-white/15 px-2 py-0.5 font-bold"
              disabled={parseDur(manual) <= 0}
              onClick={() =>
                setFound({
                  src: yt,
                  title: 'YouTube video',
                  artist: 'YouTube',
                  dur: parseDur(manual),
                })
              }
            >
              use
            </button>
          </div>
        </div>
      )}
      {found !== null && (
        <div className="flex items-center gap-2 rounded-lg bg-white/10 p-2" data-fm="found">
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold">{found.title}</div>
            <div className="truncate text-[11px] opacity-70">
              {found.artist} · {fmtDur(found.dur)} · {KIND[found.src.kind]}
            </div>
            {tooLong && (
              <div className="text-[11px] text-[#ff6b5b]">
                over the {FM_MAX_TRACK_S / 60} minute cap
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={tooLong}
            className="rounded-lg bg-[#ffd400] px-3 py-1.5 text-xs font-black text-black disabled:opacity-40"
            onClick={() => {
              onTrack(found);
              reset();
            }}
          >
            {cta}
          </button>
        </div>
      )}
    </div>
  );
}

function QueueTab({ fm, view, name }: { fm: NounFm; view: FmView; name: string }) {
  const s = view.state;
  const air = view.air;
  const mine = (owner?: string) => owner === view.myTag;
  const myCount = s?.queue.filter(e => mine(e.owner)).length ?? 0;
  return (
    <div className="flex flex-col gap-2">
      <LinkAdder fm={fm} cta="QUEUE IT" onTrack={t => fm.add(t, name)} />
      <div className="text-[10px] opacity-60">
        up to {FM_PER_RIDER} tracks each ({myCount} waiting), max {FM_MAX_TRACK_S / 60} min a track
      </div>
      <div className="flex max-h-[34vh] flex-col gap-1 overflow-y-auto pr-1" data-fm="queue">
        {air.track !== null && (
          <div className="flex items-center gap-2 rounded-lg bg-[#ffd400]/20 p-1.5">
            <span className="text-[10px] font-black text-[#ffd400]">
              {view.phase === 'ident' ? 'NEXT' : 'LIVE'}
            </span>
            <div className="min-w-0 flex-1 truncate">
              <b>{air.track.title}</b> <span className="opacity-70">{air.track.artist}</span>
            </div>
            <span className="text-[10px] opacity-70">{fmtDur(air.track.dur)}</span>
            {air.source === 'queue' && mine(air.track.owner) && (
              <button
                type="button"
                className="rounded bg-white/15 px-1.5 text-[10px] font-bold"
                onClick={() => fm.skip()}
              >
                skip
              </button>
            )}
          </div>
        )}
        {s !== null && s.queue.length === 0 && air.source !== 'set' && (
          <div className="opacity-60">
            queue&apos;s empty{air.track === null ? ', the pirate relay is filling in' : ''}
          </div>
        )}
        {s?.queue.map((e, i) => (
          <div key={e.id} className="flex items-center gap-1.5 rounded-lg bg-white/5 p-1.5">
            <span className="w-4 text-right text-[10px] opacity-60">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate">
                <b>{e.title}</b> <span className="opacity-70">{e.artist}</span>
              </div>
              <div className="text-[10px] opacity-60">
                {fmtDur(e.dur)} · {KIND[e.src.kind]} · {mine(e.owner) ? 'you' : e.by}
              </div>
            </div>
            {mine(e.owner) && (
              <>
                <button type="button" title="up" onClick={() => fm.move(e.id, -1)}>
                  ▲
                </button>
                <button type="button" title="down" onClick={() => fm.move(e.id, 1)}>
                  ▼
                </button>
                <button
                  type="button"
                  title="remove"
                  className="text-[#ff6b5b]"
                  onClick={() => fm.remove(e.id)}
                >
                  ✕
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Next time (within 24 h) the clock reads hh:mm. */
function nextAt(hhmm: string, now: number): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(now);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  let t = d.getTime();
  if (t < now - 60_000) t += 24 * 3600_000;
  return t;
}

function SetTab({ fm, view, name }: { fm: NounFm; view: FmView; name: string }) {
  const [dj, setDj] = useState(name);
  const [title, setTitle] = useState('');
  const [time, setTime] = useState(() => {
    const d = new Date(Date.now() + 15 * 60_000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [tracks, setTracks] = useState<FmTrack[]>([]);
  const sets = view.state?.sets ?? [];
  const startAt = nextAt(time, fm.serverNow());
  const len = setLength(tracks);
  const move = (i: number, d: number) =>
    setTracks(ts => {
      const j = i + d;
      if (j < 0 || j >= ts.length) return ts;
      const n = [...ts];
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  return (
    <div className="flex flex-col gap-2">
      <div className="font-bold">TODAY&apos;S SCHEDULE</div>
      {sets.length === 0 && <div className="opacity-60">no sets booked, the slot&apos;s yours</div>}
      {sets.map(x => (
        <div key={x.id} className="flex items-center gap-2 rounded-lg bg-white/5 p-1.5">
          <div className="min-w-0 flex-1">
            <div className="truncate">
              <b>{x.dj}</b> · {x.name}
            </div>
            <div className="text-[10px] opacity-60">
              {clock(x.startAt)}–{clock(setEnd(x))} · {x.tracks.length} tracks
              {x.startAt <= fm.serverNow() ? ' · LIVE' : ''}
            </div>
          </div>
          {x.owner === view.myTag && (
            <button
              type="button"
              className="rounded bg-white/15 px-1.5 text-[10px] font-bold text-[#ff6b5b]"
              onClick={() => fm.cancelSet(x.id)}
            >
              cancel
            </button>
          )}
        </div>
      ))}
      <div className="mt-1 font-bold">BOOK YOUR SET</div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-1.5 text-[11px]">
        <label htmlFor="fm-dj">DJ</label>
        <input
          id="fm-dj"
          value={dj}
          maxLength={20}
          onChange={e => setDj(e.target.value)}
          className="rounded border border-white/20 bg-black/50 px-2 py-1"
        />
        <label htmlFor="fm-set">set</label>
        <input
          id="fm-set"
          value={title}
          maxLength={32}
          placeholder="sunset session"
          onChange={e => setTitle(e.target.value)}
          className="rounded border border-white/20 bg-black/50 px-2 py-1"
        />
        <label htmlFor="fm-time">starts</label>
        <div className="flex items-center gap-2">
          <input
            id="fm-time"
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            className="rounded border border-white/20 bg-black/50 px-2 py-1"
          />
          <span className="opacity-60">
            {new Date(startAt).toDateString() !== new Date().toDateString() ? 'tomorrow ' : ''}
            {clock(startAt)}, runs {fmtDur(len / 1000)}
          </span>
        </div>
      </div>
      {tracks.length < FM_SET_MAX_TRACKS && (
        <LinkAdder fm={fm} cta="ADD" onTrack={t => setTracks(ts => [...ts, t])} />
      )}
      <div className="flex max-h-[24vh] flex-col gap-1 overflow-y-auto pr-1">
        {tracks.map((t, i) => (
          <div key={i} className="flex items-center gap-1.5 rounded-lg bg-white/5 p-1.5">
            <span className="w-4 text-right text-[10px] opacity-60">{i + 1}</span>
            <div className="min-w-0 flex-1 truncate">
              <b>{t.title}</b> <span className="opacity-70">{fmtDur(t.dur)}</span>
            </div>
            <button type="button" onClick={() => move(i, -1)}>
              ▲
            </button>
            <button type="button" onClick={() => move(i, 1)}>
              ▼
            </button>
            <button
              type="button"
              className="text-[#ff6b5b]"
              onClick={() => setTracks(ts => ts.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={tracks.length === 0}
        className="rounded-lg bg-[#d22209] px-3 py-2 text-sm font-black disabled:opacity-40"
        onClick={() => fm.bookSet(dj, title, startAt, tracks)}
      >
        BOOK SET · {tracks.length} tracks
      </button>
      <div className="text-[10px] opacity-60">
        one set per DJ, no overlaps, up to {FM_SET_MAX_TRACKS} tracks / 2 hours. Sets take over the
        station at their time; the queue carries on after.
      </div>
    </div>
  );
}

export function FmPanel({ game, onClose }: { game: Game; onClose: () => void }) {
  const fm = game.fm;
  const view = useFm(fm);
  const [tab, setTab] = useState<'queue' | 'set'>('queue');
  const [token, setToken] = useState('');
  const name = useMemo(() => game.name, [game]);
  // Keys type into the panel, not the skater
  useEffect(() => {
    game.input.setEnabled(false);
    const k = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onClose();
    };
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('keydown', k);
      if (!game.paused) game.input.setEnabled(true);
    };
  }, [game, onClose]);
  const tune = () => {
    game.unlockAudio();
    game.radio.setMode(view.tuned ? 'pirate' : 'fm');
  };
  const now = performance.now();
  return (
    <div
      className="w2-panel pointer-events-auto absolute left-1/2 top-1/2 z-40 flex max-h-[86vh] w-[420px] max-w-[calc(100vw-24px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-2 overflow-y-auto text-xs"
      data-fm="panel"
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <div className="w2-fm-logo">NOUN FM</div>
        <div className="text-[10px] opacity-60">
          live from the ice cream van{view.offline ? ' · offline (local station)' : ''}
        </div>
        <button type="button" className="ml-auto text-base" onClick={onClose} title="close (Esc)">
          ✕
        </button>
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-black/40 p-2">
        <span className={`w2-fm-dot ${view.air.track !== null ? 'w2-fm-live' : ''}`} />
        <div className="min-w-0 flex-1 truncate" data-fm="onair">
          {view.air.set !== null && (
            <span className="text-[#ffd400]">
              {view.air.set.dj} · {view.air.set.name} ({view.air.set.index + 1}/{view.air.set.count}
              ){' '}
            </span>
          )}
          {view.phase === 'ident' ? '📣 ident, then: ' : ''}
          {view.air.track !== null
            ? `${view.air.track.title} — ${view.air.track.artist}`
            : 'nothing queued: pirate relay'}
        </div>
        <button
          type="button"
          onClick={tune}
          className={`rounded-full px-3 py-1 text-[11px] font-black ${view.tuned ? 'bg-[#3ddc84] text-black' : 'bg-white/15'}`}
          data-fm="tune"
        >
          {view.tuned ? 'TUNED IN' : 'TUNE IN'}
        </button>
      </div>
      {view.trackError !== null && (
        <div className="text-[11px] text-[#ff6b5b]">{view.trackError}</div>
      )}
      {!view.ready && <div className="opacity-70">connecting to the station…</div>}
      <div className="flex gap-1">
        {(['queue', 'set'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1 text-[11px] font-bold ${tab === t ? 'bg-[#ffd400] text-black' : 'bg-white/10'}`}
          >
            {t === 'queue' ? 'QUEUE' : 'DJ SET FOR TODAY'}
          </button>
        ))}
      </div>
      {tab === 'queue' ? (
        <QueueTab fm={fm} view={view} name={name} />
      ) : (
        <SetTab fm={fm} view={view} name={name} />
      )}
      {view.error !== null && now - view.error.at < 8000 && (
        <div className="text-[11px] text-[#ff6b5b]" data-fm="error">
          {view.error.msg}
        </div>
      )}
      {view.notice !== null && now - view.notice.at < 4000 && view.error === null && (
        <div className="text-[11px] text-[#3ddc84]">{view.notice.msg}</div>
      )}
      <details className="text-[10px] opacity-60">
        <summary>station admin</summary>
        <div className="mt-1 flex gap-1.5">
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="admin token"
            className="min-w-0 flex-1 rounded border border-white/20 bg-black/50 px-2 py-1"
          />
          <button
            type="button"
            className="rounded bg-white/15 px-2 font-bold"
            onClick={() => fm.skip(token)}
          >
            skip track
          </button>
        </div>
      </details>
    </div>
  );
}

/**
 * The deck screen: NOUN FM's YouTube player, visible whenever a YouTube
 * track is on air for you (tuned in, or near the van). Closing it stops
 * that video for you until the next track.
 */
export function FmScreen({ fm, touch }: { fm: NounFm; touch: boolean }) {
  const view = useFm(fm);
  if (!view.screen) return null;
  return <FmScreenInner fm={fm} touch={touch} label={view.label} />;
}

function FmScreenInner({ fm, touch, label }: { fm: NounFm; touch: boolean; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    fm.yt.mount(el);
    return () => fm.yt.unmount();
  }, [fm]);
  return (
    <div
      className={`w2-panel pointer-events-auto absolute z-30 flex flex-col gap-1 !p-1.5 ${touch ? 'left-2 top-[150px]' : 'bottom-24 right-4'}`}
      data-fm="screen"
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className="w2-fm-dot w2-fm-live" />
        <span className="max-w-[170px] truncate font-bold">{label}</span>
        <button
          type="button"
          className="ml-auto px-1 text-sm"
          title="close: the YouTube track stops for you"
          onClick={() => fm.dismissScreen()}
        >
          ✕
        </button>
      </div>
      <div
        ref={ref}
        className="overflow-hidden rounded bg-black"
        style={{ width: Math.max(YT_MIN_PX, 220), height: Math.max(YT_MIN_PX, 220) }}
      />
    </div>
  );
}

export const FM_CSS = `
.w2-fm-logo{font-family:'Pip3',system-ui,sans-serif;font-style:italic;font-weight:900;font-size:20px;color:#ffd400;text-shadow:2px 2px 0 #d22209;letter-spacing:.02em}
.w2-fm-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#666;flex:none}
.w2-fm-live{background:#ff3020;box-shadow:0 0 8px #ff3020;animation:w2fmblink 1.2s steps(2) infinite}
@keyframes w2fmblink{50%{opacity:.35}}
`;
