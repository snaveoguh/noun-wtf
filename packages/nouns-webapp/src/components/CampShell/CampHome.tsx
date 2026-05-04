import { useMemo, useState } from 'react';

import clsx from 'clsx';
import { ChevronDown, Search } from 'lucide-react';
import { useAccount } from 'wagmi';

import ActivityFeed from '@/components/TerminalFeed/ActivityFeed';
import { useActivityFeed } from '@/components/TerminalFeed/useActivityFeed';
import { useAllProposals } from '@/wrappers/nounsDao';
import { useCandidateProposals } from '@/wrappers/nounsData';

import CandidateListItem from './CandidateListItem';
import { buildDigestSections } from './digestSections';
import ProposalListItem from './ProposalListItem';
import SectionedList, { type SectionItem } from './SectionedList';
import VoterList from './VoterList';

import CampShell from './index';

type TabId = 'digest' | 'proposals' | 'topics' | 'candidates' | 'voters';

const TABS: { id: TabId; label: string; disabled?: boolean }[] = [
  { id: 'digest', label: 'Digest' },
  { id: 'proposals', label: 'Proposals' },
  { id: 'topics', label: 'Topics', disabled: true },
  { id: 'candidates', label: 'Candidates' },
  { id: 'voters', label: 'Voters' },
];

/**
 * Filter pill above the activity feed — toggles "noisy" event types
 * (auction bids + flow stream activity) so the feed reads as governance-only.
 * Camp.wtf shows `Hide Auction bids and Flows activity ▾` here.
 */
const NOISY_EVENT_TYPES = new Set<string>([
  'AUCTION_BID',
  'AUCTION_SETTLED',
  'V2_BID',
  'V2_SETTLED',
  'LIL_BID',
  'LIL_AUCTION_SETTLED',
]);

function ProposalsBrowse({
  search,
}: {
  search: string;
}) {
  const { data, loading } = useAllProposals();

  const sorted = useMemo(() => {
    const list = data ?? [];
    const filtered = search
      ? list.filter(p => p.title.toLowerCase().includes(search.toLowerCase()))
      : list;
    return [...filtered].sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0));
  }, [data, search]);

  if (loading && (data?.length ?? 0) === 0) {
    return (
      <div
        style={{
          padding: 24,
          color: 'var(--theme-text-secondary, var(--theme-text-primary))',
          fontSize: 13,
        }}
      >
        Loading proposals…
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          color: 'var(--theme-text-secondary, var(--theme-text-primary))',
          fontSize: 13,
        }}
      >
        No proposals match.
      </div>
    );
  }

  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {sorted.map(p => (
        <li key={p.id}>
          <div className="camp-row" style={{ position: 'relative' }}>
            <ProposalListItem proposal={p} showVotingBar />
          </div>
        </li>
      ))}
    </ul>
  );
}

function CandidatesBrowse({ search }: { search: string }) {
  const { data, loading } = useCandidateProposals();

  const sorted = useMemo(() => {
    const list = data ?? [];
    const filtered = search
      ? list.filter(c => {
          const title = c.version?.content?.title ?? c.slug;
          return title.toLowerCase().includes(search.toLowerCase());
        })
      : list;
    return [...filtered].sort(
      (a, b) => Number(b.lastUpdatedTimestamp ?? 0n) - Number(a.lastUpdatedTimestamp ?? 0n),
    );
  }, [data, search]);

  if (loading && (data?.length ?? 0) === 0) {
    return (
      <div
        style={{
          padding: 24,
          color: 'var(--theme-text-secondary, var(--theme-text-primary))',
          fontSize: 13,
        }}
      >
        Loading candidates…
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          color: 'var(--theme-text-secondary, var(--theme-text-primary))',
          fontSize: 13,
        }}
      >
        No candidates match.
      </div>
    );
  }

  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {sorted.map(c => (
        <CandidateListItem key={c.id} candidate={c} />
      ))}
    </ul>
  );
}

function DigestView() {
  const { address } = useAccount();
  const { data: proposals } = useAllProposals();
  const { data: candidates } = useCandidateProposals();

  const sections = useMemo<SectionItem[]>(() => {
    const { proposalSections, candidateSections } = buildDigestSections({
      proposals: proposals ?? [],
      candidates: candidates ?? [],
      connectedAccountAddress: address?.toLowerCase(),
      // We don't currently know which proposals the user has voted on without
      // an extra query. Treat unknown as "ongoing" so we don't mis-bucket.
    });

    const out: SectionItem[] = [];
    for (const s of proposalSections) {
      out.push({
        key: s.key,
        title: s.title,
        description: s.description,
        count: s.proposals.length,
        children: s.proposals.map(p => (
          <ProposalListItem key={p.id} proposal={p} showVotingBar />
        )),
      });
    }
    for (const s of candidateSections) {
      out.push({
        key: s.key,
        title: s.title,
        description: s.description,
        count: s.candidates.length,
        children: s.candidates.map(c => <CandidateListItem key={c.id} candidate={c} />),
      });
    }
    return out;
  }, [proposals, candidates, address]);

  if ((proposals?.length ?? 0) === 0 && (candidates?.length ?? 0) === 0) {
    return (
      <div
        style={{
          padding: 24,
          color: 'var(--theme-text-secondary, var(--theme-text-primary))',
          fontSize: 13,
        }}
      >
        Loading digest…
      </div>
    );
  }

  return (
    <SectionedList
      sections={sections}
      emptyState={
        address
          ? 'No active proposals or candidates right now.'
          : 'Connect a wallet to personalize your digest.'
      }
    />
  );
}

/**
 * Bespoke `/` page rendered when `theme === 'camp'`.
 *
 * Two-column dashboard mirroring camp.wtf's dark dashboard:
 *  - Left  (~60%): search input → filter chip → live activity feed
 *  - Right (~40%): tabbed listings — Digest / Proposals / Topics /
 *                  Candidates / Voters. Topics is reserved for future use.
 */
export default function CampHome() {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('digest');
  const [hideNoisy, setHideNoisy] = useState(true);

  const { events, loading, hasMore, error, loadMore } = useActivityFeed('');

  const filteredEvents = useMemo(() => {
    if (!hideNoisy) return events;
    return events.filter(e => !NOISY_EVENT_TYPES.has(e.type));
  }, [events, hideNoisy]);

  const renderTab = () => {
    switch (activeTab) {
      case 'digest':
        return <DigestView />;
      case 'proposals':
        return <ProposalsBrowse search={search} />;
      case 'topics':
        return (
          <div
            style={{
              padding: 32,
              color: 'var(--theme-text-muted, var(--theme-text-secondary))',
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            Topics — coming soon. Discussion threads outside any one proposal.
          </div>
        );
      case 'candidates':
        return <CandidatesBrowse search={search} />;
      case 'voters':
        return <VoterList search={search} />;
    }
  };

  return (
    <CampShell showSearchAffordance>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 6fr) minmax(0, 4fr)',
          gap: 16,
          alignItems: 'start',
        }}
        className="camp-home-grid"
      >
        {/* Left: search + filter chip + feed */}
        <section
          style={{
            background: 'var(--theme-bg-card)',
            border: '1px solid var(--theme-border)',
            borderRadius: 'var(--theme-radius-lg, 10px)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            height: 'calc(100vh - 96px)',
            minHeight: 520,
          }}
        >
          {/* Search input — top of left pane */}
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--theme-border-light, var(--theme-border))',
            }}
          >
            <label
              htmlFor="camp-search-input"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                background: 'var(--theme-bg-input)',
                border: '1px solid var(--theme-border)',
                borderRadius: 8,
                color: 'var(--theme-text-secondary)',
              }}
            >
              <Search size={14} aria-hidden />
              <input
                id="camp-search-input"
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search proposals, candidates, voters..."
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: 'var(--theme-text-primary)',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  minWidth: 0,
                }}
              />
            </label>
          </div>

          {/* Filter chip row */}
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid var(--theme-border-light, var(--theme-border))',
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={() => setHideNoisy(v => !v)}
              className="camp-filter-chip"
              aria-pressed={hideNoisy}
            >
              {hideNoisy ? 'Hide' : 'Show'} Auction bids and Flows activity
              <ChevronDown size={11} aria-hidden />
            </button>
          </div>

          {/* Activity feed */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <ActivityFeed
              events={filteredEvents}
              loading={loading}
              hasMore={hasMore}
              error={error}
              onLoadMore={loadMore}
            />
          </div>
        </section>

        {/* Right: tabs */}
        <section
          style={{
            background: 'var(--theme-bg-card)',
            border: '1px solid var(--theme-border)',
            borderRadius: 'var(--theme-radius-lg, 10px)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 'calc(100vh - 96px)',
          }}
        >
          <nav
            role="tablist"
            style={{
              display: 'flex',
              gap: 0,
              padding: '0 12px',
              borderBottom: '1px solid var(--theme-border-light, var(--theme-border))',
              overflowX: 'auto',
            }}
          >
            {TABS.map(tab => {
              const selected = tab.id === activeTab;
              const disabled = tab.disabled === true;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  disabled={disabled}
                  onClick={() => !disabled && setActiveTab(tab.id)}
                  className={clsx('camp-tab', { 'camp-tab--active': selected })}
                  style={{
                    padding: '12px 14px',
                    fontSize: 13,
                    fontWeight: selected ? 700 : 500,
                    color: selected
                      ? 'var(--theme-text-primary)'
                      : disabled
                        ? 'var(--theme-text-muted)'
                        : 'var(--theme-text-secondary)',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: selected
                      ? '2px solid var(--theme-accent)'
                      : '2px solid transparent',
                    marginBottom: -1,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                    opacity: disabled ? 0.55 : 1,
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{renderTab()}</div>
        </section>
      </div>

      {/* Single-column collapse on narrow viewports */}
      <style>{`
        @media (max-width: 900px) {
          .camp-home-grid {
            grid-template-columns: minmax(0, 1fr) !important;
          }
          .camp-home-grid > section {
            height: auto !important;
            max-height: none !important;
          }
        }
        .camp-row-edit:hover { background: var(--theme-bg-secondary) !important; }
      `}</style>
    </CampShell>
  );
}
