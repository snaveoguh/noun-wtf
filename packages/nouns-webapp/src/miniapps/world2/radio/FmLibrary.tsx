// ── NOUN FM: today's schedule + the shared set library (panel parts) ─────
//
// ScheduleBoard sits at the top of the decks panel for everyone: who's on
// now (with the live set's tracklist), what's next, the rest of today.
// LibraryTab lists every shared set; anyone can open one, PLAY NOW (books
// it on the station at the next free slot under their own key, crediting
// its DJ) or LOAD it into the booking form.

import { useEffect, useState } from 'react';

import {
  setEnd,
  setLength,
  type FmSet,
  type FmTrack,
} from '../../../../../nouns-party/src/fmStation';

import { clock, fmtDur, KIND } from './fmFormat';
import {
  creditFor,
  deleteLibSet,
  markPlayed,
  nextFreeSlot,
  publishSet,
  type LibSet,
} from './library';
import { getLibCache, inLibrary, setLibCache, useLibrary, type SetDraft } from './libraryStore';
import { type FmView, type NounFm } from './NounFm';
import { type SavedSet } from './setHistory';

// ── pieces ────────────────────────────────────────────────────────────

export function Tracklist({ tracks, current }: { tracks: FmTrack[]; current?: number }) {
  return (
    <ol className="flex flex-col gap-0.5 pl-1" data-fm="tracklist">
      {tracks.map((t, i) => (
        <li
          // eslint-disable-next-line @eslint-react/no-array-index-key -- a fixed list; a set may repeat a track
          key={i}
          className={`flex items-center gap-1.5 rounded px-1 py-0.5 ${i === current ? 'bg-[#ffd400]/20' : ''}`}
        >
          <span className="w-4 flex-none text-right text-[10px] opacity-60">
            {i === current ? '▶' : i + 1}
          </span>
          <span className="min-w-0 flex-1 truncate">
            <b>{t.title}</b> <span className="opacity-70">{t.artist}</span>
          </span>
          <span className="flex-none text-[10px] opacity-60">
            {fmtDur(t.dur)} · {KIND[t.src.kind]}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ScheduleRow({
  set,
  now,
  live,
  current,
  mine,
  onCancel,
}: {
  set: FmSet;
  now: number;
  live: boolean;
  current?: number;
  mine: boolean;
  onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const mins = Math.max(0, Math.round((set.startAt - now) / 60_000));
  return (
    <div
      className={`rounded-lg p-1.5 ${live ? 'bg-[#d22209]/40' : 'bg-white/5'}`}
      data-fm={live ? 'live-set' : 'next-set'}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
        >
          <div className="truncate">
            {live ? (
              <span className="mr-1 text-[10px] font-black text-[#ffd400]">ON AIR</span>
            ) : (
              <span className="mr-1 text-[10px] font-bold opacity-80">{clock(set.startAt)}</span>
            )}
            <b>{set.dj}</b> · {set.name}
          </div>
          <div className="text-[10px] opacity-60">
            {live
              ? `track ${(current ?? 0) + 1}/${set.tracks.length} · ends ${clock(setEnd(set))}`
              : `${inMins(mins)} · ${set.tracks.length} tracks · ${fmtDur(setLength(set.tracks) / 1000)}`}{' '}
            · {open ? 'hide tracklist ▴' : 'tracklist ▾'}
          </div>
        </button>
        {mine && (
          <button
            type="button"
            className="flex-none rounded bg-white/15 px-1.5 text-[10px] font-bold text-[#ff6b5b]"
            onClick={onCancel}
          >
            cancel
          </button>
        )}
      </div>
      {open && (
        <div className="mt-1 max-h-[22vh] overflow-y-auto">
          <Tracklist tracks={set.tracks} current={live ? current : undefined} />
        </div>
      )}
    </div>
  );
}

/** Today on NOUN FM, for everyone: the live set, what's next, the rest. */
export function ScheduleBoard({ fm, view }: { fm: NounFm; view: FmView }) {
  const [all, setAll] = useState(false);
  const sets = view.state?.sets ?? [];
  const now = fm.serverNow();
  const live = sets.find(x => x.startAt <= now && now < setEnd(x));
  const next = sets.filter(x => x.startAt > now);
  const shown = all ? next : next.slice(0, 2);
  return (
    <div className="flex flex-col gap-1" data-fm="schedule">
      <div className="flex items-center text-[10px] font-bold tracking-wide opacity-80">
        TODAY ON NOUN FM
        <span className="ml-1 font-normal opacity-70">
          ·{' '}
          {sets.length === 0
            ? 'no DJ sets booked'
            : `${sets.length} set${sets.length === 1 ? '' : 's'}`}
        </span>
      </div>
      {live !== undefined && (
        <ScheduleRow
          key={live.id}
          set={live}
          now={now}
          live
          current={view.air.set?.id === live.id ? view.air.set.index : undefined}
          mine={live.owner === view.myTag}
          onCancel={() => fm.cancelSet(live.id)}
        />
      )}
      {live === undefined && (
        <div className="text-[10px] opacity-60">
          no set on air{view.air.source === 'queue' ? ': the open queue is playing' : ''}. Pick one
          from the LIBRARY and PLAY NOW.
        </div>
      )}
      {shown.length > 0 && <div className="text-[10px] font-bold opacity-70">UP NEXT</div>}
      {shown.map(x => (
        <ScheduleRow
          key={x.id}
          set={x}
          now={now}
          live={false}
          mine={x.owner === view.myTag}
          onCancel={() => fm.cancelSet(x.id)}
        />
      ))}
      {next.length > 2 && (
        <button
          type="button"
          className="self-start text-[10px] underline opacity-70"
          onClick={() => setAll(a => !a)}
        >
          {all ? 'show less' : `+ ${next.length - 2} more today`}
        </button>
      )}
    </div>
  );
}

type Status = { ok: boolean; msg: string };

function inMins(m: number): string {
  if (m < 1) return 'starting';
  if (m < 60) return `in ${m} min`;
  return `in ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

function LibRow({
  set,
  open,
  onToggle,
  mine,
  status,
  confirm,
  onPlay,
  onLoad,
  onDelete,
}: {
  set: LibSet;
  open: boolean;
  onToggle: () => void;
  mine: boolean;
  status: Status | undefined;
  confirm: string | null;
  onPlay: () => void;
  onLoad: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg bg-white/5 p-1.5" data-fm="lib-set">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={onToggle}
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate">
            <b>{set.name}</b> · {set.dj}
            {mine && <span className="ml-1 text-[10px] text-[#3ddc84]">yours</span>}
          </div>
          <div className="text-[10px] opacity-60">
            {set.tracks.length} tracks · {fmtDur(setLength(set.tracks) / 1000)} · ▶ {set.plays}{' '}
            {set.plays === 1 ? 'play' : 'plays'}
          </div>
        </div>
        <span className="flex-none text-[10px] opacity-70">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <div className="max-h-[26vh] overflow-y-auto">
            <Tracklist tracks={set.tracks} />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="rounded-lg bg-[#d22209] px-3 py-1.5 text-xs font-black"
              onClick={onPlay}
              data-fm="play-now"
            >
              {confirm !== null ? 'REPLACE MY SET + PLAY' : '▶ PLAY NOW'}
            </button>
            <button
              type="button"
              className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-bold"
              onClick={onLoad}
            >
              LOAD TO EDIT
            </button>
            {mine && (
              <button
                type="button"
                className="ml-auto rounded-lg bg-white/10 px-2 py-1.5 text-[10px] font-bold text-[#ff6b5b]"
                onClick={onDelete}
              >
                delete
              </button>
            )}
          </div>
          {confirm !== null && (
            <div className="text-[11px] text-[#ffd400]">
              you already have &quot;{confirm}&quot; booked: playing this replaces it. Tap again to
              go.
            </div>
          )}
          {status !== undefined && (
            <div
              className={`text-[11px] ${status.ok ? 'text-[#3ddc84]' : 'text-[#ff6b5b]'}`}
              data-fm="lib-status"
            >
              {status.msg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LibraryTab({
  fm,
  view,
  name,
  history,
  onLoad,
}: {
  fm: NounFm;
  view: FmView;
  name: string;
  history: SavedSet[];
  onLoad: (d: SetDraft) => void;
}) {
  const { lib, err, busy, refresh } = useLibrary();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [confirm, setConfirm] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const say = (id: string, s: Status) => setStatus(x => ({ ...x, [id]: s }));

  const play = async (set: LibSet) => {
    const s = view.state;
    if (s === null) return say(set.id, { ok: false, msg: 'not connected to the station yet' });
    const now = fm.serverNow();
    const mine = s.sets.find(x => x.owner === view.myTag);
    if (mine !== undefined && mine.startAt <= now)
      return say(set.id, { ok: false, msg: 'your set is live: cancel it first' });
    if (mine !== undefined && confirm !== set.id) {
      setConfirm(set.id);
      return;
    }
    setConfirm(null);
    const at = nextFreeSlot(s.sets, setLength(set.tracks), now, mine?.id ?? null);
    if (at === null)
      return say(set.id, { ok: false, msg: "no free slot left in today's schedule" });
    const c = creditFor(set, name, set.by === view.myTag);
    say(set.id, { ok: true, msg: 'booking…' });
    const r = await fm.bookSet(c.dj, c.name, at, set.tracks);
    if (!r.ok) return say(set.id, { ok: false, msg: `couldn't book it: ${r.msg}` });
    say(set.id, {
      ok: true,
      msg:
        at - now < 15_000
          ? 'on air now: tune in!'
          : `booked: starts ${clock(at)} (after the set that's on)`,
    });
    void markPlayed(fm.libraryKey(), set.id);
    const c0 = getLibCache();
    if (c0 !== null)
      setLibCache({
        ...c0,
        sets: c0.sets.map(x => (x.id === set.id ? { ...x, plays: x.plays + 1 } : x)),
      });
  };

  const del = async (set: LibSet) => {
    const r = await deleteLibSet(fm.libraryKey(), set.id);
    if (!r.ok) return say(set.id, { ok: false, msg: r.reason });
    const c0 = getLibCache();
    if (c0 !== null)
      setLibCache({
        sets: c0.sets.filter(x => x.id !== set.id),
        total: Math.max(0, c0.total - 1),
      });
  };

  const unshared = lib === null ? [] : history.filter(h => !inLibrary(h));
  const shareAll = async () => {
    setSharing('…');
    let n = 0;
    let last = '';
    for (const h of unshared) {
      const r = await publishSet(fm.libraryKey(), h);
      if (r.ok) n++;
      else last = r.reason;
    }
    setSharing(`shared ${n}${last !== '' ? ` · ${last}` : ''}`);
    void refresh();
  };

  const needle = q.trim().toLowerCase();
  const sets = (lib?.sets ?? []).filter(
    s =>
      needle === '' ||
      s.name.toLowerCase().includes(needle) ||
      s.dj.toLowerCase().includes(needle) ||
      s.tracks.some(t => `${t.title} ${t.artist}`.toLowerCase().includes(needle)),
  );
  const mineSet = view.state?.sets.find(x => x.owner === view.myTag);

  return (
    <div className="flex flex-col gap-2" data-fm="library">
      <div className="flex items-center gap-1.5">
        <div className="font-bold">SET LIBRARY{lib !== null ? ` · ${lib.total}` : ''}</div>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="search sets, DJs, tracks"
          className="min-w-0 flex-1 rounded-lg border border-white/20 bg-black/50 px-2 py-1 text-xs text-white outline-none"
        />
        <button
          type="button"
          className="rounded-lg bg-white/15 px-2 py-1 text-xs font-bold disabled:opacity-40"
          disabled={busy}
          onClick={() => void refresh()}
          title="refresh"
        >
          {busy ? '…' : '↻'}
        </button>
      </div>
      <div className="text-[10px] opacity-60">
        every DJ set shared on NOUN FM. Anyone can put one on: PLAY NOW books it on the station
        under your name at the next free slot, credited to its DJ.
      </div>
      {err !== null && <div className="text-[11px] text-[#ff6b5b]">{err}</div>}
      {unshared.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-[#ffd400]/15 p-1.5 text-[11px]">
          <span className="min-w-0 flex-1">
            {unshared.length} of your saved set{unshared.length === 1 ? ' is' : 's are'} only on
            this device
          </span>
          <button
            type="button"
            disabled={sharing === '…'}
            className="flex-none rounded bg-[#ffd400] px-2 py-0.5 text-[10px] font-black text-black disabled:opacity-40"
            onClick={() => void shareAll()}
          >
            SHARE {unshared.length === 1 ? 'IT' : 'ALL'}
          </button>
        </div>
      )}
      {sharing !== null && sharing !== '…' && (
        <div className="text-[11px] text-[#3ddc84]">{sharing}</div>
      )}
      <div className="flex max-h-[44vh] flex-col gap-1 overflow-y-auto pr-1" data-fm="lib-list">
        {lib === null && busy && <div className="opacity-60">loading the library…</div>}
        {lib !== null && sets.length === 0 && (
          <div className="opacity-60">
            {needle !== ''
              ? 'nothing matches'
              : 'no sets shared yet: book one in DJ SET FOR TODAY and it lands here'}
          </div>
        )}
        {sets.map(s => (
          <LibRow
            key={s.id}
            set={s}
            open={open === s.id}
            onToggle={() => {
              setOpen(o => (o === s.id ? null : s.id));
              setConfirm(null);
            }}
            mine={s.by === view.myTag}
            status={status[s.id]}
            confirm={confirm === s.id ? (mineSet?.name ?? 'your set') : null}
            onPlay={() => void play(s)}
            onLoad={() => onLoad({ ...creditFor(s, name, s.by === view.myTag), tracks: s.tracks })}
            onDelete={() => void del(s)}
          />
        ))}
      </div>
    </div>
  );
}
