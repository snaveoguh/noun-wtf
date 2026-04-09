// ── Day/Night Cycle ──────────────────────────────────────────────────

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

export interface DayNightState {
  color: string;
  alpha: number;
  phase: TimeOfDay;
  ambientIntensity: number; // light level 0-1
  npcDamageMultiplier: number; // NPCs hit harder at night
  fogDensity: number; // 0 = none, 1 = thick
  starAlpha: number; // star visibility
}

/** Get current overlay based on real clock time */
export function getDayNightOverlay(): DayNightState {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;

  // 6am-10am: warm dawn
  if (hour >= 6 && hour < 10) {
    const t = (hour - 6) / 4;
    return { color: 'rgba(255,200,100,1)', alpha: 0.08 * (1 - t), phase: 'dawn', ambientIntensity: 0.5 + t * 0.3, npcDamageMultiplier: 1.0, fogDensity: 0.15 * (1 - t), starAlpha: 0 };
  }
  // 10am-5pm: clear day
  if (hour >= 10 && hour < 17) {
    return { color: 'rgba(0,0,0,0)', alpha: 0, phase: 'day', ambientIntensity: 0.8, npcDamageMultiplier: 1.0, fogDensity: 0, starAlpha: 0 };
  }
  // 5pm-8pm: dusk
  if (hour >= 17 && hour < 20) {
    const t = (hour - 17) / 3;
    return { color: `rgba(255,${Math.round(150 - t * 100)},50,1)`, alpha: 0.05 + t * 0.1, phase: 'dusk', ambientIntensity: 0.7 - t * 0.3, npcDamageMultiplier: 1.0 + t * 0.3, fogDensity: t * 0.1, starAlpha: t * 0.3 };
  }
  // 8pm-11pm: evening
  if (hour >= 20 && hour < 23) {
    const t = (hour - 20) / 3;
    return { color: 'rgba(20,20,80,1)', alpha: 0.15 + t * 0.15, phase: 'night', ambientIntensity: 0.3 - t * 0.1, npcDamageMultiplier: 1.5, fogDensity: 0.1 + t * 0.1, starAlpha: 0.5 + t * 0.3 };
  }
  // 11pm-5am: deep night — NPCs are dangerous, low visibility
  if (hour >= 23 || hour < 5) {
    return { color: 'rgba(10,10,50,1)', alpha: 0.35, phase: 'night', ambientIntensity: 0.15, npcDamageMultiplier: 2.0, fogDensity: 0.2, starAlpha: 0.8 };
  }
  // 5am-6am: pre-dawn
  const t = (hour - 5);
  return { color: 'rgba(40,30,80,1)', alpha: 0.25 * (1 - t), phase: 'dawn', ambientIntensity: 0.3 + t * 0.2, npcDamageMultiplier: 1.2, fogDensity: 0.15, starAlpha: 0.3 * (1 - t) };
}
