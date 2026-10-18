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
  FM_MIN_TRACK_S,
  FM_PER_RIDER,
  FM_SET_MAX_MS,
  FM_SET_MAX_TRACKS,
  setEnd,
  setLength,
  type FmSrc,
  type FmTrack,
} from '../../../../../nouns-party/src/fmStation';

import { type FmView, type NounFm } from './NounFm';
import { forgetSet, loadSetHistory, rememberSet, type SavedSet } from './setHistory';
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

/**
 * Look a YouTube video up through the official embed (cued, muted, never
 * played): its title + length, or why it can't go on air.
 */
function probeYouTube(
  id: string,
  host: HTMLElement,
  timeoutMs = 15_000,
): Promise<{ ok: true; info: Omit<FmTrack, 'src'> } | { ok: false; reason: string }> {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.style.cssText = `width:${YT_MIN_PX}px;height:${YT_MIN_PX}px`;
    host.appendChild(el);
    const deck = new YouTubeDeck();
    deck.mount(el);
    deck.setVolume(0);
    let started = false;
    const t0 = performance.now();
    const done = (r: Parameters<typeof resolve>[0]) => {
      window.clearInterval(iv);
      deck.unmount();
      el.remove();
      resolve(r);
    };
    const iv = window.setInterval(() => {
      if (!started) started = deck.play(id, 0, true);
      if (deck.error !== null)
        return done({
          ok: false,
          reason:
            deck.error === 101 || deck.error === 150
              ? 'the owner blocks embedding'
              : deck.error === 100
                ? 'video not found'
                : "YouTube wouldn't load it",
        });
      const i = deck.info();
      if (i.dur > 0)
        return done({
          ok: true,
          info: {
            title: i.title || 'YouTube video',
            artist: i.artist || 'YouTube',
            dur: Math.round(i.dur),
          },
        });
      if (performance.now() - t0 > timeoutMs) done({ ok: false, reason: 'timed out loading' });
    }, 400);
  });
}

/** Every link in a pasted block (newlines, spaces or commas between them). */
export function linksIn(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s"',<>]+/g) ?? [])];
}

/**
 * Paste a whole list of links: each is checked in turn and added to the set,
 * anything that won't play (blocked embed, gone, too long) is skipped and
 * listed, and it stops when the set is full (tracks or 2 hours).
 */
function BulkAdder({
  fm,
  tracks,
  onTrack,
}: {
  fm: NounFm;
  tracks: FmTrack[];
  onTrack: (t: FmTrack) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<{ at: number; of: number } | null>(null);
  const [skipped, setSkipped] = useState<{ url: string; reason: string }[]>([]);
  const [added, setAdded] = useState(0);
  const probeHost = useRef<HTMLDivElement>(null);
  const live = useRef(tracks);
  live.current = tracks;
  const links = linksIn(text);
  const run = async () => {
    const host = probeHost.current;
    if (host === null) return;
    setSkipped([]);
    setAdded(0);
    let ms = setLength(live.current);
    let n = live.current.length;
    for (let i = 0; i < links.length; i++) {
      const url = links[i]!;
      setBusy({ at: i + 1, of: links.length });
      const skip = (reason: string) => setSkipped(x => [...x, { url, reason }]);
      if (n >= FM_SET_MAX_TRACKS) {
        skip(`set is full (${FM_SET_MAX_TRACKS} tracks)`);
        continue;
      }
      const r = await fm.inspect(url);
      let track: FmTrack | null = null;
      if (!r.ok) skip(r.reason);
      else if ('preview' in r) {
        const p = await probeYouTube(r.preview.id, host);
        if (p.ok) track = { src: r.preview, ...p.info };
        else skip(p.reason);
      } else track = r.track;
      if (track === null) continue;
      if (track.dur > FM_MAX_TRACK_S) {
        skip(`too long (${fmtDur(track.dur)}, max ${fmtDur(FM_MAX_TRACK_S)})`);
        continue;
      }
      if (track.dur < FM_MIN_TRACK_S) {
        skip('too short');
        continue;
      }
      const next = ms + setLength([track]);
      if (next > FM_SET_MAX_MS) {
        skip('set would pass 2 hours');
        continue;
      }
      ms = next;
      n++;
      onTrack(track);
      setAdded(a => a + 1);
    }
    setBusy(null);
    setText('');
  };
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        disabled={busy !== null}
        rows={3}
        placeholder="or paste a whole list of links, one per line: the ones that won't play get skipped"
        className="rounded-lg border border-white/20 bg-black/50 px-2 py-1.5 text-xs text-white outline-none"
        data-fm="bulk"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy !== null || links.length === 0}
          className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-bold disabled:opacity-40"
          onClick={() => void run()}
        >
          {busy !== null ? `CHECKING ${busy.at}/${busy.of}…` : `ADD ALL · ${links.length} links`}
        </button>
        {(added > 0 || skipped.length > 0) && busy === null && (
          <span className="text-[11px] opacity-80">
            added {added}
            {skipped.length > 0 ? ` · skipped ${skipped.length}` : ''}
          </span>
        )}
      </div>
      {skipped.length > 0 && (
        <div className="max-h-[10vh] overflow-y-auto text-[10px] text-[#ff6b5b]">
          {skipped.map(x => (
            <div key={x.url} className="truncate">
              skipped {x.url.replace(/^https?:\/\/(www\.)?/, '')}: {x.reason}
            </div>
          ))}
        </div>
      )}
      {/* Hidden embeds used to look videos up (YouTube needs them on the page) */}
      <div
        ref={probeHost}
        aria-hidden
        className="pointer-events-none fixed left-0 top-0 overflow-hidden opacity-0"
        style={{ width: YT_MIN_PX, height: YT_MIN_PX }}
      />
    </div>
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
  const [history, setHistory] = useState<SavedSet[]>(() => loadSetHistory());
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
      {history.length > 0 && (
        <>
          <div className="mt-1 font-bold">YOUR SAVED SETS</div>
          <div className="flex max-h-[18vh] flex-col gap-1 overflow-y-auto pr-1">
            {history.map((h, i) => (
              <div
                key={`${h.at}-${i}`}
                className="flex items-center gap-2 rounded-lg bg-white/5 p-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate">
                    <b>{h.name || 'untitled set'}</b> · {h.dj}
                  </div>
                  <div className="text-[10px] opacity-60">
                    {h.tracks.length} tracks · {fmtDur(setLength(h.tracks) / 1000)} · last booked{' '}
                    {new Date(h.at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded bg-[#ffd400] px-2 py-0.5 text-[10px] font-black text-black"
                  onClick={() => {
                    setDj(h.dj);
                    setTitle(h.name);
                    setTracks(h.tracks.slice(0, FM_SET_MAX_TRACKS));
                  }}
                >
                  LOAD
                </button>
                <button
                  type="button"
                  className="text-[#ff6b5b]"
                  title="Forget this set"
                  onClick={() => setHistory(forgetSet(i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}
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
        <>
          <LinkAdder fm={fm} cta="ADD" onTrack={t => setTracks(ts => [...ts, t])} />
          <BulkAdder fm={fm} tracks={tracks} onTrack={t => setTracks(ts => [...ts, t])} />
        </>
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
        onClick={() => {
          fm.bookSet(dj, title, startAt, tracks);
          setHistory(rememberSet({ dj, name: title, tracks }));
        }}
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
