/** Small presentational primitives shared across the profile page. */
import type { NounSeedLike } from './types';

import { FC, ReactNode, useMemo, useState } from 'react';

import { CheckIcon, CopyIcon } from 'lucide-react';
import { Link } from 'react-router';

import { getNoun } from '@/components/StandaloneNoun';

import { fmtInt, num, shortAddr, statusTone, supportLabel } from './format';

export const Card: FC<{
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  right?: ReactNode;
}> = ({ children, className, title, right }) => (
  <section className={`wp-card ${className ?? ''}`}>
    {(title != null || right != null) && (
      <div className="mb-2 flex items-center justify-between gap-2">
        {title != null && <h3 className="wp-h !mb-0">{title}</h3>}
        {right}
      </div>
    )}
    {children}
  </section>
);

export const Pill: FC<{
  children: ReactNode;
  tone?: 'accent' | 'pos' | 'neg' | 'mid';
  title?: string;
}> = ({ children, tone, title }) => (
  <span className={`wp-pill ${tone != null ? `wp-pill-${tone}` : ''}`} title={title}>
    {children}
  </span>
);

export const StatusPill: FC<{ status: string | null | undefined }> = ({ status }) => {
  if (!status) return null;
  const tone = statusTone(status);
  return <Pill tone={tone === 'muted' ? undefined : tone}>{status.replace(/_/g, ' ')}</Pill>;
};

export const SupportChip: FC<{ support: number | null | undefined }> = ({ support }) => {
  let tone: 'pos' | 'neg' | 'mid' = 'mid';
  if (support === 1) tone = 'pos';
  else if (support === 0) tone = 'neg';
  return <Pill tone={tone}>{supportLabel(support)}</Pill>;
};

export const Skeleton: FC<{ h?: number; w?: string; className?: string }> = ({
  h = 14,
  w = '100%',
  className,
}) => <div className={`wp-skel ${className ?? ''}`} style={{ height: h, width: w }} />;

export const Empty: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="wp-muted py-6 text-center text-xs">{children}</div>
);

/** For/against/abstain stacked bar. */
export const TriBar: FC<{
  forN: unknown;
  againstN: unknown;
  abstainN: unknown;
  height?: number;
}> = ({ forN, againstN, abstainN, height = 6 }) => {
  const f = num(forN);
  const a = num(againstN);
  const ab = num(abstainN);
  const t = f + a + ab;
  if (t === 0) return <div className="wp-tri" style={{ height }} />;
  return (
    <div className="wp-tri" style={{ height }} title={`${f} for · ${a} against · ${ab} abstain`}>
      <span className="wp-bg-pos" style={{ width: `${(f / t) * 100}%` }} />
      <span className="wp-bg-neg" style={{ width: `${(a / t) * 100}%` }} />
      <span className="wp-bg-mid" style={{ width: `${(ab / t) * 100}%` }} />
    </div>
  );
};

export const Bar: FC<{ pct: number; tone?: 'accent' | 'pos' | 'neg' | 'mid'; height?: number }> = ({
  pct,
  tone = 'accent',
  height = 6,
}) => (
  <div className="wp-bar" style={{ height }}>
    <span className={`wp-bg-${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
  </div>
);

/** Noun image from a seed — no RPC, pure SVG build. */
export const NounSeedImage: FC<{
  nounId: number | string;
  seed: NounSeedLike | null | undefined;
  isV2?: boolean;
  className?: string;
  title?: string;
}> = ({ nounId, seed, isV2 = false, className, title }) => {
  const image = useMemo(() => {
    if (!seed) return null;
    try {
      return getNoun(String(nounId), seed, isV2).image;
    } catch {
      return null;
    }
  }, [nounId, seed, isV2]);
  if (image == null) {
    return (
      <div className={`wp-noun flex items-center justify-center ${className ?? ''}`} title={title}>
        <span className="wp-muted text-xs">⌐◨-◨</span>
      </div>
    );
  }
  return (
    <img
      src={image}
      alt={`Noun ${nounId}`}
      title={title}
      className={`wp-noun ${className ?? ''}`}
      draggable={false}
    />
  );
};

export const NounLink: FC<{ nounId: number | string; isV2?: boolean; children?: ReactNode }> = ({
  nounId,
  isV2 = false,
  children,
}) => (
  <Link to={`${isV2 ? '/v2' : ''}/noun/${nounId}`} className="wp-link">
    {children ?? `Noun ${nounId}`}
  </Link>
);

export const PropLink: FC<{ id: number | string; title?: string | null; isV2?: boolean }> = ({
  id,
  title,
  isV2 = false,
}) => (
  <Link to={`${isV2 ? '/v2' : ''}/vote/${id}`} className="wp-link wp-ellipsis">
    <span className="wp-muted">#{id}</span> {title ?? `Proposal ${id}`}
  </Link>
);

export const AddrLink: FC<{
  address: string | null | undefined;
  ens?: (a: string) => string | null;
}> = ({ address, ens }) => {
  if (!address) return <span className="wp-muted">—</span>;
  const name = ens?.(address) ?? null;
  return (
    <Link to={`/gamer/${encodeURIComponent(address)}`} className="wp-link wp-mono" title={address}>
      {name ?? shortAddr(address)}
    </Link>
  );
};

export const CopyButton: FC<{ text: string; label?: string }> = ({ text, label }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="wp-btn wp-btn-sm"
      title={`Copy ${label ?? text}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked — nothing to do */
        }
      }}
    >
      {done ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
    </button>
  );
};

export const KV: FC<{ k: ReactNode; v: ReactNode }> = ({ k, v }) => (
  <div className="flex items-baseline justify-between gap-3 py-1 text-xs">
    <span className="wp-muted">{k}</span>
    <span className="wp-mono text-right">{v}</span>
  </div>
);

export const CountLabel: FC<{ n: unknown }> = ({ n }) => (
  <span className="wp-tab-count">{fmtInt(n)}</span>
);

export const EtherscanTx: FC<{ hash: string | null | undefined }> = ({ hash }) => {
  if (!hash || !hash.startsWith('0x') || hash.length < 10) return null;
  return (
    <a
      href={`https://etherscan.io/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="wp-link text-[10px]"
      title={hash}
    >
      tx ↗
    </a>
  );
};
