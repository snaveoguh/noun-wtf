export function MarketGridSkeleton() {
  return (
    <section className="mb-8">
      <div className="mb-3 h-3 w-28 animate-pulse bg-[var(--rule-light)]" />
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border border-[var(--rule-light)] p-4">
            <div className="mb-2 flex items-center gap-2">
              <div className="bg-[var(--rule-light)]/60 h-2.5 w-14 animate-pulse" />
              <div className="bg-[var(--rule-light)]/40 h-2.5 w-8 animate-pulse" />
            </div>
            <div className="mb-1 h-3.5 w-5/6 animate-pulse bg-[var(--rule-light)]" />
            <div className="bg-[var(--rule-light)]/60 mb-3 h-3 w-2/3 animate-pulse" />
            <div className="bg-[var(--rule-light)]/30 h-6 w-full animate-pulse" />
          </div>
        ))}
      </div>
    </section>
  );
}
