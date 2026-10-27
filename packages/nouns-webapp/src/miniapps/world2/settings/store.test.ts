import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hudCss } from './hudCss';
import {
  bootQuality,
  defaultSettings,
  HUD_ITEMS,
  loadSettings,
  migrate,
  sanitize,
  SETTINGS_KEY,
  SETTINGS_VERSION,
  settings,
} from './store';

beforeEach(() => {
  localStorage.clear();
  settings._reload();
});
afterEach(() => vi.restoreAllMocks());

describe('defaults', () => {
  it('leave the mix and the HUD as they were', () => {
    const d = defaultSettings(false);
    expect(d.v).toBe(SETTINGS_VERSION);
    expect(d.audio).toEqual({ master: 1, sfx: 1, radio: 1, voice: 1, npc: 1, muted: false });
    for (const h of HUD_ITEMS) expect([h.id, d.hud[h.id]]).toEqual([h.id, h.id !== 'fps']);
    expect(d.hudScale).toBe(1);
    expect(d.quality).toBe('auto');
    expect(d.camMode).toBe('follow');
    expect(d.lookSens).toBe(1);
    expect(d.invertY).toBe(false);
    expect(d.reduceMotion).toBe(false);
  });

  it('nothing stored → defaults', () => {
    expect(loadSettings().audio.master).toBe(1);
  });

  it('broken JSON or throwing storage → defaults, no crash', () => {
    localStorage.setItem(SETTINGS_KEY, '{not json');
    expect(loadSettings().hudScale).toBe(1);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadSettings().quality).toBe('auto');
  });

  it('a throwing setItem still updates the live value', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    settings.update({ hudScale: 1.2 });
    expect(settings.get().hudScale).toBe(1.2);
  });
});

describe('clamping', () => {
  it('clamps numbers into range and rejects junk', () => {
    const base = defaultSettings(false);
    const s = sanitize(
      {
        v: 1,
        audio: { master: 4, sfx: -1, radio: 'loud', voice: NaN, muted: 'yes' },
        hudScale: 9,
        lookSens: 0,
        quality: 'ultra',
        camMode: 'drone',
        invertY: 1,
        hud: { speed: false, minimap: 'no', bogus: false },
      },
      base,
    );
    expect(s.audio).toEqual({ master: 1, sfx: 0, radio: 1, voice: 1, npc: 1, muted: false });
    expect(s.hudScale).toBe(1.5);
    expect(s.lookSens).toBe(0.25);
    expect(s.quality).toBe('auto');
    expect(s.camMode).toBe('follow');
    expect(s.invertY).toBe(false);
    expect(s.hud.speed).toBe(false);
    expect(s.hud.minimap).toBe(true);
    expect('bogus' in s.hud).toBe(false);
    expect(sanitize({ v: 1, hudScale: 0.1 }, base).hudScale).toBe(0.75);
  });

  it('update() goes through the same clamps and persists', () => {
    settings.update({ audio: { sfx: 3 }, hudScale: 0.2, lookSens: 99 });
    const s = settings.get();
    expect(s.audio.sfx).toBe(1);
    expect(s.audio.master).toBe(1); // untouched keys survive a partial patch
    expect(s.hudScale).toBe(0.75);
    expect(s.lookSens).toBe(3);
    settings._reload();
    expect(settings.get().lookSens).toBe(3);
  });

  it('notifies subscribers and reset() restores defaults', () => {
    const fn = vi.fn();
    const off = settings.subscribe(fn);
    settings.update({ hud: { chat: false } });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(settings.get().hud.chat).toBe(false);
    expect(settings.get().hud.combo).toBe(true);
    settings.reset();
    expect(settings.get().hud.chat).toBe(true);
    off();
  });
});

describe('versioned load / migrate', () => {
  it('stores a versioned value', () => {
    settings.update({ invertY: true });
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY)!) as { v: number };
    expect(raw.v).toBe(SETTINGS_VERSION);
  });

  it('lifts the v0 flat audio shape into audio{}', () => {
    const m = migrate({ master: 0.5, sfx: 0.25, muted: true, hudScale: 1.25 });
    expect(m.v).toBe(SETTINGS_VERSION);
    expect(m.audio).toMatchObject({ master: 0.5, sfx: 0.25, muted: true });
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ master: 0.5, radio: 0.3 }));
    const s = loadSettings();
    expect(s.audio.master).toBe(0.5);
    expect(s.audio.radio).toBe(0.3);
    expect(s.audio.sfx).toBe(1);
  });

  it('turns the v1 default-on FPS line off, keeps the other HUD choices', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ v: 1, hud: { fps: true, chat: false, speed: true } }),
    );
    const s = loadSettings();
    expect(s.hud.fps).toBe(false);
    expect(s.hud.chat).toBe(false);
    expect(s.hud.speed).toBe(true);
    // a v2 choice to show it sticks
    expect(sanitize({ v: 2, hud: { fps: true } }).hud.fps).toBe(true);
  });

  it('a future version keeps the fields it understands', () => {
    const s = sanitize({ v: 99, hudScale: 1.1, audio: { radio: 0.2 } }, defaultSettings(false));
    expect(s.v).toBe(SETTINGS_VERSION);
    expect(s.hudScale).toBe(1.1);
    expect(s.audio.radio).toBe(0.2);
  });
});

describe('boot quality', () => {
  it('URL ?q= wins, then the saved choice, auto = let the game pick', () => {
    expect(bootQuality(null)).toBeUndefined();
    settings.update({ quality: 'low' });
    expect(bootQuality(null)).toBe('low');
    expect(bootQuality('high')).toBe('high');
    expect(bootQuality('nonsense')).toBe('low');
  });
});

describe('HUD stylesheet', () => {
  it('only hides the dev FPS line at defaults', () => {
    expect(hudCss(defaultSettings(false))).toBe('[data-w2hud="fps"]{display:none!important}');
  });

  it('hides the chosen blocks, keeps the cog, scales', () => {
    const s = defaultSettings(true);
    s.hud.speed = false;
    s.hud.system = false;
    s.hud.minimap = false;
    s.hud.nametags = false;
    s.hudScale = 1.25;
    const css = hudCss(s);
    expect(css).toContain('[data-w2hud="speed"]{display:none!important}');
    expect(css).toContain('.w2-minimap,.w2h-void,.w2h-mapdisc{display:none!important}');
    expect(css).toContain(':not([data-w2cog])');
    expect(css).toContain('.w2-nametag>span');
    expect(css).toContain('.w2-speedlines{display:none!important}');
    expect(css).toContain('[data-w2hud="ring"]{scale:1.25;transform-origin:top right}');
    expect(css).toContain('.w2h-toasts{scale:1.25;transform-origin:top center}');
    // (session, speed and the icon row live inside the ring: scaling them too would double up)
    expect(css).not.toContain('[data-w2hud="session"]{scale');
    expect(css).not.toContain('[data-w2hud="system"]{scale');
    expect(css).not.toContain('[data-w2hud="chat"]{display');
  });

  it('has a Missions toggle that hides the tracker', () => {
    const s = defaultSettings(false);
    expect(s.hud.missions).toBe(true);
    s.hud.missions = false;
    expect(hudCss(s)).toContain('[data-w2hud="missions"]{display:none!important}');
  });
});

describe('voices', () => {
  it('real voices default to auto with callouts on and clean mode off', () => {
    const d = defaultSettings(false);
    expect(d.voices).toBe('auto');
    expect(d.callouts).toBe(true);
    expect(d.cleanVoices).toBe(false);
  });

  it('junk voice settings fall back; good ones stick', () => {
    const s = sanitize({ v: 1, voices: 'loud', callouts: 'yes', cleanVoices: 1 });
    expect(s.voices).toBe('auto');
    expect(s.callouts).toBe(true);
    expect(s.cleanVoices).toBe(false);
    settings.update({ voices: 'off', cleanVoices: true });
    settings._reload();
    expect(settings.get().voices).toBe('off');
    expect(settings.get().cleanVoices).toBe(true);
  });
});
