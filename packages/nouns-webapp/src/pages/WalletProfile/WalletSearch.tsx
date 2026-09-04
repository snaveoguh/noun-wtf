/** ENS / address search box for /gamer and /explore/wallet without an identity. */
import { FC, useState } from 'react';

import { SearchIcon } from 'lucide-react';
import { useNavigate } from 'react-router';

export const WalletSearch: FC<{ compact?: boolean; initial?: string; basePath?: string }> = ({
  compact = false,
  initial = '',
  basePath = '/gamer',
}) => {
  const navigate = useNavigate();
  const [q, setQ] = useState(initial);
  const submit = () => {
    const v = q.trim();
    if (v.length === 0) return;
    navigate(`${basePath}/${encodeURIComponent(v)}`);
  };
  return (
    <div className={compact ? 'flex items-center gap-2' : 'wp-card mx-auto mt-10 max-w-xl'}>
      {!compact && (
        <>
          <h1 className="m-0 text-xl font-bold">Gamer profile</h1>
          <p className="wp-muted mb-3 mt-1 text-xs">
            Every vote, proposal, candidate, bid, settlement, stream and delegation a wallet has
            made in and around Nouns DAO — plus an AI overview and Autopilot vote drafts for the
            owner.
          </p>
        </>
      )}
      <div className="flex w-full items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon
            size={14}
            className="wp-muted pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          />
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="ENS or 0x address — e.g. hugo.eth"
            className="wp-input !pl-8"
            autoFocus={!compact}
          />
        </div>
        <button type="button" className="wp-btn wp-btn-primary" onClick={submit}>
          {compact ? 'Go' : 'Open profile'}
        </button>
      </div>
    </div>
  );
};
