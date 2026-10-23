import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

// ─── ENS Resolution ─────────────────────────────────────────────────────

export const ensCache = new Map<string, { name: string | null; resolvedAt: number }>();
export const ENS_CACHE_TTL = 3600_000; // 1 hour

export const ensClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.PONDER_RPC_URL_1 || 'https://ethereum-rpc.publicnode.com'),
});

export async function resolveEnsBatch(addresses: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const out: Record<string, string> = {};
  const toResolve: string[] = [];
  for (const addr of addresses) {
    const key = addr.toLowerCase();
    const cached = ensCache.get(key);
    if (cached && now - cached.resolvedAt < ENS_CACHE_TTL) {
      if (cached.name) out[key] = cached.name;
    } else {
      toResolve.push(addr);
    }
  }
  for (let i = 0; i < toResolve.length; i += 10) {
    await Promise.all(
      toResolve.slice(i, i + 10).map(async addr => {
        const key = addr.toLowerCase();
        try {
          const name = await ensClient.getEnsName({ address: addr as `0x${string}` });
          ensCache.set(key, { name: name || null, resolvedAt: now });
          if (name) out[key] = name;
        } catch {
          ensCache.set(key, { name: null, resolvedAt: now });
        }
      }),
    );
  }
  return out;
}
