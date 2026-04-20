// ── DojoAudio — ambient construct drone + sparse pings ───────────────
//
// Two low sustained oscillators (60Hz + detuned 240Hz partial) give the
// "inside the construct" hum. Every 6–10 seconds we drop a brief high
// ping (1200–1800Hz, 80ms ADSR envelope) for that Matrix sampler vibe.
//
// All routing is through the sfx bus so slomo's biquad lowpass colors
// the drone naturally when the player focus-triggers. Zero visual
// component — this just runs as a React side-effect.

import { useEffect } from 'react';

import { getSfxBus, getSfxContext } from '../../engine/audioFx';

const DRONE_BASE_FREQ = 60;
const DRONE_HARMONIC_FREQ = 240;
const DRONE_HARMONIC_DETUNE_CENTS = 7;
const DRONE_BASE_GAIN = 0.035;
const DRONE_HARMONIC_GAIN = 0.015;

const PING_MIN_INTERVAL_S = 6;
const PING_MAX_INTERVAL_S = 10;
const PING_MIN_FREQ = 1200;
const PING_MAX_FREQ = 1800;
const PING_DURATION_S = 0.08;
const PING_PEAK_GAIN = 0.05;

export function DojoAudio(): null {
  useEffect(() => {
    const ctx = getSfxContext();
    const bus = getSfxBus();

    // ── Drone oscillators ─────────────────────────────────────────────
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0; // ramp in
    droneGain.connect(bus);

    const base = ctx.createOscillator();
    base.type = 'sine';
    base.frequency.value = DRONE_BASE_FREQ;
    const baseGain = ctx.createGain();
    baseGain.gain.value = DRONE_BASE_GAIN;
    base.connect(baseGain).connect(droneGain);

    const harm = ctx.createOscillator();
    harm.type = 'sine';
    harm.frequency.value = DRONE_HARMONIC_FREQ;
    harm.detune.value = DRONE_HARMONIC_DETUNE_CENTS;
    const harmGain = ctx.createGain();
    harmGain.gain.value = DRONE_HARMONIC_GAIN;
    harm.connect(harmGain).connect(droneGain);

    // Attempt start — if the context is suspended due to no user
    // gesture, we schedule a resume on the first interaction.
    let started = false;
    const startDrone = () => {
      if (started) return;
      try {
        base.start();
        harm.start();
        started = true;
        // Fade in smoothly.
        droneGain.gain.cancelScheduledValues(ctx.currentTime);
        droneGain.gain.setValueAtTime(0, ctx.currentTime);
        droneGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.2);
      } catch {
        // Already started elsewhere or browser policy — ignore.
      }
    };

    if (ctx.state === 'running') {
      startDrone();
    } else {
      // Resume + start on the first user gesture.
      const resumeHandler = () => {
        ctx
          .resume()
          .then(() => startDrone())
          .catch(() => {});
        window.removeEventListener('pointerdown', resumeHandler);
        window.removeEventListener('keydown', resumeHandler);
      };
      window.addEventListener('pointerdown', resumeHandler);
      window.addEventListener('keydown', resumeHandler);
    }

    // ── Ping scheduler ────────────────────────────────────────────────
    let pingTimer: number | null = null;
    const pingNodes = new Set<{ osc: OscillatorNode; gain: GainNode }>();

    const firePing = () => {
      if (ctx.state !== 'running') {
        scheduleNext();
        return;
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const freq = PING_MIN_FREQ + Math.random() * (PING_MAX_FREQ - PING_MIN_FREQ);
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain).connect(bus);

      const now = ctx.currentTime;
      const attack = 0.005;
      const decay = PING_DURATION_S - attack;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(PING_PEAK_GAIN, now + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);

      const tracker = { osc, gain };
      pingNodes.add(tracker);
      osc.start(now);
      osc.stop(now + PING_DURATION_S + 0.05);
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
        pingNodes.delete(tracker);
      };

      scheduleNext();
    };

    const scheduleNext = () => {
      const intervalMs =
        (PING_MIN_INTERVAL_S + Math.random() * (PING_MAX_INTERVAL_S - PING_MIN_INTERVAL_S)) * 1000;
      pingTimer = window.setTimeout(firePing, intervalMs);
    };

    scheduleNext();

    // ── Cleanup ───────────────────────────────────────────────────────
    return () => {
      if (pingTimer !== null) {
        window.clearTimeout(pingTimer);
        pingTimer = null;
      }
      // Fade out drone to avoid a click.
      try {
        droneGain.gain.cancelScheduledValues(ctx.currentTime);
        droneGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);
      } catch {}
      // Stop oscillators shortly after fade.
      const stopAt = ctx.currentTime + 0.25;
      try {
        if (started) {
          base.stop(stopAt);
          harm.stop(stopAt);
        }
      } catch {}
      // Disconnect drone nodes after stop.
      window.setTimeout(() => {
        try {
          base.disconnect();
          harm.disconnect();
          baseGain.disconnect();
          harmGain.disconnect();
          droneGain.disconnect();
        } catch {}
      }, 350);
      // Also clean up any in-flight pings.
      for (const tracker of pingNodes) {
        try {
          tracker.osc.stop();
          tracker.osc.disconnect();
          tracker.gain.disconnect();
        } catch {}
      }
      pingNodes.clear();
    };
  }, []);

  return null;
}

export default DojoAudio;
