"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProposalCreatedData = exports.ProposalCreatedWithRequirementsEvent = void 0;
exports.createProposalCreatedWithRequirementsEventV3 = createProposalCreatedWithRequirementsEventV3;
exports.createProposalCreatedWithRequirementsEventV1 = createProposalCreatedWithRequirementsEventV1;
exports.stubProposalCreatedWithRequirementsEventInput = stubProposalCreatedWithRequirementsEventInput;
exports.createVoteCastEvent = createVoteCastEvent;
exports.createMinQuorumVotesBPSSetEvent = createMinQuorumVotesBPSSetEvent;
exports.createMaxQuorumVotesBPSSetEvent = createMaxQuorumVotesBPSSetEvent;
exports.createQuorumCoefficientSetEvent = createQuorumCoefficientSetEvent;
exports.handleAllQuorumParamEvents = handleAllQuorumParamEvents;
exports.createProposalObjectionPeriodSetEvent = createProposalObjectionPeriodSetEvent;
exports.createProposalUpdatedEvent = createProposalUpdatedEvent;
exports.createProposalCandidateCreatedEvent = createProposalCandidateCreatedEvent;
exports.createSignatureAddedEvent = createSignatureAddedEvent;
exports.createProposalDescriptionUpdatedEvent = createProposalDescriptionUpdatedEvent;
exports.createProposalTransactionsUpdatedEvent = createProposalTransactionsUpdatedEvent;
exports.createEscrowedToForkEvent = createEscrowedToForkEvent;
exports.createWithdrawFromForkEscrowEvent = createWithdrawFromForkEscrowEvent;
exports.createProposalCanceledEvent = createProposalCanceledEvent;
exports.createProposalVetoedEvent = createProposalVetoedEvent;
exports.createProposalExecutedEvent = createProposalExecutedEvent;
exports.createProposalQueuedEvent = createProposalQueuedEvent;
exports.createTransferEvent = createTransferEvent;
exports.createDelegateChangedEvent = createDelegateChangedEvent;
exports.createDelegateVotesChangedEvent = createDelegateVotesChangedEvent;
exports.createProposalCreatedEvent = createProposalCreatedEvent;
const graph_ts_1 = require("@graphprotocol/graph-ts");
const index_1 = require("matchstick-as/assembly/index");
const nouns_dao_1 = require("../src/nouns-dao");
const constants_1 = require("../src/utils/constants");
function createProposalCreatedWithRequirementsEventV3(input) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('id', graph_ts_1.ethereum.Value.fromUnsignedBigInt(input.id)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('proposer', graph_ts_1.ethereum.Value.fromAddress(input.proposer)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('signers', graph_ts_1.ethereum.Value.fromAddressArray(input.signers)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('targets', graph_ts_1.ethereum.Value.fromAddressArray(input.targets)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('values', graph_ts_1.ethereum.Value.fromUnsignedBigIntArray(input.values)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('signatures', graph_ts_1.ethereum.Value.fromStringArray(input.signatures)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('calldatas', graph_ts_1.ethereum.Value.fromBytesArray(input.calldatas)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('startBlock', graph_ts_1.ethereum.Value.fromUnsignedBigInt(input.startBlock)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('endBlock', graph_ts_1.ethereum.Value.fromUnsignedBigInt(input.endBlock)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('updatePeriodEndBlock', graph_ts_1.ethereum.Value.fromUnsignedBigInt(input.updatePeriodEndBlock)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('proposalThreshold', graph_ts_1.ethereum.Value.fromUnsignedBigInt(input.proposalThreshold)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('quorumVotes', graph_ts_1.ethereum.Value.fromUnsignedBigInt(input.quorumVotes)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('description', graph_ts_1.ethereum.Value.fromString(input.description)));
    newEvent.block.number = input.eventBlockNumber;
    return newEvent;
}
class ProposalCreatedWithRequirementsEvent {
}
exports.ProposalCreatedWithRequirementsEvent = ProposalCreatedWithRequirementsEvent;
function createProposalCreatedWithRequirementsEventV1(input) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('id', graph_ts_1.ethereum.Value.fromUnsignedBigInt(input.id)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('proposer', graph_ts_1.ethereum.Value.fromAddress(input.proposer)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('targets', graph_ts_1.ethereum.Value.fromAddressArray(input.targets)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('values', graph_ts_1.ethereum.Value.fromUnsignedBigIntArray(input.values)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('signatures', graph_ts_1.ethereum.Value.fromStringArray(input.signatures)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('calldatas', graph_ts_1.ethereum.Value.fromBytesArray(input.calldatas)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('startBlock', graph_ts_1.ethereum.Value.fromUnsignedBigInt(input.startBlock)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('endBlock', graph_ts_1.ethereum.Value.fromUnsignedBigInt(input.endBlock)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('proposalThreshold', graph_ts_1.ethereum.Value.fromUnsignedBigInt(input.proposalThreshold)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('quorumVotes', graph_ts_1.ethereum.Value.fromUnsignedBigInt(input.quorumVotes)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('description', graph_ts_1.ethereum.Value.fromString(input.description)));
    newEvent.block.number = input.eventBlockNumber;
    return newEvent;
}
function stubProposalCreatedWithRequirementsEventInput(eventBlockNumber = constants_1.BIGINT_ZERO, signers = []) {
    return {
        id: graph_ts_1.BigInt.fromI32(1),
        proposer: graph_ts_1.Address.fromString('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'),
        signers: signers,
        targets: [graph_ts_1.Address.fromString('0x000000000000000000000000000000000000dEaD')],
        values: [graph_ts_1.BigInt.fromI32(0)],
        signatures: ['some signature'],
        calldatas: [changetype(graph_ts_1.ByteArray.fromBigInt(constants_1.BIGINT_ONE))],
        startBlock: graph_ts_1.BigInt.fromI32(203),
        endBlock: graph_ts_1.BigInt.fromI32(303),
        updatePeriodEndBlock: graph_ts_1.BigInt.fromI32(103),
        proposalThreshold: constants_1.BIGINT_ONE,
        quorumVotes: constants_1.BIGINT_ONE,
        description: 'some description',
        eventBlockNumber: eventBlockNumber,
    };
}
function createVoteCastEvent(voter, proposalId, support, votes) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('voter', graph_ts_1.ethereum.Value.fromAddress(voter)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('proposalId', graph_ts_1.ethereum.Value.fromUnsignedBigInt(proposalId)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('support', graph_ts_1.ethereum.Value.fromI32(support)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('votes', graph_ts_1.ethereum.Value.fromUnsignedBigInt(votes)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('reason', graph_ts_1.ethereum.Value.fromString('some reason')));
    return newEvent;
}
function createMinQuorumVotesBPSSetEvent(oldMinQuorumVotesBPS, newMinQuorumVotesBPS) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.block.number = constants_1.BIGINT_ZERO;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('oldMinQuorumVotesBPS', graph_ts_1.ethereum.Value.fromI32(oldMinQuorumVotesBPS)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('newMinQuorumVotesBPS', graph_ts_1.ethereum.Value.fromI32(newMinQuorumVotesBPS)));
    return newEvent;
}
function createMaxQuorumVotesBPSSetEvent(oldMaxQuorumVotesBPS, newMaxQuorumVotesBPS) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.block.number = constants_1.BIGINT_ZERO;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('oldMaxQuorumVotesBPS', graph_ts_1.ethereum.Value.fromI32(oldMaxQuorumVotesBPS)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('newMaxQuorumVotesBPS', graph_ts_1.ethereum.Value.fromI32(newMaxQuorumVotesBPS)));
    return newEvent;
}
function createQuorumCoefficientSetEvent(oldQuorumCoefficient, newQuorumCoefficient) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.block.number = constants_1.BIGINT_ZERO;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('oldQuorumCoefficient', graph_ts_1.ethereum.Value.fromUnsignedBigInt(oldQuorumCoefficient)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('newQuorumCoefficient', graph_ts_1.ethereum.Value.fromUnsignedBigInt(newQuorumCoefficient)));
    return newEvent;
}
function handleAllQuorumParamEvents(newMinQuorumVotesBPS, newMaxQuorumVotesBPS, newCoefficient) {
    (0, nouns_dao_1.handleMinQuorumVotesBPSSet)(createMinQuorumVotesBPSSetEvent(0, newMinQuorumVotesBPS));
    (0, nouns_dao_1.handleMaxQuorumVotesBPSSet)(createMaxQuorumVotesBPSSetEvent(0, newMaxQuorumVotesBPS));
    (0, nouns_dao_1.handleQuorumCoefficientSet)(createQuorumCoefficientSetEvent(constants_1.BIGINT_ZERO, newCoefficient));
}
function createProposalObjectionPeriodSetEvent(proposalId, objectionPeriodEndBlock) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('id', graph_ts_1.ethereum.Value.fromUnsignedBigInt(proposalId)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('objectionPeriodEndBlock', graph_ts_1.ethereum.Value.fromUnsignedBigInt(objectionPeriodEndBlock)));
    return newEvent;
}
function createProposalUpdatedEvent(txHash, logIndex, blockTimestamp, blockNumber, proposalId, proposer, targets, values, signatures, calldatas, description, updateMessage) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.transaction.hash = txHash;
    newEvent.logIndex = logIndex;
    newEvent.block.timestamp = blockTimestamp;
    newEvent.block.number = blockNumber;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('id', graph_ts_1.ethereum.Value.fromUnsignedBigInt(proposalId)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('proposer', graph_ts_1.ethereum.Value.fromAddress(proposer)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('targets', graph_ts_1.ethereum.Value.fromAddressArray(targets)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('values', graph_ts_1.ethereum.Value.fromUnsignedBigIntArray(values)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('signatures', graph_ts_1.ethereum.Value.fromStringArray(signatures)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('calldatas', graph_ts_1.ethereum.Value.fromBytesArray(calldatas)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('description', graph_ts_1.ethereum.Value.fromString(description)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('updateMessage', graph_ts_1.ethereum.Value.fromString(updateMessage)));
    return newEvent;
}
function createProposalCandidateCreatedEvent(txHash, logIndex, blockTimestamp, blockNumber, sender, targets, values, signatures, calldatas, description, slug, encodedProposalHash) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.transaction.hash = txHash;
    newEvent.logIndex = logIndex;
    newEvent.block.timestamp = blockTimestamp;
    newEvent.block.number = blockNumber;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('msgSender', graph_ts_1.ethereum.Value.fromAddress(sender)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('targets', graph_ts_1.ethereum.Value.fromAddressArray(targets)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('values', graph_ts_1.ethereum.Value.fromUnsignedBigIntArray(values)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('signatures', graph_ts_1.ethereum.Value.fromStringArray(signatures)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('calldatas', graph_ts_1.ethereum.Value.fromBytesArray(calldatas)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('description', graph_ts_1.ethereum.Value.fromString(description)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('slug', graph_ts_1.ethereum.Value.fromString(slug)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('proposalIdToUpdate', graph_ts_1.ethereum.Value.fromUnsignedBigInt(constants_1.BIGINT_ZERO)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('encodedProposalHash', graph_ts_1.ethereum.Value.fromBytes(encodedProposalHash)));
    return newEvent;
}
function createSignatureAddedEvent(signer, sig, expirationTimestamp, proposer, slug, encodedPropHash, sigDigest, reason, blockNumber, blockTimestamp) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.block.timestamp = blockTimestamp;
    newEvent.block.number = blockNumber;
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('signer', graph_ts_1.ethereum.Value.fromAddress(signer)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('sig', graph_ts_1.ethereum.Value.fromBytes(sig)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('expirationTimestamp', graph_ts_1.ethereum.Value.fromUnsignedBigInt(expirationTimestamp)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('proposer', graph_ts_1.ethereum.Value.fromAddress(proposer)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('slug', graph_ts_1.ethereum.Value.fromString(slug)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('proposalIdToUpdate', graph_ts_1.ethereum.Value.fromUnsignedBigInt(constants_1.BIGINT_ZERO)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('encodedPropHash', graph_ts_1.ethereum.Value.fromBytes(encodedPropHash)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('sigDigest', graph_ts_1.ethereum.Value.fromBytes(sigDigest)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('reason', graph_ts_1.ethereum.Value.fromString(reason)));
    return newEvent;
}
function createProposalDescriptionUpdatedEvent(txHash, logIndex, blockTimestamp, blockNumber, proposalId, proposer, description, updateMessage) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.transaction.hash = txHash;
    newEvent.logIndex = logIndex;
    newEvent.block.timestamp = blockTimestamp;
    newEvent.block.number = blockNumber;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('id', graph_ts_1.ethereum.Value.fromUnsignedBigInt(proposalId)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('proposer', graph_ts_1.ethereum.Value.fromAddress(proposer)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('description', graph_ts_1.ethereum.Value.fromString(description)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('updateMessage', graph_ts_1.ethereum.Value.fromString(updateMessage)));
    return newEvent;
}
function createProposalTransactionsUpdatedEvent(txHash, logIndex, blockTimestamp, blockNumber, proposalId, proposer, targets, values, signatures, calldatas, updateMessage) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.transaction.hash = txHash;
    newEvent.logIndex = logIndex;
    newEvent.block.timestamp = blockTimestamp;
    newEvent.block.number = blockNumber;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('id', graph_ts_1.ethereum.Value.fromUnsignedBigInt(proposalId)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('proposer', graph_ts_1.ethereum.Value.fromAddress(proposer)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('targets', graph_ts_1.ethereum.Value.fromAddressArray(targets)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('values', graph_ts_1.ethereum.Value.fromUnsignedBigIntArray(values)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('signatures', graph_ts_1.ethereum.Value.fromStringArray(signatures)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('calldatas', graph_ts_1.ethereum.Value.fromBytesArray(calldatas)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('updateMessage', graph_ts_1.ethereum.Value.fromString(updateMessage)));
    return newEvent;
}
function createEscrowedToForkEvent(txHash, logIndex, blockTimestamp, owner, tokenIds, proposalIds, reason, forkId) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.transaction.hash = txHash;
    newEvent.logIndex = logIndex;
    newEvent.block.timestamp = blockTimestamp;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('forkId', graph_ts_1.ethereum.Value.fromUnsignedBigInt(forkId)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('owner', graph_ts_1.ethereum.Value.fromAddress(owner)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('tokenIds', graph_ts_1.ethereum.Value.fromUnsignedBigIntArray(tokenIds)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('proposalIds', graph_ts_1.ethereum.Value.fromUnsignedBigIntArray(proposalIds)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('reason', graph_ts_1.ethereum.Value.fromString(reason)));
    return newEvent;
}
function createWithdrawFromForkEscrowEvent(txHash, logIndex, blockTimestamp, owner, tokenIds, forkId) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.transaction.hash = txHash;
    newEvent.logIndex = logIndex;
    newEvent.block.timestamp = blockTimestamp;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('forkId', graph_ts_1.ethereum.Value.fromUnsignedBigInt(forkId)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('owner', graph_ts_1.ethereum.Value.fromAddress(owner)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('tokenIds', graph_ts_1.ethereum.Value.fromUnsignedBigIntArray(tokenIds)));
    return newEvent;
}
function createProposalCanceledEvent(txHash, logIndex, blockTimestamp, blockNumber, proposalId) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.transaction.hash = txHash;
    newEvent.logIndex = logIndex;
    newEvent.block.timestamp = blockTimestamp;
    newEvent.block.number = blockNumber;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('id', graph_ts_1.ethereum.Value.fromUnsignedBigInt(proposalId)));
    return newEvent;
}
function createProposalVetoedEvent(txHash, logIndex, blockTimestamp, blockNumber, proposalId) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.transaction.hash = txHash;
    newEvent.logIndex = logIndex;
    newEvent.block.timestamp = blockTimestamp;
    newEvent.block.number = blockNumber;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('id', graph_ts_1.ethereum.Value.fromUnsignedBigInt(proposalId)));
    return newEvent;
}
function createProposalExecutedEvent(txHash, logIndex, blockTimestamp, blockNumber, proposalId) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.transaction.hash = txHash;
    newEvent.logIndex = logIndex;
    newEvent.block.timestamp = blockTimestamp;
    newEvent.block.number = blockNumber;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('id', graph_ts_1.ethereum.Value.fromUnsignedBigInt(proposalId)));
    return newEvent;
}
function createProposalQueuedEvent(txHash, logIndex, blockTimestamp, blockNumber, proposalId, eta) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.transaction.hash = txHash;
    newEvent.logIndex = logIndex;
    newEvent.block.timestamp = blockTimestamp;
    newEvent.block.number = blockNumber;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('id', graph_ts_1.ethereum.Value.fromUnsignedBigInt(proposalId)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('eta', graph_ts_1.ethereum.Value.fromUnsignedBigInt(eta)));
    return newEvent;
}
function createTransferEvent(txHash, logIndex, blockTimestamp, blockNumber, from, to, tokenId) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.transaction.hash = txHash;
    newEvent.logIndex = logIndex;
    newEvent.block.timestamp = blockTimestamp;
    newEvent.block.number = blockNumber;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('from', graph_ts_1.ethereum.Value.fromAddress(from)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('to', graph_ts_1.ethereum.Value.fromAddress(to)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('tokenId', graph_ts_1.ethereum.Value.fromUnsignedBigInt(tokenId)));
    return newEvent;
}
function createDelegateChangedEvent(txHash, logIndex, blockTimestamp, blockNumber, delegator, previousDelegate, newDelegate) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.transaction.hash = txHash;
    newEvent.logIndex = logIndex;
    newEvent.block.timestamp = blockTimestamp;
    newEvent.block.number = blockNumber;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('delegator', graph_ts_1.ethereum.Value.fromAddress(delegator)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('previousDelegate', graph_ts_1.ethereum.Value.fromAddress(previousDelegate)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('newDelegate', graph_ts_1.ethereum.Value.fromAddress(newDelegate)));
    return newEvent;
}
function createDelegateVotesChangedEvent(txHash, logIndex, blockTimestamp, blockNumber, delegate, previousBalance, newBalance) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.transaction.hash = txHash;
    newEvent.logIndex = logIndex;
    newEvent.block.timestamp = blockTimestamp;
    newEvent.block.number = blockNumber;
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('delegate', graph_ts_1.ethereum.Value.fromAddress(delegate)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('previousBalance', graph_ts_1.ethereum.Value.fromUnsignedBigInt(previousBalance)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('newBalance', graph_ts_1.ethereum.Value.fromUnsignedBigInt(newBalance)));
    return newEvent;
}
class ProposalCreatedData {
    constructor() {
        this.id = constants_1.BIGINT_ZERO;
        this.proposer = graph_ts_1.Address.fromString(constants_1.ZERO_ADDRESS);
        this.signers = [];
        this.targets = [];
        this.values = [];
        this.signatures = [];
        this.calldatas = [];
        this.startBlock = constants_1.BIGINT_ZERO;
        this.endBlock = constants_1.BIGINT_ZERO;
        this.description = '';
        this.eventBlockNumber = constants_1.BIGINT_ZERO;
        this.eventBlockTimestamp = constants_1.BIGINT_ZERO;
        this.txHash = graph_ts_1.Bytes.fromI32(0);
        this.logIndex = constants_1.BIGINT_ZERO;
        this.address = graph_ts_1.Address.fromString(constants_1.ZERO_ADDRESS);
    }
}
exports.ProposalCreatedData = ProposalCreatedData;
function createProposalCreatedEvent(input) {
    const newEvent = changetype((0, index_1.newMockEvent)());
    newEvent.parameters = [];
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('id', graph_ts_1.ethereum.Value.fromUnsignedBigInt(input.id)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('proposer', graph_ts_1.ethereum.Value.fromAddress(input.proposer)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('targets', graph_ts_1.ethereum.Value.fromAddressArray(input.targets)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('values', graph_ts_1.ethereum.Value.fromUnsignedBigIntArray(input.values)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('signatures', graph_ts_1.ethereum.Value.fromStringArray(input.signatures)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('calldatas', graph_ts_1.ethereum.Value.fromBytesArray(input.calldatas)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('startBlock', graph_ts_1.ethereum.Value.fromUnsignedBigInt(input.startBlock)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('endBlock', graph_ts_1.ethereum.Value.fromUnsignedBigInt(input.endBlock)));
    newEvent.parameters.push(new graph_ts_1.ethereum.EventParam('description', graph_ts_1.ethereum.Value.fromString(input.description)));
    newEvent.block.number = input.eventBlockNumber;
    newEvent.block.timestamp = input.eventBlockTimestamp;
    newEvent.transaction.hash = input.txHash;
    newEvent.logIndex = input.logIndex;
    newEvent.address = input.address;
    return newEvent;
}
