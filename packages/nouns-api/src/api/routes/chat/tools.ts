import type { HubChatRequest } from './hub.js';

// NounIRL tool definitions, moved verbatim out of the /api/chat handler.
// Builders return a fresh array per call, exactly as the inline literals did.
export function buildNounIrlTools(): HubChatRequest['tools'] {
  return [
    // Proposal lookup is back: without it the agent had no way to check a
    // specific prop's final state and filled the gap with invented outcomes
    {
      type: 'function' as const,
      function: {
        name: 'lookup_proposal',
        description:
          'Look up a Nouns proposal by ID, or search by keyword (e.g. "client incentives"). Returns title, status (ACTIVE/PENDING/SUCCEEDED/QUEUED/EXECUTED/DEFEATED/CANCELLED/VETOED), vote counts, quorumVotes, quorumMet and time remaining. Call this before answering anything about a specific proposal\'s outcome, votes or timing.',
        parameters: {
          type: 'object' as const,
          properties: {
            proposalId: { type: 'number', description: 'Proposal ID, e.g. 1000.' },
            keyword: {
              type: 'string',
              description: 'Search the proposal text when no ID is known.',
            },
          },
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'world_fastest',
        description:
          'Noun World all-time stats (the skate game on noun.wtf): players ever, sessions, and the top riders for top speed (km/h), best combo, best session, highest jump, longest hang time, longest grind and furthest downhill. Call this for any question about records, who is best or how many people play Noun World.',
        parameters: { type: 'object' as const, properties: {}, required: [] },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'verify_tip',
        description:
          'Verify an ETH tip transaction sent to nounirl.eth. Checks the transaction receipt on any supported chain (Ethereum, Base, Optimism, Arbitrum, Zora) and confirms the recipient is nounirl.eth and amount is ≥ 0.002 ETH (~$5).',
        parameters: {
          type: 'object' as const,
          properties: {
            txHash: {
              type: 'string',
              description: 'The transaction hash to verify (0x-prefixed).',
            },
            chainId: {
              type: 'number',
              description:
                'The chain ID where the transaction was sent. 1=Ethereum, 8453=Base, 10=Optimism, 42161=Arbitrum, 7777777=Zora.',
            },
          },
          required: ['txHash', 'chainId'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'create_reservation',
        description:
          'Create a trait reservation for a user. Requires a verified tip transaction. The reservation starts as pending_verification, then auto-activates once the tip is confirmed. The block watcher will then monitor for matching traits and auto-settle when found.',
        parameters: {
          type: 'object' as const,
          properties: {
            wallet: {
              type: 'string',
              description: "The user's wallet address (checksummed).",
            },
            txHash: {
              type: 'string',
              description: 'The tip transaction hash (must be verified).',
            },
            chainId: {
              type: 'number',
              description: 'Chain ID of the tip transaction.',
            },
            traits: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Array of desired traits in "category:value" format, e.g. ["head:shark", "glasses:blue"]. All must match (AND logic).',
            },
            dao: {
              type: 'string',
              enum: ['v1', 'v2'],
              description:
                "Which DAO's mints to watch: 'v1' = main Nouns DAO (default), 'v2' = NounV2.",
            },
          },
          required: ['wallet', 'txHash', 'chainId', 'traits'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_reservations',
        description: 'List trait reservations. Optionally filter by wallet address.',
        parameters: {
          type: 'object' as const,
          properties: {
            wallet: {
              type: 'string',
              description: 'Optional wallet address to filter by.',
            },
          },
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'cancel_reservation',
        description: 'Cancel an active or pending trait reservation.',
        parameters: {
          type: 'object' as const,
          properties: {
            reservationId: {
              type: 'string',
              description: 'The reservation ID to cancel.',
            },
          },
          required: ['reservationId'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'check_block',
        description:
          'Force an immediate block check. Returns the current block number, next noun ID, predicted traits, whether the auction has ended, and any matching reservations. Use this to give users real-time prediction data.',
        parameters: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'list_traits',
        description:
          'List all valid trait names for a given category. Useful for helping users identify exact trait names.',
        parameters: {
          type: 'object' as const,
          properties: {
            category: {
              type: 'string',
              enum: ['background', 'body', 'accessory', 'head', 'glasses'],
              description: 'The trait category to list.',
            },
          },
          required: ['category'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'parse_traits',
        description:
          'Parse a natural language trait description into structured "category:value" format. e.g. "shark head and blue noggles" → ["head:shark", "glasses:blue"].',
        parameters: {
          type: 'object' as const,
          properties: {
            description: {
              type: 'string',
              description: 'Natural language description of desired traits.',
            },
          },
          required: ['description'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_noun_settler',
        description:
          'Who settled / curated ANY noun, back to Noun 0, from the noun.wtf indexer (not the agent\'s own log). Returns the settler of noun N (tx.from of the AuctionSettled tx), the curator of N (= the settler of N-1, whose settle tx minted N and rolled its seed), the settle tx/time, winner and amount, with ENS names where known. Use this for every "who settled #N" / "who curated #N" question.',
        parameters: {
          type: 'object' as const,
          properties: {
            nounId: { type: 'number', description: 'Noun id, e.g. 1766.' },
            dao: {
              type: 'string',
              enum: ['v1', 'v2'],
              description: "'v1' = main Nouns DAO (default), 'v2' = NounV2.",
            },
          },
          required: ['nounId'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_settlements',
        description:
          "The agent's OWN successful settlements (nounirl.eth, since it started firing in 2026). NOT a history of who settled every noun — use get_noun_settler for that.",
        parameters: {
          type: 'object' as const,
          properties: {
            limit: {
              type: 'number',
              description: 'Max number of settlements to return (default 20).',
            },
          },
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_agent_balance',
        description: 'Get the ETH balance of the nounirl.eth wallet on Ethereum mainnet.',
        parameters: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'deploy_code',
        description:
          'Generate a code patch via Claude, append it as a commit on the non-production `dev-noun` branch, and trigger a Netlify branch-deploy to a fixed preview URL. Only files under packages/nouns-webapp/src/ can be modified — never deleted. Rate limited to 1 deploy per hour. Production (`main`/noun.wtf) is unreachable from this tool. Result includes `previewUrl`; quote it to the user and tell them to DM @pip on Warpcast to review and ship to prod.',
        parameters: {
          type: 'object' as const,
          properties: {
            description: {
              type: 'string',
              description:
                'A detailed description of the code change to make. Be specific about what file to modify, what to change, and why.',
            },
            reason: {
              type: 'string',
              description:
                'Short reason for the deploy (e.g. "fix polling interval", "improve UI").',
            },
          },
          required: ['description', 'reason'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'remember_fact',
        description:
          'Store a fact in persistent memory that survives across sessions. Use this to remember user names, preferences, important details about users or conversations. Memory persists across page reloads and new conversations.',
        parameters: {
          type: 'object' as const,
          properties: {
            key: {
              type: 'string',
              description:
                'Short key for the memory (e.g. "name", "preference", "ens", "fav-trait"). Lowercase, no spaces.',
            },
            content: {
              type: 'string',
              description: 'The fact to remember.',
            },
            scope: {
              type: 'string',
              enum: ['wallet', 'global'],
              description:
                'Scope: "wallet" stores it for the current user only, "global" stores it for everyone to see.',
            },
          },
          required: ['key', 'content', 'scope'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'recall_facts',
        description:
          'Recall stored memories. Use this to look up previously remembered facts about a user or global knowledge.',
        parameters: {
          type: 'object' as const,
          properties: {
            scope: {
              type: 'string',
              enum: ['wallet', 'global', 'all'],
              description:
                'Scope: "wallet" for current user, "global" for shared knowledge, "all" for everything.',
            },
            key: {
              type: 'string',
              description: 'Optional specific key to recall.',
            },
          },
          required: ['scope'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'learn_url',
        description:
          'Learn facts from a web page. Fetches the URL, extracts text, uses AI to distill key facts, and stores them in persistent knowledge. Use this when someone shares a URL and says "learn this" or "read this" or when you want to expand your knowledge base.',
        parameters: {
          type: 'object' as const,
          properties: {
            url: {
              type: 'string',
              description: 'The URL to learn from (must be a valid http/https URL).',
            },
          },
          required: ['url'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'self_learn',
        description:
          'Trigger self-learning pipeline. Reads ALL proposals, auctions, and delegate data from noun.wtf\'s own Ponder-indexed GraphQL and distills hundreds of facts into your knowledge base. Takes a few minutes. Use when asked to "learn everything", "refresh knowledge", or when you want comprehensive governance data.',
        parameters: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
    },
    // ── Governance + Trading tools mostly removed from LLM prompt (~5,000 tokens saved) ──
    // parseCommand() handles most governance actions (bid, sponsor, etc.) via
    // pattern matching BEFORE the LLM is called. Tool handlers in the switch/case
    // below are kept intact so they still execute if somehow invoked.
    //
    // KEPT: prepare_vote (needed for natural-language Lil Nouns voting — parseCommand
    // handles "vote for lil prop 375" but the LLM handles free-form requests like
    // "can you vote on lil nouns proposal 375 for me?").
    //
    // Removed: lookup_proposal, lookup_candidate, prepare_proposal_feedback,
    // prepare_candidate_feedback, prepare_candidate, prepare_update_candidate,
    // prepare_update_proposal, prepare_sponsor, prepare_bid, prepare_promote,
    // lookup_grant, prepare_grant_vote, prepare_grant_proposal, prepare_queue_proposal,
    // prepare_queue_grant, prepare_execute_proposal, prepare_execute_grant,
    // get_trading_positions, get_trading_performance, get_trading_signals
    {
      type: 'function' as const,
      function: {
        name: 'prepare_vote',
        description:
          'Prepare a vote action for the user to sign. Works for BOTH mainnet Nouns DAO and Lil Nouns DAO. Set dao to "lil-nouns" for Lil Nouns votes.',
        parameters: {
          type: 'object' as const,
          properties: {
            proposalId: {
              type: 'number',
              description: 'The proposal ID to vote on.',
            },
            support: {
              type: 'number',
              enum: [0, 1, 2],
              description: 'Vote direction: 0=AGAINST, 1=FOR, 2=ABSTAIN.',
            },
            reason: {
              type: 'string',
              description: 'Optional reason for the vote.',
            },
            dao: {
              type: 'string',
              enum: ['nouns', 'lil-nouns'],
              description:
                'Which DAO to vote on. "lil-nouns" for Lil Nouns DAO. Defaults to "nouns" (mainnet).',
            },
          },
          required: ['proposalId', 'support'],
        },
      },
    },
  ];
}

// Original tool definitions preserved as dead code (the handler only ever
// evaluates `false && buildRemovedGovernanceTools()`).
export function buildRemovedGovernanceTools() {
  return [
    {
      type: 'function' as const,
      function: {
        name: 'lookup_proposal',
        description:
          'Look up a proposal by ID or search by keyword. Returns proposal details including title, status, proposer, vote counts, and pre-calculated time remaining (votingTimeLeft, votingBlocksLeft, updatePeriodTimeLeft, objectionPeriodTimeLeft). Use this data to directly answer timing questions. Use this FIRST when the user mentions a proposal by number or topic.',
        parameters: {
          type: 'object' as const,
          properties: {
            proposalId: {
              type: 'number',
              description: 'The proposal ID to look up (e.g. 567).',
            },
            keyword: {
              type: 'string',
              description:
                'Search keyword to find proposals by title/description. Only used if proposalId is not provided.',
            },
          },
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'lookup_candidate',
        description:
          'Look up a candidate proposal by slug or search by keyword. Returns candidate details including slug, proposer, description, sponsor count. Use this when the user mentions a candidate.',
        parameters: {
          type: 'object' as const,
          properties: {
            slug: {
              type: 'string',
              description: 'The candidate slug to look up.',
            },
            keyword: {
              type: 'string',
              description:
                'Search keyword to find candidates by description. Only used if slug is not provided.',
            },
          },
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'prepare_vote',
        description:
          "Prepare a vote action for the user to sign. Returns a GovernanceAction that the frontend will present for confirmation and wallet signing. Works for BOTH mainnet Nouns DAO (default) and Lil Nouns DAO — pick the right `dao` value based on the user's intent. For mainnet Nouns ALWAYS use lookup_proposal first to confirm the proposal exists and is voteable. For Lil Nouns the on-chain governor will reject invalid IDs/states, so confirmation is best-effort via the injected Lil Nouns context (or just ask the user to clarify if uncertain).",
        parameters: {
          type: 'object' as const,
          properties: {
            proposalId: {
              type: 'number',
              description: 'The proposal ID to vote on.',
            },
            support: {
              type: 'number',
              enum: [0, 1, 2],
              description: 'Vote direction: 0=AGAINST, 1=FOR, 2=ABSTAIN.',
            },
            reason: {
              type: 'string',
              description: 'Optional reason for the vote.',
            },
            dao: {
              type: 'string',
              enum: ['nouns', 'lil-nouns'],
              description:
                'Which DAO\'s governor to vote on. "nouns" = mainnet Nouns DAO (the default). "lil-nouns" = Lil Nouns DAO (governor 0x5d2C…4039). Use "lil-nouns" whenever the user mentions "lil", "lilnoun(s)", references a proposal that exists in Lil Nouns DAO, or when viewContext.dao is "lil-nouns". Otherwise leave it unset (defaults to "nouns").',
            },
          },
          required: ['proposalId', 'support'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'prepare_proposal_feedback',
        description:
          'Prepare proposal feedback (signal vote) for the user to sign. This is non-binding feedback on a proposal — like a straw poll. Returns a GovernanceAction.',
        parameters: {
          type: 'object' as const,
          properties: {
            proposalId: {
              type: 'number',
              description: 'The proposal ID to give feedback on.',
            },
            support: {
              type: 'number',
              enum: [0, 1, 2],
              description: 'Feedback direction: 0=AGAINST, 1=FOR, 2=ABSTAIN.',
            },
            reason: {
              type: 'string',
              description: 'Optional reason for the feedback.',
            },
          },
          required: ['proposalId', 'support'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'prepare_candidate_feedback',
        description:
          'Prepare candidate proposal feedback for the user to sign. Returns a GovernanceAction.',
        parameters: {
          type: 'object' as const,
          properties: {
            proposer: {
              type: 'string',
              description: 'The candidate proposer address (0x-prefixed).',
            },
            slug: {
              type: 'string',
              description: 'The candidate slug.',
            },
            support: {
              type: 'number',
              enum: [0, 1, 2],
              description: 'Feedback direction: 0=AGAINST, 1=FOR, 2=ABSTAIN.',
            },
            reason: {
              type: 'string',
              description: 'Optional reason for the feedback.',
            },
          },
          required: ['proposer', 'slug', 'support'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'prepare_candidate',
        description:
          'Prepare a new candidate proposal for the user to create. Returns a GovernanceAction. Can include executable transactions (ETH transfers, contract calls) or be description-only. When the user mentions sending ETH, transferring tokens, or executing any treasury action — include it in the transactions array.',
        parameters: {
          type: 'object' as const,
          properties: {
            title: {
              type: 'string',
              description: 'Short title for the candidate proposal.',
            },
            description: {
              type: 'string',
              description: 'Full description/body of the candidate proposal. Markdown supported.',
            },
            transactions: {
              type: 'array',
              description:
                'Optional array of executable transactions. STRONGLY PREFER the typed primitives (kind:"usdc_transfer", "usdc_payer_debt", "eth_transfer", "weth_transfer", "steth_transfer") — these take human-readable amounts and the API encodes them correctly. Only fall back to raw {target,value,signature,calldata} for non-token contract calls (e.g. arbitrary onchain function invocations). NEVER hand-encode hex calldata for token transfers — the API will reject it if the amount is off.',
              items: {
                type: 'object',
                description:
                  'Either a typed primitive (preferred) or a raw transaction. Primitive shape: {kind,recipient,amount} for usdc_*, {kind,recipient,amountEth} for eth/weth/steth. Examples: {"kind":"usdc_transfer","recipient":"0x...","amount":"20000"} sends 20,000 USDC. {"kind":"usdc_payer_debt","recipient":"0x...","amount":"5000"} registers 5,000 USDC of debt via the Nouns Payer. {"kind":"eth_transfer","recipient":"0x...","amountEth":"0.5"} sends 0.5 ETH. Raw shape (last resort): {"target":"0x...","value":"0","signature":"someFunc(uint256)","calldata":"0x..."}.',
                properties: {
                  kind: {
                    type: 'string',
                    enum: [
                      'usdc_transfer',
                      'usdc_payer_debt',
                      'eth_transfer',
                      'weth_transfer',
                      'steth_transfer',
                    ],
                    description: 'Primitive kind. Omit for raw {target,value,signature,calldata}.',
                  },
                  recipient: {
                    type: 'string',
                    description: 'Recipient address (0x-prefixed). Used by primitives.',
                  },
                  amount: {
                    type: 'string',
                    description:
                      'Human-readable USDC amount as a string (e.g. "20000" or "20000.5"). Used by usdc_* primitives.',
                  },
                  amountEth: {
                    type: 'string',
                    description:
                      'Human-readable ETH amount as a string (e.g. "0.5", "1"). Used by eth_/weth_/steth_ primitives.',
                  },
                  target: {
                    type: 'string',
                    description: 'Raw mode only: target contract/recipient address.',
                  },
                  value: {
                    type: 'string',
                    description: 'Raw mode only: ETH value in wei as a string.',
                  },
                  signature: {
                    type: 'string',
                    description: 'Raw mode only: function signature.',
                  },
                  calldata: {
                    type: 'string',
                    description: 'Raw mode only: ABI-encoded args as hex.',
                  },
                },
              },
            },
          },
          required: ['title', 'description'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'propose_trait',
        description:
          'Prepare a governance proposal that adds a NEW art trait (head, body, accessory, or glasses) — to the ORIGINAL Nouns DAO (dao:"nouns") or to NounV2 (dao:"nounv2", the default). The proposal calls the descriptor addHeads-family function and is executed by that DAO\'s governor (NounV2 Treasury, or the main Nouns DAO for dao:"nouns"). Returns a GovernanceAction the user signs (NounV2: hold >=1 NounV2; main Nouns: meet the main DAO proposal threshold). Image sources, in precedence order: raw `rle` hex > `dream_id` (a saved Dream\'s custom trait PNG) > `png_data_url` (32x32 PNG, larger squares are downscaled) > `derive_from` an existing trait with `swap_runs`/`recolor`. PNG pixels must EXACTLY match colours already in that DAO\'s on-chain palette (alpha-0 = transparent) — new colours need a separate palette proposal. The result includes a previewUrl (/api/trait-preview) showing sample nouns wearing the trait; share it with the user.',
        parameters: {
          type: 'object' as const,
          properties: {
            category: {
              type: 'string',
              enum: ['head', 'body', 'accessory', 'glasses'],
              description: 'Which trait slot the new trait is added to.',
            },
            trait_name: {
              type: 'string',
              description: 'Short name for the new trait (e.g. "joker").',
            },
            title: { type: 'string', description: 'Proposal title.' },
            description: {
              type: 'string',
              description: 'Proposal body. Markdown supported.',
            },
            dao: {
              type: 'string',
              enum: ['nouns', 'nounv2'],
              description:
                'Which DAO the trait is proposed to. "nounv2" (default) = NounV2; "nouns" = the original/main Nouns DAO.',
            },
            rle: {
              type: 'string',
              description:
                'Optional: the trait image as raw Nouns RLE hex (0x…). Highest-precedence image source.',
            },
            dream_id: {
              type: 'number',
              description:
                'Optional: id of a saved Dream noun whose custom trait PNG becomes the new trait (converted to RLE against the DAO palette).',
            },
            png_data_url: {
              type: 'string',
              description:
                'Optional: the trait as a data:image/png;base64,… URL. Must be square; 32x32 preferred (larger squares are nearest-downscaled). Colours must already exist in the palette.',
            },
            derive_from: {
              type: 'string',
              description:
                'Optional: name or index of an existing trait in this category to derive the new one from (e.g. "index-card").',
            },
            swap_runs: {
              type: 'string',
              description:
                'Optional derivation: two 0-based RLE run indices whose colours are swapped, as "i,j" (e.g. "1,7" swaps index-card\'s top-red and bottom-blue rule lines → joker).',
            },
            recolor: {
              type: 'string',
              description:
                'Optional derivation: palette-index remaps "a:b,c:d" applied to every run.',
            },
          },
          required: ['category', 'trait_name', 'title', 'description'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'prepare_update_candidate',
        description:
          'Prepare an update to an existing candidate proposal. This replaces the candidate content and transactions. IMPORTANT: updating a candidate resets all sponsor signatures — signers must re-sign the updated version. Only the original proposer can update their candidate.',
        parameters: {
          type: 'object' as const,
          properties: {
            slug: {
              type: 'string',
              description: 'The candidate slug to update.',
            },
            title: {
              type: 'string',
              description: 'Updated title for the candidate.',
            },
            description: {
              type: 'string',
              description: 'Updated description/body. Markdown supported.',
            },
            reason: {
              type: 'string',
              description: 'Reason for the update (shown to sponsors).',
            },
            transactions: {
              type: 'array',
              description:
                'Updated transactions array. STRONGLY PREFER typed primitives (kind:"usdc_transfer"|"usdc_payer_debt"|"eth_transfer"|"weth_transfer"|"steth_transfer") with human amounts; fall back to raw {target,value,signature,calldata} only for non-token contract calls. Same item shape as prepare_candidate.',
              items: {
                type: 'object',
                properties: {
                  kind: {
                    type: 'string',
                    enum: [
                      'usdc_transfer',
                      'usdc_payer_debt',
                      'eth_transfer',
                      'weth_transfer',
                      'steth_transfer',
                    ],
                  },
                  recipient: { type: 'string' },
                  amount: { type: 'string' },
                  amountEth: { type: 'string' },
                  target: { type: 'string' },
                  value: { type: 'string' },
                  signature: { type: 'string' },
                  calldata: { type: 'string' },
                },
              },
            },
          },
          required: ['slug', 'title', 'description'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'prepare_update_proposal',
        description:
          'Prepare an update to an existing onchain proposal during its updatable period. Proposals have an update window after creation where the proposer can modify the description and/or transactions. Only the original proposer can update. Use lookup_proposal first to check that the proposal is in the updatable period (updatePeriodEndBlock > current block).',
        parameters: {
          type: 'object' as const,
          properties: {
            proposalId: {
              type: 'number',
              description: 'The proposal ID to update.',
            },
            description: {
              type: 'string',
              description:
                'Updated description (including title as "# Title"). If only updating transactions, pass the current description unchanged.',
            },
            updateMessage: {
              type: 'string',
              description: 'A short message explaining what changed in this update.',
            },
            transactions: {
              type: 'array',
              description:
                'Updated transactions. STRONGLY PREFER typed primitives (kind:"usdc_transfer"|"usdc_payer_debt"|"eth_transfer"|"weth_transfer"|"steth_transfer") with human amounts; fall back to raw only for non-token contract calls. Same item shape as prepare_candidate.',
              items: {
                type: 'object',
                properties: {
                  kind: {
                    type: 'string',
                    enum: [
                      'usdc_transfer',
                      'usdc_payer_debt',
                      'eth_transfer',
                      'weth_transfer',
                      'steth_transfer',
                    ],
                  },
                  recipient: { type: 'string' },
                  amount: { type: 'string' },
                  amountEth: { type: 'string' },
                  target: { type: 'string' },
                  value: { type: 'string' },
                  signature: { type: 'string' },
                  calldata: { type: 'string' },
                },
              },
            },
          },
          required: ['proposalId', 'updateMessage'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'prepare_sponsor',
        description:
          'Prepare to sponsor (sign) a candidate proposal. The user will sign an EIP-712 message and submit it onchain. Returns a GovernanceAction with the candidate details needed for signing.',
        parameters: {
          type: 'object' as const,
          properties: {
            proposer: {
              type: 'string',
              description: 'The candidate proposer address.',
            },
            slug: {
              type: 'string',
              description: 'The candidate slug.',
            },
            reason: {
              type: 'string',
              description: 'Optional reason for sponsoring.',
            },
          },
          required: ['proposer', 'slug'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'prepare_bid',
        description:
          'Prepare a bid on the current Nouns auction. Returns a GovernanceAction with the nounId and bid amount in ETH. The frontend handles the payable transaction with client ID 37.',
        parameters: {
          type: 'object' as const,
          properties: {
            nounId: {
              type: 'number',
              description: 'The noun ID to bid on (current auction noun).',
            },
            bidAmountEth: {
              type: 'string',
              description:
                'The bid amount in ETH (e.g. "0.55"). Must be higher than current bid + minimum increment.',
            },
          },
          required: ['nounId', 'bidAmountEth'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'prepare_promote',
        description:
          'Prepare to promote a candidate proposal to a real onchain proposal using collected sponsor signatures. This calls proposeBySigs on the NounsGovernor with client ID 37. The candidate must have enough valid signatures to meet the proposal threshold.',
        parameters: {
          type: 'object' as const,
          properties: {
            proposer: {
              type: 'string',
              description: 'The candidate proposer address.',
            },
            slug: {
              type: 'string',
              description: 'The candidate slug.',
            },
          },
          required: ['proposer', 'slug'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'lookup_grant',
        description:
          'Look up Small Grants Treasury proposals. Returns grant details including status, votes, and pre-calculated voting time remaining (votingTimeLeft, votingBlocksLeft, votingEnded). Use this data to directly answer timing questions. Can search by ID or keyword.',
        parameters: {
          type: 'object' as const,
          properties: {
            grantId: {
              type: 'number',
              description: 'The grant proposal ID to look up.',
            },
            keyword: {
              type: 'string',
              description: 'Search keyword to find grants by description.',
            },
          },
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'prepare_grant_vote',
        description:
          'Prepare a vote on an active Small Grants proposal. Returns a GovernanceAction for the frontend. Requires Nouns voting power.',
        parameters: {
          type: 'object' as const,
          properties: {
            grantId: {
              type: 'number',
              description: 'The grant proposal ID to vote on.',
            },
            support: {
              type: 'number',
              description: 'Vote direction: 0=AGAINST, 1=FOR, 2=ABSTAIN.',
            },
            reason: {
              type: 'string',
              description: 'Optional reason for the vote.',
            },
          },
          required: ['grantId', 'support'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'prepare_grant_proposal',
        description:
          'Create a new Small Grants proposal. Anyone can propose. Enters 12hr voting immediately, then 12hr timelock. Returns a GovernanceAction. Include transactions for ETH transfers or contract calls.',
        parameters: {
          type: 'object' as const,
          properties: {
            title: {
              type: 'string',
              description: 'Short title for the grant proposal.',
            },
            description: {
              type: 'string',
              description: 'Full description of the grant request.',
            },
            transactions: {
              type: 'array',
              description:
                'Optional executable transactions. STRONGLY PREFER typed primitives (kind:"usdc_transfer"|"usdc_payer_debt"|"eth_transfer"|"weth_transfer"|"steth_transfer") with human amounts; fall back to raw only for non-token contract calls. Same item shape as prepare_candidate.',
              items: {
                type: 'object',
                properties: {
                  kind: {
                    type: 'string',
                    enum: [
                      'usdc_transfer',
                      'usdc_payer_debt',
                      'eth_transfer',
                      'weth_transfer',
                      'steth_transfer',
                    ],
                  },
                  recipient: { type: 'string' },
                  amount: { type: 'string' },
                  amountEth: { type: 'string' },
                  target: { type: 'string' },
                  value: { type: 'string' },
                  signature: { type: 'string' },
                  calldata: { type: 'string' },
                },
              },
            },
          },
          required: ['title', 'description'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'prepare_queue_proposal',
        description:
          'Queue a succeeded Nouns DAO proposal into the timelock. Must be called after a proposal passes voting before it can be executed. Anyone can call this. Returns a GovernanceAction for the frontend.',
        parameters: {
          type: 'object' as const,
          properties: {
            proposalId: {
              type: 'number',
              description:
                'The proposal ID to queue. Must be in SUCCEEDED status (passed voting with quorum).',
            },
          },
          required: ['proposalId'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'prepare_queue_grant',
        description:
          'Queue a succeeded Small Grants proposal into the timelock. Must be called after a grant passes its 12hr vote before it can be executed. Anyone can call this. Returns a GovernanceAction for the frontend.',
        parameters: {
          type: 'object' as const,
          properties: {
            grantId: {
              type: 'number',
              description: 'The grant proposal ID to queue. Must have passed voting.',
            },
          },
          required: ['grantId'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'prepare_execute_proposal',
        description:
          'Execute a queued Nouns DAO proposal whose timelock has expired. Anyone can call this. Returns a GovernanceAction for the frontend.',
        parameters: {
          type: 'object' as const,
          properties: {
            proposalId: {
              type: 'number',
              description:
                'The proposal ID to execute. Must be in QUEUED status with expired timelock.',
            },
          },
          required: ['proposalId'],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'prepare_execute_grant',
        description:
          'Execute a queued Small Grants proposal whose timelock has expired. Anyone can call this. Returns a GovernanceAction for the frontend.',
        parameters: {
          type: 'object' as const,
          properties: {
            grantId: {
              type: 'number',
              description:
                'The grant proposal ID to execute. Must be in QUEUED status with expired timelock.',
            },
          },
          required: ['grantId'],
        },
      },
    },
    // ── Trading Bot Tools (pooter.world integration) ──
    {
      type: 'function' as const,
      function: {
        name: 'get_trading_positions',
        description:
          'Get current trading positions from the pooter.world trading bot. Shows open positions with entry price, P&L, venue, direction (long/short), and moral score. Use this when users ask about trading, positions, or the trading bot.',
        parameters: {
          type: 'object' as const,
          properties: {
            openOnly: {
              type: 'boolean',
              description: 'If true (default), only show open positions. If false, show all.',
            },
          },
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_trading_performance',
        description:
          'Get trading performance metrics from the pooter.world trading bot. Returns account value, win rate, realized P&L, total trades, largest win/loss. Use this when users ask about trading performance, returns, or how the bot is doing.',
        parameters: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
    },
    {
      type: 'function' as const,
      function: {
        name: 'get_trading_signals',
        description:
          'Get current market signals from the pooter.world trading bot. Returns bullish/bearish/neutral signals with confidence levels for watched markets (BTC, ETH, SOL, etc.). Use this when users ask about market sentiment or what the bot is watching.',
        parameters: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
      },
    },
  ];
}
