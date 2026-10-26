// Home overlays: the MORE INFO sheet for a featured game, and the
// "Submit yours" form for the Community row.

import type { Game, GameId } from './rows';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

import { cx } from '../osStore';

import {
  BLURB_MAX,
  KIND_LABEL,
  NAME_MAX,
  SUBMISSION_KINDS,
  SUBMISSIONS_URL,
  validateSubmission,
  type SubmissionKind,
} from './community';
import { GAME_ACCENT, GameTitle } from './Hero';
import { LockIcon } from './Shelf';

function Modal({
  label,
  onClose,
  children,
  className,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>(
      'input,textarea,button:not(.nh-x),a[href]',
    );
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && box.current) {
        const f = [
          ...box.current.querySelectorAll<HTMLElement>(
            'input,textarea,button,a[href],[tabindex="0"]',
          ),
        ].filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
        if (f.length === 0) return;
        const a = f[0]!;
        const z = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      back?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return createPortal(
    <div className="nh-modal" onPointerDown={e => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        className={cx('nh-sheet', className)}
        role="dialog"
        aria-modal="true"
        aria-label={label}
      >
        <button type="button" className="nh-x" onClick={onClose} aria-label="Close">
          ×
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function GameSheet({
  game,
  resume,
  locked,
  onPlay,
  onClose,
}: {
  game: Game;
  resume: boolean;
  /** Not open yet: says how to open it, and the button opens Noun World instead */
  locked?: { hint: string };
  onPlay: (id: GameId) => void;
  onClose: () => void;
}) {
  return (
    <Modal label={game.name} onClose={onClose} className="is-game">
      <div className={locked ? 'nh-sheet-art is-locked' : 'nh-sheet-art'}>
        <img src={game.cover} alt={`${game.name} cover art`} />
      </div>
      <div className="nh-sheet-body">
        <h2>
          <GameTitle name={game.name} accent={GAME_ACCENT[game.id]} />
        </h2>
        <span className="nh-strapline">{game.tagline}</span>
        <p>{game.teaser}</p>
        {locked && (
          <p className="nh-locked-note">
            <LockIcon />
            <span>
              <b>Locked.</b> {locked.hint}: meet the Oracle by the fountain, then find the Keymaker
              in the GO DOWN alley and ride his line until he hands you the key. Once the door is
              open to you, the mountain is one click from here.
            </span>
          </p>
        )}
        <ul>
          {game.facts.map(f => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <button
          type="button"
          className="nh-play"
          onClick={() => {
            onClose();
            onPlay(locked ? 'world' : game.id);
          }}
        >
          <span aria-hidden>▶</span> {locked ? 'PLAY NOUN WORLD' : resume ? 'RESUME' : game.cta}
        </button>
      </div>
    </Modal>
  );
}

type SendState = { s: 'idle' } | { s: 'sending' } | { s: 'done' } | { s: 'error'; error: string };

export function SubmitDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [blurb, setBlurb] = useState('');
  const [kind, setKind] = useState<SubmissionKind>('game');
  const [trap, setTrap] = useState('');
  const [state, setState] = useState<SendState>({ s: 'idle' });

  const submit = async () => {
    const input = { name, url, blurb, kind, website: trap };
    const v = validateSubmission(input);
    if (!v.ok) {
      setState({ s: 'error', error: v.error });
      return;
    }
    setState({ s: 'sending' });
    try {
      const res = await fetch(SUBMISSIONS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...v.value, website: trap }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && data.ok === true) setState({ s: 'done' });
      else
        setState({
          s: 'error',
          error: data.error ?? "couldn't reach the submissions box, try again in a bit",
        });
    } catch {
      setState({ s: 'error', error: "couldn't reach the submissions box, try again in a bit" });
    }
  };

  return (
    <Modal label="Submit to noun.wtf" onClose={onClose} className="is-form">
      {state.s === 'done' ? (
        <div className="nh-form-done">
          <span className="nh-done-nog" aria-hidden>
            ⌐◨-◨
          </span>
          <h2>In the queue.</h2>
          <p>
            A human checks every submission before it goes on the shelf. If it&rsquo;s nounish,
            you&rsquo;ll see it in the Community row.
          </p>
          <button type="button" className="nh-play" onClick={onClose}>
            BACK TO THE SHELF
          </button>
        </div>
      ) : (
        <form
          className="nh-form"
          onSubmit={e => {
            e.preventDefault();
            void submit();
          }}
          noValidate
        >
          <span className="nh-eyebrow">
            <b>+</b> OPEN CALL
          </span>
          <h2>Put your thing on the shelf</h2>
          <p className="nh-form-lede">
            Made a game, a page, a tool or a whole client? Send it in. Approved entries show up in
            the Community row with their own box art.
          </p>
          <label>
            <span>Name</span>
            <input
              value={name}
              maxLength={NAME_MAX}
              onChange={e => setName(e.target.value)}
              placeholder="Noun Kart"
              autoComplete="off"
              required
            />
          </label>
          <label>
            <span>Link (https)</span>
            <input
              value={url}
              type="url"
              inputMode="url"
              maxLength={200}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://"
              autoComplete="off"
              required
            />
          </label>
          <label>
            <span>
              What is it{' '}
              <em>
                {blurb.trim().length}/{BLURB_MAX}
              </em>
            </span>
            <textarea
              value={blurb}
              maxLength={BLURB_MAX}
              rows={3}
              onChange={e => setBlurb(e.target.value)}
              placeholder="one or two lines. what do you do there?"
              required
            />
          </label>
          <fieldset>
            <legend>Kind</legend>
            <div className="nh-kinds">
              {SUBMISSION_KINDS.map(k => (
                <label key={k} className={k === kind ? 'is-on' : undefined}>
                  <input
                    type="radio"
                    name="kind"
                    value={k}
                    checked={k === kind}
                    onChange={() => setKind(k)}
                  />
                  {KIND_LABEL[k]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="nh-trap" aria-hidden>
            Website
            <input
              tabIndex={-1}
              value={trap}
              onChange={e => setTrap(e.target.value)}
              autoComplete="off"
            />
          </label>
          {state.s === 'error' && (
            <p className="nh-form-err" role="alert">
              {state.error}
            </p>
          )}
          <div className="nh-form-foot">
            <span>Reviewed by hand. Links open in a new tab, never inside noun.wtf.</span>
            <button type="submit" className="nh-play" disabled={state.s === 'sending'}>
              {state.s === 'sending' ? 'SENDING…' : 'SUBMIT ▸'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
