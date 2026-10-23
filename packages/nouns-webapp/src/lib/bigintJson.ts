/**
 * Make `JSON.stringify` tolerate BigInt by serialising it as a decimal string.
 *
 * This global patch used to run as a side effect of building the Apollo client
 * (`clientFactory` in `wrappers/subgraph.ts`). Code across the app came to
 * depend on it — e.g. TanStack Query hashes query keys with `JSON.stringify`,
 * and several keys contain bigints — so it is kept as an explicit, idempotent
 * install called once at startup from `index.tsx`.
 */
export function installBigIntJsonSerialization(): void {
  if (typeof BigInt === 'undefined') return;
  const proto = BigInt.prototype as unknown as { toJSON?: () => string };
  if (proto.toJSON) return;
  proto.toJSON = function (this: bigint) {
    return this.toString();
  };
}
