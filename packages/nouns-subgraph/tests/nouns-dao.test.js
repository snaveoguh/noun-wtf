"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const graph_ts_1 = require("@graphprotocol/graph-ts");
const index_1 = require("matchstick-as/assembly/index");
const ParsedProposalV3_1 = require("../src/custom-types/ParsedProposalV3");
const nouns_dao_1 = require("../src/nouns-dao");
const schema_1 = require("../src/types/schema");
const constants_1 = require("../src/utils/constants");
const helpers_1 = require("../src/utils/helpers");
const utils_1 = require("./utils");
const SOME_ADDRESS = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const proposerWithDelegate = graph_ts_1.Address.fromString('0x0000000000000000000000000000000000000001');
const signerWithDelegate = graph_ts_1.Address.fromString('0x0000000000000000000000000000000000000003');
const signerWithNoDelegate = graph_ts_1.Address.fromString('0x0000000000000000000000000000000000000004');
const txHash = graph_ts_1.Bytes.fromI32(11);
const logIndex = graph_ts_1.BigInt.fromI32(3);
const updateBlockTimestamp = graph_ts_1.BigInt.fromI32(946684800);
const updateBlockNumber = graph_ts_1.BigInt.fromI32(15537394);
const proposalId = graph_ts_1.BigInt.fromI32(42);
(0, index_1.afterEach)(() => {
    (0, index_1.clearStore)();
});
(0, index_1.describe)('nouns-dao', () => {
    (0, index_1.beforeEach)(() => {
        const delegate = (0, helpers_1.getOrCreateDelegate)(proposerWithDelegate.toHexString());
        delegate.tokenHoldersRepresentedAmount = 1;
        delegate.delegatedVotes = constants_1.BIGINT_ONE;
        delegate.delegatedVotesRaw = constants_1.BIGINT_ONE;
        delegate.save();
        (0, index_1.createMockedFunction)(graph_ts_1.Address.fromString(SOME_ADDRESS), 'adjustedTotalSupply', 'adjustedTotalSupply():(uint256)').returns([graph_ts_1.ethereum.Value.fromUnsignedBigInt(graph_ts_1.BigInt.fromI32(600))]);
    });
    (0, index_1.describe)('handleProposalCreated', () => {
        (0, index_1.describe)('field setting', () => {
            (0, index_1.test)('copies values from ParsedProposalV3 and saves a ProposalVersion', () => {
                const createdBlock = graph_ts_1.BigInt.fromI32(100);
                const propData = new utils_1.ProposalCreatedData();
                propData.id = graph_ts_1.BigInt.fromI32(42);
                propData.proposer = proposerWithDelegate;
                propData.targets = [graph_ts_1.Address.fromString(SOME_ADDRESS)];
                propData.values = [graph_ts_1.BigInt.fromI32(123)];
                propData.signatures = ['some signature'];
                propData.calldatas = [graph_ts_1.Bytes.fromI32(312)];
                propData.startBlock = createdBlock.plus(graph_ts_1.BigInt.fromI32(200));
                propData.endBlock = createdBlock.plus(graph_ts_1.BigInt.fromI32(300));
                propData.description = 'some description';
                propData.eventBlockNumber = createdBlock;
                propData.eventBlockTimestamp = graph_ts_1.BigInt.fromI32(946684800);
                propData.txHash = graph_ts_1.Bytes.fromI32(11);
                propData.logIndex = graph_ts_1.BigInt.fromI32(2);
                propData.address = graph_ts_1.Address.fromString(SOME_ADDRESS);
                const propExtraDetails = new ParsedProposalV3_1.ParsedProposalV3();
                propExtraDetails.id = propData.id.toString();
                propExtraDetails.updatePeriodEndBlock = graph_ts_1.BigInt.fromI32(150);
                propExtraDetails.proposalThreshold = graph_ts_1.BigInt.fromI32(42);
                propExtraDetails.quorumVotes = graph_ts_1.BigInt.fromI32(43);
                (0, nouns_dao_1.handleProposalCreated)((0, utils_1.createProposalCreatedEvent)(propData));
                (0, nouns_dao_1.saveProposalExtraDetails)(propExtraDetails);
                const proposal = schema_1.Proposal.load('42');
                index_1.assert.stringEquals(proposal.proposer, propData.proposer.toHexString());
                index_1.assert.bytesEquals(proposal.targets[0], propData.targets[0]);
                index_1.assert.bigIntEquals(proposal.values[0], propData.values[0]);
                index_1.assert.stringEquals(proposal.signatures[0], propData.signatures[0]);
                index_1.assert.bytesEquals(proposal.calldatas[0], propData.calldatas[0]);
                index_1.assert.bigIntEquals(proposal.createdTimestamp, propData.eventBlockTimestamp);
                index_1.assert.bigIntEquals(proposal.createdBlock, propData.eventBlockNumber);
                index_1.assert.bytesEquals(proposal.createdTransactionHash, propData.txHash);
                index_1.assert.bigIntEquals(proposal.startBlock, propData.startBlock);
                index_1.assert.bigIntEquals(proposal.endBlock, propData.endBlock);
                index_1.assert.bigIntEquals(proposal.updatePeriodEndBlock, propExtraDetails.updatePeriodEndBlock);
                index_1.assert.bigIntEquals(proposal.proposalThreshold, propExtraDetails.proposalThreshold);
                index_1.assert.bigIntEquals(proposal.quorumVotes, propExtraDetails.quorumVotes);
                index_1.assert.stringEquals(proposal.description, propData.description);
                index_1.assert.stringEquals(proposal.title, (0, ParsedProposalV3_1.extractTitle)(propData.description));
                index_1.assert.stringEquals(proposal.status, constants_1.STATUS_PENDING);
                const versionId = propData.txHash
                    .toHexString()
                    .concat('-')
                    .concat(propData.logIndex.toString());
                const propVersion = schema_1.ProposalVersion.load(versionId);
                index_1.assert.stringEquals('42', propVersion.proposal);
                index_1.assert.bigIntEquals(propData.eventBlockTimestamp, propVersion.createdAt);
                index_1.assert.bytesEquals(changetype(propData.targets)[0], propVersion.targets[0]);
                index_1.assert.bigIntEquals(propData.values[0], propVersion.values[0]);
                index_1.assert.stringEquals(propData.signatures[0], propVersion.signatures[0]);
                index_1.assert.bytesEquals(propData.calldatas[0], propVersion.calldatas[0]);
                index_1.assert.stringEquals(propData.description, propVersion.description);
                index_1.assert.stringEquals((0, ParsedProposalV3_1.extractTitle)(propData.description), propVersion.title);
                index_1.assert.stringEquals('', propVersion.updateMessage);
            });
            (0, index_1.test)('copies values from governance and dynamic quorum', () => {
                const governance = (0, helpers_1.getGovernanceEntity)();
                governance.totalTokenHolders = graph_ts_1.BigInt.fromI32(601);
                governance.save();
                const dq = (0, helpers_1.getOrCreateDynamicQuorumParams)();
                dq.minQuorumVotesBPS = 100;
                dq.maxQuorumVotesBPS = 150;
                dq.quorumCoefficient = constants_1.BIGINT_ONE;
                dq.save();
                const data = new utils_1.ProposalCreatedData();
                data.id = graph_ts_1.BigInt.fromI32(43);
                data.proposer = proposerWithDelegate;
                data.description = 'some description';
                data.txHash = graph_ts_1.Bytes.fromI32(11);
                data.logIndex = graph_ts_1.BigInt.fromI32(2);
                data.address = graph_ts_1.Address.fromString(SOME_ADDRESS);
                const proposalEvent = (0, utils_1.createProposalCreatedEvent)(data);
                (0, nouns_dao_1.handleProposalCreated)(proposalEvent);
                index_1.assert.fieldEquals('Proposal', '43', 'totalSupply', '601');
                index_1.assert.fieldEquals('Proposal', '43', 'minQuorumVotesBPS', '100');
                index_1.assert.fieldEquals('Proposal', '43', 'maxQuorumVotesBPS', '150');
                index_1.assert.fieldEquals('Proposal', '43', 'quorumCoefficient', '1');
            });
            (0, index_1.test)('sets votes and objection period block to zero', () => {
                const data = new utils_1.ProposalCreatedData();
                data.id = graph_ts_1.BigInt.fromI32(44);
                data.proposer = proposerWithDelegate;
                data.description = 'some description';
                data.txHash = graph_ts_1.Bytes.fromI32(11);
                data.logIndex = graph_ts_1.BigInt.fromI32(2);
                data.address = graph_ts_1.Address.fromString(SOME_ADDRESS);
                const proposalEvent = (0, utils_1.createProposalCreatedEvent)(data);
                (0, nouns_dao_1.handleProposalCreated)(proposalEvent);
                index_1.assert.fieldEquals('Proposal', '44', 'forVotes', '0');
                index_1.assert.fieldEquals('Proposal', '44', 'againstVotes', '0');
                index_1.assert.fieldEquals('Proposal', '44', 'abstainVotes', '0');
                index_1.assert.fieldEquals('Proposal', '44', 'objectionPeriodEndBlock', '0');
            });
        });
    });
});
(0, index_1.describe)('handleVoteCast', () => {
    (0, index_1.beforeEach)(() => {
        (0, index_1.createMockedFunction)(graph_ts_1.Address.fromString(SOME_ADDRESS), 'adjustedTotalSupply', 'adjustedTotalSupply():(uint256)').returns([graph_ts_1.ethereum.Value.fromUnsignedBigInt(graph_ts_1.BigInt.fromI32(200))]);
    });
    (0, index_1.afterEach)(() => {
        (0, index_1.clearStore)();
    });
    (0, index_1.test)('given V1 prop does not update quorumVotes using dynamic quorum', () => {
        (0, helpers_1.getOrCreateDelegate)(SOME_ADDRESS);
        const totalSupply = graph_ts_1.BigInt.fromI32(200);
        // Set total supply
        const governance = (0, helpers_1.getGovernanceEntity)();
        governance.totalTokenHolders = totalSupply;
        governance.save();
        // Save dynamic quorum params
        (0, utils_1.handleAllQuorumParamEvents)(1000, 4000, graph_ts_1.BigInt.fromI32(1500000));
        const dqParams = (0, helpers_1.getOrCreateDynamicQuorumParams)(null);
        index_1.assert.bigIntEquals(constants_1.BIGINT_ZERO, dqParams.dynamicQuorumStartBlock);
        // Create prop with state we need for quorum inputs
        // providing block number zero means this prop will look like a V1 prop
        // since the DQ events above are simulated to be at block zero
        const data = new utils_1.ProposalCreatedData();
        data.id = constants_1.BIGINT_ONE;
        data.proposer = proposerWithDelegate;
        data.description = 'some description';
        data.txHash = graph_ts_1.Bytes.fromI32(11);
        data.logIndex = graph_ts_1.BigInt.fromI32(2);
        data.address = graph_ts_1.Address.fromString(SOME_ADDRESS);
        data.eventBlockNumber = constants_1.BIGINT_ZERO;
        (0, nouns_dao_1.handleProposalCreated)((0, utils_1.createProposalCreatedEvent)(data));
        const propExtraDetails = new ParsedProposalV3_1.ParsedProposalV3();
        propExtraDetails.id = data.id.toString();
        propExtraDetails.updatePeriodEndBlock = graph_ts_1.BigInt.fromI32(150);
        propExtraDetails.proposalThreshold = graph_ts_1.BigInt.fromI32(42);
        propExtraDetails.quorumVotes = constants_1.BIGINT_ONE;
        (0, nouns_dao_1.saveProposalExtraDetails)(propExtraDetails);
        let savedProp = schema_1.Proposal.load(data.id.toString());
        index_1.assert.bigIntEquals(constants_1.BIGINT_ONE, savedProp.quorumVotes);
        const voter = graph_ts_1.Address.fromString(SOME_ADDRESS);
        const support = 0; // against
        const votes = graph_ts_1.BigInt.fromI32(32);
        const voteEvent = (0, utils_1.createVoteCastEvent)(voter, data.id, support, votes);
        (0, nouns_dao_1.handleVoteCast)(voteEvent);
        savedProp = schema_1.Proposal.load(data.id.toString());
        index_1.assert.bigIntEquals(constants_1.BIGINT_ONE, savedProp.quorumVotes);
    });
    (0, index_1.test)('updates quorumVotes using dynamic quorum math', () => {
        (0, helpers_1.getOrCreateDelegate)(SOME_ADDRESS);
        const totalSupply = graph_ts_1.BigInt.fromI32(200);
        // Set total supply
        const governance = (0, helpers_1.getGovernanceEntity)();
        governance.totalTokenHolders = totalSupply;
        governance.save();
        // Save dynamic quorum params
        (0, utils_1.handleAllQuorumParamEvents)(1000, 4000, graph_ts_1.BigInt.fromI32(1500000));
        const dqParams = (0, helpers_1.getOrCreateDynamicQuorumParams)(null);
        index_1.assert.bigIntEquals(constants_1.BIGINT_ZERO, dqParams.dynamicQuorumStartBlock);
        // Create prop with state we need for quorum inputs
        // providing a block number greater than zero means this prop will look like a V2 prop
        // since the DQ events above are simulated to be at block zero
        const data = new utils_1.ProposalCreatedData();
        data.id = constants_1.BIGINT_ONE;
        data.proposer = proposerWithDelegate;
        data.description = 'some description';
        data.txHash = graph_ts_1.Bytes.fromI32(11);
        data.logIndex = graph_ts_1.BigInt.fromI32(2);
        data.address = graph_ts_1.Address.fromString(SOME_ADDRESS);
        data.eventBlockNumber = constants_1.BIGINT_ONE;
        (0, nouns_dao_1.handleProposalCreated)((0, utils_1.createProposalCreatedEvent)(data));
        const propExtraDetails = new ParsedProposalV3_1.ParsedProposalV3();
        propExtraDetails.id = data.id.toString();
        propExtraDetails.updatePeriodEndBlock = graph_ts_1.BigInt.fromI32(150);
        propExtraDetails.proposalThreshold = constants_1.BIGINT_ONE;
        propExtraDetails.quorumVotes = constants_1.BIGINT_ONE;
        (0, nouns_dao_1.saveProposalExtraDetails)(propExtraDetails);
        const voter = graph_ts_1.Address.fromString(SOME_ADDRESS);
        const propId = constants_1.BIGINT_ONE;
        const support = 0; // against
        const votes = graph_ts_1.BigInt.fromI32(32);
        const voteEvent = (0, utils_1.createVoteCastEvent)(voter, propId, support, votes);
        (0, nouns_dao_1.handleVoteCast)(voteEvent);
        const savedProp = schema_1.Proposal.load(propId.toString());
        index_1.assert.bigIntEquals(graph_ts_1.BigInt.fromI32(68), savedProp.quorumVotes);
    });
    (0, index_1.test)('uses quorum params from prop creation time, not newer params', () => {
        (0, helpers_1.getOrCreateDelegate)(SOME_ADDRESS);
        const totalSupply = graph_ts_1.BigInt.fromI32(200);
        // Set total supply
        const governance = (0, helpers_1.getGovernanceEntity)();
        governance.totalTokenHolders = totalSupply;
        governance.save();
        // Save dynamic quorum params
        (0, utils_1.handleAllQuorumParamEvents)(1000, 4000, graph_ts_1.BigInt.fromI32(1200000));
        // Create prop with state we need for quorum inputs
        // providing a block number greater than zero means this prop will look like a V2 prop
        // since the DQ events above are simulated to be at block zero
        const data = new utils_1.ProposalCreatedData();
        data.id = constants_1.BIGINT_ONE;
        data.proposer = proposerWithDelegate;
        data.description = 'some description';
        data.txHash = graph_ts_1.Bytes.fromI32(11);
        data.logIndex = graph_ts_1.BigInt.fromI32(2);
        data.address = graph_ts_1.Address.fromString(SOME_ADDRESS);
        data.eventBlockNumber = constants_1.BIGINT_ONE;
        (0, nouns_dao_1.handleProposalCreated)((0, utils_1.createProposalCreatedEvent)(data));
        const propExtraDetails = new ParsedProposalV3_1.ParsedProposalV3();
        propExtraDetails.id = data.id.toString();
        propExtraDetails.updatePeriodEndBlock = graph_ts_1.BigInt.fromI32(150);
        propExtraDetails.proposalThreshold = constants_1.BIGINT_ONE;
        propExtraDetails.quorumVotes = constants_1.BIGINT_ONE;
        (0, nouns_dao_1.saveProposalExtraDetails)(propExtraDetails);
        (0, utils_1.handleAllQuorumParamEvents)(500, 6000, graph_ts_1.BigInt.fromI32(3000000));
        const voter = graph_ts_1.Address.fromString(SOME_ADDRESS);
        const propId = constants_1.BIGINT_ONE;
        const support = 0; // against
        const votes = graph_ts_1.BigInt.fromI32(25);
        const voteEvent = (0, utils_1.createVoteCastEvent)(voter, propId, support, votes);
        (0, nouns_dao_1.handleVoteCast)(voteEvent);
        const savedProp = schema_1.Proposal.load(propId.toString());
        index_1.assert.bigIntEquals(graph_ts_1.BigInt.fromI32(50), savedProp.quorumVotes);
    });
});
(0, index_1.describe)('dynamic quorum config handlers', () => {
    (0, index_1.afterEach)(() => {
        (0, index_1.clearStore)();
    });
    (0, index_1.test)('handleMinQuorumVotesBPSSet: saves incoming values', () => {
        const event1 = (0, utils_1.createMinQuorumVotesBPSSetEvent)(0, 1);
        (0, nouns_dao_1.handleMinQuorumVotesBPSSet)(event1);
        index_1.assert.i32Equals(1, (0, helpers_1.getOrCreateDynamicQuorumParams)(constants_1.BIGINT_ZERO).minQuorumVotesBPS);
        const event2 = (0, utils_1.createMinQuorumVotesBPSSetEvent)(1, 2);
        (0, nouns_dao_1.handleMinQuorumVotesBPSSet)(event2);
        index_1.assert.i32Equals(2, (0, helpers_1.getOrCreateDynamicQuorumParams)(constants_1.BIGINT_ZERO).minQuorumVotesBPS);
    });
    (0, index_1.test)('handleMaxQuorumVotesBPSSet: saves incoming values', () => {
        const event1 = (0, utils_1.createMaxQuorumVotesBPSSetEvent)(0, 1000);
        (0, nouns_dao_1.handleMaxQuorumVotesBPSSet)(event1);
        index_1.assert.i32Equals(1000, (0, helpers_1.getOrCreateDynamicQuorumParams)(constants_1.BIGINT_ZERO).maxQuorumVotesBPS);
        const event2 = (0, utils_1.createMaxQuorumVotesBPSSetEvent)(1000, 2000);
        (0, nouns_dao_1.handleMaxQuorumVotesBPSSet)(event2);
        index_1.assert.i32Equals(2000, (0, helpers_1.getOrCreateDynamicQuorumParams)(constants_1.BIGINT_ZERO).maxQuorumVotesBPS);
    });
    (0, index_1.test)('handleQuorumCoefficientSet: saves incoming values', () => {
        const event1 = (0, utils_1.createQuorumCoefficientSetEvent)(constants_1.BIGINT_ZERO, constants_1.BIGINT_ONE);
        (0, nouns_dao_1.handleQuorumCoefficientSet)(event1);
        index_1.assert.bigIntEquals(constants_1.BIGINT_ONE, (0, helpers_1.getOrCreateDynamicQuorumParams)(constants_1.BIGINT_ZERO).quorumCoefficient);
        const event2 = (0, utils_1.createQuorumCoefficientSetEvent)(constants_1.BIGINT_ONE, constants_1.BIGINT_10K);
        (0, nouns_dao_1.handleQuorumCoefficientSet)(event2);
        index_1.assert.bigIntEquals(constants_1.BIGINT_10K, (0, helpers_1.getOrCreateDynamicQuorumParams)(constants_1.BIGINT_ZERO).quorumCoefficient);
    });
});
(0, index_1.describe)('handleProposalObjectionPeriodSet', () => {
    (0, index_1.test)('sets the objectionPeriodEndBlock field', () => {
        const propData = new utils_1.ProposalCreatedData();
        propData.id = constants_1.BIGINT_ONE;
        propData.proposer = proposerWithDelegate;
        propData.targets = [graph_ts_1.Address.fromString(SOME_ADDRESS)];
        propData.values = [graph_ts_1.BigInt.fromI32(123)];
        propData.signatures = ['some signature'];
        propData.calldatas = [graph_ts_1.Bytes.fromI32(312)];
        propData.startBlock = graph_ts_1.BigInt.fromI32(203);
        propData.endBlock = graph_ts_1.BigInt.fromI32(303);
        propData.description = 'some description';
        propData.eventBlockNumber = graph_ts_1.BigInt.fromI32(103);
        propData.eventBlockTimestamp = graph_ts_1.BigInt.fromI32(42);
        propData.txHash = graph_ts_1.Bytes.fromI32(11);
        propData.logIndex = graph_ts_1.BigInt.fromI32(1);
        propData.address = graph_ts_1.Address.fromString(SOME_ADDRESS);
        (0, nouns_dao_1.handleProposalCreated)((0, utils_1.createProposalCreatedEvent)(propData));
        const propExtraDetails = new ParsedProposalV3_1.ParsedProposalV3();
        propExtraDetails.id = propData.id.toString();
        propExtraDetails.updatePeriodEndBlock = graph_ts_1.BigInt.fromI32(150);
        propExtraDetails.proposalThreshold = constants_1.BIGINT_ONE;
        propExtraDetails.quorumVotes = constants_1.BIGINT_ONE;
        (0, nouns_dao_1.saveProposalExtraDetails)(propExtraDetails);
        index_1.assert.fieldEquals('Proposal', '1', 'objectionPeriodEndBlock', '0');
        (0, nouns_dao_1.handleProposalObjectionPeriodSet)((0, utils_1.createProposalObjectionPeriodSetEvent)(constants_1.BIGINT_ONE, constants_1.BIGINT_10K));
        index_1.assert.fieldEquals('Proposal', '1', 'objectionPeriodEndBlock', '10000');
    });
});
(0, index_1.describe)('Proposal Updated', () => {
    (0, index_1.beforeEach)(() => {
        const propData = new utils_1.ProposalCreatedData();
        propData.id = proposalId;
        propData.proposer = proposerWithDelegate;
        propData.targets = [signerWithNoDelegate];
        propData.values = [graph_ts_1.BigInt.fromI32(987)];
        propData.signatures = ['first signature'];
        propData.calldatas = [graph_ts_1.Bytes.fromI32(888)];
        propData.startBlock = graph_ts_1.BigInt.fromI32(203);
        propData.endBlock = graph_ts_1.BigInt.fromI32(303);
        propData.description = '# Original Title\nOriginal body';
        propData.eventBlockNumber = updateBlockNumber.minus(constants_1.BIGINT_ONE);
        propData.eventBlockTimestamp = updateBlockTimestamp.minus(constants_1.BIGINT_ONE);
        propData.txHash = graph_ts_1.Bytes.fromI32(11);
        propData.logIndex = graph_ts_1.BigInt.fromI32(1);
        propData.address = graph_ts_1.Address.fromString(SOME_ADDRESS);
        (0, nouns_dao_1.handleProposalCreated)((0, utils_1.createProposalCreatedEvent)(propData));
        const propExtraDetails = new ParsedProposalV3_1.ParsedProposalV3();
        propExtraDetails.id = propData.id.toString();
        propExtraDetails.updatePeriodEndBlock = graph_ts_1.BigInt.fromI32(150);
        propExtraDetails.proposalThreshold = constants_1.BIGINT_ONE;
        propExtraDetails.quorumVotes = constants_1.BIGINT_ONE;
        (0, nouns_dao_1.saveProposalExtraDetails)(propExtraDetails);
    });
    (0, index_1.test)('handleProposalDescriptionUpdated', () => {
        const updateDescription = '# Updated Title\nUpdated body';
        const updateMessage = 'some update message';
        (0, nouns_dao_1.handleProposalDescriptionUpdated)((0, utils_1.createProposalDescriptionUpdatedEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, proposalId, proposerWithDelegate, updateDescription, updateMessage));
        const proposal = schema_1.Proposal.load(proposalId.toString());
        index_1.assert.bigIntEquals(updateBlockTimestamp, proposal.lastUpdatedTimestamp);
        index_1.assert.bigIntEquals(updateBlockNumber, proposal.lastUpdatedBlock);
        index_1.assert.stringEquals(updateDescription, proposal.description);
        index_1.assert.stringEquals((0, ParsedProposalV3_1.extractTitle)(updateDescription), proposal.title);
        // check that the original values remained as is
        index_1.assert.bytesEquals(signerWithNoDelegate, proposal.targets[0]);
        index_1.assert.bigIntEquals(graph_ts_1.BigInt.fromI32(987), proposal.values[0]);
        index_1.assert.stringEquals('first signature', proposal.signatures[0]);
        index_1.assert.bytesEquals(graph_ts_1.Bytes.fromI32(888), proposal.calldatas[0]);
        const updatedVersionId = txHash.toHexString().concat('-').concat(logIndex.toString());
        const updatedVersion = schema_1.ProposalVersion.load(updatedVersionId);
        index_1.assert.stringEquals(proposalId.toString(), updatedVersion.proposal);
        index_1.assert.bigIntEquals(updateBlockTimestamp, updatedVersion.createdAt);
        index_1.assert.stringEquals(updateDescription, updatedVersion.description);
        index_1.assert.stringEquals((0, ParsedProposalV3_1.extractTitle)(updateDescription), updatedVersion.title);
        index_1.assert.stringEquals(updateMessage, updatedVersion.updateMessage);
        // check that the original values are saved
        index_1.assert.bytesEquals(signerWithNoDelegate, updatedVersion.targets[0]);
        index_1.assert.bigIntEquals(graph_ts_1.BigInt.fromI32(987), updatedVersion.values[0]);
        index_1.assert.stringEquals('first signature', updatedVersion.signatures[0]);
        index_1.assert.bytesEquals(graph_ts_1.Bytes.fromI32(888), updatedVersion.calldatas[0]);
    });
    (0, index_1.test)('handleProposalTransactionsUpdated', () => {
        const updateTargets = [signerWithDelegate];
        const updateValues = [graph_ts_1.BigInt.fromI32(321)];
        const updateSignatures = ['update signature'];
        const updateCalldatas = [graph_ts_1.Bytes.fromI32(312)];
        const updateMessage = 'some update message';
        (0, nouns_dao_1.handleProposalTransactionsUpdated)((0, utils_1.createProposalTransactionsUpdatedEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, proposalId, proposerWithDelegate, updateTargets, updateValues, updateSignatures, updateCalldatas, updateMessage));
        const proposal = schema_1.Proposal.load(proposalId.toString());
        index_1.assert.bigIntEquals(updateBlockTimestamp, proposal.lastUpdatedTimestamp);
        index_1.assert.bigIntEquals(updateBlockNumber, proposal.lastUpdatedBlock);
        index_1.assert.bytesEquals(changetype(updateTargets)[0], proposal.targets[0]);
        index_1.assert.bigIntEquals(updateValues[0], proposal.values[0]);
        index_1.assert.stringEquals(updateSignatures[0], proposal.signatures[0]);
        index_1.assert.bytesEquals(updateCalldatas[0], proposal.calldatas[0]);
        // check that the original values remained as is
        index_1.assert.stringEquals('# Original Title\nOriginal body', proposal.description);
        index_1.assert.stringEquals('Original Title', proposal.title);
        const updatedVersionId = txHash.toHexString().concat('-').concat(logIndex.toString());
        const updatedVersion = schema_1.ProposalVersion.load(updatedVersionId);
        index_1.assert.stringEquals(proposalId.toString(), updatedVersion.proposal);
        index_1.assert.bigIntEquals(updateBlockTimestamp, updatedVersion.createdAt);
        index_1.assert.bytesEquals(changetype(updateTargets)[0], updatedVersion.targets[0]);
        index_1.assert.bigIntEquals(updateValues[0], updatedVersion.values[0]);
        index_1.assert.stringEquals(updateSignatures[0], updatedVersion.signatures[0]);
        index_1.assert.bytesEquals(updateCalldatas[0], updatedVersion.calldatas[0]);
        index_1.assert.stringEquals(updateMessage, updatedVersion.updateMessage);
        // check that the original values are saved
        index_1.assert.stringEquals('# Original Title\nOriginal body', updatedVersion.description);
        index_1.assert.stringEquals('Original Title', updatedVersion.title);
    });
    (0, index_1.test)('handleProposalUpdated', () => {
        const updateTargets = [signerWithDelegate];
        const updateValues = [graph_ts_1.BigInt.fromI32(321)];
        const updateSignatures = ['update signature'];
        const updateCalldatas = [graph_ts_1.Bytes.fromI32(312)];
        const updateDescription = '# Updated Title\nUpdated body';
        const updateMessage = 'some update message';
        (0, nouns_dao_1.handleProposalUpdated)((0, utils_1.createProposalUpdatedEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, proposalId, proposerWithDelegate, updateTargets, updateValues, updateSignatures, updateCalldatas, updateDescription, updateMessage));
        const proposal = schema_1.Proposal.load(proposalId.toString());
        index_1.assert.bigIntEquals(updateBlockTimestamp, proposal.lastUpdatedTimestamp);
        index_1.assert.bigIntEquals(updateBlockNumber, proposal.lastUpdatedBlock);
        index_1.assert.bytesEquals(changetype(updateTargets)[0], proposal.targets[0]);
        index_1.assert.bigIntEquals(updateValues[0], proposal.values[0]);
        index_1.assert.stringEquals(updateSignatures[0], proposal.signatures[0]);
        index_1.assert.bytesEquals(updateCalldatas[0], proposal.calldatas[0]);
        index_1.assert.stringEquals(updateDescription, proposal.description);
        index_1.assert.stringEquals((0, ParsedProposalV3_1.extractTitle)(updateDescription), proposal.title);
        const updatedVersionId = txHash.toHexString().concat('-').concat(logIndex.toString());
        const updatedVersion = schema_1.ProposalVersion.load(updatedVersionId);
        index_1.assert.stringEquals(proposalId.toString(), updatedVersion.proposal);
        index_1.assert.bigIntEquals(updateBlockTimestamp, updatedVersion.createdAt);
        index_1.assert.bytesEquals(changetype(updateTargets)[0], updatedVersion.targets[0]);
        index_1.assert.bigIntEquals(updateValues[0], updatedVersion.values[0]);
        index_1.assert.stringEquals(updateSignatures[0], updatedVersion.signatures[0]);
        index_1.assert.bytesEquals(updateCalldatas[0], updatedVersion.calldatas[0]);
        index_1.assert.stringEquals(updateDescription, updatedVersion.description);
        index_1.assert.stringEquals((0, ParsedProposalV3_1.extractTitle)(updateDescription), updatedVersion.title);
        index_1.assert.stringEquals(updateMessage, updatedVersion.updateMessage);
    });
});
(0, index_1.describe)('ParsedProposalV3', () => {
    (0, index_1.describe)('parses signers', () => {
        (0, index_1.test)('fromV1Event', () => {
            const propEventInput = (0, utils_1.stubProposalCreatedWithRequirementsEventInput)();
            propEventInput.signers = [graph_ts_1.Address.fromString(SOME_ADDRESS)];
            const newPropEvent = (0, utils_1.createProposalCreatedWithRequirementsEventV1)(propEventInput);
            const parsedProposal = ParsedProposalV3_1.ParsedProposalV3.fromV1Event(newPropEvent);
            index_1.assert.i32Equals(parsedProposal.signers.length, 0);
        });
        (0, index_1.test)('fromV3Event', () => {
            const propEventInput = (0, utils_1.stubProposalCreatedWithRequirementsEventInput)();
            propEventInput.signers = [graph_ts_1.Address.fromString(SOME_ADDRESS), proposerWithDelegate];
            const newPropEvent = (0, utils_1.createProposalCreatedWithRequirementsEventV3)(propEventInput);
            const parsedProposal = ParsedProposalV3_1.ParsedProposalV3.fromV3Event(newPropEvent);
            index_1.assert.i32Equals(parsedProposal.signers.length, 2);
            index_1.assert.stringEquals(parsedProposal.signers[0], SOME_ADDRESS);
            index_1.assert.stringEquals(parsedProposal.signers[1], proposerWithDelegate.toHexString());
        });
    });
});
(0, index_1.describe)('forking', () => {
    (0, index_1.describe)('escrow deposit and withdraw', () => {
        (0, index_1.afterAll)(() => {
            (0, index_1.clearStore)();
        });
        (0, index_1.test)('one deposit with 3 nouns, one withdrawal of 1 noun, results in 2 escrowed nouns', () => {
            const escrowBlockTimestamp = graph_ts_1.BigInt.fromI32(946684800);
            const withdrawBlockTimestamp = graph_ts_1.BigInt.fromI32(956684800);
            const nouner = graph_ts_1.Address.fromString('0x0000000000000000000000000000000000000001');
            const depositTokenIds = [graph_ts_1.BigInt.fromI32(1), graph_ts_1.BigInt.fromI32(4), graph_ts_1.BigInt.fromI32(2)];
            const withdrawTokenIds = [graph_ts_1.BigInt.fromI32(1)];
            const proposalIds = [graph_ts_1.BigInt.fromI32(1234)];
            const forkId = constants_1.BIGINT_ZERO;
            (0, nouns_dao_1.handleEscrowedToFork)((0, utils_1.createEscrowedToForkEvent)(txHash, constants_1.BIGINT_ZERO, escrowBlockTimestamp, nouner, depositTokenIds, proposalIds, 'some reason', forkId));
            (0, nouns_dao_1.handleWithdrawFromForkEscrow)((0, utils_1.createWithdrawFromForkEscrowEvent)(txHash, constants_1.BIGINT_ZERO, withdrawBlockTimestamp, nouner, withdrawTokenIds, forkId));
            const fork = (0, helpers_1.getOrCreateFork)(forkId);
            index_1.assert.i32Equals(fork.tokensInEscrowCount, 2);
            index_1.assert.i32Equals(fork.escrowedNouns.load().length, 2);
            const escrowedNoun = schema_1.EscrowedNoun.load(forkId.toString().concat('-4'));
            const escrowDespositId = txHash.toHexString().concat('-0');
            index_1.assert.stringEquals(escrowedNoun.fork, forkId.toString());
            index_1.assert.stringEquals(escrowedNoun.noun, '4');
            index_1.assert.stringEquals(escrowedNoun.owner, nouner.toHexString());
            index_1.assert.stringEquals(escrowedNoun.escrowDeposit, escrowDespositId);
            const escrowDeposit = schema_1.EscrowDeposit.load(escrowDespositId);
            index_1.assert.stringEquals(escrowDeposit.fork, forkId.toString());
            index_1.assert.bigIntEquals(escrowDeposit.createdAt, escrowBlockTimestamp);
            index_1.assert.stringEquals(escrowDeposit.owner, nouner.toHexString());
            index_1.assert.i32Equals(escrowDeposit.tokenIDs.length, 3);
            index_1.assert.bigIntEquals(escrowDeposit.tokenIDs[0], graph_ts_1.BigInt.fromI32(1));
            index_1.assert.bigIntEquals(escrowDeposit.tokenIDs[1], graph_ts_1.BigInt.fromI32(4));
            index_1.assert.bigIntEquals(escrowDeposit.tokenIDs[2], graph_ts_1.BigInt.fromI32(2));
            index_1.assert.bigIntEquals(escrowDeposit.proposalIDs[0], graph_ts_1.BigInt.fromI32(1234));
            index_1.assert.stringEquals(escrowDeposit.reason, 'some reason');
        });
    });
});
(0, index_1.describe)('Proposal status changes', () => {
    (0, index_1.beforeEach)(() => {
        const propData = new utils_1.ProposalCreatedData();
        propData.id = proposalId;
        propData.proposer = proposerWithDelegate;
        propData.targets = [graph_ts_1.Address.fromString(SOME_ADDRESS)];
        propData.values = [graph_ts_1.BigInt.fromI32(123)];
        propData.signatures = ['some signature'];
        propData.calldatas = [graph_ts_1.Bytes.fromI32(312)];
        propData.startBlock = graph_ts_1.BigInt.fromI32(203);
        propData.endBlock = graph_ts_1.BigInt.fromI32(303);
        propData.description = 'some description';
        propData.eventBlockNumber = graph_ts_1.BigInt.fromI32(103);
        propData.eventBlockTimestamp = graph_ts_1.BigInt.fromI32(42);
        propData.txHash = graph_ts_1.Bytes.fromI32(11);
        propData.logIndex = graph_ts_1.BigInt.fromI32(1);
        propData.address = graph_ts_1.Address.fromString(SOME_ADDRESS);
        (0, nouns_dao_1.handleProposalCreated)((0, utils_1.createProposalCreatedEvent)(propData));
        const propExtraDetails = new ParsedProposalV3_1.ParsedProposalV3();
        propExtraDetails.id = propData.id.toString();
        propExtraDetails.updatePeriodEndBlock = graph_ts_1.BigInt.fromI32(150);
        propExtraDetails.proposalThreshold = constants_1.BIGINT_ONE;
        propExtraDetails.quorumVotes = constants_1.BIGINT_ONE;
        (0, nouns_dao_1.saveProposalExtraDetails)(propExtraDetails);
    });
    (0, index_1.test)('handleProposalCanceled', () => {
        (0, nouns_dao_1.handleProposalCanceled)((0, utils_1.createProposalCanceledEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, proposalId));
        const proposal = schema_1.Proposal.load(proposalId.toString());
        index_1.assert.stringEquals(constants_1.STATUS_CANCELLED, proposal.status);
        index_1.assert.bigIntEquals(updateBlockTimestamp, proposal.canceledTimestamp);
        index_1.assert.bigIntEquals(updateBlockNumber, proposal.canceledBlock);
    });
    (0, index_1.test)('handleProposalVetoed', () => {
        (0, nouns_dao_1.handleProposalVetoed)((0, utils_1.createProposalVetoedEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, proposalId));
        const proposal = schema_1.Proposal.load(proposalId.toString());
        index_1.assert.stringEquals(constants_1.STATUS_VETOED, proposal.status);
        index_1.assert.bigIntEquals(updateBlockTimestamp, proposal.vetoedTimestamp);
        index_1.assert.bigIntEquals(updateBlockNumber, proposal.vetoedBlock);
    });
    (0, index_1.test)('handleProposalQueued', () => {
        const eta = updateBlockTimestamp.plus(graph_ts_1.BigInt.fromI32(100));
        (0, nouns_dao_1.handleProposalQueued)((0, utils_1.createProposalQueuedEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, proposalId, eta));
        const proposal = schema_1.Proposal.load(proposalId.toString());
        index_1.assert.stringEquals(constants_1.STATUS_QUEUED, proposal.status);
        index_1.assert.bigIntEquals(updateBlockTimestamp, proposal.queuedTimestamp);
        index_1.assert.bigIntEquals(updateBlockNumber, proposal.queuedBlock);
        index_1.assert.bigIntEquals(eta, proposal.executionETA);
    });
    (0, index_1.test)('handleProposalExecuted', () => {
        (0, nouns_dao_1.handleProposalExecuted)((0, utils_1.createProposalExecutedEvent)(txHash, logIndex, updateBlockTimestamp, updateBlockNumber, proposalId));
        const proposal = schema_1.Proposal.load(proposalId.toString());
        index_1.assert.stringEquals(constants_1.STATUS_EXECUTED, proposal.status);
        index_1.assert.bigIntEquals(updateBlockTimestamp, proposal.executedTimestamp);
        index_1.assert.bigIntEquals(updateBlockNumber, proposal.executedBlock);
    });
});
