// ── A spoken line: typewriter text in step with the character's babble ────
//
// The text reveals on the voice's own clock (voiceParams.charTimes, the same
// one the syllables fire on), read from the AudioContext so sound and letters
// stay together. Tap the line to finish it at once. `quiet` shows it whole
// with no voice (it was just heard in a cutscene).

import type { Game } from '../Game';
import type { NpcId } from './defs';

import { useEffect, useRef, useState } from 'react';

import { npcVoice } from '../audio/voice/cast';
import { revealed } from '../audio/voice/voiceParams';

export function Spoken({
  game,
  who,
  lineId,
  text,
  quiet = false,
  delay = 0,
  className,
}: {
  game: Game;
  who: NpcId;
  lineId: string;
  text: string;
  quiet?: boolean;
  /** Seconds to wait before speaking (so two lines in one panel take turns). */
  delay?: number;
  className?: string;
}) {
  const chars = [...text];
  const key = `${who}|${lineId}|${text}`;
  // Characters showing, per line (a new line starts from nothing; a quiet one whole)
  const [state, setState] = useState<{ key: string; n: number }>({ key: '', n: 0 });
  const shown = quiet ? chars.length : state.key === key ? state.n : 0;
  const stopRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (quiet) return;
    const n = [...text].length;
    let raf = 0;
    let h: ReturnType<Game['voice']['speak']> | null = null;
    const begin = () => {
      const line = game.voice.speak({ text, voice: npcVoice(who), lineId });
      h = line;
      const times = line.plan.times;
      const t0 = performance.now();
      const ctx = game.audio.ctx;
      const tick = () => {
        // The audio clock when there is one (letters land on their blips)
        const e =
          ctx !== null && line.startedAt !== null
            ? (ctx.currentTime - line.startedAt) / line.stretch
            : (performance.now() - t0) / 1000;
        const k = revealed(times, e);
        setState({ key, n: k });
        if (k < n) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    const wait = window.setTimeout(begin, delay * 1000);
    stopRef.current = () => {
      window.clearTimeout(wait);
      cancelAnimationFrame(raf);
      h?.stop();
      setState({ key, n });
    };
    return () => {
      window.clearTimeout(wait);
      cancelAnimationFrame(raf);
      h?.stop();
    };
  }, [game, who, lineId, text, quiet, delay, key]);

  return (
    <div className={className} onClick={() => stopRef.current()}>
      {chars.slice(0, shown).join('')}
      <span style={{ visibility: 'hidden' }}>{chars.slice(shown).join('')}</span>
    </div>
  );
}
