export const PIPE_UNLOCK_MESSAGE =
  'if you are here it is likely you know where to find my pipe, talk to him to get this unlocked';

export function normalizeTerminalErrorMessage(errorMsg: string) {
  const trimmed = errorMsg.replace(/^ai request failed:\s*/i, '').trim();

  if (
    trimmed.includes(PIPE_UNLOCK_MESSAGE) ||
    /all providers failed|rate limit reached|credit limit exceeded|credit limit|429\b|402\b/i.test(
      trimmed,
    )
  ) {
    return PIPE_UNLOCK_MESSAGE;
  }

  return `error: ${trimmed}`;
}
