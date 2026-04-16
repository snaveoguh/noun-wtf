import { NounsMarketplace } from '@/components/Marketplace/NounsMarketplace';

export default function MarketplacePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 border-b-2 border-neutral-200 pb-4 dark:border-neutral-700">
        <h1 className="font-londrina text-4xl">Nouns Marketplace</h1>
        <p className="mt-1 text-xs uppercase tracking-widest text-neutral-500">
          Zero-fee · Seaport 1.6 · Peer-to-peer on Ethereum
        </p>
      </div>
      <NounsMarketplace />
    </div>
  );
}
