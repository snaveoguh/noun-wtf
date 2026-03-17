import { FC, useCallback, useEffect, useRef } from 'react';

import { useAppSelector } from '@/hooks';

/**
 * Headless component — plays atmospheric background music while torch/dungeon mode is active.
 * Handles browser autoplay restrictions by waiting for first user interaction.
 * Fades out smoothly when torch mode is toggled off.
 */
const DungeonMusic: FC = () => {
  const torchMode = useAppSelector(state => state.application.torchMode);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unlockListenerRef = useRef<(() => void) | null>(null);

  // Initialize audio element once
  useEffect(() => {
    const audio = new Audio('/audio/dungeon.mp3');
    audio.loop = true;
    audio.volume = 1;
    audio.preload = 'auto';
    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, []);

  // Try to play, returns true if successful
  const tryPlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = 1;
    audio.play().catch(() => {
      // Autoplay blocked — will retry on user interaction
    });
  }, []);

  // Fade out then pause
  const fadeOutAndPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused) return;

    // Clear any existing fade
    if (fadeTimerRef.current) {
      clearInterval(fadeTimerRef.current);
    }

    const FADE_DURATION = 500; // ms
    const FADE_STEPS = 20;
    const stepTime = FADE_DURATION / FADE_STEPS;
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
        a.volume = 1; // Reset for next play
        if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    }, stepTime);
  }, []);

  // React to torchMode changes
  useEffect(() => {
    // Clear any in-progress fade when state changes
    if (fadeTimerRef.current) {
      clearInterval(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }

    if (torchMode) {
      tryPlay();

      // Register one-time unlock listener for autoplay-blocked browsers
      const unlock = () => {
        const audio = audioRef.current;
        if (audio && audio.paused) {
          audio.volume = 1;
          audio.play().catch(() => {});
        }
        // Remove both listeners after first interaction
        document.removeEventListener('click', unlock);
        document.removeEventListener('touchstart', unlock);
        unlockListenerRef.current = null;
      };

      // Only add if we might be blocked
      const audio = audioRef.current;
      if (audio && audio.paused) {
        document.addEventListener('click', unlock, { once: false });
        document.addEventListener('touchstart', unlock, { once: false });
        unlockListenerRef.current = unlock;
      }
    } else {
      // Remove unlock listener if torch turned off before user interacted
      if (unlockListenerRef.current) {
        document.removeEventListener('click', unlockListenerRef.current);
        document.removeEventListener('touchstart', unlockListenerRef.current);
        unlockListenerRef.current = null;
      }

      fadeOutAndPause();
    }

    return () => {
      // Cleanup unlock listeners on effect re-run
      if (unlockListenerRef.current) {
        document.removeEventListener('click', unlockListenerRef.current);
        document.removeEventListener('touchstart', unlockListenerRef.current);
        unlockListenerRef.current = null;
      }
    };
  }, [torchMode, tryPlay, fadeOutAndPause]);

  // Cleanup fade timer on unmount
  useEffect(() => {
    return () => {
      if (fadeTimerRef.current) {
        clearInterval(fadeTimerRef.current);
      }
    };
  }, []);

  return null; // Headless component
};

export default DungeonMusic;
