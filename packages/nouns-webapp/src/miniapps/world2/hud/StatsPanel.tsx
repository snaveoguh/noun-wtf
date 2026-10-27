// ── All-time stats: the trophy icon and the leaderboard panel it opens ──
//
// (Was World2Page's StatsChip.) The icon's tooltip carries the fastest
// record, the panel the top 10 per board, your best and the wallet link.

import type { MyBests, StatKey, StatRow, WorldStats } from '../net/Stats';

import { useState, useSyncExternalStore } from 'react';

import { shortAddr, STAT_INFO, walletLink } from '../net/Stats';
import { WalletLink } from '../ui/WalletLink';

import { IconButton } from './IconButton';

/** Fastest of all time (room leaderboard): the record in the tooltip, top 10 on click. */
const STAT_TABS: StatKey[] = [
  'kmh',
  'combo',
  'session',
  'airM',
  'airS',
  'grindM',
  'downM',
  'km',
  'tricks',
  'playS',
];

export function StatsButton({
  stats,
  open,
  onToggle,
}: {
  stats: WorldStats | null;
  open: boolean;
  onToggle: () => void;
}) {
  const speed = stats?.boards.kmh ?? [];
  const top = speed.length > 0 ? speed[0] : undefined;
  return (
    <IconButton
      icon="trophy"
      on={open}
      label={
        top !== undefined
          ? `Stats & records: ${Math.round(top.value)} km/h by ${top.name}`
          : 'Stats & records'
      }
      onClick={onToggle}
    />
  );
}

export function StatsPanel({
  stats,
  mine,
  me,
  players,
}: {
  stats: WorldStats | null;
  mine: MyBests;
  me: string;
  players: number;
}) {
  const [tab, setTab] = useState<StatKey>('kmh');
  const rows = stats?.boards[tab] ?? [];
  const info = STAT_INFO[tab];
  // A linked rider is their address's row, whatever name they play under
  const link = useSyncExternalStore(walletLink.subscribe, walletLink.get);
  const isMe = (e: StatRow) =>
    link !== null && e.addr !== undefined
      ? e.addr.toLowerCase() === link.address.toLowerCase()
      : link === null && e.name === me;
  const myRank = rows.findIndex(isMe);
  const myBest = tab in mine.best ? mine.best[tab as keyof MyBests['best']] : undefined;
  const today = stats?.days[new Date().toISOString().slice(0, 10)] ?? 0;
  return (
    <div
      className="w2-panel pointer-events-auto relative z-30 flex w-[300px] max-w-[calc(100vw-32px)] flex-col gap-1.5 text-xs"
      data-w2stats=""
    >
      <div className="flex items-baseline justify-between font-bold">
        <span>NOUN WORLD STATS</span>
        <span className="text-[10px] opacity-60">{players} online now</span>
      </div>
      {stats !== null && (
        <div className="grid grid-cols-3 gap-1 text-center">
          <div className="rounded-lg bg-white/10 p-1">
            <b className="block text-sm">{stats.riders.toLocaleString()}</b>
            <span className="text-[10px] opacity-60">players ever</span>
          </div>
          <div className="rounded-lg bg-white/10 p-1">
            <b className="block text-sm">{stats.sessions.toLocaleString()}</b>
            <span className="text-[10px] opacity-60">sessions</span>
          </div>
          <div className="rounded-lg bg-white/10 p-1">
            <b className="block text-sm">{today.toLocaleString()}</b>
            <span className="text-[10px] opacity-60">today</span>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {STAT_TABS.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tab === t ? 'bg-[#ffd400] text-black' : 'bg-white/10'}`}
          >
            {STAT_INFO[t].tab}
          </button>
        ))}
      </div>
      <div className="font-bold">{info.title}</div>
      {stats === null && <div className="opacity-70">loading…</div>}
      {stats !== null && rows.length === 0 && (
        <div className="opacity-70">no records yet, go set one</div>
      )}
      <div className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto pr-1">
        {rows.map((e, i) => (
          <div key={i} className={isMe(e) ? 'font-bold text-[#ffd400]' : ''}>
            <div className="flex justify-between gap-3">
              <span className="truncate" title={e.addr}>
                {i + 1}. {e.name}
                {e.addr !== undefined && (
                  <span className="text-[10px] opacity-60">
                    {' '}
                    <span className="text-[#5be37d]">✓</span> {shortAddr(e.addr)}
                  </span>
                )}
              </span>
              <b className="shrink-0">{info.fmt(e.value)}</b>
            </div>
            {e.label !== undefined && e.label !== '' && (
              <div className="truncate pl-4 text-[10px] opacity-60">{e.label}</div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 opacity-70">
        you:{' '}
        {myBest !== undefined
          ? info.fmt(myBest)
          : myRank >= 0
            ? info.fmt(rows[myRank]!.value)
            : '–'}
        {myRank >= 0 ? ` (#${myRank + 1})` : ''}
      </div>
      <WalletLink me={me} />
    </div>
  );
}
