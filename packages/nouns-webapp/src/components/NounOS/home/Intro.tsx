// The noun.wtf ident, Netflix style: the canonical noggles alone on black.
// The red frame slams in pixel by pixel (the "tu"), the eyes punch in (the
// "DUM"), a glint runs across, then red light streaks rush out as the camera
// dives into the right pupil and through to the homescreen. About 5.5 s,
// once per browser session, skippable with any click or key. Reduced
// motion: a short fade of the still noggles.

import { type CSSProperties, useEffect, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

import { cx } from '../osStore';

import { ident } from './sound';

export const INTRO_KEY = 'nounwtf-intro-v1';
const DURATION = 5550;
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

// Pixel-for-pixel the real noggles (nouns-assets glasses-square-red, 16x5):
// R = frame (#f3322c), W = white, B = pupil, . = empty.
const NOGGLES = [
  '...RRRRRR.RRRRRR',
  '...RWWBBR.RWWBBR',
  'RRRRWWBBRRRWWBBR',
  'R..RWWBBR.RWWBBR',
  'R..RWWBBR.RWWBBR',
];
const PIXELS = NOGGLES.flatMap((row, y) =>
  [...row].flatMap((k, x) => (k === '.' ? [] : [{ x, y, k }])),
);
const STREAKS = Array.from({ length: 24 }, (_, i) => i);

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
      <div className="nh-intro-streaks" aria-hidden>
        {STREAKS.map(i => (
          <i key={i} style={{ '--i': i } as CSSProperties} />
        ))}
      </div>
      <div className="nh-intro-stage">
        <div className="nh-nog" role="img" aria-label="noun.wtf">
          {PIXELS.map(({ x, y, k }) => (
            <i
              key={`${x}-${y}`}
              className={`is-${k}`}
              style={{ gridColumn: x + 1, gridRow: y + 1, '--x': x, '--y': y } as CSSProperties}
            />
          ))}
        </div>
      </div>
      <span className="nh-intro-skip">click or press any key to skip</span>
    </div>,
    document.body,
  );
}
