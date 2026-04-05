// ── Day/Night Cycle ──────────────────────────────────────────────────

export interface DayNightState {
  color: string;
  alpha: number;
}

/** Get current overlay based on real clock time */
export function getDayNightOverlay(): DayNightState {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;

  // 6am-10am: warm dawn
  if (hour >= 6 && hour < 10) {
    const t = (hour - 6) / 4;
    return { color: 'rgba(255,200,100,1)', alpha: 0.08 * (1 - t) };
  }
  // 10am-5pm: clear day
  if (hour >= 10 && hour < 17) {
    return { color: 'rgba(0,0,0,0)', alpha: 0 };
  }
  // 5pm-8pm: dusk
  if (hour >= 17 && hour < 20) {
    const t = (hour - 17) / 3;
    return { color: `rgba(255,${Math.round(150 - t * 100)},50,1)`, alpha: 0.05 + t * 0.1 };
  }
  // 8pm-11pm: evening
  if (hour >= 20 && hour < 23) {
    const t = (hour - 20) / 3;
    return { color: 'rgba(20,20,80,1)', alpha: 0.15 + t * 0.15 };
  }
  // 11pm-5am: deep night
  if (hour >= 23 || hour < 5) {
    return { color: 'rgba(10,10,50,1)', alpha: 0.35 };
  }
  // 5am-6am: pre-dawn
  const t = (hour - 5);
  return { color: 'rgba(40,30,80,1)', alpha: 0.25 * (1 - t) };
}
