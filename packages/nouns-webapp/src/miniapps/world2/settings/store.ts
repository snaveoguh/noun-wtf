// ── Noun World settings (per device) ─────────────────────────────────────
//
// One versioned localStorage key holds every rider preference: mixer
// levels, which HUD blocks show, HUD scale, quality, camera, mouse look and
// reduce motion. Everything read from storage goes through `sanitize`, so a
// hand-edited or half-written value can never put the game in a bad state.
// Storage access is wrapped: private mode / blocked storage just means the
// settings last for this page only.

export const SETTINGS_KEY = 'noun-world-settings';
export const SETTINGS_VERSION = 2;

export const HUD_ITEMS = [
  { id: 'speed', label: 'Speedometer' },
  { id: 'session', label: 'Score & session' },
  { id: 'system', label: 'Icons under the map' },
  { id: 'minimap', label: 'Minimap' },
  { id: 'compass', label: 'Landmarks compass' },
  { id: 'chat', label: 'Chat feed' },
  { id: 'combo', label: 'Combo' },
  { id: 'toasts', label: 'Now-playing toasts' },
  // A dev readout: off unless asked for
  { id: 'fps', label: 'FPS / quality (dev)', off: true },
  { id: 'nametags', label: 'Name tags' },
  { id: 'missions', label: 'Missions tracker' },
] as const;
export type HudItem = (typeof HUD_ITEMS)[number]['id'];

export const QUALITIES = ['auto', 'low', 'medium', 'high'] as const;
export type QualitySetting = (typeof QUALITIES)[number];
export const CAM_MODES = ['follow', 'low', 'far'] as const;
export type CamModeSetting = (typeof CAM_MODES)[number];

/** Real (neural) character voices: auto = on where the download is cheap, else babble. */
export const VOICE_MODES = ['auto', 'on', 'off'] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];

export const HUD_SCALE_MIN = 0.75;
export const HUD_SCALE_MAX = 1.5;
export const LOOK_SENS_MIN = 0.25;
export const LOOK_SENS_MAX = 3;

export interface AudioLevels {
  /** 0..1 slider positions (the mixer maps them to gain). */
  master: number;
  sfx: number;
  radio: number;
  /** Voice chat (other riders). */
  voice: number;
  /** Character voices (the NPCs' babble, cutscene lines). */
  npc: number;
  muted: boolean;
}

export interface WorldSettings {
  v: typeof SETTINGS_VERSION;
  audio: AudioLevels;
  hud: Record<HudItem, boolean>;
  hudScale: number;
  quality: QualitySetting;
  camMode: CamModeSetting;
  /** Mouse-look multiplier. */
  lookSens: number;
  invertY: boolean;
  /** No speed lines, no camera shake. */
  reduceMotion: boolean;
  /** Real character voices (a one-off model download) or the babble. */
  voices: VoiceMode;
  /** The rider shouts on bails, speed and records. */
  callouts: boolean;
  /** No swearing in the rider's callouts. */
  cleanVoices: boolean;
  /** Voice Booth: the rider says lines in the player's own recordings. */
  myVoice: boolean;
  /** Hear other players' recorded voices (off: their callouts fall back to TTS). */
  hearVoices: boolean;
  /** Voice Booth in clean mode: also list the swear versions to record. */
  boothSwears: boolean;
  /** Share my booth recordings so other players hear them (ticked consent). */
  shareRecordings: boolean;
  /** Use my own trained voice model for my character (callouts without a recording, my typed chat). */
  modelVoice: boolean;
  /** Let other players hear my model voice (short generated clips of my chat lines, never the model). */
  modelShare: boolean;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

export function defaultSettings(reduceMotion = prefersReducedMotion()): WorldSettings {
  const hud = {} as Record<HudItem, boolean>;
  for (const h of HUD_ITEMS) hud[h.id] = !('off' in h);
  return {
    v: SETTINGS_VERSION,
    audio: { master: 1, sfx: 1, radio: 1, voice: 1, npc: 1, muted: false },
    hud,
    hudScale: 1,
    quality: 'auto',
    camMode: 'follow',
    lookSens: 1,
    invertY: false,
    reduceMotion,
    voices: 'auto',
    callouts: true,
    cleanVoices: false,
    myVoice: true,
    hearVoices: true,
    boothSwears: false,
    shareRecordings: false,
    modelVoice: false,
    modelShare: false,
  };
}

export function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : fallback;
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Older shapes → the current one. Each step takes version n to n + 1.
 * v0: the pre-release flat shape (`{master, sfx, radio, voice, muted, ...}`).
 * v1: the FPS / quality line was on by default; v2 makes it a dev readout
 *     (off), so a stored `true` from v1 was the old default, not a choice.
 */
const MIGRATIONS: Record<number, (o: Record<string, unknown>) => Record<string, unknown>> = {
  0: o => {
    const { master, sfx, radio, voice, muted, ...rest } = o;
    return { ...rest, v: 1, audio: { ...obj(o.audio), master, sfx, radio, voice, muted } };
  },
  1: o => ({ ...o, v: 2, hud: { ...obj(o.hud), fps: false } }),
};

export function migrate(raw: unknown): Record<string, unknown> {
  let o = obj(raw);
  let v = typeof o.v === 'number' && Number.isInteger(o.v) ? o.v : 0;
  while (v < SETTINGS_VERSION) {
    const step = MIGRATIONS[v];
    if (step === undefined) return {};
    o = step(o);
    v += 1;
  }
  return o;
}

/** Any value → valid settings (unknown keys dropped, numbers clamped). */
export function sanitize(raw: unknown, base: WorldSettings = defaultSettings()): WorldSettings {
  const o = migrate(raw);
  const a = obj(o.audio);
  const h = obj(o.hud);
  const hud = { ...base.hud };
  for (const it of HUD_ITEMS) hud[it.id] = bool(h[it.id], base.hud[it.id]);
  return {
    v: SETTINGS_VERSION,
    audio: {
      master: clamp(a.master, 0, 1, base.audio.master),
      sfx: clamp(a.sfx, 0, 1, base.audio.sfx),
      radio: clamp(a.radio, 0, 1, base.audio.radio),
      voice: clamp(a.voice, 0, 1, base.audio.voice),
      npc: clamp(a.npc, 0, 1, base.audio.npc),
      muted: bool(a.muted, base.audio.muted),
    },
    hud,
    hudScale: clamp(o.hudScale, HUD_SCALE_MIN, HUD_SCALE_MAX, base.hudScale),
    quality: oneOf(o.quality, QUALITIES, base.quality),
    camMode: oneOf(o.camMode, CAM_MODES, base.camMode),
    lookSens: clamp(o.lookSens, LOOK_SENS_MIN, LOOK_SENS_MAX, base.lookSens),
    invertY: bool(o.invertY, base.invertY),
    reduceMotion: bool(o.reduceMotion, base.reduceMotion),
    voices: oneOf(o.voices, VOICE_MODES, base.voices),
    callouts: bool(o.callouts, base.callouts),
    cleanVoices: bool(o.cleanVoices, base.cleanVoices),
    myVoice: bool(o.myVoice, base.myVoice),
    hearVoices: bool(o.hearVoices, base.hearVoices),
    boothSwears: bool(o.boothSwears, base.boothSwears),
    shareRecordings: bool(o.shareRecordings, base.shareRecordings),
    modelVoice: bool(o.modelVoice, base.modelVoice),
    modelShare: bool(o.modelShare, base.modelShare),
  };
}

export function loadSettings(): WorldSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return defaultSettings();
    return sanitize(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

function saveSettings(s: WorldSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // private mode / quota: settings just last for this page
  }
}

// ── Live store (useSyncExternalStore-friendly) ────────────────────────────

let current: WorldSettings | null = null;
const listeners = new Set<() => void>();

export type SettingsPatch = Partial<Omit<WorldSettings, 'v' | 'audio' | 'hud'>> & {
  audio?: Partial<AudioLevels>;
  hud?: Partial<Record<HudItem, boolean>>;
};

export const settings = {
  get(): WorldSettings {
    current ??= loadSettings();
    return current;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  update(patch: SettingsPatch) {
    const cur = settings.get();
    const next = sanitize(
      {
        ...cur,
        ...patch,
        audio: { ...cur.audio, ...patch.audio },
        hud: { ...cur.hud, ...patch.hud },
      },
      cur,
    );
    current = next;
    saveSettings(next);
    for (const l of listeners) l();
  },
  reset() {
    current = defaultSettings();
    saveSettings(current);
    for (const l of listeners) l();
  },
  /** Tests: forget the cached value (next get() re-reads storage). */
  _reload() {
    current = null;
  },
};

/** The quality to boot with: a ?q= URL param wins, then the saved choice (auto = undefined). */
export function bootQuality(param: string | null): 'low' | 'medium' | 'high' | undefined {
  const q = settings.get().quality;
  const p = param === 'low' || param === 'medium' || param === 'high' ? param : null;
  bootedQuality.setting = q;
  bootedQuality.param = p;
  if (p !== null) return p;
  return q === 'auto' ? undefined : q;
}

/** What this page booted with (the panel offers a reload when the choice differs). */
export const bootedQuality: { setting: QualitySetting; param: QualitySetting | null } = {
  setting: 'auto',
  param: null,
};
