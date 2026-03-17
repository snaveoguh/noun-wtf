import { FC, useCallback, useEffect, useRef, useState } from 'react';

import { useAppSelector } from '@/hooks';

/**
 * CandleGate — full-screen black overlay with a clickable candle in the center.
 * On first visit (torchMode === true && candle not yet lit), the page is pitch black.
 * User clicks the candle → it lights up with animation → torch overlay activates →
 * song starts playing. The candle gate then dissolves away.
 *
 * Once lit, subsequent visits skip the gate (localStorage remembers).
 */

const CANDLE_LIT_KEY = 'noun-wtf-candle-lit';

const CandleGate: FC = () => {
  const torchMode = useAppSelector(state => state.application.torchMode);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Gate is shown when torchMode is on but candle hasn't been lit yet this session
  const [gateDismissed, setGateDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(CANDLE_LIT_KEY) === '1';
  });
  const [candleLit, setCandleLit] = useState(false);
  const [dissolving, setDissolving] = useState(false);

  // Initialize audio
  useEffect(() => {
    const audio = new Audio('/audio/dungeon.mp3');
    audio.loop = true;
    audio.volume = 0;
    audio.preload = 'auto';
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, []);

  // Fade out music when torchMode turns off
  useEffect(() => {
    if (!torchMode && audioRef.current && !audioRef.current.paused) {
      const audio = audioRef.current;
      if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);

      const FADE_STEPS = 20;
      const stepTime = 500 / FADE_STEPS;
      const volumeStep = audio.volume / FADE_STEPS;

      fadeTimerRef.current = setInterval(() => {
        const a = audioRef.current;
        if (!a) {
          if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
          return;
        }
        const newVol = Math.max(0, a.volume - volumeStep);
        a.volume = newVol;
        if (newVol <= 0) {
          a.pause();
          a.volume = 0;
          if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
          fadeTimerRef.current = null;
        }
      }, stepTime);
    }
  }, [torchMode]);

  // When torchMode turns back on (via navbar toggle), restart music
  useEffect(() => {
    if (torchMode && gateDismissed && audioRef.current) {
      const audio = audioRef.current;
      if (audio.paused) {
        audio.volume = 1;
        audio.play().catch(() => {});
      }
    }
  }, [torchMode, gateDismissed]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
    };
  }, []);

  const lightCandle = useCallback(() => {
    if (candleLit) return;
    setCandleLit(true);

    // Start music with fade-in
    const audio = audioRef.current;
    if (audio) {
      audio.volume = 0;
      audio.play().then(() => {
        // Fade in over 2s
        let vol = 0;
        const fadeIn = setInterval(() => {
          vol += 0.05;
          if (vol >= 1) {
            vol = 1;
            clearInterval(fadeIn);
          }
          if (audioRef.current) audioRef.current.volume = vol;
        }, 100);
      }).catch(() => {});
    }

    // After flame animation, dissolve gate
    setTimeout(() => {
      setDissolving(true);
      setTimeout(() => {
        setGateDismissed(true);
        try { localStorage.setItem(CANDLE_LIT_KEY, '1'); } catch { /* noop */ }
      }, 1200);
    }, 1500);
  }, [candleLit]);

  // Stable mobile check — read once on mount, not on every render
  const [isMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

  // Don't show gate if already dismissed, not in torch mode, or on mobile
  if (gateDismissed || !torchMode || isMobile) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'opacity 1.2s ease-out',
        opacity: dissolving ? 0 : 1,
        pointerEvents: dissolving ? 'none' : 'auto',
        cursor: 'pointer',
      }}
      onClick={lightCandle}
    >
      {/* Candle */}
      <div style={{ position: 'relative', width: 80, height: 200 }}>
        {/* Candle body */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 40,
            height: 120,
            background: 'linear-gradient(to bottom, #f5e6c8, #e8d4a8)',
            borderRadius: '4px 4px 2px 2px',
            boxShadow: candleLit ? '0 0 30px rgba(255, 170, 50, 0.3)' : 'none',
          }}
        />

        {/* Wick */}
        <div
          style={{
            position: 'absolute',
            bottom: 120,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 3,
            height: 14,
            background: '#333',
            borderRadius: '1px',
          }}
        />

        {/* Flame (hidden until lit) */}
        {candleLit && (
          <div
            style={{
              position: 'absolute',
              bottom: 130,
              left: '50%',
              transform: 'translateX(-50%)',
              animation: 'candleFlameGrow 0.6s ease-out forwards',
            }}
          >
            {/* Outer glow */}
            <div
              style={{
                position: 'absolute',
                top: '-30px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 100,
                height: 100,
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(255,170,50,0.4) 0%, transparent 70%)',
                animation: 'candlePulse 2s ease-in-out infinite',
              }}
            />
            {/* Flame body */}
            <div
              style={{
                width: 18,
                height: 36,
                background: 'linear-gradient(to top, #ff6600, #ffaa33, #ffdd66)',
                borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
                animation: 'candleFlicker 0.15s ease-in-out infinite alternate',
                boxShadow: '0 0 20px #ff8800, 0 0 60px rgba(255,136,0,0.5)',
              }}
            />
            {/* Inner flame */}
            <div
              style={{
                position: 'absolute',
                bottom: 2,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 8,
                height: 16,
                background: 'linear-gradient(to top, #4488ff, #88bbff)',
                borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
              }}
            />
          </div>
        )}

        {/* Wax drips */}
        <div
          style={{
            position: 'absolute',
            bottom: 80,
            left: 16,
            width: 6,
            height: 12,
            background: '#f5e6c8',
            borderRadius: '0 0 3px 3px',
            opacity: candleLit ? 1 : 0,
            transition: 'opacity 1s ease-in',
          }}
        />
      </div>

      {/* Prompt text */}
      <p
        style={{
          marginTop: '2rem',
          color: candleLit ? 'rgba(255,200,120,0.8)' : 'rgba(255,255,255,0.15)',
          fontFamily: 'PT Root UI, sans-serif',
          fontSize: '0.9rem',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          transition: 'color 1s ease',
          userSelect: 'none',
        }}
      >
        {candleLit ? '' : 'click to light'}
      </p>

      {/* CSS animations */}
      <style>{`
        @keyframes candleFlameGrow {
          from { transform: translateX(-50%) scale(0); opacity: 0; }
          to { transform: translateX(-50%) scale(1); opacity: 1; }
        }
        @keyframes candleFlicker {
          from { transform: scaleX(1) rotate(-1deg); }
          to { transform: scaleX(0.92) rotate(1deg); }
        }
        @keyframes candlePulse {
          0%, 100% { opacity: 0.6; transform: translateX(-50%) scale(1); }
          50% { opacity: 1; transform: translateX(-50%) scale(1.1); }
        }
      `}</style>
    </div>
  );
};

export default CandleGate;
