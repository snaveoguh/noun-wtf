// The small HUD tag that marks an agent (an AI economic actor, not a player).

export function AgentTag({ title }: { title?: string }) {
  return (
    <span
      className="ml-1 inline-block bg-[#ffd400] px-1 align-middle text-[9px] font-black not-italic leading-[14px] tracking-wide text-black"
      title={title ?? 'An agent: an AI trader that keeps the economy moving while players are away'}
      data-agent-tag
    >
      🤖 AGENT
    </span>
  );
}
