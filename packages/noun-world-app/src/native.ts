// Native-shell glue for Noun World. Everything here is additive: the game
// (packages/nouns-webapp/src/miniapps/world2) is untouched and keeps working
// in a plain browser, this file only reacts to Capacitor lifecycle events.

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

import type { Game } from '@/miniapps/world2/Game';

/** World2Page publishes the live Game on window.__w2 (handy in devtools). */
function game(): Game | null {
  return (window as unknown as { __w2?: Game }).__w2 ?? null;
}

/**
 * iOS / Android audio unlock.
 *
 * WKWebView and Chrome WebView only start an AudioContext inside a user
 * gesture; the game already calls `unlockAudio()` on pointerdown. Two gaps
 * remain on mobile:
 *  1. older WebKit builds only count `touchend` as the activating gesture,
 *  2. when the app is backgrounded (home button, phone call) the context is
 *     suspended / interrupted and nothing resumes it until the next tap.
 * Cover both: unlock on the first touchend as well, and resume on resume.
 */
function installAudioUnlock() {
  const unlock = () => {
    const g = game();
    if (!g) return;
    g.unlockAudio();
    const ctx = g.audio.ctx;
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  };
  const once = () => {
    unlock();
    // Keep listening: iOS re-suspends after an interruption, and a later
    // tap must bring the mix back. Listeners are passive + cheap.
  };
  window.addEventListener('touchend', once, { passive: true });
  window.addEventListener('pointerup', once, { passive: true });

  void App.addListener('appStateChange', ({ isActive }) => {
    const g = game();
    if (!g) return;
    if (isActive) {
      g.setPaused(false);
      const ctx = g.audio.ctx;
      if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    } else {
      // Freeze the sim + input while backgrounded; the radio/voice keep
      // their state and come back on resume.
      g.setPaused(true);
    }
  });
}

/**
 * Microphone.
 *
 * The game asks for the mic with `navigator.mediaDevices.getUserMedia`
 * when the player taps "join voice". Capacitor forwards that to the OS:
 *  - Android: `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS` are declared in
 *    android/app/src/main/AndroidManifest.xml; Capacitor's WebChromeClient
 *    handles `onPermissionRequest` and shows the runtime prompt.
 *  - iOS: `NSMicrophoneUsageDescription` is in ios/App/App/Info.plist;
 *    WKWebView shows the system prompt the first time.
 * Nothing to do here beyond making sure a denied prompt doesn't throw out
 * of the game: Voice.ts already catches it and reports 'denied'. We only
 * surface the state in a console line for debugging on device.
 */
function installMicDiagnostics() {
  if (!navigator.mediaDevices?.getUserMedia) {
    console.warn('[noun-world-app] getUserMedia unavailable: voice chat disabled');
    return;
  }
  navigator.permissions
    ?.query({ name: 'microphone' as PermissionName })
    .then(s => console.info(`[noun-world-app] mic permission: ${s.state}`))
    .catch(() => undefined);
}

/** Android hardware back: minimise rather than quit mid-session. */
function installBackButton() {
  void App.addListener('backButton', () => {
    void App.minimizeApp();
  });
}

export function installNativeShell() {
  if (!Capacitor.isNativePlatform()) return;
  installAudioUnlock();
  installMicDiagnostics();
  installBackButton();
  document.documentElement.classList.add(`platform-${Capacitor.getPlatform()}`);
}
