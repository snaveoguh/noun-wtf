// ── Whether real voices may load on this device ─────────────────────────
//
// Pure. The model is ~80 MB (once, then cached), so 'auto' only turns real
// voices on where that's cheap: a desktop-class pointer on a fast connection
// with no data saver. Phones, slow links and Save-Data keep the babble until
// the player picks 'on' in settings. 'off' is always babble.

export type VoiceModeLike = 'auto' | 'on' | 'off';

export interface DeviceNet {
  /** A touch-first device (pointer: coarse). */
  coarse: boolean;
  saveData: boolean;
  /** navigator.connection.effectiveType, when the browser tells us. */
  effectiveType?: string;
  /** navigator.deviceMemory (GB), when the browser tells us. */
  memory?: number;
}

export function autoVoicesOk(d: DeviceNet): boolean {
  if (d.coarse || d.saveData) return false;
  if (d.effectiveType !== undefined && d.effectiveType !== '4g') return false;
  if (d.memory !== undefined && d.memory < 4) return false;
  return true;
}

export function realVoicesOn(mode: VoiceModeLike, d: DeviceNet): boolean {
  return mode === 'on' || (mode === 'auto' && autoVoicesOk(d));
}

/** This browser's DeviceNet (read once; safe anywhere). */
export function readDeviceNet(): DeviceNet {
  try {
    const nav = navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
      deviceMemory?: number;
    };
    return {
      coarse: window.matchMedia?.('(pointer: coarse)').matches === true,
      saveData: nav.connection?.saveData === true,
      effectiveType: nav.connection?.effectiveType,
      memory: nav.deviceMemory,
    };
  } catch {
    return { coarse: true, saveData: false };
  }
}
