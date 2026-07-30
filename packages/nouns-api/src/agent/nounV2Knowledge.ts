// ─── NounV2 Knowledge Block ─────────────────────────────────────────────────
//
// Static facts about the NounV2 fork DAO. Injected into every chat system
// prompt so the AI knows v2 exists and can answer questions about it without
// hallucinating that v2 noun #0 is the same noun as a mainnet Noun.
//
// Keep this short. The injected `view_context` block tells the AI which
// DAO the user is currently viewing — these facts give it the vocabulary
// to talk about it.

export const NOUN_V2_KNOWLEDGE = `
## NounV2 (Concurrent Fork DAO)

NounV2 launched on Ethereum mainnet on 2026-04-24 as a concurrent Nouns-style DAO running alongside the original Nouns DAO. Same generative pixel-art pipeline (5 traits: background, body, accessory, head, glasses), same NounsSeeder algorithm — but fresh IDs starting at NounV2 #0.

Why it exists: in early 2026 the original Nouns DAO adopted a 2.8 ETH reserve price on its auctions. Auctions that fail to clear the reserve burn the noun (no settlement). NounV2 was launched in response, with effectively zero reserve (50 wei = $0.00000015 at current ETH price) so every noun will sell. Auctions are 24 hours.

Contracts (all on Ethereum mainnet):
- Token: 0xb1d6bdf9326dd09183c2e9d25af5e22c637293b9
- AuctionHouse: 0x9a6ddb16e23967d5482e5bfd7444a04a5d5145fc (Treasury-owned — governance controls every parameter)
- Treasury: 0x2cdeb0d251674710840d9fa990d1de138dfe7c00 (receives all auction proceeds)
- Admin Safe with veto: 0xADa31Add8450CA0422983B9a3103633b78938617

Governance: 1 NounV2 holder = 1 vote. ≥1 token to propose. 12-hour voting window + 12-hour timelock. No quorum. Faster cycle than mainnet Nouns. The admin Safe holds a veto for emergencies only.

CRITICAL DISAMBIGUATION: NounV2 IDs are completely separate from mainnet Nouns IDs. NounV2 #0 is NOT mainnet Noun #0 (that's a Nounder reward). When a user is viewing dao=nounv2, all noun IDs in that view refer to v2 tokens, not mainnet. Always check the injected view_context before referencing any noun by ID.

Art trait additions: both descriptors are governance-owned (NounV2's by the Treasury, main Nouns' by the DAO timelock), so a new head/body/accessory/glasses trait is added by a proposal calling the descriptor's addHeads-family function. The propose_trait tool builds this end-to-end — from raw RLE, a saved Dream's custom trait PNG (dream_id), or an uploaded 32x32 PNG — for either DAO (dao:"nounv2" default, dao:"nouns" for mainnet), and returns a /api/trait-preview URL showing sample nouns wearing the trait. Constraint: the image may only use colours already in that DAO's on-chain palette (main: 239 colours, V2: 253); new colours need a separate palette proposal. First shipped as NounV2 prop #1 ("joker" head #253).
`.trim();
