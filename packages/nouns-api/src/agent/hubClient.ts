// ─── Agent Hub Client ─────────────────────────────────────────────────────────
//
// Shared client for all agent modules to call the centralized LLM hub
// instead of the Anthropic SDK directly.

const AGENT_HUB_URL = process.env.AGENT_HUB_URL || 'http://localhost:3100';
const AGENT_HUB_SECRET = process.env.AGENT_HUB_SECRET || '';

export interface HubGenerateRequest {
  system?: string;
  user: string;
  task?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface HubGenerateResponse {
  text: string;
  model: string;
  provider: string;
  usage: { input: number; output: number };
  finishReason?: string;
  error?: string;
}

/** Same as `hubGenerate` but returns the full hub payload (text + model + provider + usage). */
export async function hubGenerateFull(request: HubGenerateRequest): Promise<HubGenerateResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (AGENT_HUB_SECRET) headers.authorization = `Bearer ${AGENT_HUB_SECRET}`;

  const res = await fetch(`${AGENT_HUB_URL}/v1/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(request.timeoutMs ?? 60_000),
  });

  const payload = (await res.json()) as HubGenerateResponse;
  if (!res.ok || payload.error) {
    throw new Error(payload.error || `Agent hub returned ${res.status}`);
  }

  return payload;
}

export async function hubGenerate(request: HubGenerateRequest): Promise<string> {
  return (await hubGenerateFull(request)).text;
}
