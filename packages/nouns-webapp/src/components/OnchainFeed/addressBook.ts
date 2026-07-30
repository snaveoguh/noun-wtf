/**
 * Hardcoded address → display-name registry for the onchain feed.
 * Resolution order (see AddressTag): this book → API `resolved` map → 0x1234…abcd.
 * Keys MUST be lowercase.
 */
export const ADDRESS_BOOK: Record<string, string> = {
  // Nouns
  '0xb1a32fc9f9d8b2cf86c068cae13108809547ef71': 'Nouns Treasury',
  '0x830bd73e4184cef73443c15111a1df14e495c706': 'Nouns Auction',
  '0xae4705dc0816ee6d8a13f1c72780ec5021915fed': 'memevalue.eth',
  // NounV2
  '0x2cdeb0d251674710840d9fa990d1de138dfe7c00': 'NounV2 Treasury',
  // Marketplaces
  '0x0000000000000068f116a894984e2db1123eb395': 'OpenSea',
  '0x39da41747a83aee658334415666f3ef92dd0d541': 'Blur',
};

/**
 * Best display name for an address: address book → API resolved map → null.
 */
export function displayNameFor(
  address: string | null | undefined,
  resolved?: Record<string, string>,
): string | null {
  if (!address) return null;
  const key = address.toLowerCase();
  return ADDRESS_BOOK[key] ?? resolved?.[key] ?? null;
}

/** 0x1234…abcd */
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
