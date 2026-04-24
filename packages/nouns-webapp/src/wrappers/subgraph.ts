import { ApolloClient, ApolloLink, gql, HttpLink, InMemoryCache } from '@apollo/client';

import {
  clearUnavailableSubgraphUrl,
  getSubgraphRequestUrls,
  markSubgraphUrlUnavailable,
} from '@/lib/subgraphSettings';
import { BigNumberish } from '@/utils/types';

export const clientFactory = (uri: string) => {
  // patch BigInt JSON serialization (runs once)
  if (
    typeof BigInt !== 'undefined' &&
    !(BigInt.prototype as unknown as { toJSON?: () => string }).toJSON
  ) {
    (BigInt.prototype as unknown as { toJSON?: () => string }).toJSON = function () {
      return this.toString();
    };
  }

  // scrub nested BigInts even before cache
  const scrubBigIntLink = new ApolloLink((operation, forward) =>
    forward(operation)!.map(result =>
      JSON.parse(JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
    ),
  );

  const fetchWithFallback: typeof fetch = async (_input, init) => {
    const requestUrls = getSubgraphRequestUrls();
    const urls = requestUrls.length > 0 ? requestUrls : [uri];
    let lastError: Error | null = null;

    for (const [index, url] of urls.entries()) {
      try {
        const response = await fetch(url, init);
        if (!response.ok) {
          throw new Error(`Subgraph request failed: HTTP ${response.status}`);
        }

        clearUnavailableSubgraphUrl(url);
        return response;
      } catch (error) {
        markSubgraphUrlUnavailable(url);
        lastError = error instanceof Error ? error : new Error('Subgraph request failed');

        if (index === urls.length - 1) {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error('Subgraph request failed');
  };

  return new ApolloClient({
    link: ApolloLink.from([scrubBigIntLink, new HttpLink({ uri, fetch: fetchWithFallback })]),
    cache: new InMemoryCache(),
    defaultOptions: {
      watchQuery: {
        fetchPolicy: 'cache-and-network',
      },
      query: {
        fetchPolicy: 'network-only',
      },
    },
  });
};

export interface IBid {
  id: string;
  bidder: {
    id: string;
  };
  amount: bigint;
  blockNumber: number;
  blockTimestamp: number;
  txHash: string;
  txIndex?: number;
  noun: {
    id: number;
    startTime?: BigNumberish;
    endTime?: BigNumberish;
    settled?: boolean;
  };
}

interface ProposalVote {
  supportDetailed: 0 | 1 | 2;
  voter: {
    id: string;
  };
}

export interface ProposalVotes {
  votes: ProposalVote[];
}

export interface Delegate {
  id: string;
  nounsRepresented: {
    id: string;
  }[];
}

export interface Delegates {
  delegates: Delegate[];
}

// ─── Ponder-compatible GraphQL queries ─────────────────────────────────────────
// Ponder v0.12 wraps plural results in { items: [...], totalCount }
// and uses limit/after/before instead of first/skip

export const seedsQuery = (first = 1_000, after?: string) => ({
  query: gql`
    query GetSeeds($first: Int!, $after: String) {
      nouns(limit: $first, orderBy: "id", orderDirection: "asc", after: $after) {
        items {
          id
          background
          body
          accessory
          head
          glasses
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `,
  variables: { first, after: after ?? null },
});

export const proposalQuery = (id: string | number) => ({
  query: gql`
    query GetProposal($id: BigInt!) {
      proposal(id: $id) {
        id
        description
        status
        proposalThreshold
        quorumVotes
        forVotes
        againstVotes
        abstainVotes
        createdAtTransaction
        createdAtBlock
        createdAt
        startBlock
        endBlock
        updatePeriodEndBlock
        objectionPeriodEndBlock
        executionETA
        onTimelockV1
        voteSnapshotBlock
        proposer
        clientId
        signers(limit: 100) {
          items {
            signer
          }
        }
        transactions(limit: 100, orderBy: "index", orderDirection: "asc") {
          items {
            target
            value
            signature
            calldata
          }
        }
      }
    }
  `,
  variables: { id: String(id) },
});

export const partialProposalsQuery = (first = 1_000) => ({
  query: gql`
    query GetPartialProposals($first: Int!) {
      proposals(limit: $first, orderBy: "createdAtBlock", orderDirection: "asc") {
        items {
          id
          status
          forVotes
          againstVotes
          abstainVotes
          quorumVotes
          executionETA
          startBlock
          endBlock
          updatePeriodEndBlock
          objectionPeriodEndBlock
          onTimelockV1
          proposer
          signers(limit: 100) {
            items {
              signer
            }
          }
        }
      }
    }
  `,
  variables: { first },
});

export const activePendingUpdatableProposersQuery = (first = 1_000, currentBlock: bigint = 0n) => ({
  query: gql`
    query GetActivePendingUpdatableProposers($first: Int!, $currentBlock: BigInt!) {
      proposals(
        limit: $first
        where: {
          OR: [
            { status: "PENDING", endBlock_gt: $currentBlock }
            { status: "ACTIVE", endBlock_gt: $currentBlock }
          ]
        }
      ) {
        items {
          proposer
          signers(limit: 100) {
            items {
              signer
            }
          }
        }
      }
    }
  `,
  variables: { first, currentBlock: String(currentBlock) },
});

export const updatableProposalsQuery = (first = 1_000, currentBlock: bigint = 0n) => ({
  query: gql`
    query GetUpdatableProposals($first: Int!, $currentBlock: BigInt!) {
      proposals(
        limit: $first
        where: {
          status: "PENDING"
          endBlock_gt: $currentBlock
          updatePeriodEndBlock_gt: $currentBlock
        }
      ) {
        items {
          id
        }
      }
    }
  `,
  variables: { first, currentBlock: String(currentBlock || 0) },
});

export const candidateProposalsQuery = (first = 1_000) => ({
  query: gql`
    query GetCandidateProposals($first: Int!) {
      candidates(
        limit: $first
        where: { canceled: false }
        orderBy: "lastUpdatedAtBlock"
        orderDirection: "desc"
      ) {
        items {
          id
          slug
          proposer
          canceled
          versionsCount
          proposalIdToUpdate
          encodedProposalHash
          description
          targets
          values
          signatures
          calldatas
          createdAt
          createdAtBlock
          createdAtTransaction
          lastUpdatedAt
          lastUpdatedAtBlock
          candidateSignatures(limit: 100) {
            items {
              signer
              sig
              expirationTimestamp
              encodedPropHash
              reason
              canceled
            }
          }
        }
      }
    }
  `,
  variables: { first },
});

export const candidateProposalQuery = (id: string) => ({
  query: gql`
    query GetCandidateProposal($id: String!) {
      candidate(id: $id) {
        id
        slug
        proposer
        canceled
        versionsCount
        proposalIdToUpdate
        encodedProposalHash
        description
        targets
        values
        signatures
        calldatas
        createdAt
        createdAtBlock
        createdAtTransaction
        lastUpdatedAt
        lastUpdatedAtBlock
        candidateSignatures(limit: 100) {
          items {
            signer
            sig
            expirationTimestamp
            encodedPropHash
            reason
            canceled
          }
        }
      }
    }
  `,
  variables: { id },
});

export const candidateProposalVersionsQuery = (_id: string) => {
  void _id;
  return {
    query: gql`
      query GetCandidateProposalVersions {
        __typename
      }
    `,
    variables: {},
  };
};

// Not indexed by Ponder
export const proposalVersionsQuery = (_id: string | number) => {
  void _id;
  return {
    query: gql`
      query GetProposalVersions {
        __typename
      }
    `,
    variables: {},
  };
};

export const auctionQuery = (id: string) => ({
  query: gql`
    query GetAuction($id: BigInt!) {
      auction(nounId: $id) {
        nounId
        amount
        settled
        winner
        burned
        startTime
        endTime
        clientId
        noun {
          id
          background
          body
          accessory
          head
          glasses
          owner
        }
        bids(limit: 100, orderBy: "value", orderDirection: "desc") {
          items {
            value
            bidder
            clientId
            createdAtBlock
            createdAtTransaction
          }
        }
      }
    }
  `,
  variables: { id: String(id) },
});

export const bidsByAuctionQuery = (auctionId: string) => ({
  query: gql`
    query GetBidsByAuction($auctionId: BigInt!) {
      bids(where: { nounId: $auctionId }, orderBy: "value", orderDirection: "desc") {
        items {
          nounId
          value
          bidder
          clientId
          createdAt
          createdAtBlock
          createdAtTransaction
        }
      }
    }
  `,
  variables: { auctionId: String(auctionId) },
});

export const nounQuery = (id: string) => ({
  query: gql`
    query GetNoun($id: BigInt!) {
      noun(id: $id) {
        id
        background
        body
        accessory
        head
        glasses
        owner
      }
    }
  `,
  variables: { id: String(id) },
});

export const nounsIndex = () => ({
  query: gql`
    query GetNounsIndex {
      nouns(limit: 1000, orderBy: "id", orderDirection: "asc") {
        items {
          id
          owner
        }
      }
    }
  `,
  variables: {},
});

export const latestAuctionsQuery = (first = 1000, _skip = 0) => {
  void _skip;
  return {
    query: gql`
      query GetLatestAuctions($first: Int!) {
        auctions(orderBy: "startTime", orderDirection: "desc", limit: $first) {
          items {
            nounId
            amount
            settled
            winner
            burned
            startTime
            endTime
            clientId
            noun {
              id
              owner
            }
            bids(limit: 100, orderBy: "value", orderDirection: "desc") {
              items {
                value
                bidder
                clientId
                createdAtBlock
                createdAt
                createdAtTransaction
              }
            }
          }
        }
      }
    `,
    variables: { first },
  };
};

// Fetch a single auction by nounId. Used on-demand when the user navigates
// to a noun that falls outside the initial latestAuctionsQuery(1000) window
// (i.e. old nouns #0 – #~870 once the DAO gets past noun ~1870). The bulk
// query caps at the most recent 1000 auctions to keep the initial page
// payload small; this fills in the rest lazily.
export const singleAuctionQuery = (nounId: string) => ({
  query: gql`
    query GetSingleAuction($nounId: BigInt!) {
      auctions(where: { nounId: $nounId }, limit: 1) {
        items {
          nounId
          amount
          settled
          winner
          burned
          startTime
          endTime
          clientId
          noun {
            id
            owner
          }
          bids(limit: 100, orderBy: "value", orderDirection: "desc") {
            items {
              value
              bidder
              clientId
              createdAtBlock
              createdAt
              createdAtTransaction
            }
          }
        }
      }
    }
  `,
  variables: { nounId },
});

export const latestBidsQuery = (first = 10) => ({
  query: gql`
    query GetLatestBids($first: Int!) {
      bids(limit: $first, orderBy: "createdAt", orderDirection: "desc") {
        items {
          nounId
          bidder
          value
          createdAt
          createdAtBlock
          createdAtTransaction
          auction {
            nounId
            startTime
            endTime
            settled
          }
        }
      }
    }
  `,
  variables: { first },
});

// Voting history for a specific noun — not directly queryable via Ponder
export const nounVotingHistoryQuery = (_nounId: number, _first = 1_000) => {
  void _nounId;
  void _first;
  return {
    query: gql`
      query GetNounVotingHistory {
        __typename
      }
    `,
    variables: {},
  };
};

// Transfer/delegation events not indexed by Ponder
export const nounTransferHistoryQuery = (_nounId: number, _first = 1_000) => {
  void _nounId;
  void _first;
  return {
    query: gql`
      query GetNounTransferHistory {
        __typename
      }
    `,
    variables: {},
  };
};

export const nounDelegationHistoryQuery = (_nounId: number, _first = 1_000) => {
  void _nounId;
  void _first;
  return {
    query: gql`
      query GetNounDelegationHistory {
        __typename
      }
    `,
    variables: {},
  };
};

export const createTimestampAllProposals = () => ({
  query: gql`
    query GetCreateTimestampAllProposals {
      proposals(orderBy: "createdAt", orderDirection: "asc", limit: 1000) {
        items {
          id
          createdAt
        }
      }
    }
  `,
  variables: {},
});

export const proposalVotesQuery = (proposalId: string) => ({
  query: gql`
    query GetProposalVotes($proposalId: BigInt!) {
      votes(where: { proposalId: $proposalId, votes_gt: 0 }, limit: 1000) {
        items {
          support
          votes
          voter
          reason
          clientId
          createdAtBlock
          createdAtTransaction
        }
      }
    }
  `,
  variables: { proposalId: String(proposalId) },
});

// Block-scoped queries not supported by Ponder — return current state
export const delegateNounsAtBlockQuery = (delegates: string[], _block: bigint) => {
  void _block;
  return {
    query: gql`
      query GetDelegateNounsAtBlock($delegates: [String!]!) {
        delegates(where: { id_in: $delegates }, limit: 1000) {
          items {
            id
            delegatedVotes
          }
        }
      }
    `,
    variables: { delegates },
  };
};

export const currentlyDelegatedNouns = (delegate: string) => ({
  query: gql`
    query GetCurrentlyDelegatedNouns($delegate: String!) {
      delegates(where: { id: $delegate }) {
        items {
          id
          delegatedVotes
        }
      }
    }
  `,
  variables: { delegate },
});

// adjustedTotalSupply not in Ponder — stub
export const adjustedNounSupplyAtPropSnapshot = (_proposalId: string) => {
  void _proposalId;
  return {
    query: gql`
      query GetAdjustedNounSupplyAtPropSnapshot {
        __typename
      }
    `,
    variables: {},
  };
};

// quorumCoefficient not in Ponder — stub
export const propUsingDynamicQuorum = (_proposalId: string) => {
  void _proposalId;
  return {
    query: gql`
      query GetPropUsingDynamicQuorum {
        __typename
      }
    `,
    variables: {},
  };
};

export const proposalFeedbacksQuery = (proposalId: string) => ({
  query: gql`
    query GetProposalFeedbacks($proposalId: BigInt!) {
      proposalFeedbacks(
        where: { proposalId: $proposalId }
        limit: 1000
        orderBy: "createdAtBlock"
        orderDirection: "desc"
      ) {
        items {
          voter
          proposalId
          support
          reason
          createdAt
          createdAtBlock
        }
      }
    }
  `,
  variables: { proposalId: String(proposalId) },
});

export const candidateFeedbacksQuery = (candidateId: string) => ({
  query: gql`
    query GetCandidateFeedbacks($candidateId: String!) {
      candidateFeedbacks(
        where: { candidateId: $candidateId }
        limit: 1000
        orderBy: "createdAtBlock"
        orderDirection: "desc"
      ) {
        items {
          voter
          candidateId
          support
          reason
          createdAt
          createdAtBlock
        }
      }
    }
  `,
  variables: { candidateId },
});

export const ownedNounsQuery = (owner: string) => ({
  query: gql`
    query GetOwnedNouns($owner: String!) {
      nouns(where: { owner: $owner }, limit: 1000) {
        items {
          id
        }
      }
    }
  `,
  variables: { owner: owner.toLowerCase() },
});

// Fork/escrow not indexed by Ponder — stub
export const accountEscrowedNounsQuery = (_owner: string) => {
  void _owner;
  return {
    query: gql`
      query GetAccountEscrowedNouns {
        __typename
      }
    `,
    variables: {},
  };
};

export const escrowDepositEventsQuery = (_forkId: string) => {
  void _forkId;
  return {
    query: gql`
      query GetEscrowDepositEvents {
        __typename
      }
    `,
    variables: {},
  };
};

export const forkJoinsQuery = (_forkId: string) => {
  void _forkId;
  return {
    query: gql`
      query GetForkJoins {
        __typename
      }
    `,
    variables: {},
  };
};

export const escrowWithdrawEventsQuery = (_forkId: string) => {
  void _forkId;
  return {
    query: gql`
      query GetEscrowWithdrawEvents {
        __typename
      }
    `,
    variables: {},
  };
};

export const proposalTitlesQuery = (ids: number[]) => ({
  query: gql`
    query GetProposalTitles($ids: [BigInt!]!) {
      proposals(where: { id_in: $ids }, limit: 1000) {
        items {
          id
          description
        }
      }
    }
  `,
  variables: { ids: ids.map(String) },
});

// Fork details not indexed by Ponder — stub
export const forkDetailsQuery = (_id: string) => {
  void _id;
  return {
    query: gql`
      query GetForkDetails {
        __typename
      }
    `,
    variables: {},
  };
};

export const forksQuery = () => ({
  query: gql`
    query GetForks {
      __typename
    }
  `,
  variables: {},
});

export const isForkActiveQuery = (_currentTimestamp: number) => {
  void _currentTimestamp;
  return {
    query: gql`
      query GetIsForkActive {
        __typename
      }
    `,
    variables: {},
  };
};
