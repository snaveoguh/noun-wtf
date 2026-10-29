// ── Settings → a running Game ────────────────────────────────────────────
//
// Applies the saved settings as soon as the Game exists (before its first
// frame) and keeps applying them as the panel changes them. Camera mode
// goes both ways: pressing C saves the new mode too.

import type { Game } from '../Game';

import { capFps } from '../render/framePacer';

import { settings, type WorldSettings } from './store';

export function applySettings(game: Game, s: WorldSettings) {
  game.mixer.set(s.audio);
  game.input.lookSensitivity = s.lookSens;
  game.input.invertY = s.invertY;
  game.cam.shakeScale = s.reduceMotion ? 0 : 1;
  if (game.cam.mode !== s.camMode) game.cam.mode = s.camMode;
  game.voiceMode = s.voices;
  game.frameCap = capFps(s.frameCap);
  game.setSharp(s.sharp);
  game.rider.enabled = s.callouts;
  game.rider.brain.clean = s.cleanVoices;
}

/** Bind the store to a game; returns the unbind. */
export function bindSettings(game: Game): () => void {
  // Outputs outside the WebAudio graph follow the mixer
  const offMix = game.mixer.onChange(() => {
    game.fm.extGain = game.mixer.gain('radio');
    game.radio.extGain = game.mixer.gain('radio');
    game.radio.setVolume(game.radio.volume);
    game.net.voip.setVolume(game.mixer.gain('voice'));
  });
  applySettings(game, settings.get());
  const offStore = settings.subscribe(() => applySettings(game, settings.get()));
  const offGame = game.subscribe(() => {
    const mode = game.cam.mode;
    if (mode !== settings.get().camMode) settings.update({ camMode: mode });
  });
  return () => {
    offMix();
    offStore();
    offGame();
  };
}
