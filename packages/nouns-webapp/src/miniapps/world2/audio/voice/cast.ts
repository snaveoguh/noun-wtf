// ── The mission cast's voices (their seeds + presets) ────────────────────

import { NPCS, type NpcId } from '../../missions/defs';

import { deriveVoice, VOICE_PRESETS, type SeedLike, type VoiceParams } from './voiceParams';

const cache = new Map<string, VoiceParams>();

/** A mission character's voice (from their first Noun's seed + their preset). */
export function npcVoice(id: NpcId): VoiceParams {
  let v = cache.get(id);
  if (v === undefined) {
    v = deriveVoice(NPCS[id].seeds[0]!, VOICE_PRESETS[id]);
    cache.set(id, v);
  }
  return v;
}

/** Anyone else with a Noun seed (town customers, the rider). */
export function seedVoice(seed: SeedLike): VoiceParams {
  return deriveVoice(seed);
}
