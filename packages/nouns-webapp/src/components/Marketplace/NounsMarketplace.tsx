import type { NounMarketItem } from '@/lib/marketplace/nouns-marketplace';

import { useState, useEffect, useCallback } from 'react';

import { NounCard } from './NounCard';
import { YourNouns } from './YourNouns';

const SORT_OPTIONS = [
  { value: 'id-desc', label: 'Newest' },
  { value: 'id-asc', label: 'Oldest' },
  { value: 'price-asc', label: 'Price ↑' },
  { value: 'price-desc', label: 'Price ↓' },
];

export function NounsMarketplace() {
  const [items, setItems] = useState<NounMarketItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState('price-asc');

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ sort });
      const res = await fetch(`/api/nouns/listings?${params}`);
      const data = await res.json();
      setItems((data.items ?? []) as NounMarketItem[]);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [sort]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  return (
    <div>
      {/* ── Masthead ── */}
      <div className="mb-6 border-b-2 border-[var(--rule)] pb-4">
        <h1 className="font-headline text-4xl text-[var(--ink)] sm:text-5xl">Nouns Marketplace</h1>
        <p className="font-body-serif mt-1 text-sm text-[var(--ink-light)]">
          Buy and sell Nouns NFTs with 0% marketplace fees. Direct peer-to-peer trading via Seaport
          1.6 on Ethereum.
        </p>
      </div>

      {/* ── Your Nouns (wallet-connected) ── */}
      <YourNouns />

      {/* ── Listed Nouns ── */}
      <div className="mb-2 border-b border-[var(--rule-light)] pb-2">
        <h2 className="font-headline text-xl text-[var(--ink)]">Listed for Sale</h2>
      </div>

      {/* ── Sort / Count ── */}
      <div className="mb-4 flex flex-wrap items-center gap-0 border-b border-[var(--rule-light)] pb-3 font-mono text-[10px] uppercase tracking-wider">
        {SORT_OPTIONS.map((opt, i) => (
          <span key={opt.value} className="flex shrink-0 items-center">
            {i > 0 && <span className="mx-1 text-[var(--rule-light)]">|</span>}
            <button
              onClick={() => setSort(opt.value)}
              className={`transition-colors ${
                sort === opt.value
                  ? 'font-bold text-[var(--ink)] underline underline-offset-4'
                  : 'text-[var(--ink-faint)] hover:text-[var(--ink)]'
              }`}
            >
              {opt.label}
            </button>
          </span>
        ))}

        <span className="ml-auto shrink-0 text-[var(--ink-faint)]">{items.length} listed</span>
      </div>

      {/* ── Grid ── */}
      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className="aspect-square animate-pulse border border-[var(--rule-light)] bg-[var(--paper-dark)]"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="font-body-serif py-16 text-center text-sm italic text-[var(--ink-faint)]">
          No Nouns are currently listed for sale.
          <br />
          <span className="mt-2 block font-mono text-[8px] uppercase tracking-wider">
            Connect your wallet and visit a Noun&rsquo;s detail page to list it.
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map(item => (
            <NounCard key={item.nounId} noun={item} />
          ))}
        </div>
      )}
    </div>
  );
}
