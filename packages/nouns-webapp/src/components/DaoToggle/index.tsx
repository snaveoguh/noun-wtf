import { useActiveDao, type ActiveDao } from '@/hooks/useActiveDao';

/**
 * Pill toggle that flips the active auction between mainnet Nouns and the
 * NounV2 fork. Lives above the auction hero on `/` and `/noun/:id`.
 *
 * Styling choices:
 * - NounV2 side uses the red/#dc2626 accent already established by the
 *   /nounv2 page and the /vote announcement banner, so the visual
 *   identity is consistent.
 * - Active side gets a solid fill + subtle shadow; inactive side is a
 *   quiet outline so the contrast reads at a glance.
 */
export default function DaoToggle() {
  const { activeDao, setActiveDao } = useActiveDao();

  return (
    <div className="flex w-full justify-center px-4 pt-4 sm:pt-6">
      <div
        role="tablist"
        aria-label="Select DAO auction"
        className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white/80 p-1 shadow-sm backdrop-blur-sm"
      >
        <ToggleButton
          label="Nouns"
          sublabel="Original"
          value="nouns"
          active={activeDao === 'nouns'}
          onClick={() => setActiveDao('nouns')}
          accent="neutral"
        />
        <ToggleButton
          label="NounV2"
          sublabel="No-reserve fork"
          value="nounv2"
          active={activeDao === 'nounv2'}
          onClick={() => setActiveDao('nounv2')}
          accent="red"
        />
      </div>
    </div>
  );
}

interface ToggleButtonProps {
  label: string;
  sublabel: string;
  value: ActiveDao;
  active: boolean;
  onClick: () => void;
  accent: 'neutral' | 'red';
}

function ToggleButton({ label, sublabel, value, active, onClick, accent }: ToggleButtonProps) {
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
      aria-controls={`dao-panel-${value}`}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
        accent === 'red' ? 'focus-visible:ring-red-500' : 'focus-visible:ring-neutral-500'
      } ${active ? activeClasses : inactiveClasses}`}
    >
      <span className="leading-none">{label}</span>
      <span
        className={`hidden text-[0.65rem] font-medium uppercase tracking-[0.08em] sm:inline ${
          active ? 'opacity-80' : 'opacity-60'
        }`}
      >
        {sublabel}
      </span>
      {value === 'nounv2' && !active && (
        <span className="rounded-sm bg-red-600 px-1.5 py-[1px] text-[0.55rem] font-extrabold uppercase tracking-[0.1em] text-white">
          New
        </span>
      )}
    </button>
  );
}
