import React, { useEffect, useRef } from 'react';

interface ProbeTerminalProps {
  value: string;
  onChange: (v: string) => void;
  matchCount: number;
  totalCount: number;
  seedsReady: boolean;
}

/**
 * Terminal-styled real-time search bar for the probe explore grid.
 * Matches noun IDs and trait names (head/noggles/body/accessory/background)
 * as you type — multi-word queries AND together, e.g. "fox cool".
 */
const ProbeTerminal: React.FC<ProbeTerminalProps> = ({
  value,
  onChange,
  matchCount,
  totalCount,
  seedsReady,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" focuses the terminal from anywhere; Escape clears + blurs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div
      className="mt-3 cursor-text rounded-xl border border-green-900/60 bg-black px-3 py-2.5 font-mono text-sm shadow-[0_0_12px_rgba(34,197,94,0.15)] sm:px-4"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 select-none text-green-600">
          probe@noun.wtf<span className="text-green-800">:~$</span>
        </span>
        <div className="relative flex-1">
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                onChange('');
                e.currentTarget.blur();
              }
            }}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            aria-label="Search nouns by ID or trait name"
            className="w-full bg-transparent text-green-400 caret-green-400 placeholder:text-green-900 focus:outline-none"
            style={value === '' ? { paddingLeft: '1.5ch' } : undefined}
            placeholder="search id or traits… try: fox · disco · 1000 · cool crab"
          />
          {value === '' && (
            <span className="pointer-events-none absolute left-0 top-0 animate-pulse text-green-500">
              █
            </span>
          )}
        </div>
        <span className="shrink-0 select-none text-xs text-green-700">
          {value.trim()
            ? `[${matchCount}/${totalCount}]`
            : seedsReady
              ? `[${totalCount}]`
              : '[loading traits…]'}
        </span>
      </div>
    </div>
  );
};

export default ProbeTerminal;
