import { FC } from 'react';

const SettlersPage: FC = () => {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-2 text-4xl font-bold">Settlers</h1>
      <p className="text-muted-foreground mb-6">
        Track who settles Nouns auctions. Settlers call the <code>settle()</code> function on the
        auction house contract, triggering the next auction and minting the next Noun.
      </p>

      <div className="rounded-xl border bg-white p-8 text-center shadow-sm">
        <div className="text-6xl mb-4">⛏️</div>
        <h2 className="text-xl font-bold mb-2">Coming Soon</h2>
        <p className="text-muted-foreground">
          Settler tracking requires the Ponder indexer to capture settlement data.
          Once the indexer is fully synced, this page will display a leaderboard of
          the most active settlers, their settlement counts, and links to each settled noun.
        </p>
      </div>
    </div>
  );
};

export default SettlersPage;
