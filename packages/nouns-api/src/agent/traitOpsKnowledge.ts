// ─── Trait Operations Knowledge ─────────────────────────────────────────────
//
// Hard-won operational facts from the 2026-07-30/31 session. Injected into the
// NounIRL system prompt so the agent can run trait proposals and settlement
// solo WITHOUT repeating the failure modes documented here — most of which cost
// hours and one of which (the joker) is permanently on-chain.
//
// Keep additions factual and verifiable. Everything here was confirmed against
// mainnet, not inferred from source.

export const TRAIT_OPS_KNOWLEDGE = `
## Trait operations — learned the hard way

### RPC: never diagnose a revert on the free dRPC endpoint
dRPC's free plan silently caps eth_call gas and returns a bare "execution
reverted" with data 0x. The \`gas\` parameter is IGNORED, so escalating it proves
nothing. It also caps eth_getLogs at 10k blocks and can serve blocks BEHIND the
tip. An entire investigation once concluded "V2 rendering is broken for 92% of
heads" — completely false, it was the gas cap.
RULE: when an eth_call reverts with empty data, RE-RUN IT against
https://ethereum-rpc.publicnode.com before concluding anything about a contract.
publicnode 403s anonymous library traffic — send a User-Agent header (curl/8.7.1
works). Verified there: all V2 and MAIN heads read fine, tokenURI(72) returns
18,560 bytes. Big art pages are NOT a problem.

### Trait art encoding — the bug that is permanently on-chain
NounsArt.imageByIndex does abi.decode(inflate(page), (bytes[])). The payload MUST
be the DEFLATE of abi.encode(bytes[] images), and decompressedLength MUST be the
ABI-ENCODED length — not the bare RLE. NounV2 proposal #1 shipped the bare form:
it proposed, passed and executed cleanly, and V2 head #253 ("joker") is
unreadable to this day. heads(253) reverts; generateSVGImage(head=253) reverts;
any Noun rolling it (~1 in 254 mints) has a REVERTING tokenURI — no art and no
attributes anywhere, not merely a missing head.
buildAddTraitCall was fixed 2026-07-31 and now wraps correctly (verified: it
reproduces prop 987's payload byte-for-byte after inflation).
ALWAYS verify after execute: call <art>.heads(newIndex) / glasses(newIndex).
It must RETURN BYTES. If it reverts, the art is unreadable. Use
verifyTraitReadable() or the CLI's --verify-index <n> --art <addr>.

### Descriptors differ between the DAOs
MAIN descriptor 0x33A9c445fb4FB21f2c030A6b2d3e2F12D017BFAC HAS updateHeads /
updateAccessories — main prop 631 used exactly that to replace art in one call.
The V2 descriptor 0xAe0247Ca34B211a61b03A95F8008DCb8B3124B89 is a different,
larger implementation with NO update* functions at all; it exposes only add*,
setArt, setArtDescriptor, setPalette, setRenderer, lockParts.
So a broken V2 trait CANNOT be repaired by a simple proposal. It needs either a
temporary descriptor swap (setArtDescriptor → purpose-built contract → hand
back) or a whole new art contract via setArt. A JokerFix contract exists at
packages/nouns-contracts/contracts/JokerFix.sol but is NOT deployed: reading
heads(253) back inside the same transaction costs >30M gas (the block limit), so
the in-contract self-check must be reduced to headCount() and verification done
externally. Unresolved — do not deploy without re-simulating.

### Proposal timing
MAIN Nouns: 60h updatable + 12h delay + 4d voting + 48h timelock = EXACTLY 9.00
days propose→earliest execute. To execute on day D, propose on D-9 at the same
clock time; leave 3-4h of slack for block drift (~12.05-12.1s real block time
adds ~1.5h across the voting span). queue() is MANUAL and the timelock starts at
QUEUE, not at vote end — queue the moment voting closes or the schedule slips.
NounV2: ~12h voting + 12h timelock ≈ 1 day. Threshold 1 NounV2 (nounirl.eth
holds 1). MAIN threshold is dynamic (~3-4 votes) and uses DYNAMIC QUORUM — the
required FOR votes rise with AGAINST votes, so a proposal can have more FOR than
the stored quorumVotes and still be DEFEATED. Read state(id) from the governor;
never trust a cached status field.

### Settler standing targets
ONE process watches BOTH DAOs off the same block feed (dual-DAO refactor,
2026-08-01). Standing targets are configured PER DAO:
  NOUNIRL_STANDING_TRAITS_V1 (default head:wall if unset)
  NOUNIRL_STANDING_TRAITS_V2 (default off if unset)
Syntax per DAO: "+" joins AND-conditions within a group, "," separates OR
groups, "off" disables.
  head:Index card+accessory:Grease,head:Retainer+accessory:Grease
The legacy NOUNIRL_STANDING_TRAITS var is still honored: groups may carry a
"v1:"/"v2:" prefix; un-prefixed groups apply to the DAO the retired
NOUNIRL_WATCH_DAO var names (else v1). The per-DAO vars win over legacy.
Names are the DISPLAY form from seedToTraitNames ("head-index-card" → "Index
card", space not hyphen), matched EXACTLY and case-insensitively so head:Wall
never fires on Wallet or Wallsafe. Reservations carry a dao field and only
match their own DAO's predictions. Settle txs from the two DAOs share one
wallet nonce and are serialized in-process. The settler never wins the Noun
(V4 routes no-bid Nouns to the treasury); the prize is that noun.wtf credits
the settler of Noun N as the CURATOR of Noun N+1.
`;
