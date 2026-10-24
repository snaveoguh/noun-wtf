// The noun.wtf ident, Netflix style: the canonical noggles alone on black.
// The red frame slams in pixel by pixel (the "tu"), the eyes punch in (the
// "DUM"), a glint runs across, then red light streaks rush out as the camera
// dives into the right pupil and through to the homescreen. About 4 s,
// once per browser session, skippable with any click or key. Reduced
// motion: a short fade of the still noggles. Drawn on one canvas from one
// clock (introScene.ts).

import { useEffect, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

import { cx } from '../osStore';

import { drawIntro, T } from './introScene';
import { ident } from './sound';

export const INTRO_KEY = 'nounwtf-intro-v1';

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

export default function Intro({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduce = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    try {
      sessionStorage.setItem(INTRO_KEY, '1');
    } catch {
      // private mode: it plays again next time, fine
    }
    const cv = canvas.current;
    const c = cv?.getContext('2d') ?? null;
    const finish = () => {
      if (done.current) return;
      done.current = true;
      onDone();
    };
    const hold = new URLSearchParams(window.location.search).get('intro') === 'hold';
    let w = 0;
    let h = 0;
    const size = () => {
      if (!cv || !c) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    window.addEventListener('resize', size);

    // One clock for everything. Time advances by at most 50 ms per frame, so
    // a stall on a busy page slows the ident down instead of skipping it, and
    // it only ends once the last frame has actually been drawn.
    let t = 0;
    let last = -1;
    let raf = 0;
    let leaveAt = -1;
    const end = reduce.current ? 700 : T.total;
    const startT = reduce.current || hold ? T.dive - 1 : 0;
    t = startT;
    if (!reduce.current && !hold) ident(); // silent until audio is unlocked
    const frame = (now: number) => {
      if (last >= 0 && !hold && !reduce.current) t += Math.min(now - last, 50);
      if (last >= 0 && reduce.current) leaveAt = leaveAt < 0 ? now + end - 260 : leaveAt;
      last = now;
      if (c) drawIntro(c, w, h, Math.min(t, T.total));
      if (hold) return; // ?intro=hold: frozen on the full noggles
      if (reduce.current) {
        if (leaveAt >= 0 && now >= leaveAt) {
          setLeaving(true);
          window.setTimeout(finish, 260);
          return;
        }
      } else if (t >= T.total - 260 && t < T.total) {
        setLeaving(true);
      } else if (t >= T.total) {
        finish();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const skip = () => {
      setLeaving(true);
      window.setTimeout(finish, 180);
    };
    window.addEventListener('keydown', skip);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
      window.removeEventListener('keydown', skip);
    };
  }, [onDone]);

  return createPortal(
    <div
      className={cx('nh-intro', leaving && 'is-leaving')}
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
      <canvas ref={canvas} className="nh-intro-canvas" role="img" aria-label="noun.wtf" />
      <span className="nh-intro-skip">click or press any key to skip</span>
    </div>,
    document.body,
  );
}
