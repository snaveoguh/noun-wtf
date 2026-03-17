// ─── Agent NounIRL — Bridge to pooter.world ──────────────────────────────────
//
// Lightweight HTTP bridge that pushes agent events to pooter.world's message bus.
// Format matches AgentMessage from pooter.world/src/lib/agents/core/types.ts.
//
// Env vars:
//   AGENT_BRIDGE_URL    — e.g. https://pooter.world
//   AGENT_BRIDGE_SECRET — shared secret for Bearer auth

const BRIDGE_URL = (): string | null => process.env.AGENT_BRIDGE_URL || null;
const BRIDGE_SECRET = (): string | null => process.env.AGENT_BRIDGE_SECRET || null;

const AGENT_ID = 'nounirl';
const RELAY_TIMEOUT_MS = 5_000;

interface BridgeMessage {
  id: string;
  from: string;
  to: string;
  topic: string;
  payload: unknown;
  timestamp: number;
}

/**
 * Publish a message to pooter.world's message bus relay.
 * Fire-and-forget — never throws, never blocks the caller.
 */
export function bridgePublish(
  topic: string,
  payload: unknown,
  to: string = '*',
): void {
  const url = BRIDGE_URL();
  const secret = BRIDGE_SECRET();

  if (!url || !secret) return; // bridge not configured — silently skip

  const message: BridgeMessage = {
    id: crypto.randomUUID(),
    from: AGENT_ID,
    to,
    topic,
    payload,
    timestamp: Date.now(),
  };

  const relayUrl = `${url}/api/agents/bus/relay`;

  // Fire and forget — don't await, don't block settlement logic
  fetch(relayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${secret}`,
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
  })
    .then((res) => {
      if (!res.ok) {
        console.warn(`[NounIRL:Bridge] Relay failed: ${res.status} ${res.statusText}`);
      } else {
        console.log(`[NounIRL:Bridge] Relayed "${topic}" to ${url}`);
      }
    })
    .catch((err) => {
      console.warn(`[NounIRL:Bridge] Relay error: ${err instanceof Error ? err.message : err}`);
    });
}

/**
 * Check if bridge is configured.
 */
export function isBridgeConfigured(): boolean {
  return !!(BRIDGE_URL() && BRIDGE_SECRET());
}
