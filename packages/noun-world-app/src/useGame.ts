import type { Game } from '@/miniapps/world2/Game';

import { useEffect, useState } from 'react';

type W = Window & { __w2?: Game };

/** The live Game instance World2Page publishes on window.__w2. */
export function useGame(): Game | null {
  const [game, setGame] = useState<Game | null>(() => (window as W).__w2 ?? null);
  useEffect(() => {
    const id = window.setInterval(() => {
      const g = (window as W).__w2 ?? null;
      setGame(prev => (prev === g ? prev : g));
    }, 200);
    return () => window.clearInterval(id);
  }, []);
  return game;
}

export function clearGame() {
  (window as W).__w2 = undefined;
}
