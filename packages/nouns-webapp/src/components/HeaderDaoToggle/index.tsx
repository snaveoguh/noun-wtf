import { useActiveDao, type ActiveDao } from '@/hooks/useActiveDao';

/// Compact sitewide DAO toggle for the top navbar.
/// Click navigates to the DAO root so the user sees the chosen auction
/// immediately. The route itself owns the DAO context (no `?dao=` param,
/// no localStorage), so flipping is just a `navigate()`.
export default function HeaderDaoToggle() {
  const { activeDao, setActiveDao } = useActiveDao();

  function onPick(next: ActiveDao) {
    setActiveDao(next);
  }

  return (
    <div
      role="tablist"
      aria-label="Select DAO"
      className="inline-flex items-center gap-0.5 rounded-full border border-neutral-200 bg-white/70 p-0.5 shadow-sm backdrop-blur-sm"
    >
      <Pill
        label="Nouns"
        active={activeDao === 'nouns'}
        accent="neutral"
        onClick={() => onPick('nouns')}
      />
      <Pill
        label="V2"
        active={activeDao === 'nounv2'}
        accent="red"
        onClick={() => onPick('nounv2')}
      />
    </div>
  );
}

interface PillProps {
  label: string;
  active: boolean;
  accent: 'neutral' | 'red';
  showNewBadge?: boolean;
  onClick: () => void;
}

function Pill({ label, active, accent, showNewBadge, onClick }: PillProps) {
  const activeClasses =
    accent === 'red'
      ? 'bg-red-600 text-white shadow-[0_1px_2px_rgba(220,38,38,0.35)]'
      : 'bg-neutral-900 text-white shadow-[0_1px_2px_rgba(0,0,0,0.25)]';
  const inactiveClasses =
    accent === 'red'
      ? 'text-red-700 hover:bg-red-50'
      : 'text-neutral-700 hover:bg-neutral-100';

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
        accent === 'red' ? 'focus-visible:ring-red-500' : 'focus-visible:ring-neutral-500'
      } ${active ? activeClasses : inactiveClasses}`}
    >
      <span className="leading-none">{label}</span>
      {showNewBadge && (
        <span className="rounded-sm bg-red-600 px-1 py-[1px] text-[0.5rem] font-extrabold uppercase tracking-[0.08em] text-white">
          New
        </span>
      )}
    </button>
  );
}
