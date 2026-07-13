// NounsFederation ABI — generated from
// packages/nouns-contracts/contracts/federation/NounsFederation.sol
// V2→V1 meta-governance relay. Events: MirrorCreated, MirrorVoteCast, VoteRelayed.
export const nounsFederationAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_nounsDAOV1",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_nounV2Token",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_owner",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "mirrorId",
        "type": "uint256"
      }
    ],
    "name": "AlreadyMirrored",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "AlreadyRelayed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "AlreadyVoted",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidSupport",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "blocksRemaining",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "maxLeadBlocks",
        "type": "uint256"
      }
    ],
    "name": "MirrorTooEarly",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "blocksRemaining",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "minLeadBlocks",
        "type": "uint256"
      }
    ],
    "name": "MirrorTooLate",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NoVotingPower",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "OnlyOwner",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "Paused",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "totalVotes",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "quorum",
        "type": "uint256"
      }
    ],
    "name": "QuorumNotReached",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UnknownMirror",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "V1ProposalNotActive",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "VotingClosed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "VotingOpen",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "oldValue",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "newValue",
        "type": "uint256"
      }
    ],
    "name": "MaxLeadBlocksChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "mirrorId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "v1ProposalId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "creator",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "snapshotBlock",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "endBlock",
        "type": "uint256"
      }
    ],
    "name": "MirrorCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "bool",
        "name": "paused",
        "type": "bool"
      }
    ],
    "name": "MirrorPausedChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "voter",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "mirrorId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "support",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "votes",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "reason",
        "type": "string"
      }
    ],
    "name": "MirrorVoteCast",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "oldOwner",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "OwnerChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "oldValue",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "newValue",
        "type": "uint256"
      }
    ],
    "name": "QuorumVotesChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "mirrorId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "v1ProposalId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "support",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "forVotes",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "againstVotes",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "abstainVotes",
        "type": "uint256"
      }
    ],
    "name": "VoteRelayed",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "MIN_LEAD_BLOCKS",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "RELAY_BUFFER",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "VOTING_PERIOD",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "mirrorId",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "support",
        "type": "uint8"
      }
    ],
    "name": "castVote",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "mirrorId",
        "type": "uint256"
      },
      {
        "internalType": "uint8",
        "name": "support",
        "type": "uint8"
      },
      {
        "internalType": "string",
        "name": "reason",
        "type": "string"
      }
    ],
    "name": "castVoteWithReason",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "mirrorId",
        "type": "uint256"
      }
    ],
    "name": "getMirror",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint256",
            "name": "v1ProposalId",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "snapshotBlock",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "endBlock",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "forVotes",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "againstVotes",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "abstainVotes",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "relayed",
            "type": "bool"
          },
          {
            "internalType": "uint8",
            "name": "relayedSupport",
            "type": "uint8"
          }
        ],
        "internalType": "struct NounsFederation.Mirror",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "name": "hasVoted",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "mirrorId",
        "type": "uint256"
      }
    ],
    "name": "isRelayable",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxLeadBlocks",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "v1ProposalId",
        "type": "uint256"
      }
    ],
    "name": "mirror",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "mirrorId",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "mirrorCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "mirrorPaused",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "mirrors",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "v1ProposalId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "snapshotBlock",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "endBlock",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "forVotes",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "againstVotes",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "abstainVotes",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "relayed",
        "type": "bool"
      },
      {
        "internalType": "uint8",
        "name": "relayedSupport",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "nounV2Token",
    "outputs": [
      {
        "internalType": "contract INounV2VotingToken",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "nounsDAOV1",
    "outputs": [
      {
        "internalType": "contract INounsDAOV1",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "owner",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "quorumVotes",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "mirrorId",
        "type": "uint256"
      }
    ],
    "name": "relay",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "support",
        "type": "uint8"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "newValue",
        "type": "uint256"
      }
    ],
    "name": "setMaxLeadBlocks",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bool",
        "name": "paused",
        "type": "bool"
      }
    ],
    "name": "setMirrorPaused",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "newValue",
        "type": "uint256"
      }
    ],
    "name": "setQuorumVotes",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "newOwner",
        "type": "address"
      }
    ],
    "name": "transferOwnership",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "v1ToMirror",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
