/**
 * Registry of known Nouns auction client IDs.
 *
 * Each client registers onchain via NounsAuctionHouseV2 / NounsClientRewards
 * and is assigned a monotonically increasing integer ID. Clients also publish
 * metadata (name + url) onchain, but this webapp doesn't currently query it —
 * so we keep a hardcoded fallback map here that covers the common clients.
 *
 * TODO(tech-debt): Replace this hardcoded map with an onchain query of the
 * NounsAuctionHouseV2 `getClient(uint32)` view (or the off-chain registry
 * that Nouns DAO publishes). Until then, unknown clients show a neutral
 * placeholder favicon and a "Client #N" label.
 */

export interface ClientInfo {
  /** Display name */
  name: string;
  /** Landing-page URL — used as the link target and to derive the favicon */
  url: string;
  /** Short description shown in the hover tooltip */
  description: string;
  /**
   * Optional explicit favicon URL. If omitted, we derive one from `url`
   * via Google's s2 favicon service.
   */
  iconUrl?: string;
}

/**
 * Known clients. Keyed by the uint32 clientId stored onchain.
 *
 * Some IDs were taken from <https://nouns.camp/> and the Nouns DAO client
 * rewards dashboards. Fill in more as you verify them.
 */
// Source of truth: NounsClientToken (0x88386...) `clientMetadata(uint32)`.
// Verified onchain via publicnode 2026-04-28. If this looks off, query
// the contract directly — the human-friendly description there is canonical.
export const CLIENT_REGISTRY: Record<number, ClientInfo> = {
  0: {
    name: 'nouns.wtf',
    url: 'https://nouns.wtf',
    description: 'The official Nouns DAO frontend',
  },
  1: {
    name: 'Noundry',
    url: 'https://noundry.wtf',
    description: 'Community-generated Noun traits',
  },
  2: {
    name: 'House of Nouns',
    url: '',
    description: 'House of Nouns — community client',
  },
  3: {
    name: 'nouns.camp',
    url: 'https://nouns.camp',
    description: 'Governance-focused Nouns client by Obvious Inc',
  },
  4: {
    name: 'Nouns.biz',
    url: 'https://nouns.biz',
    description: 'Nouns.biz client',
  },
  5: {
    name: 'Nouns.com',
    url: 'https://nouns.com',
    description: 'Nouns-powered tools and utilities',
  },
  6: {
    name: 'nouns.game',
    url: 'https://nouns.game',
    description: 'A cool client by the DUNA Admin',
  },
  7: {
    name: 'Nouns Terminal',
    url: 'https://nouns.sh',
    description: 'Terminal-style Nouns auction & governance client',
  },
  8: {
    name: 'Nouns GG',
    url: '',
    description: 'Nouns GG — community client',
  },
  9: {
    name: 'Probe',
    url: 'https://probe.wtf',
    description: 'Probe — Nouns explorer client by mshrm',
  },
  10: {
    name: 'Agora',
    url: 'https://nounsagora.com',
    description: 'Agora governance dashboard for Nouns DAO',
  },
  11: {
    name: 'Berry OS',
    url: 'https://berryos.wtf',
    description: 'Berry OS — desktop-style Nouns client (formerly Nouns 95)',
  },
  12: {
    name: 'Prop Launchpad',
    url: 'https://proplaunchpad.com',
    description: 'This client does not exist, they are farming rewards via etherscan',
  },
  18: {
    name: 'Anouns',
    url: '',
    description: 'Anouns — anonymous Nouns client',
  },
  22: {
    name: "Nouncil's client",
    url: '',
    description: "Nouncil's client",
  },
  37: {
    name: 'noun.wtf',
    url: 'https://noun.wtf',
    description: 'Community Nouns client by pip',
  },
};

export const UNKNOWN_CLIENT: ClientInfo = {
  name: 'Unknown client',
  url: '',
  description: 'Bid placed via an unrecognized client',
};

export function getClientInfo(clientId: number | null | undefined): ClientInfo | null {
  if (clientId == null) return null;
  const known = CLIENT_REGISTRY[clientId];
  if (known) return known;
  return { ...UNKNOWN_CLIENT, name: `Client #${clientId}` };
}

/**
 * Derive a favicon URL from a client's URL. Uses Google's s2 favicon service
 * which requires no extra backend and works for arbitrary domains.
 * Falls back to undefined if the URL is empty / unparseable.
 */
export function getClientFaviconUrl(client: ClientInfo, size = 64): string | undefined {
  if (client.iconUrl) return client.iconUrl;
  if (!client.url) return undefined;
  try {
    const domain = new URL(client.url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
  } catch {
    return undefined;
  }
}
