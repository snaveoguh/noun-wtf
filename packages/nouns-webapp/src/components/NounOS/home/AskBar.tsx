// The header's search / ask bar. Typing filters everything on the shelves;
// Enter opens the highlighted result, or (with nothing picked) sends the
// line to NounIRL, whose replies type out in a panel under the bar. Local
// verbs (play, hoops, readme, vote, /draft, …) work exactly like the old
// console. "/" focuses it from anywhere on the home.

import type { AppKind } from '../osStore';

import { useEffect, useMemo, useRef, useState } from 'react';

import GovernanceActionConfirm from '@/components/TerminalFeed/GovernanceActionConfirm';

import { cx } from '../osStore';

import { searchItems, type Item, type Row } from './rows';
import { LOCAL_VERBS, useNounIRL, type AgentHandlers } from './useNounIRL';

const SUGGEST = ['play', 'hoops', 'readme', 'what is noun v2?', 'who is winning the auction?'];

export default function AskBar({
  rows,
  active,
  handlers,
  onActivate,
  onOpen,
}: {
  rows: Row[];
  active: boolean;
  handlers: AgentHandlers;
  onActivate: (it: Item) => void;
  onOpen: (app: AppKind) => void;
}) {
  const { lines, busy, action, setAction, run, say } = useNounIRL(handlers);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(-1);
  const [panel, setPanel] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchItems(rows, q), [rows, q]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el !== null &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        setExpanded(true);
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) {
        setOpen(false);
        if (q === '') setExpanded(false);
      }
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [q]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [lines, busy, action]);

  const submit = async (text: string) => {
    setQ('');
    setOpen(false);
    const cmd = text.trim().toLowerCase().replace(/^\//, '');
    if (!LOCAL_VERBS.includes(cmd)) setPanel(true);
    await run(text);
  };

  const ask = (text: string) => {
    setPanel(true);
    void submit(text);
  };

  const pick = (it: Item) => {
    setQ('');
    setOpen(false);
    setExpanded(false);
    onActivate(it);
  };

  const showDrop = open && q.trim() !== '';

  return (
    <div ref={root} className={cx('nh-ask', expanded && 'is-expanded')}>
      <button
        type="button"
        className="nh-ask-toggle"
        aria-label="Search or ask NounIRL"
        onClick={() => {
          setExpanded(true);
          window.setTimeout(() => input.current?.focus(), 0);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <path
            d="M15.5 15.5L21 21"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <form
        className="nh-ask-form"
        role="search"
        onSubmit={e => {
          e.preventDefault();
          const hit = sel >= 0 ? results[sel] : undefined;
          if (hit) pick(hit);
          else if (q.trim() !== '') void submit(q);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden className="nh-ask-icon">
          <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
          <path
            d="M15.5 15.5L21 21"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
        <input
          ref={input}
          value={q}
          onChange={e => {
            setQ(e.target.value);
            setSel(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel(s => Math.min(results.length, s + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel(s => Math.max(-1, s - 1));
            } else if (e.key === 'Escape') {
              setOpen(false);
              setQ('');
              setExpanded(false);
              input.current?.blur();
            }
          }}
          placeholder="Search noun.wtf or ask NounIRL"
          aria-label="Search noun.wtf or ask NounIRL"
          aria-expanded={showDrop}
          aria-controls="nh-ask-list"
          aria-autocomplete="list"
          role="combobox"
          spellCheck={false}
          autoComplete="off"
        />
        <kbd aria-hidden>/</kbd>
      </form>

      {showDrop && (
        <div className="nh-drop" id="nh-ask-list" role="listbox">
          {results.map((it, i) => (
            <button
              key={it.key}
              type="button"
              role="option"
              aria-selected={i === sel}
              className={i === sel ? 'is-sel' : undefined}
              onPointerEnter={() => setSel(i)}
              onClick={() => pick(it)}
            >
              <b>{it.title}</b>
              <span>{it.blurb}</span>
              <em>{it.external === true ? '↗' : it.label}</em>
            </button>
          ))}
          <button
            type="button"
            role="option"
            aria-selected={sel === results.length}
            className={cx('nh-drop-ask', sel === results.length && 'is-sel')}
            onPointerEnter={() => setSel(results.length)}
            onClick={() => ask(q)}
          >
            <b>⌐◨-◨ Ask NounIRL</b>
            <span>“{q.trim()}”</span>
            <em>enter ↵</em>
          </button>
        </div>
      )}

      {!showDrop && open && q === '' && !panel && (
        <div className="nh-drop is-hint">
          <span className="nh-drop-h">try</span>
          <div className="nh-sugg">
            {SUGGEST.map(s => (
              <button key={s} type="button" onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {panel && (lines.length > 0 || busy) && (
        <div className="nh-agent" role="log" aria-live="polite" aria-label="NounIRL">
          <div className="nh-agent-head">
            <b>⌐◨-◨ NounIRL</b>
            <button type="button" onClick={() => onOpen('terminal')}>
              open terminal ↗
            </button>
            <button type="button" aria-label="Close" onClick={() => setPanel(false)}>
              ×
            </button>
          </div>
          <div ref={log} className="nh-agent-log">
            {lines.map((l, i) => (
              <p key={i} className={`who-${l.who}`}>
                {l.who === 'you' ? '› ' : ''}
                {l.text.slice(0, l.shown)}
                {l.shown < l.text.length && <span className="nh-caret">▌</span>}
              </p>
            ))}
            {busy && <p className="who-sys">thinking…</p>}
            {action && (
              <div className="nh-agent-action">
                <GovernanceActionConfirm
                  action={action}
                  onSuccess={hash =>
                    say(`tx submitted: ${hash.slice(0, 10)}… etherscan.io/tx/${hash}`)
                  }
                  onCancel={() => {
                    setAction(null);
                    say('cancelled');
                  }}
                />
              </div>
            )}
          </div>
          <form
            className="nh-agent-prompt"
            onSubmit={e => {
              e.preventDefault();
              const v = (e.currentTarget.elements.namedItem('m') as HTMLInputElement).value;
              (e.currentTarget.elements.namedItem('m') as HTMLInputElement).value = '';
              void submit(v);
            }}
          >
            <span aria-hidden>›</span>
            <input
              name="m"
              placeholder="say something"
              aria-label="Message NounIRL"
              spellCheck={false}
              autoComplete="off"
            />
          </form>
        </div>
      )}
    </div>
  );
}
