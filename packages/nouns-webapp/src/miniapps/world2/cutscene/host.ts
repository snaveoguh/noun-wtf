// ── The Game as a cutscene host (CutscenePlayer's view of the world) ──────

import type { Game } from '../Game';
import type { CutsceneHost } from './CutscenePlayer';

import { isSfxId } from '../audio/sfx/Sfx';
import { settings } from '../settings/store';

/** The Upside Down's colour drain, eased in rather than switched on. */
const DRAIN_S = 1.6;

export function gameHost(game: Game): CutsceneHost {
  const g = game;
  let preview: { filter: string; transition: string } | null = null;
  let drainTimer = 0;
  const canvas = () => g.gfx.renderer.domElement;
  return {
    get camera() {
      return g.gfx.camera;
    },
    get stats() {
      return g.stats;
    },
    setInput: on => g.input.setEnabled(on),
    liveCamera: dt => g.cam.update(dt, g.player, 0, 0, performance.now()),
    canPlay: () =>
      !g.replay.active &&
      !g.hoops.active &&
      !g.van2.driving &&
      !g.dragon.riding &&
      !g.showroom &&
      !g.paused &&
      g.me !== null,
    suspendedAfter: () => g.missions.ud.active || g.van2.driving || g.dragon.riding,
    inputAfter: () => !g.paused && g.missions.panel === null,
    anchorOf: what => {
      if (what === 'rider') {
        const p = g.player;
        return { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: Math.atan2(p.fwd.x, p.fwd.z) };
      }
      if (what === 'door') {
        const d = g.missions.doorAt();
        if (d === null) return null;
        // Face the rider: the scene's +z is the side you came from
        const p = g.player.pos;
        return { x: d.x, y: d.y, z: d.z, yaw: Math.atan2(p.x - d.x, p.z - d.z) };
      }
      const n = g.missions.npcOf(what);
      if (n === null) return null;
      // The Twins wait facing the plaza but race out along +X: frame the race
      const yaw = what === 'twins' ? Math.PI / 2 : n.yaw;
      return { x: n.pos.x, y: n.pos.y, z: n.pos.z, yaw };
    },
    rider: () => g.player.pos,
    npc: who => g.missions.npcOf(who),
    voice: {
      speak: line => g.voice.speak(line),
      stopAll: () => g.voice.stopAll(),
    },
    sound: {
      play: (id, o) => {
        if (isSfxId(id)) g.sfx.play(id, o);
      },
      music: (cue, dur) =>
        g.sfx.music(cue === 'one' || cue === 'door' || cue === 'keys' ? cue : 'oracle', dur),
    },
    cue: (name, o) => {
      if (name === 'oracleGlow') g.missions.npcOf('oracle')?.glowTo(1);
      else if (name === 'doorGlow') g.missions.doorBoost = Math.max(o.dur, 0.5);
      else if (name === 'enterUD') {
        const c = canvas();
        if (o.replay) {
          // From the journal: show the drain, put it all back after
          if (g.missions.ud.active || preview !== null) return;
          preview = { filter: c.style.filter, transition: c.style.transition };
          c.style.transition = `filter ${DRAIN_S}s ease-in`;
          c.style.filter = g.missions.ud.filter;
          return;
        }
        // The real thing: through the door, the colour draining out
        c.style.transition = `filter ${DRAIN_S}s ease-in`;
        g.missions.enterUpsideDown();
        window.clearTimeout(drainTimer);
        drainTimer = window.setTimeout(
          () => {
            c.style.transition = '';
          },
          DRAIN_S * 1000 + 100,
        );
      }
    },
    endCues: replay => {
      if (replay && preview !== null) {
        const c = canvas();
        c.style.transition = '';
        c.style.filter = preview.filter;
        const t = preview.transition;
        preview = null;
        requestAnimationFrame(() => (c.style.transition = t));
      }
    },
    reduceMotion: () => settings.get().reduceMotion,
    markSeen: id => g.missions.markSeen(id),
  };
}
