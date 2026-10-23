// The noun.wtf ident: noggles unfold on black (lenses swing open from the
// bridge, the arm flicks out, the eyes snap in), then the camera dives
// through the right lens into the homescreen. Under 2 s, once per browser
// session, skippable with any click or key. Reduced motion: no fold, just a
// short fade of the still noggles.

import { useEffect, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

import { cx } from '../osStore';

import { ident } from './sound';

export const INTRO_KEY = 'nounwtf-intro-v1';
const DURATION = 1850;
const REDUCED = 700;

export function shouldPlayIntro(): boolean {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('intro') === '1' || q.get('intro') === 'hold') return true;
    if (q.get('intro') === '0' || q.get('skip') === '1') return false;
    return sessionStorage.getItem(INTRO_KEY) !== '1';
  } catch {
    return false;
  }
}

/** One lens: a red frame, white on the left, black pupil on the right. */
function Lens() {
  return (
    <svg viewBox="0 0 8 6" className="nh-lens" shapeRendering="crispEdges" aria-hidden>
      <rect width="8" height="6" fill="var(--nog)" />
      <rect x="1" y="1" width="6" height="4" fill="#fff" />
      <rect className="nh-pupil" x="4" y="1" width="3" height="4" fill="#000" />
    </svg>
  );
}

export default function Intro({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  const sounded = useRef(false);
  const reduce = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    try {
      sessionStorage.setItem(INTRO_KEY, '1');
    } catch {
      // private mode: it plays again next time, fine
    }
    // Plays only if the browser already allows audio (silent on a cold load)
    if (!reduce.current && !sounded.current) {
      sounded.current = true;
      ident();
    }
    const finish = () => {
      if (done.current) return;
      done.current = true;
      onDone();
    };
    // ?intro=hold freezes it on screen (design review / screenshots)
    if (new URLSearchParams(window.location.search).get('intro') === 'hold') return;
    const total = reduce.current ? REDUCED : DURATION;
    const t1 = window.setTimeout(() => setLeaving(true), total - 260);
    const t2 = window.setTimeout(finish, total);
    const skip = () => {
      setLeaving(true);
      window.setTimeout(finish, 180);
    };
    window.addEventListener('keydown', skip);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('keydown', skip);
    };
  }, [onDone]);

  return createPortal(
    <div
      className={cx('nh-intro', leaving && 'is-leaving', reduce.current && 'is-still')}
      onPointerDown={() => {
        setLeaving(true);
        window.setTimeout(() => {
          if (done.current) return;
          done.current = true;
          onDone();
        }, 180);
      }}
      role="presentation"
    >
      <div className="nh-intro-stage">
        <div className="nh-nog" aria-label="noun.wtf">
          <span className="nh-nog-arm">
            <svg viewBox="0 0 4 4" shapeRendering="crispEdges" aria-hidden>
              <rect x="0" y="0" width="4" height="1" fill="var(--nog)" />
              <rect x="0" y="0" width="1" height="3" fill="var(--nog)" />
            </svg>
          </span>
          <span className="nh-nog-l">
            <Lens />
          </span>
          <span className="nh-nog-bridge">
            <svg viewBox="0 0 2 1" shapeRendering="crispEdges" aria-hidden>
              <rect width="2" height="1" fill="var(--nog)" />
            </svg>
          </span>
          <span className="nh-nog-r">
            <Lens />
          </span>
        </div>
        <div className="nh-intro-word">NOUN.WTF</div>
      </div>
      <span className="nh-intro-skip">click or press any key to skip</span>
    </div>,
    document.body,
  );
}
