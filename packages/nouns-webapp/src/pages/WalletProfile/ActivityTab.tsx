/**
 * Activity timeline — every feed event this wallet touched, worded by the
 * same registry as the homepage terminal feed, rendered as light in-shell
 * rows with infinite scroll on `/api/wallet/:identity/activity`.
 */
import type { WalletActivityEvent } from './types';

import { FC, useEffect, useMemo, useRef, useState } from 'react';

import { Link } from 'react-router';

import {
  describeEvent,
  extractAddresses,
  getEventDef,
  getEventLink,
  getExpandableText,
} from '@/components/TerminalFeed/eventRegistry';
import { useEnsNames } from '@/components/TerminalFeed/useEnsNames';

import { useWalletActivity } from './api';
import { fmtDate, relTime } from './format';
import { Card, Empty, EtherscanTx, Skeleton } from './ui';

const ActivityRow: FC<{ ev: WalletActivityEvent; ens: (a: string) => string | null }> = ({
  ev,
  ens,
}) => {
  const [open, setOpen] = useState(false);
  const def = getEventDef(ev.type, ev.data);
  const link = getEventLink(ev.type, ev.data);
  const expandable = getExpandableText(ev.type, ev.data);
  return (
    <div className="wp-row flex-col !items-stretch">
      <div className="flex items-start gap-2 text-xs">
        <span
          className="wp-pill shrink-0"
          style={{ borderColor: def.color, color: def.color, background: 'transparent' }}
        >
          {def.label}
        </span>
        <span className="min-w-0 flex-1 break-words">{describeEvent(ev.type, ev.data, ens)}</span>
        <span className="wp-muted ml-auto flex shrink-0 items-center gap-2 text-[11px]">
          {link != null && (
            <Link to={link} className="wp-link">
              view
            </Link>
          )}
          <EtherscanTx hash={ev.txHash} />
          <span title={fmtDate(ev.timestamp)}>{relTime(ev.timestamp)}</span>
        </span>
      </div>
      {expandable != null && (
        <div className="wp-reason">
          {open || expandable.length <= 200 ? expandable : `${expandable.slice(0, 200)}…`}
          {expandable.length > 200 && (
            <button
              type="button"
              className="wp-link ml-2 text-[11px]"
              onClick={() => setOpen(o => !o)}
            >
              {open ? 'less' : 'more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export const ActivityTab: FC<{ identity: string | undefined }> = ({ identity }) => {
  const q = useWalletActivity(identity);
  const events = useMemo(() => q.data?.pages.flatMap(p => p.events) ?? [], [q.data]);
  const addrs = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) for (const a of extractAddresses(e.data)) s.add(a);
    return Array.from(s);
  }, [events]);
  const ens = useEnsNames(addrs);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !q.hasNextPage) return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && !q.isFetchingNextPage) void q.fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [q, q.hasNextPage, q.isFetchingNextPage]);

  return (
    <Card title={`Activity · ${events.length}${q.hasNextPage === true ? '+' : ''}`}>
      {q.isLoading && (
        <div className="grid gap-2">
          <Skeleton />
          <Skeleton w="80%" />
          <Skeleton w="90%" />
          <Skeleton w="70%" />
        </div>
      )}
      {q.isError && <Empty>Could not load activity: {q.error.message}</Empty>}
      {!q.isLoading && !q.isError && events.length === 0 && (
        <Empty>No on-chain activity indexed for this wallet.</Empty>
      )}
      {events.map(e => (
        <ActivityRow
          key={`${e.txHash}-${e.type}-${e.blockNumber}-${JSON.stringify(e.data).length}`}
          ev={e}
          ens={ens}
        />
      ))}
      <div ref={sentinel} className="h-4" />
      {q.isFetchingNextPage && <Skeleton w="60%" />}
      {q.hasNextPage === true && !q.isFetchingNextPage && (
        <button
          type="button"
          className="wp-btn wp-btn-sm mt-2"
          onClick={() => void q.fetchNextPage()}
        >
          load more
        </button>
      )}
    </Card>
  );
};
