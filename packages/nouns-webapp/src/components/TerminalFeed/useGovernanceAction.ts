import type { GovernanceAction } from './GovernanceActionConfirm';

import { useCallback, useState } from 'react';

import {
  keccak256,
  encodePacked,
  encodeAbiParameters,
  parseEther,
  stringToBytes,
  type Address,
  type Hex,
} from 'viem';
import { useWriteContract, useSignTypedData } from 'wagmi';

import { NOUN_WTF_CLIENT_ID } from '@/config';
import {
  nounsGovernorAbi,
  nounsGovernorAddress,
  nounsDataAbi,
  nounsDataAddress,
  nounsAuctionHouseAbi,
  nounsAuctionHouseAddress,
} from '@/contracts';
import {
  smallGrantsTreasuryAbi,
  SMALL_GRANTS_TREASURY_ADDRESS,
} from '@/contracts/small-grants-treasury';
import { LIL_NOUNS_GOVERNOR, LIL_NOUNS_GOVERNOR_ABI } from '@/lib/marketplace/governance';

// ─── Compute encodedProp for addSignature (mirrors CandidatePage logic) ───

function calcProposalEncodeData({
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

// ─── Hook ─────────────────────────────────────────────────────────────────

export function useGovernanceAction() {
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (action: GovernanceAction): Promise<string | null> => {
      setIsPending(true);
      setError(null);

      try {
        let hash: string | null = null;

        switch (action.type) {
          case 'VOTE': {
            if (action.proposalId === undefined || action.support === undefined) {
              throw new Error('Missing proposalId or support');
            }
            const isLilNouns =
              action.dao === 'lil-nouns' ||
              action.dao === 'lilnouns' ||
              action.dao === 'lil';
            if (isLilNouns) {
              // Lil Nouns governor doesn't support gas-refund variants and has
              // no client-id arg — use plain castVote / castVoteWithReason
              // (mirrors LilNounsVotePage). See:
              // packages/nouns-webapp/src/pages/Vote/LilNounsVotePage.tsx
              if (action.reason) {
                hash = await writeContractAsync({
                  abi: LIL_NOUNS_GOVERNOR_ABI,
                  address: LIL_NOUNS_GOVERNOR,
                  functionName: 'castVoteWithReason',
                  args: [BigInt(action.proposalId), action.support, action.reason],
                });
              } else {
                hash = await writeContractAsync({
                  abi: LIL_NOUNS_GOVERNOR_ABI,
                  address: LIL_NOUNS_GOVERNOR,
                  functionName: 'castVote',
                  args: [BigInt(action.proposalId), action.support],
                });
              }
            } else if (action.reason) {
              hash = await writeContractAsync({
                abi: nounsGovernorAbi,
                address: nounsGovernorAddress[1] as Address,
                functionName: 'castRefundableVoteWithReason',
                args: [
                  BigInt(action.proposalId),
                  action.support,
                  action.reason,
                  NOUN_WTF_CLIENT_ID,
                ],
              });
            } else {
              hash = await writeContractAsync({
                abi: nounsGovernorAbi,
                address: nounsGovernorAddress[1] as Address,
                functionName: 'castRefundableVote',
                args: [BigInt(action.proposalId), action.support, NOUN_WTF_CLIENT_ID],
              });
            }
            break;
          }

          case 'PROPOSAL_FEEDBACK': {
            if (action.proposalId === undefined || action.support === undefined) {
              throw new Error('Missing proposalId or support');
            }
            hash = await writeContractAsync({
              abi: nounsDataAbi,
              address: nounsDataAddress[1] as Address,
              functionName: 'sendFeedback',
              args: [BigInt(action.proposalId), action.support, action.reason || ''],
            });
            break;
          }

          case 'CANDIDATE_FEEDBACK': {
            if (!action.proposer || !action.slug || action.support === undefined) {
              throw new Error('Missing proposer, slug, or support');
            }
            hash = await writeContractAsync({
              abi: nounsDataAbi,
              address: nounsDataAddress[1] as Address,
              functionName: 'sendCandidateFeedback',
              args: [action.proposer as Address, action.slug, action.support, action.reason || ''],
            });
            break;
          }

          case 'CREATE_CANDIDATE': {
            if (!action.slug || !action.description) {
              throw new Error('Missing slug or description');
            }
            const ccTargets = (action.targets || []).map(t => t as Address);
            const ccValues = (action.values || []).map(v => BigInt(v));
            const ccSigs = action.signatures || [];
            const ccCalldatas = (action.calldatas || []).map(c => c as Hex);
            hash = await writeContractAsync({
              abi: nounsDataAbi,
              address: nounsDataAddress[1] as Address,
              functionName: 'createProposalCandidate',
              args: [
                ccTargets,
                ccValues,
                ccSigs,
                ccCalldatas,
                action.description,
                action.slug,
                0n, // proposalIdToUpdate (0 = new candidate)
              ],
            });
            break;
          }

          case 'UPDATE_CANDIDATE': {
            if (!action.slug || !action.description) {
              throw new Error('Missing slug or description');
            }
            const ucTargets = (action.targets || []).map(t => t as Address);
            const ucValues = (action.values || []).map(v => BigInt(v));
            const ucSigs = action.signatures || [];
            const ucCalldatas = (action.calldatas || []).map(c => c as Hex);
            hash = await writeContractAsync({
              abi: nounsDataAbi,
              address: nounsDataAddress[1] as Address,
              functionName: 'updateProposalCandidate',
              args: [
                ucTargets,
                ucValues,
                ucSigs,
                ucCalldatas,
                action.description,
                action.slug,
                0n, // proposalIdToUpdate (0 = standalone candidate)
                action.reason || '',
              ],
            });
            break;
          }

          case 'UPDATE_PROPOSAL': {
            if (action.proposalId === undefined || !action.description || !action.updateMessage) {
              throw new Error('Missing proposalId, description, or updateMessage');
            }
            const upTargets = (action.targets || []).map(t => t as Address);
            const upValues = (action.values || []).map(v => BigInt(v));
            const upSigs = action.signatures || [];
            const upCalldatas = (action.calldatas || []).map(c => c as Hex);
            hash = await writeContractAsync({
              abi: nounsGovernorAbi,
              address: nounsGovernorAddress[1] as Address,
              functionName: 'updateProposal',
              args: [
                BigInt(action.proposalId),
                upTargets,
                upValues,
                upSigs,
                upCalldatas,
                action.description,
                action.updateMessage,
              ],
            });
            break;
          }

          case 'UPDATE_PROPOSAL_DESCRIPTION': {
            if (action.proposalId === undefined || !action.description || !action.updateMessage) {
              throw new Error('Missing proposalId, description, or updateMessage');
            }
            hash = await writeContractAsync({
              abi: nounsGovernorAbi,
              address: nounsGovernorAddress[1] as Address,
              functionName: 'updateProposalDescription',
              args: [BigInt(action.proposalId), action.description, action.updateMessage],
            });
            break;
          }

          case 'UPDATE_PROPOSAL_TRANSACTIONS': {
            if (action.proposalId === undefined || !action.updateMessage) {
              throw new Error('Missing proposalId or updateMessage');
            }
            const uptTargets = (action.targets || []).map(t => t as Address);
            const uptValues = (action.values || []).map(v => BigInt(v));
            const uptSigs = action.signatures || [];
            const uptCalldatas = (action.calldatas || []).map(c => c as Hex);
            hash = await writeContractAsync({
              abi: nounsGovernorAbi,
              address: nounsGovernorAddress[1] as Address,
              functionName: 'updateProposalTransactions',
              args: [
                BigInt(action.proposalId),
                uptTargets,
                uptValues,
                uptSigs,
                uptCalldatas,
                action.updateMessage,
              ],
            });
            break;
          }

          case 'SPONSOR': {
            if (!action.proposer || !action.slug) {
              throw new Error('Missing proposer or slug');
            }

            // Parse the candidate's proposal data from the API
            let propData: {
              targets: string[];
              values: string[];
              signatures: string[];
              calldatas: string[];
              description: string;
            } | null = null;

            try {
              if (action.encodedProp) {
                propData = JSON.parse(action.encodedProp);
              }
            } catch {
              // If we can't parse, use empty defaults
            }

            if (!propData) {
              propData = {
                targets: [],
                values: [],
                signatures: [],
                calldatas: [],
                description: '',
              };
            }

            const proposer = action.proposer as Hex;
            const targets = propData.targets.map(t => t as Hex);
            const values = propData.values.map(v => BigInt(v));
            const sigs = propData.signatures;
            const calldatas = propData.calldatas.map(c => c as Hex);
            const description = propData.description;

            // Set expiration to 30 days from now
            const expirationTimestamp = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);

            // Step 1: EIP-712 typed data signature
            // Uses the same structure as the existing CandidatePage
            const daoAddress = nounsGovernorAddress[1] as Address;

            const proposalTypes = [
              { name: 'proposer', type: 'address' },
              { name: 'targets', type: 'address[]' },
              { name: 'values', type: 'uint256[]' },
              { name: 'signatures', type: 'string[]' },
              { name: 'calldatas', type: 'bytes[]' },
              { name: 'description', type: 'string' },
              { name: 'expiry', type: 'uint256' },
            ] as const;

            const signature = await signTypedDataAsync({
              domain: {
                name: 'Nouns DAO',
                chainId: 1,
                verifyingContract: daoAddress,
              },
              types: {
                Proposal: proposalTypes,
              },
              primaryType: 'Proposal',
              message: {
                proposer,
                targets,
                values,
                signatures: sigs,
                calldatas,
                description,
                expiry: expirationTimestamp,
              },
            });

            // Step 2: Compute encodedProp for the addSignature contract call
            // This is the ABI-encoded proposal data that the contract hashes internally
            // to verify against the EIP-712 signature
            const encodedProp = calcProposalEncodeData({
              proposer,
              targets,
              values,
              signatures: sigs,
              calldatas,
              description,
            });

            // Step 3: Submit the signature onchain via NounsData.addSignature
            hash = await writeContractAsync({
              abi: nounsDataAbi,
              address: nounsDataAddress[1] as Address,
              functionName: 'addSignature',
              args: [
                signature,
                expirationTimestamp,
                proposer,
                action.slug,
                0n, // proposalIdToUpdate
                encodedProp,
                action.reason || '',
              ],
            });
            break;
          }

          case 'BID': {
            if (action.nounId === undefined || !action.bidAmountEth) {
              throw new Error('Missing nounId or bidAmountEth');
            }
            hash = await writeContractAsync({
              abi: nounsAuctionHouseAbi,
              address: nounsAuctionHouseAddress[1] as Address,
              functionName: 'createBid',
              args: [BigInt(action.nounId), NOUN_WTF_CLIENT_ID],
              value: parseEther(action.bidAmountEth),
            });
            break;
          }

          case 'PROMOTE': {
            if (!action.proposer || !action.slug || !action.description) {
              throw new Error('Missing proposer, slug, or description');
            }
            const sponsorSigs = (action.sponsorSignatures || []).map(s => ({
              sig: s.sig as Hex,
              signer: s.signer as Address,
              expirationTimestamp: BigInt(s.expirationTimestamp),
            }));

            if (sponsorSigs.length > 0) {
              // Promote via proposeBySigs (has sponsor signatures)
              hash = await writeContractAsync({
                abi: nounsGovernorAbi,
                address: nounsGovernorAddress[1] as Address,
                functionName: 'proposeBySigs',
                args: [
                  sponsorSigs,
                  (action.targets || []).map(t => t as Address),
                  (action.values || []).map(v => BigInt(v)),
                  action.signatures || [],
                  (action.calldatas || []).map(c => c as Hex),
                  action.description,
                  NOUN_WTF_CLIENT_ID,
                ],
              });
            } else {
              // Direct propose — proposer has enough voting power (no signatures needed)
              hash = await writeContractAsync({
                abi: nounsGovernorAbi,
                address: nounsGovernorAddress[1] as Address,
                functionName: 'propose',
                args: [
                  (action.targets || []).map(t => t as Address),
                  (action.values || []).map(v => BigInt(v)),
                  action.signatures || [],
                  (action.calldatas || []).map(c => c as Hex),
                  action.description,
                  NOUN_WTF_CLIENT_ID,
                ],
              });
            }
            break;
          }

          case 'GRANT_VOTE': {
            if (action.grantId === undefined || action.support === undefined) {
              throw new Error('Missing grantId or support');
            }
            if (action.reason) {
              hash = await writeContractAsync({
                abi: smallGrantsTreasuryAbi,
                address: SMALL_GRANTS_TREASURY_ADDRESS,
                functionName: 'castVoteWithReason',
                args: [BigInt(action.grantId), action.support, action.reason],
              });
            } else {
              hash = await writeContractAsync({
                abi: smallGrantsTreasuryAbi,
                address: SMALL_GRANTS_TREASURY_ADDRESS,
                functionName: 'castVote',
                args: [BigInt(action.grantId), action.support],
              });
            }
            break;
          }

          case 'GRANT_PROPOSAL': {
            if (!action.description) {
              throw new Error('Missing description');
            }
            const gpTargets = (action.targets || []).map(t => t as Address);
            const gpValues = (action.values || []).map(v => BigInt(v));
            const gpSigs = action.signatures || [];
            const gpCalldatas = (action.calldatas || []).map(c => c as Hex);
            hash = await writeContractAsync({
              abi: smallGrantsTreasuryAbi,
              address: SMALL_GRANTS_TREASURY_ADDRESS,
              functionName: 'propose',
              args: [gpTargets, gpValues, gpSigs, gpCalldatas, action.description],
            });
            break;
          }

          case 'QUEUE_PROPOSAL': {
            if (action.proposalId === undefined) {
              throw new Error('Missing proposalId');
            }
            hash = await writeContractAsync({
              abi: nounsGovernorAbi,
              address: nounsGovernorAddress[1] as Address,
              functionName: 'queue',
              args: [BigInt(action.proposalId)],
            });
            break;
          }

          case 'QUEUE_GRANT': {
            if (action.grantId === undefined) {
              throw new Error('Missing grantId');
            }
            hash = await writeContractAsync({
              abi: smallGrantsTreasuryAbi,
              address: SMALL_GRANTS_TREASURY_ADDRESS,
              functionName: 'queue',
              args: [BigInt(action.grantId)],
            });
            break;
          }

          case 'EXECUTE_PROPOSAL': {
            if (action.proposalId === undefined) {
              throw new Error('Missing proposalId');
            }
            hash = await writeContractAsync({
              abi: nounsGovernorAbi,
              address: nounsGovernorAddress[1] as Address,
              functionName: 'execute',
              args: [BigInt(action.proposalId)],
            });
            break;
          }

          case 'EXECUTE_GRANT': {
            if (action.grantId === undefined) {
              throw new Error('Missing grantId');
            }
            hash = await writeContractAsync({
              abi: smallGrantsTreasuryAbi,
              address: SMALL_GRANTS_TREASURY_ADDRESS,
              functionName: 'execute',
              args: [BigInt(action.grantId)],
            });
            break;
          }

          default:
            throw new Error(`Unknown action type: ${action.type}`);
        }

        setIsPending(false);
        return hash;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Transaction failed';
        // Clean up common wagmi/wallet error messages
        const cleanMsg = msg.includes('User rejected')
          ? 'transaction rejected by user'
          : msg.includes('insufficient funds')
            ? 'insufficient funds for gas'
            : msg.length > 200
              ? msg.slice(0, 200) + '...'
              : msg;
        setError(cleanMsg);
        setIsPending(false);
        return null;
      }
    },
    [writeContractAsync, signTypedDataAsync],
  );

  return { execute, isPending, error };
}
