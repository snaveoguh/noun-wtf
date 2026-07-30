import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { parseHexColor } from '@/lib/hexColorSearch';

const Nounsweeper = lazy(() => import('@/components/Nounsweeper'));

/** Easter eggs: type one of these into the probe terminal to launch it. */
const NOUNSWEEPER_WORDS = ['nounsweeper', 'minesweeper', 'nounsweep'];

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
 * A hex-colour token (#c54e38) filters to nouns containing that colour and
 * shows a swatch that opens a native colour picker.
 */
const ProbeTerminal: React.FC<ProbeTerminalProps> = ({
  value,
  onChange,
  matchCount,
  totalCount,
  seedsReady,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);
  const [sweeper, setSweeper] = useState(false);

  // Easter egg — typing 'nounsweeper' launches the game and clears the query.
  useEffect(() => {
    if (NOUNSWEEPER_WORDS.includes(value.trim().toLowerCase())) {
      setSweeper(true);
      onChange('');
    }
  }, [value, onChange]);

  // Last query token that parses as a hex colour → inline swatch + picker.
  // Splitting on captured whitespace keeps the original spacing intact so
  // the picker can write its colour back into the exact token it previews.
  const colorToken = useMemo(() => {
    const parts = value.split(/(\s+)/);
    for (let i = parts.length - 1; i >= 0; i--) {
      const hex = parseHexColor(parts[i]);
      if (hex != null) return { hex, index: i, parts };
    }
    return null;
  }, [value]);

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
            aria-label="Search nouns by ID, trait name, or hex colour"
            className="w-full bg-transparent text-green-400 caret-green-400 placeholder:text-green-900 focus:outline-none"
            style={value === '' ? { paddingLeft: '1.5ch' } : undefined}
            placeholder="search id, traits or hex… try: fox · disco · 1000 · #c54e38 · nounsweeper"
          />
          {value === '' && (
            <span className="pointer-events-none absolute left-0 top-0 animate-pulse text-green-500">
              █
            </span>
          )}
        </div>
        {colorToken != null && (
          <span className="relative shrink-0">
            <button
              type="button"
              title={`Filtering by ${colorToken.hex} — click to pick a colour`}
              aria-label={`Filtering by colour ${colorToken.hex}. Open colour picker`}
              onClick={e => {
                e.stopPropagation();
                colorInputRef.current?.click();
              }}
              className="block h-5 w-5 rounded border border-green-700 transition-transform hover:scale-110"
              style={{ backgroundColor: colorToken.hex }}
            />
            <input
              ref={colorInputRef}
              type="color"
              value={colorToken.hex}
              onChange={e => {
                const next = [...colorToken.parts];
                next[colorToken.index] = e.target.value;
                onChange(next.join(''));
              }}
              tabIndex={-1}
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-full h-0 w-0 opacity-0"
            />
          </span>
        )}
        <span className="shrink-0 select-none text-xs text-green-700">
          {value.trim()
            ? `[${matchCount}/${totalCount}]`
            : seedsReady
              ? `[${totalCount}]`
              : '[loading traits…]'}
        </span>
      </div>
      {sweeper && (
        <Suspense fallback={null}>
          <Nounsweeper onClose={() => setSweeper(false)} />
        </Suspense>
      )}
    </div>
  );
};

export default ProbeTerminal;
