// ── NOUN TAXI chatter ↔ the game (the only file that knows Game) ──────────

import type { ChatterHost } from './ChatterSystem';
import type { ChatPlace } from './generator';
import type { Game } from '../../Game';

import { nounFm } from '../../../../components/NounFm/NounFmStation';
import { defaultWorker, TtsEngine } from '../../audio/voice/TtsEngine';
import { HOUSE_CONFIG_URL, HOUSE_MODEL_URL } from '../../audio/voice/ttsVoice';
import { readDeviceNet } from '../../audio/voice/voicePrefs';
import { textureDiet } from '../../render/textureDiet';
import { TOWN_SPECS } from '../../trade/towns';
import { allDestinations } from '../sim/destinations';

import { fetchLlmLines } from './ChatterSystem';
import { spokenName } from './generator';
import { LLM_FLAG_KEY, llmWanted } from './llm';

/** The site's NOUN FM player is making noise (not off / held / blocked). */
function siteFmOn(): boolean {
  try {
    const p = nounFm().getView().phase;
    return p === 'track' || p === 'jingle' || p === 'loading';
  } catch {
    return false;
  }
}

/** Every named place in the destination registry, as the chatter says it. */
export function chatPlaces(): ChatPlace[] {
  const out: ChatPlace[] = [];
  for (const d of allDestinations()) {
    if (d.kind === 'door') continue;
    if (d.kind === 'town') {
      const spec = Object.values(TOWN_SPECS).find(t => `town:${t.id}` === d.id);
      out.push({
        id: d.id,
        name: spokenName(d.name),
        kind: 'town',
        style: spec?.style,
        makes: spec?.market.makes,
      });
    } else if (d.kind === 'landmark') {
      out.push({
        id: d.id,
        name: spokenName(d.name),
        kind: 'landmark',
        landmark: d.id.replace(/^land:/, ''),
      });
    } else out.push({ id: d.id, name: spokenName(d.name), kind: d.kind });
  }
  return out;
}

export function chatterHost(g: Game): ChatterHost {
  const device = readDeviceNet();
  let llm = false;
  try {
    llm = llmWanted(location.search, localStorage.getItem(LLM_FLAG_KEY));
  } catch {
    llm = false;
  }
  return {
    speak: line => g.voice.speak(line),
    audioCtx: () => g.audio.ctx,
    sharedHouse: () => g.voices.house(),
    makeHouse: () =>
      new TtsEngine(defaultWorker, () => ({
        t: 'init',
        modelUrl: HOUSE_MODEL_URL,
        configUrl: HOUSE_CONFIG_URL,
      })),
    plan: () => ({
      mode: g.voiceMode,
      device,
      weak: g.weakDevice || textureDiet.on,
      realOn: g.realVoicesOn(),
    }),
    radioOn: () => g.radio.mode !== 'off' || siteFmOn(),
    places: chatPlaces,
    tod: () => g.hud.timeOfDay,
    now: () => performance.now() / 1000,
    get: k => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        // session only
      }
    },
    fetchLines: llm ? fetchLlmLines : null,
  };
}
