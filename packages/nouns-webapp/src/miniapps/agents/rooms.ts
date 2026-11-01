// ── Which rooms an agent works in (pure, deterministic per door) ────────
//
// About half the owned rooms of a kind an agent covers get an agent behind
// the counter (their `rooms` list); the rest keep their ordinary seeded
// owner. Same door → same agent on every client and every visit.

import type { AgentDef } from './contract';

import { AGENTS } from './roster';

/** Share of eligible rooms an agent runs. */
export const AGENT_ROOM_SHARE = 0.5;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function agentForRoom(
  doorId: string,
  kind: string,
  roster: readonly AgentDef[] = AGENTS,
): AgentDef | null {
  const c = roster.filter(a => a.rooms.includes(kind));
  if (c.length === 0) return null;
  const h = hash(`agent-room:${doorId}`);
  if ((h % 1000) / 1000 >= AGENT_ROOM_SHARE) return null;
  return c[(h >>> 10) % c.length]!;
}

/**
 * Put the room's agent in place of its owner (or its first resident where
 * nobody owns it): their name, their Noun, and an `agent` id.
 */
export function withAgent<
  T extends {
    name: string;
    seed: [number, number, number, number, number];
    role: string;
    agent?: string;
  },
>(defs: T[], doorId: string, kind: string, roster?: readonly AgentDef[]): T[] {
  const a = agentForRoom(doorId, kind, roster);
  if (a === null || defs.length === 0) return defs;
  const i = Math.max(
    0,
    defs.findIndex(d => d.role === 'owner'),
  );
  return defs.map((d, k) =>
    k === i ? { ...d, name: a.name, seed: [...a.seed] as T['seed'], agent: a.id } : d,
  );
}
