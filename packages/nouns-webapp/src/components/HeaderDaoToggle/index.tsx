import { useLocation } from 'react-router';

import { routeHasDaoToggle, useActiveDao, type ActiveDao } from '@/hooks/useActiveDao';

/// Compact sitewide DAO toggle for the top navbar.
/// Click navigates to the DAO root so the user sees the chosen auction
/// immediately. The route itself owns the DAO context (no `?dao=` param,
/// no localStorage), so flipping is just a `navigate()`.
///
/// Only renders on DAO-namespaced auction routes (`/`, `/noun/:id`, `/v2`,
/// `/v2/noun/:id`). On every other page (governance, probe, crystal-ball,
/// etc.) the toggle would have no meaningful destination — it would dump
/// the user onto the V2 auction page — so we hide it entirely.
///
/// Mobile (<768px) uses a tighter rendering: "V1" / "V2" labels with
/// reduced padding so the toggle and the adjacent action buttons fit
/// alongside the connect icon without wrapping. Desktop keeps the full
/// "Nouns" / "V2" pill labels.
export default function HeaderDaoToggle() {
  const location = useLocation();
  const { activeDao, setActiveDao } = useActiveDao();

  if (!routeHasDaoToggle(location.pathname)) return null;

  function onPick(next: ActiveDao) {
    setActiveDao(next);
  }

  return (
    <div
      role="tablist"
      aria-label="Select DAO"
      className="inline-flex items-center gap-0.5 rounded-full border border-neutral-200 bg-white/70 p-0.5 shadow-sm backdrop-blur-sm sm:gap-1 sm:p-1"
    >
      <Pill
        label="Nouns"
        mobileLabel="V1"
        active={activeDao === 'nouns'}
        accent="neutral"
        onClick={() => onPick('nouns')}
      />
      <Pill
        label="V2"
        mobileLabel="V2"
        active={activeDao === 'nounv2'}
        accent="red"
        onClick={() => onPick('nounv2')}
      />
    </div>
  );
}

interface PillProps {
  label: string;
  /** Optional shorter label rendered below the md breakpoint. */
  mobileLabel?: string;
  active: boolean;
  accent: 'neutral' | 'red';
  showNewBadge?: boolean;
  onClick: () => void;
}

function Pill({ label, mobileLabel, active, accent, showNewBadge, onClick }: PillProps) {
  const activeClasses =
    accent === 'red'
      ? 'bg-red-600 text-white shadow-[0_1px_2px_rgba(220,38,38,0.35)]'
      : 'bg-neutral-900 text-white shadow-[0_1px_2px_rgba(0,0,0,0.25)]';
  const inactiveClasses =
    accent === 'red' ? 'text-red-700 hover:bg-red-50' : 'text-neutral-700 hover:bg-neutral-100';

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[0.65rem] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 sm:px-3 sm:py-1 sm:text-xs md:px-3.5 md:py-1.5 md:text-sm ${
        accent === 'red' ? 'focus-visible:ring-red-500' : 'focus-visible:ring-neutral-500'
      } ${active ? activeClasses : inactiveClasses}`}
    >
      {mobileLabel != null && mobileLabel !== label ? (
        <>
          <span className="hidden leading-none md:inline">{label}</span>
          <span className="inline leading-none md:hidden">{mobileLabel}</span>
        </>
      ) : (
        <span className="leading-none">{label}</span>
      )}
      {showNewBadge === true && (
        <span className="rounded-sm bg-red-600 px-1 py-[1px] text-[0.5rem] font-extrabold uppercase tracking-[0.08em] text-white">
          New
        </span>
      )}
    </button>
  );
}
