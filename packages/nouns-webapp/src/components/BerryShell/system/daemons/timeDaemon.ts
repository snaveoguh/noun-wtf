/**
 * Time daemon — emits `system:tick` once a second.
 *
 * Pure system service: no permission needed, autoStart on. Apps that want
 * a heartbeat (clocks, countdowns, etc.) subscribe to the tick instead of
 * spinning their own setIntervals — keeps the timer count low.
 *
 * Note: `system:tick` is NOT in the core BerryEventMap (other agent owns
 * that file). We emit it via `extendedBus` until the core map adds it; if
 * it does, this file can swap the import without touching subscribers as
 * long as they also swap.
 */

import { useEffect, useState } from 'react';

import { extendedBus } from '../extendedBus';
import type { BerryService } from '../services';

// Add tick to the extended event map at the type level via module augmentation.
// This keeps strictness without forcing the other agent to extend their map.
declare module '../extendedBus' {
  interface ExtendedEventMap {
    'system:tick': { epoch: number; isoString: string };
  }
}

let intervalId: ReturnType<typeof setInterval> | undefined;

export const timeDaemon: BerryService = {
  id: 'time',
  name: 'System clock',
  autoStart: true,
  description: 'Emits a system:tick every second.',

  async start() {
    if (intervalId) return;
    // Fire one tick immediately so subscribers don't have to wait a full
    // second for their first value. Helps the SystemClock UI feel snappy.
    const fire = () => {
      const now = new Date();
      extendedBus.emit('system:tick', {
        epoch: Math.floor(now.getTime() / 1000),
        isoString: now.toISOString(),
      });
    };
    fire();
    intervalId = setInterval(fire, 1000);
  },

  async stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = undefined;
    }
  },

  status() {
    return intervalId ? 'running' : 'stopped';
  },
};

/**
 * Convenience hook for components that want to render the current tick —
 * subscribes to the tick event and re-renders on each fire. Lightweight by
 * design (only updates state on tick boundaries).
 */
export function useSystemTick(): { epoch: number; isoString: string } {
  const [tick, setTick] = useState<{ epoch: number; isoString: string }>(() => ({
    epoch: Math.floor(Date.now() / 1000),
    isoString: new Date().toISOString(),
  }));

  useEffect(() => {
    return extendedBus.on('system:tick', payload => setTick(payload));
  }, []);

  return tick;
}
