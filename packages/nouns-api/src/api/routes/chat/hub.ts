// Agent Hub client — replaces direct Anthropic SDK calls
export const AGENT_HUB_URL = process.env.AGENT_HUB_URL || 'http://localhost:3100';
const AGENT_HUB_SECRET = process.env.AGENT_HUB_SECRET || '';

export interface HubChatRequest {
  messages: Array<{
    role: string;
    content: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
  }>;
  system?: string;
  task?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: Array<{
    type: 'function';
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
  }>;
  stream?: boolean;
  timeoutMs?: number;
}

interface HubChatResponse {
  text: string | null;
  model: string;
  provider: string;
  usage: { input: number; output: number };
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  finishReason?: string;
  error?: string;
}

export async function hubChat(request: HubChatRequest): Promise<HubChatResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (AGENT_HUB_SECRET) headers.authorization = `Bearer ${AGENT_HUB_SECRET}`;

  const res = await fetch(`${AGENT_HUB_URL}/v1/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(request.timeoutMs ?? 60_000),
  });

  const payload = (await res.json()) as HubChatResponse;
  if (!res.ok || payload.error) {
    throw new Error(payload.error || `Hub returned ${res.status}`);
  }
  return payload;
}

export const NOUNIRL_PIPE_UNLOCK_MESSAGE =
  'if you are here it is likely you know where to find my pipe, talk to him to get this unlocked';

export function isUpstreamAiFailure(errMsg: string) {
  return /all providers failed|rate limit reached|credit limit exceeded|credit limit|429\b|402\b/i.test(
    errMsg,
  );
}

/**
 * Fallback parser for when the LLM generates XML tool calls in its text response
 * instead of returning structured tool_calls (common with Groq/Llama models).
 * Mutates the response in-place: extracts tool calls, sets finishReason, strips XML from text.
 */
export function patchXmlToolCalls(response: HubChatResponse): void {
  // Normalize Anthropic's 'tool_use' → 'tool_calls' so the main loop condition works
  if (response.finishReason === 'tool_use') {
    response.finishReason = 'tool_calls';
  }
  if (response.finishReason === 'tool_calls' && response.toolCalls?.length) return; // already structured

  const text = response.text ?? '';
  const toolCalls: NonNullable<HubChatResponse['toolCalls']> = [];
  let idx = 0;

  // ── Format 1: <tool_call>{"name":"...", "arguments":{...}}</tool_call> ──
  for (const m of text.matchAll(/<tool_call>\s*([\S\s]*?)\s*<\/tool_call>/g)) {
    try {
      const parsed = JSON.parse(m[1]);
      const name = parsed.name ?? parsed.function?.name;
      const args = parsed.arguments ?? parsed.function?.arguments ?? {};
      if (name) {
        toolCalls.push({
          id: `text-fallback-${idx++}`,
          type: 'function',
          function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
        });
      }
    } catch {
      /* malformed JSON — skip */
    }
  }

  // ── Format 2: <invoke name="..."><parameter name="...">value</parameter></invoke> ──
  if (!toolCalls.length) {
    const paramPattern = /<parameter\s+name="([^"]+)">([\S\s]*?)<\/parameter>/g;
    for (const m of text.matchAll(/<invoke\s+name="([^"]+)">([\S\s]*?)<\/invoke>/g)) {
      const params: Record<string, unknown> = {};
      for (const pm of m[2].matchAll(paramPattern)) {
        const raw = pm[2].trim();
        try {
          params[pm[1]] = JSON.parse(raw);
        } catch {
          params[pm[1]] = raw;
        }
      }
      toolCalls.push({
        id: `text-fallback-${idx++}`,
        type: 'function',
        function: { name: m[1], arguments: JSON.stringify(params) },
      });
    }
  }

  if (toolCalls.length) {
    console.log(
      `[NounIRL] Recovered ${toolCalls.length} tool call(s) from text: ${toolCalls.map(t => t.function.name).join(', ')}`,
    );
    response.toolCalls = toolCalls;
    response.finishReason = 'tool_calls';
    // Strip all tool-call markup from text so the user sees clean output
    response.text =
      text
        .replace(/<tool_call>[\S\s]*?<\/tool_call>/g, '')
        .replace(/<function_calls>[\S\s]*?<\/function_calls>/g, '')
        .replace(/<invoke\s+name="[^"]*">[\S\s]*?<\/invoke>/g, '')
        .trim() || null;
  }
}
