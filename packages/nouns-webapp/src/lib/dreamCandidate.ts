import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  stringToBytes,
  type Hex,
} from 'viem';

import { nounsGovernorAddress } from '@/contracts/nouns-governor.gen';
import { defaultChain } from '@/wagmi';
import { type ProposalCandidate } from '@/wrappers/nounsData';

/**
 * Compute the encodedProp hash for addSignature.
 * Extracted from Candidate/index.tsx for reuse.
 */
export function calcProposalEncodeData({
  proposer,
  targets,
  values,
  signatures,
  calldatas,
  description,
  proposalIdToUpdate,
}: {
  proposer: Hex;
  targets: Hex[];
  values: bigint[];
  signatures: string[];
  calldatas: Hex[];
  description: string;
  proposalIdToUpdate?: number;
}): Hex {
  const signatureHashes = signatures.map(sig => keccak256(stringToBytes(sig)));
  const calldatasHashes = calldatas.map(cd => keccak256(cd));

  const params: [string, unknown][] = [];

  if (proposalIdToUpdate != null && proposalIdToUpdate > 0) {
    params.push(['uint256', BigInt(proposalIdToUpdate)]);
  }

  params.push(
    ['address', proposer],
    ['bytes32', keccak256(encodePacked(['address[]'], [targets]))],
    ['bytes32', keccak256(encodePacked(['uint256[]'], [values]))],
    ['bytes32', keccak256(encodePacked(['bytes32[]'], [signatureHashes as Hex[]]))],
    ['bytes32', keccak256(encodePacked(['bytes32[]'], [calldatasHashes as Hex[]]))],
    ['bytes32', keccak256(stringToBytes(description))],
  );

  return encodeAbiParameters(
    params.map(([type]) => ({ type: type as string })),
    params.map(p => p[1]),
  );
}

/**
 * Build EIP-712 typed data for sponsoring a candidate.
 */
export function buildSponsorTypedData(
  candidate: ProposalCandidate,
  expirationTimestamp: number,
) {
  const chainId = defaultChain.id;
  const version = candidate.version.content;

  const encodedProp = calcProposalEncodeData({
    proposer: candidate.proposer,
    targets: version.targets,
    values: version.values,
    signatures: version.signatures,
    calldatas: version.calldatas,
    description: version.description,
    proposalIdToUpdate: candidate.proposalIdToUpdate,
  });

  const proposalEncodeHash = keccak256(encodedProp);

  return {
    domain: {
      name: 'Nouns DAO',
      chainId,
      verifyingContract: nounsGovernorAddress[chainId as keyof typeof nounsGovernorAddress],
    },
    types: {
      SignProposal: [
        { name: 'proposer', type: 'address' },
        { name: 'slug', type: 'string' },
        { name: 'proposalEncodeHash', type: 'bytes32' },
        { name: 'expirationTimestamp', type: 'uint256' },
      ],
    },
    primaryType: 'SignProposal' as const,
    message: {
      proposer: candidate.proposer,
      slug: candidate.slug,
      proposalEncodeHash,
      expirationTimestamp: BigInt(expirationTimestamp),
    },
    // For addSignature call
    encodedProp,
  };
}
