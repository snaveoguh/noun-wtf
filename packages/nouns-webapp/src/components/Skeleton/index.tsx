import type { CSSProperties, FC } from 'react';

import classes from './Skeleton.module.css';

// ─── Bone (reusable building block) ─────────────────────────────────────────

interface BoneProps {
  w: number | string;
  h: number | string;
  circle?: boolean;
  dark?: boolean;
  delay?: number;
  style?: CSSProperties;
}

const Bone: FC<BoneProps> = ({ w, h, circle, dark, delay, style }) => (
  <div
    className={circle ? classes.boneRound : dark ? classes.boneDark : classes.bone}
    style={{
      width: typeof w === 'number' ? w : w,
      height: typeof h === 'number' ? h : h,
      animationDelay: delay ? `${delay}s` : undefined,
      flexShrink: 0,
      ...style,
    }}
  />
);

// ─── Auction Skeleton (homepage) ─────────────────────────────────────────────

export const AuctionSkeleton: FC = () => (
  <div className={classes.auctionWrap}>
    {/* Left: noun image */}
    <div className={classes.auctionLeft}>
      <Bone w="100%" h={0} style={{ paddingTop: '100%' }} />
      <Bone w={180} h={28} delay={0.2} style={{ borderRadius: 8 }} />
    </div>
    {/* Right: activity */}
    <div className={classes.auctionRight}>
      <Bone w={100} h={14} delay={0.1} />
      <Bone w={200} h={32} delay={0.2} />
      <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Bone w={80} h={12} delay={0.15} />
          <Bone w={140} h={28} delay={0.25} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Bone w={80} h={12} delay={0.2} />
          <Bone w={120} h={28} delay={0.3} />
        </div>
      </div>
      <Bone w="60%" h={14} delay={0.35} style={{ marginTop: 12 }} />
      <Bone w="100%" h={48} delay={0.4} style={{ borderRadius: 12, marginTop: 8 }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Bone w={36} h={36} delay={0.45} style={{ borderRadius: 8 }} />
        <Bone w={36} h={36} delay={0.5} style={{ borderRadius: 8 }} />
      </div>
    </div>
  </div>
);

// ─── Feed Skeleton ───────────────────────────────────────────────────────────

const FeedCardSkeleton: FC<{ delay: number }> = ({ delay }) => (
  <div className={classes.feedCard}>
    <div className={classes.feedCardHeader}>
      <Bone w={32} h={32} circle delay={delay} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <Bone w={100} h={12} delay={delay + 0.05} />
        <Bone w={70} h={10} delay={delay + 0.1} />
      </div>
      <Bone w={24} h={10} delay={delay + 0.15} />
    </div>
    <div className={classes.feedCardLines}>
      <Bone w="95%" h={12} delay={delay + 0.1} />
      <Bone w="70%" h={12} delay={delay + 0.15} />
    </div>
    <div className={classes.feedCardFooter}>
      <Bone w={30} h={10} delay={delay + 0.2} />
      <Bone w={30} h={10} delay={delay + 0.25} />
      <Bone w={30} h={10} delay={delay + 0.3} />
    </div>
  </div>
);

export const FeedSkeleton: FC<{ inline?: boolean }> = ({ inline }) => {
  const content = (
    <>
      {/* Title */}
      <Bone w={160} h={28} />
      {/* Tab pills */}
      <div className={classes.feedTabs}>
        <Bone w={50} h={30} style={{ borderRadius: 20 }} />
        <Bone w={65} h={30} delay={0.1} style={{ borderRadius: 20 }} />
        <Bone w={50} h={30} delay={0.2} style={{ borderRadius: 20 }} />
        <Bone w={45} h={30} delay={0.3} style={{ borderRadius: 20 }} />
      </div>
      {/* Compose box */}
      <Bone w="100%" h={50} delay={0.1} style={{ borderRadius: 8 }} />
      {/* Cast cards */}
      <div className={classes.feedCards}>
        {[0, 0.15, 0.3, 0.45, 0.6].map((d, i) => (
          <FeedCardSkeleton key={i} delay={d} />
        ))}
      </div>
    </>
  );

  if (inline) return <>{content}</>;

  return <div className={classes.feedWrap}>{content}</div>;
};

// ─── Terminal Skeleton ───────────────────────────────────────────────────────

export const TerminalSkeleton: FC = () => (
  <div className={classes.terminalWrap}>
    <div className={classes.terminalBox}>
      <Bone w="100%" h={16} dark delay={0} />
      <Bone w="85%" h={16} dark delay={0.15} />
      <Bone w="90%" h={16} dark delay={0.3} />
      <Bone w="60%" h={16} dark delay={0.45} />
      <Bone w="75%" h={16} dark delay={0.6} />
      <Bone w="40%" h={16} dark delay={0.75} />
    </div>
    <div className={classes.terminalInput}>
      <Bone w={14} h={14} dark delay={0.2} />
      <Bone w="100%" h={36} dark delay={0.3} style={{ borderRadius: 4, maxWidth: 480 }} />
    </div>
  </div>
);

// ─── Governance Skeleton ─────────────────────────────────────────────────────

export const GovernanceSkeleton: FC = () => (
  <div className={classes.govWrap}>
    {/* Header */}
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Bone w={100} h={16} />
      <Bone w={180} h={36} delay={0.1} />
      <Bone w="80%" h={14} delay={0.2} />
    </div>
    {/* Treasury card */}
    <div className={classes.govTreasury}>
      <Bone w={80} h={14} />
      <div className={classes.govTreasuryRow}>
        <Bone w={160} h={36} delay={0.15} />
        <Bone w={200} h={36} delay={0.25} />
      </div>
      <Bone w="60%" h={14} delay={0.3} />
    </div>
    {/* Proposals */}
    <Bone w={120} h={20} delay={0.2} />
    <div className={classes.govProposals}>
      {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((d, i) => (
        <div key={i} className={classes.govProposalRow}>
          <Bone w={32} h={20} delay={d} style={{ borderRadius: 4 }} />
          <Bone w="60%" h={16} delay={d + 0.05} />
          <div style={{ marginLeft: 'auto' }}>
            <Bone w={70} h={24} delay={d + 0.1} style={{ borderRadius: 20 }} />
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ─── Settlers Skeleton ───────────────────────────────────────────────────────

export const SettlersSkeleton: FC = () => (
  <div className={classes.settlersWrap}>
    <Bone w={160} h={32} />
    <Bone w="50%" h={14} delay={0.1} />
    {/* Table header */}
    <div className={classes.settlersRow} style={{ borderBottom: '2px solid #e5e7eb' }}>
      <Bone w={30} h={14} />
      <Bone w={100} h={14} delay={0.05} />
      <Bone w={60} h={14} delay={0.1} />
      <Bone w={50} h={14} delay={0.15} style={{ marginLeft: 'auto' }} />
    </div>
    {/* Rows */}
    {[0, 0.08, 0.16, 0.24, 0.32, 0.4, 0.48, 0.56].map((d, i) => (
      <div key={i} className={classes.settlersRow}>
        <Bone w={24} h={24} delay={d} style={{ borderRadius: 4 }} />
        <Bone w={120} h={14} delay={d + 0.05} />
        <Bone w={80} h={14} delay={d + 0.1} />
        <Bone w={60} h={14} delay={d + 0.15} style={{ marginLeft: 'auto' }} />
      </div>
    ))}
  </div>
);

// ─── Nouns Grid Skeleton ─────────────────────────────────────────────────────

export const NounsGridSkeleton: FC = () => (
  <div className={classes.nounsWrap}>
    {/* Filter bar */}
    <div style={{ display: 'flex', gap: 8 }}>
      <Bone w={120} h={36} style={{ borderRadius: 8 }} />
      <Bone w={100} h={36} delay={0.1} style={{ borderRadius: 8 }} />
      <Bone w={80} h={36} delay={0.2} style={{ borderRadius: 8 }} />
    </div>
    {/* Grid */}
    <div className={classes.nounsGrid}>
      {Array.from({ length: 32 }).map((_, i) => (
        <Bone
          key={i}
          w="100%"
          h={0}
          delay={(i % 8) * 0.08}
          style={{ paddingTop: '100%', borderRadius: 8 }}
        />
      ))}
    </div>
  </div>
);

// ─── Dreams Grid Skeleton ────────────────────────────────────────────────────

export const DreamsGridSkeleton: FC = () => (
  <div className={classes.dreamsWrap}>
    <div className={classes.dreamsHeader}>
      <Bone w={140} h={32} />
      <Bone w={100} h={36} delay={0.1} style={{ borderRadius: 8 }} />
    </div>
    <div className={classes.dreamsGrid}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={classes.dreamCard}>
          <Bone
            w="100%"
            h={0}
            delay={i * 0.1}
            style={{ paddingTop: '100%', borderRadius: 0 }}
          />
          <div className={classes.dreamCardText}>
            <Bone w="70%" h={14} delay={i * 0.1 + 0.05} />
            <Bone w="40%" h={10} delay={i * 0.1 + 0.1} />
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ─── Generic Skeleton (catch-all for minor pages) ────────────────────────────

export const GenericSkeleton: FC = () => (
  <div className={classes.genericWrap}>
    <Bone w={200} h={32} />
    <Bone w="60%" h={16} delay={0.15} />
    <Bone w="80%" h={200} delay={0.3} style={{ borderRadius: 12 }} />
    <Bone w="50%" h={16} delay={0.45} />
  </div>
);

export { Bone };
export default Bone;
